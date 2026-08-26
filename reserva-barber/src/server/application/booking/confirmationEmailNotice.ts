/**
 * What the confirmed state says about the confirmation email (N1).
 *
 * **Three answers and not two.** "We have not recorded it yet" and "it could
 * not be sent" are different facts, and only one of them is worth alarming
 * somebody with. Collapsing them would either cry failure at a client whose
 * message is in flight, or — far worse — stay quiet about one that never went.
 *
 * The rule the whole thing exists to enforce: **the page must never claim a
 * message that was not sent.** In the failed case the on-screen link stops
 * being a convenience and becomes the client's only record of the appointment,
 * which is why that variant says so plainly instead of softening it.
 */

/**
 * How long a just-confirmed booking is given before its silence is reported as
 * a failure.
 *
 * A judgement, not a measurement — the sixth of its kind in this product, and
 * disclosed as one like the five in `bookingHorizon.ts`. The send is bounded at
 * five seconds and is awaited inside the request that confirmed the booking, so
 * by the time a client can load this page the outcome is normally already
 * decided. This window covers the case where they beat it: a page opened in
 * another tab, or a redirect that raced the write.
 *
 * Too short and a client is told the message failed while it is being accepted.
 * Too long and a genuine failure reads as "still working" until the client
 * gives up. Thirty seconds is comfortably past the send's own bound.
 */
export const EMAIL_NOTICE_GRACE_SECONDS = 30;

export type ConfirmationEmailNotice =
  /** Accepted by the provider. Says where it went — not the address itself. */
  | 'sent'
  /** Too soon to say. The page says nothing about the email at all. */
  | 'pending'
  /** Not sent, and the client needs to know the link is their only copy. */
  | 'failed';

export interface ConfirmationEmailNoticeInput {
  /** When the provider accepted the message, or `null`. */
  readonly sentAt: Date | null;
  /**
   * The booking's last write — a **proxy** for when it was confirmed, which
   * this table does not store.
   *
   * Good enough for the one decision it makes, and named as a proxy so that a
   * later reader does not mistake it for a confirmation timestamp. The
   * direction it errs in is the safe one: any later write to the booking pushes
   * this forward and buys the message more grace, so the page stays quiet
   * rather than accusing a send that may have succeeded.
   */
  readonly updatedAt: Date;
  readonly now: Date;
}

export function resolveConfirmationEmailNotice(
  input: ConfirmationEmailNoticeInput
): ConfirmationEmailNotice {
  if (input.sentAt !== null) return 'sent';

  const elapsedSeconds = (input.now.getTime() - input.updatedAt.getTime()) / 1000;

  // Negative elapsed time means the row was written "in the future" relative to
  // this render — clock skew between the database and the Worker. Treated as
  // just-confirmed rather than as long-failed, which is the conservative
  // direction: staying quiet costs a client nothing, and a false accusation
  // that their confirmation failed costs them confidence in a booking that is
  // real.
  if (elapsedSeconds < EMAIL_NOTICE_GRACE_SECONDS) return 'pending';

  return 'failed';
}
