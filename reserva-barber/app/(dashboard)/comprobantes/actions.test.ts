import { describe, it, expect, vi, beforeEach } from 'vitest';
import { COPY } from '@/lib/copy';
import { EMPTY_REVIEW_STATE } from './formState';

const requireOwner = vi.fn(async () => ({
  id: 'owner-root',
  email: 'owner@example.com',
  authUserId: 'auth-uuid',
}));
const approve = vi.fn();
const reject = vi.fn();
const revalidatePath = vi.fn();

vi.mock('@/server/infrastructure/supabase/requireOwner', () => ({
  requireOwner: () => requireOwner(),
}));
vi.mock('./receiptReviewService', () => ({
  receiptReviewService: async () => ({ approve, reject }),
}));
vi.mock('next/cache', () => ({ revalidatePath: (path: string) => revalidatePath(path) }));

const { approveReceiptAction, rejectReceiptAction } = await import('./actions');

const RECEIPT = 'rcp-1';

function submission(receiptId: string | null = RECEIPT): FormData {
  const form = new FormData();
  if (receiptId !== null) form.set('receiptId', receiptId);
  return form;
}

beforeEach(() => {
  approve.mockReset().mockResolvedValue({ outcome: 'applied' });
  reject.mockReset().mockResolvedValue({ outcome: 'applied' });
  revalidatePath.mockReset();
});

describe('approving', () => {
  it('confirms the booking and reports it', async () => {
    const state = await approveReceiptAction(EMPTY_REVIEW_STATE, submission());

    expect(approve).toHaveBeenCalledWith(RECEIPT, 'owner-root');
    expect(state).toEqual({ error: null, notice: COPY.receipts.approved });
  });

  it('revalidates the queue so the row disappears', async () => {
    await approveReceiptAction(EMPTY_REVIEW_STATE, submission());

    expect(revalidatePath).toHaveBeenCalledWith('/comprobantes');
  });
});

describe('rejecting', () => {
  it('releases the slot and reports it', async () => {
    const state = await rejectReceiptAction(EMPTY_REVIEW_STATE, submission());

    expect(reject).toHaveBeenCalledWith(RECEIPT, 'owner-root');
    expect(state).toEqual({ error: null, notice: COPY.receipts.rejected });
  });
});

describe('the owner is resolved, never submitted', () => {
  /**
   * The form carries a receipt id and nothing else. If an owner id travelled
   * in the submission, forging one would be the whole attack.
   */
  it('takes the owner from the session and ignores anything in the form', async () => {
    const form = submission();
    form.set('ownerId', 'someone-else');

    await approveReceiptAction(EMPTY_REVIEW_STATE, form);

    expect(approve).toHaveBeenCalledWith(RECEIPT, 'owner-root');
  });

  it('resolves the owner before touching the repository', async () => {
    await approveReceiptAction(EMPTY_REVIEW_STATE, submission());

    expect(requireOwner.mock.invocationCallOrder[0]).toBeLessThan(
      approve.mock.invocationCallOrder[0]!
    );
  });
});

describe('what the answers disclose', () => {
  /**
   * A receipt belonging to another owner and one that never existed produce the
   * same outcome from the repository, and must produce the same message here. A
   * differential answer would turn this into an oracle for which receipts exist.
   */
  it('answers a foreign receipt and an unknown one identically', async () => {
    approve.mockResolvedValue({ outcome: 'notFound' });
    const foreign = await approveReceiptAction(EMPTY_REVIEW_STATE, submission('rcp-other'));

    approve.mockResolvedValue({ outcome: 'notFound' });
    const unknown = await approveReceiptAction(EMPTY_REVIEW_STATE, submission('rcp-nope'));

    expect(foreign).toEqual(unknown);
    expect(foreign).toEqual({ error: COPY.receipts.notFound, notice: null });
  });

  it('does not revalidate for a receipt it could not resolve', async () => {
    approve.mockResolvedValue({ outcome: 'notFound' });

    await approveReceiptAction(EMPTY_REVIEW_STATE, submission());

    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe('a stale decision', () => {
  /**
   * The booking moved while the page was open — most likely a second submission
   * of the same decision. Ordinary, not a failure, and the queue is refreshed
   * so the row goes away.
   */
  it('reports that the booking is no longer pending and refreshes the queue', async () => {
    approve.mockResolvedValue({ outcome: 'notPending', bookingStatus: 'CONFIRMED' });

    const state = await approveReceiptAction(EMPTY_REVIEW_STATE, submission());

    expect(state).toEqual({ error: COPY.receipts.noLongerPending, notice: null });
    expect(revalidatePath).toHaveBeenCalledWith('/comprobantes');
  });
});

describe('malformed submissions', () => {
  it('refuses a submission with no receipt id', async () => {
    const state = await approveReceiptAction(EMPTY_REVIEW_STATE, submission(null));

    expect(state).toEqual({ error: COPY.receipts.notFound, notice: null });
    expect(approve).not.toHaveBeenCalled();
  });

  /** Generous, like every other bound on a value that arrives from outside. */
  it('refuses an overlong receipt id before doing any work', async () => {
    const state = await approveReceiptAction(EMPTY_REVIEW_STATE, submission('x'.repeat(65)));

    expect(state).toEqual({ error: COPY.receipts.notFound, notice: null });
    expect(approve).not.toHaveBeenCalled();
  });
});

describe('an infrastructure failure', () => {
  it('reports a Spanish message rather than propagating', async () => {
    approve.mockRejectedValue(new Error('connection reset'));

    const state = await approveReceiptAction(EMPTY_REVIEW_STATE, submission());

    expect(state).toEqual({ error: COPY.receipts.actionFailed, notice: null });
    expect(JSON.stringify(state)).not.toContain('connection reset');
  });
});

/**
 * N1: the owner is never told the client was notified.
 *
 * Telling an owner a client has been informed when they have not is worse than
 * saying nothing — it removes the owner's reason to phone them, which is the
 * only recovery this product offers for a failed send. There is no resend
 * control and, once approved, the receipt leaves the queue.
 */
describe('what the approval notice may claim', () => {
  it('confirms the booking without claiming the client was notified', async () => {
    const state = await approveReceiptAction(EMPTY_REVIEW_STATE, submission());

    expect(state.notice).toBe(COPY.receipts.approved);
    expect(state.notice).not.toMatch(/mail|email|avisa|notific/i);
  });

  it('keeps the copy itself free of any claim about notifying', async () => {
    // Asserted over the copy rather than only over one call, because the string
    // is what a later change would edit.
    expect(COPY.receipts.approved).not.toMatch(/mail|email|avisa|notific/i);
  });
});
