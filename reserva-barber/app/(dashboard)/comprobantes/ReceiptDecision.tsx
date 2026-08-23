'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { COPY } from '@/lib/copy';
import { approveReceiptAction, rejectReceiptAction } from './actions';
import { EMPTY_REVIEW_STATE } from './formState';

/**
 * The two decisions for one receipt.
 *
 * Two forms rather than one with two submits, because they are two actions and
 * only one of them is destructive — and because the rejection needs a
 * confirmation the approval must not inherit.
 */
export function ReceiptDecision({ receiptId }: { receiptId: string }) {
  const [approveState, approve] = useActionState(approveReceiptAction, EMPTY_REVIEW_STATE);
  const [rejectState, reject] = useActionState(rejectReceiptAction, EMPTY_REVIEW_STATE);

  const state = approveState.error ?? rejectState.error ?? null;
  const notice = approveState.notice ?? rejectState.notice ?? null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <form action={approve}>
          <input type="hidden" name="receiptId" value={receiptId} />
          <ApproveButton />
        </form>

        <form action={reject} onSubmit={confirmRejection}>
          <input type="hidden" name="receiptId" value={receiptId} />
          <RejectButton />
        </form>
      </div>

      {state !== null && (
        <p className="text-destructive text-sm" role="alert">
          {state}
        </p>
      )}
      {notice !== null && (
        <p className="text-muted-foreground text-sm" role="status">
          {notice}
        </p>
      )}
    </div>
  );
}

/**
 * The confirmation before a rejection.
 *
 * Rejection cancels the booking and frees the slot, and nothing here can undo
 * it — so it is confirmed, and the confirmation names the part this system
 * cannot help with: if the client already transferred, the refund is the
 * owner's to arrange.
 *
 * `confirm` rather than a modal, matching what the rest of this dashboard does
 * for destructive actions. Without JavaScript there is no prompt and the
 * submission proceeds, which is the correct failure direction for a page only
 * an authenticated owner can reach — the alternative is a control that silently
 * does nothing.
 */
function confirmRejection(event: React.FormEvent<HTMLFormElement>): void {
  if (!window.confirm(COPY.receipts.rejectConfirm)) {
    event.preventDefault();
  }
}

function ApproveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? COPY.receipts.approving : COPY.receipts.approve}
    </Button>
  );
}

function RejectButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="outline" disabled={pending}>
      {pending ? COPY.receipts.rejecting : COPY.receipts.reject}
    </Button>
  );
}
