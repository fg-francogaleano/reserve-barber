import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MAX_SERVICES_PER_OWNER } from '@/server/application/services/ServiceCatalogService';
import { COPY } from '@/lib/copy';
import { INITIAL_BARBER_SERVICES_FORM_STATE } from './formState';

const requireOwner = vi.fn(async () => ({ id: 'owner-root', email: 'owner@example.com' }));
const setServices = vi.fn(async () => undefined);
const getEditorData = vi.fn();
const revalidatePath = vi.fn();
const redirect = vi.fn((path: string): never => {
  // Mirrors Next: redirect() signals by throwing, which is why the real action
  // must keep it outside the try — otherwise a successful save would be caught
  // and reported as an infrastructure failure.
  throw new Error(`NEXT_REDIRECT:${path}`);
});

vi.mock('@/server/infrastructure/supabase/requireOwner', () => ({
  requireOwner: () => requireOwner(),
}));
vi.mock('@/server/infrastructure/prisma/client', () => ({
  getPrismaClient: () => ({}),
}));
vi.mock('next/cache', () => ({ revalidatePath: (path: string) => revalidatePath(path) }));
vi.mock('next/navigation', () => ({ redirect: (path: string) => redirect(path) }));
vi.mock('@/server/application/services/BarberServiceAssignmentService', () => ({
  BarberServiceAssignmentService: class {
    setServices = setServices;
    getEditorData = getEditorData;
  },
}));

const { setBarberServicesAction } = await import('./actions');

function formData(entries: Array<[string, string]>): FormData {
  const data = new FormData();
  for (const [key, value] of entries) {
    data.append(key, value);
  }
  return data;
}

beforeEach(() => vi.clearAllMocks());

describe('setBarberServicesAction - bounds are enforced before any write', () => {
  it('should_not_reach_the_application_service_on_an_over_cap_submission', async () => {
    const entries: Array<[string, string]> = [['barberId', 'barber-1']];
    for (let index = 0; index <= MAX_SERVICES_PER_OWNER; index += 1) {
      entries.push(['serviceIds', `svc-${index}`]);
      entries.push(['renderedServiceIds', `svc-${index}`]);
    }

    const state = await setBarberServicesAction(
      INITIAL_BARBER_SERVICES_FORM_STATE,
      formData(entries)
    );

    expect(state.error).toBe(COPY.barberServices.tooMany);
    expect(setServices).not.toHaveBeenCalled();
  });

  it('should_not_reach_the_application_service_when_the_baseline_is_missing', async () => {
    const state = await setBarberServicesAction(
      INITIAL_BARBER_SERVICES_FORM_STATE,
      formData([
        ['barberId', 'barber-1'],
        ['serviceIds', 'svc-1'],
      ])
    );

    expect(state.error).toBe(COPY.barberServices.invalidSelection);
    expect(setServices).not.toHaveBeenCalled();
  });

  it('should_echo_the_submitted_selection_back_on_rejection', async () => {
    const state = await setBarberServicesAction(
      INITIAL_BARBER_SERVICES_FORM_STATE,
      formData([
        ['barberId', ''],
        ['serviceIds', 'svc-1'],
        ['renderedServiceIds', 'svc-1'],
      ])
    );

    expect(state.values.serviceIds).toEqual(['svc-1']);
  });
});

describe('setBarberServicesAction - authentication precedes parsing', () => {
  it('should_resolve_the_owner_before_touching_the_payload', async () => {
    requireOwner.mockRejectedValueOnce(new Error('no session'));

    await expect(
      setBarberServicesAction(
        INITIAL_BARBER_SERVICES_FORM_STATE,
        formData([['barberId', 'barber-1']])
      )
    ).rejects.toThrow('no session');

    expect(setServices).not.toHaveBeenCalled();
  });
});

describe('setBarberServicesAction - success', () => {
  it('should_revalidate_both_lists_before_redirecting', async () => {
    await expect(
      setBarberServicesAction(
        INITIAL_BARBER_SERVICES_FORM_STATE,
        formData([
          ['barberId', 'barber-1'],
          ['serviceIds', 'svc-1'],
          ['renderedServiceIds', 'svc-1'],
        ])
      )
    ).rejects.toThrow('NEXT_REDIRECT:/barberos');

    expect(setServices).toHaveBeenCalledTimes(1);
    // The services list carries the bookability marker, which this write flips.
    expect(revalidatePath).toHaveBeenCalledWith('/barberos');
    expect(revalidatePath).toHaveBeenCalledWith('/servicios');
    expect(redirect).toHaveBeenCalledWith('/barberos');
  });
});
