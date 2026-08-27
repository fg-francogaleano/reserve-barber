'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { COPY } from '@/lib/copy';
import { cancelBookingAction } from './actions';
import { EMPTY_CANCEL_STATE } from './formState';

/**
 * The cancel control for one row (C2).
 *
 * **Rendered only where the booking is still cancellable** — the row decides
 * that from the shared domain predicate, so this component never has to know
 * the status list. A terminal booking gets no control rather than a disabled
 * one: a disabled-looking button invites a click that cannot succeed, which is
 * the rule the public flow's payment controls already follow.
 */
export function CancelBookingButton({
  bookingId,
  clientName,
}: {
  bookingId: string;
  clientName: string;
}) {
  const [state, cancel] = useActionState(cancelBookingAction, EMPTY_CANCEL_STATE);

  return (
    <div className="flex flex-col items-end gap-1">
      <form action={cancel} onSubmit={confirmCancellation}>
        <input type="hidden" name="bookingId" value={bookingId} />
        <SubmitButton clientName={clientName} />
      </form>

      {state.error !== null && (
        <p className="text-destructive text-sm" role="alert">
          {state.error}
        </p>
      )}
      {state.notice !== null && (
        <p className="text-muted-foreground text-sm" role="status">
          {state.notice}
        </p>
      )}
    </div>
  );
}

/**
 * The confirmation before a cancellation.
 *
 * Cancelling releases the slot immediately and nothing here can undo it, so it
 * is confirmed — and the confirmation names the part this system cannot help
 * with: if the client already paid a deposit, the refund is the owner's to
 * arrange.
 *
 * `confirm` rather than a modal, matching what the rest of this dashboard does
 * for destructive actions. Without JavaScript there is no prompt and the
 * submission proceeds, which is the correct failure direction for a page only
 * an authenticated owner can reach — the alternative is a control that silently
 * does nothing.
 */
function confirmCancellation(event: React.FormEvent<HTMLFormElement>): void {
  if (!window.confirm(COPY.dashboard.cancelConfirm)) {
    event.preventDefault();
  }
}

/**
 * The pending state matters here more than usual: the action runs a
 * transaction and, once the notice ships, an outbound message — so a control
 * with no feedback invites a second click on a booking the first one is
 * already ending.
 */
function SubmitButton({ clientName }: { clientName: string }) {
  const { pending } = useFormStatus();

  return (
    <Button
      type="submit"
      variant="outline"
      size="sm"
      disabled={pending}
      aria-label={COPY.dashboard.cancelLabel(clientName)}
    >
      {pending ? COPY.dashboard.cancelling : COPY.dashboard.cancel}
    </Button>
  );
}
