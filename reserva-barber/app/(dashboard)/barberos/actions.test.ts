import { describe, it, expect, vi, beforeEach } from 'vitest';
import { COPY } from '@/lib/copy';
import { INITIAL_BARBER_FORM_STATE } from './formState';

const requireOwner = vi.fn(async () => ({ id: 'owner-root', email: 'owner@example.com' }));
const createBarber = vi.fn(async () => undefined);
const updateBarber = vi.fn(async () => undefined);
const loggerError = vi.fn();

vi.mock('@/server/infrastructure/supabase/requireOwner', () => ({
  requireOwner: () => requireOwner(),
}));
vi.mock('@/server/infrastructure/prisma/client', () => ({ getPrismaClient: () => ({}) }));
vi.mock('@/server/infrastructure/prisma/PrismaBarberRepository', () => ({
  PrismaBarberRepository: class {},
}));
vi.mock('@/server/infrastructure/prisma/PrismaLocationRepository', () => ({
  PrismaLocationRepository: class {},
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: (path: string): never => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
}));
vi.mock('@/server/infrastructure/logger', () => ({
  logger: { error: (...args: unknown[]) => loggerError(...args) },
}));
vi.mock('@/server/application/services/BarberCatalogService', () => ({
  BarberCatalogService: class {
    createBarber = createBarber;
    updateBarber = updateBarber;
  },
}));

const { createBarberAction } = await import('./actions');

function validForm(): FormData {
  const data = new FormData();
  data.append('displayName', 'Ana');
  data.append('locationId', 'loc-1');
  data.append('bio', '');
  return data;
}

/** A PostgreSQL unique violation as Prisma surfaces it: the message carries the values. */
function uniqueViolation(): Error & { code: string } {
  return Object.assign(
    new Error('Unique constraint failed: Key (locationId, displayName)=(loc-1, Ana) already exists'),
    { code: 'P2002' }
  );
}

beforeEach(() => vi.clearAllMocks());

// ─── T20 — the barber write path must not log raw driver messages ────────────

describe('createBarberAction - constraint-violation diagnostics', () => {
  it('should_log_the_code_and_operation_only_for_a_recognized_violation', async () => {
    createBarber.mockRejectedValueOnce(uniqueViolation());

    await createBarberAction(INITIAL_BARBER_FORM_STATE, validForm());

    expect(loggerError).toHaveBeenCalledTimes(1);
    const [, context] = loggerError.mock.calls[0] as [string, Record<string, unknown>];
    expect(context).toEqual({ operation: 'createBarber', code: 'P2002' });
  });

  it('should_never_put_the_submitted_display_name_in_the_log_stream', async () => {
    createBarber.mockRejectedValueOnce(uniqueViolation());

    await createBarberAction(INITIAL_BARBER_FORM_STATE, validForm());

    // The driver message embeds the offending values, so logging it verbatim
    // writes the owner's business data into the log stream and lets a name
    // containing quotes or newlines forge fields in structured output.
    const serialized = JSON.stringify(loggerError.mock.calls[0]);
    expect(serialized).not.toContain('Ana');
    expect(serialized).not.toContain('Unique constraint failed');
    expect(serialized).not.toContain('locationId, displayName');
  });

  it('should_keep_the_message_for_an_unrecognized_failure_so_it_stays_diagnosable', async () => {
    createBarber.mockRejectedValueOnce(new Error('socket hang up'));

    await createBarberAction(INITIAL_BARBER_FORM_STATE, validForm());

    const [, context] = loggerError.mock.calls[0] as [string, Record<string, unknown>];
    expect(context).toEqual({ operation: 'createBarber', cause: 'socket hang up' });
  });

  it('should_return_the_generic_spanish_message_rather_than_technical_detail', async () => {
    createBarber.mockRejectedValueOnce(new Error('socket hang up'));

    const state = await createBarberAction(INITIAL_BARBER_FORM_STATE, validForm());

    expect(state.error).toBe(COPY.barbers.form.infrastructureError);
    expect(JSON.stringify(state)).not.toContain('socket hang up');
  });
});
