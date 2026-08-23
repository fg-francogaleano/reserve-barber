'use server';

import { revalidatePath } from 'next/cache';
import { requireOwner } from '@/server/infrastructure/supabase/requireOwner';
import { receiptReviewService } from './receiptReviewService';
import { logger } from '@/server/infrastructure/logger';
import { toErrorLogContext } from '@/server/infrastructure/errorLogContext';
import { COPY } from '@/lib/copy';
import type { ReviewFormState } from './formState';

const RECEIPTS_PATH = '/comprobantes';

/** Generous, like every other bound on a value that arrives from outside. */
const MAX_ID_LENGTH = 64;

function readReceiptId(formData: FormData): string | null {
  const value = formData.get('receiptId');
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_LENGTH
    ? value
    : null;
}

/**
 * Approve or reject, as Server Actions.
 *
 * **Server Actions here, and a Route Handler in the public flow, and that is
 * not an inconsistency.** `backend-standards.md` makes the public flow's
 * mutations Route Handlers because a guest halfway through paying must never
 * meet a build-time action id that has gone stale. The dashboard is an
 * authenticated surface the owner reloads freely, and every other write in it
 * is a Server Action; matching that is what keeps the dashboard one thing.
 *
 * **The owner is resolved here, never trusted from the form.** A receipt id is
 * the only thing the submission carries, and the repository resolves it inside
 * the caller's own scope — so a receipt belonging to another owner and one that
 * never existed produce the same `notFound`, and the same message. A
 * differential answer would turn this into an oracle for which receipts exist.
 */
export async function approveReceiptAction(
  _prev: ReviewFormState,
  formData: FormData
): Promise<ReviewFormState> {
  return review('approve', formData);
}

export async function rejectReceiptAction(
  _prev: ReviewFormState,
  formData: FormData
): Promise<ReviewFormState> {
  return review('reject', formData);
}

async function review(
  decision: 'approve' | 'reject',
  formData: FormData
): Promise<ReviewFormState> {
  const owner = await requireOwner();

  const receiptId = readReceiptId(formData);
  if (receiptId === null) {
    return { error: COPY.receipts.notFound, notice: null };
  }

  try {
    const service = await receiptReviewService();
    const result =
      decision === 'approve'
        ? await service.approve(receiptId, owner.id)
        : await service.reject(receiptId, owner.id);

    switch (result.outcome) {
      case 'applied':
        revalidatePath(RECEIPTS_PATH);
        return {
          error: null,
          notice: decision === 'approve' ? COPY.receipts.approved : COPY.receipts.rejected,
        };

      // The booking moved while the page was open — most likely a second
      // submission of the same decision, which is ordinary rather than a
      // failure. The queue is revalidated so the row disappears.
      case 'notPending':
        revalidatePath(RECEIPTS_PATH);
        return { error: COPY.receipts.noLongerPending, notice: null };

      // A foreign id and an unknown one arrive here identically, on purpose.
      case 'notFound':
        return { error: COPY.receipts.notFound, notice: null };
    }
  } catch (error) {
    // The context carries the operation and the error's name. Never the
    // client's details, never the stored file's path.
    logger.error('Receipt review failed', toErrorLogContext(`receipts.${decision}`, error));
    return { error: COPY.receipts.actionFailed, notice: null };
  }
}
