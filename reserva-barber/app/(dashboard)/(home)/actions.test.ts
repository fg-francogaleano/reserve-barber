import { describe, it, expect, vi, beforeEach } from 'vitest';
import { COPY } from '@/lib/copy';
import { EMPTY_CANCEL_STATE } from './formState';

const cancel = vi.fn();
const revalidatePath = vi.fn();
const requireOwner = vi.fn();
const loggerError = vi.fn();

vi.mock('next/cache', () => ({ revalidatePath: (path: string) => revalidatePath(path) }));
vi.mock('@/server/infrastructure/supabase/requireOwner', () => ({
  requireOwner: () => requireOwner(),
}));
vi.mock('./bookingCancellationService', () => ({
  bookingCancellationService: () => ({ cancel }),
}));
vi.mock('@/server/infrastructure/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: (m: string, c: unknown) => loggerError(m, c) },
}));

const { cancelBookingAction } = await import('./actions');

const BOOKING = 'bkg-1';
const OWNER = 'own-1';

function submission(bookingId: string | null = BOOKING): FormData {
  const form = new FormData();
  if (bookingId !== null) form.set('bookingId', bookingId);
  return form;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireOwner.mockResolvedValue({ id: OWNER });
  cancel.mockResolvedValue({ outcome: 'cancelled' });
});

describe('cancelBookingAction - the applied path', () => {
  it('resolves the owner from the session and never from the form', async () => {
    // The submission carries a booking id and nothing else. An owner id in the
    // form would be an owner id a caller could choose.
    const form = submission();
    form.set('ownerId', 'someone-else');

    await cancelBookingAction(EMPTY_CANCEL_STATE, form);

    expect(requireOwner).toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledWith(BOOKING, OWNER);
  });

  it('revalidates the dashboard so the row reflects the new status', async () => {
    await cancelBookingAction(EMPTY_CANCEL_STATE, submission());

    expect(revalidatePath).toHaveBeenCalledWith('/');
  });

  it('confirms the cancellation and says the slot is free', async () => {
    const state = await cancelBookingAction(EMPTY_CANCEL_STATE, submission());

    expect(state).toEqual({ error: null, notice: COPY.dashboard.cancelled });
  });
});

/**
 * The rule N1 established, applied to a second surface: telling an owner a
 * client has been informed when they have not removes their reason to phone
 * them, which is the only recovery this product offers for a message that did
 * not arrive.
 */
describe('cancelBookingAction - what the success message may claim', () => {
  it('does not claim the client was notified', async () => {
    const state = await cancelBookingAction(EMPTY_CANCEL_STATE, submission());

    expect(state.notice).not.toMatch(/mail|email|avisa|notific|le dijimos/i);
  });

  it('keeps the copy itself free of any such claim', async () => {
    // Asserted over the string as well as over one call, because the string is
    // what a later change would edit.
    expect(COPY.dashboard.cancelled).not.toMatch(/mail|email|avisa|notific/i);
  });

  it('does not promise a refund', async () => {
    // This product performs none, and the confirmation says so rather than the
    // success message implying otherwise.
    expect(COPY.dashboard.cancelled).not.toMatch(/devol|reembols|reintegr/i);
  });
});

describe('cancelBookingAction - the refusals', () => {
  it('reports a booking that moved as a plain message, not a failure', async () => {
    // Confirmed by a notification, swept by the expiry job, or already
    // cancelled in another tab. The guard doing its job is the system working.
    cancel.mockResolvedValue({ outcome: 'notCancellable', status: 'CONFIRMED' });

    const state = await cancelBookingAction(EMPTY_CANCEL_STATE, submission());

    expect(state).toEqual({ error: COPY.dashboard.cancelNotPossible, notice: null });
    expect(loggerError).not.toHaveBeenCalled();
  });

  it('revalidates on that refusal too, because the page is stale by definition', async () => {
    cancel.mockResolvedValue({ outcome: 'notCancellable', status: 'EXPIRED' });

    await cancelBookingAction(EMPTY_CANCEL_STATE, submission());

    expect(revalidatePath).toHaveBeenCalledWith('/');
  });

  it('answers a scope miss and a missing booking identically', async () => {
    cancel.mockResolvedValue({ outcome: 'notFound' });
    const outside = await cancelBookingAction(EMPTY_CANCEL_STATE, submission());

    const absent = await cancelBookingAction(EMPTY_CANCEL_STATE, submission(null));

    expect(outside).toEqual(absent);
    expect(outside).toEqual({ error: COPY.dashboard.cancelNotFound, notice: null });
  });

  it('never reaches the service without a booking id', async () => {
    await cancelBookingAction(EMPTY_CANCEL_STATE, submission(null));

    expect(cancel).not.toHaveBeenCalled();
  });

  it('bounds the submitted id rather than passing anything through', async () => {
    await cancelBookingAction(EMPTY_CANCEL_STATE, submission('x'.repeat(65)));

    expect(cancel).not.toHaveBeenCalled();
  });
});

describe('cancelBookingAction - an unexpected failure', () => {
  it('reports a generic message and discloses nothing', async () => {
    cancel.mockRejectedValue(new Error('connection reset to 10.0.0.1'));

    const state = await cancelBookingAction(EMPTY_CANCEL_STATE, submission());

    expect(state).toEqual({ error: COPY.dashboard.cancelFailed, notice: null });
    expect(JSON.stringify(state)).not.toContain('connection reset');
  });

  it('logs it with an operation and no submitted value', async () => {
    cancel.mockRejectedValue(new Error('boom'));

    await cancelBookingAction(EMPTY_CANCEL_STATE, submission());

    expect(loggerError).toHaveBeenCalled();
    const context = JSON.stringify(loggerError.mock.calls[0]);
    expect(context).toContain('cancelBookingAction');
  });
});
