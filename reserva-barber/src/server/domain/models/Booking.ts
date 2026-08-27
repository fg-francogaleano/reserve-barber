/**
 * The booking states, the one question availability asks about a booking, and
 * the hold-deadline rule B4 needed once it became the table's writer.
 *
 * B3 created this table and read it, writing nothing. What lived here then was
 * only the part slot generation needed; `holdExpiresAtFor` is the first piece
 * that belongs to a writer.
 */

import {
  EXPIRY_GRACE_MINUTES,
  HOLD_DURATION_MINUTES,
  TRANSFER_HOLD_DURATION_MINUTES,
} from './bookingHorizon';

export const BOOKING_STATUSES = [
  'PENDING_PAYMENT',
  'PENDING_APPROVAL',
  'CONFIRMED',
  'CANCELLED',
  'EXPIRED',
] as const;

export type BookingStatus = (typeof BOOKING_STATUSES)[number];

/**
 * Who ended a booking, when a human did (C2).
 *
 * Declared here rather than imported from the generated client, like
 * `BOOKING_STATUSES`: the page's state table and the repository both need it,
 * and only one of them may depend on Prisma.
 *
 * **`OWNER` covers both an owner cancelling directly and an owner rejecting a
 * transfer receipt** — the owner is the actor in both. `CLIENT` belongs to C1
 * and nothing writes it yet. Telling the two apart is the entire reason this
 * column exists: `CANCELLED` alone cannot say whether a client walked away or a
 * shop cancelled on them, and those are opposite messages.
 */
export const CANCELLED_BY = ['OWNER', 'CLIENT'] as const;

export type CancelledBy = (typeof CANCELLED_BY)[number];

/**
 * The projection availability reads. Four columns, and deliberately not one
 * more: no client id, no cancellation token, no price, no deposit.
 */
export interface BlockingCandidate {
  readonly startTime: Date;
  readonly endTime: Date;
  readonly status: BookingStatus;
  readonly holdExpiresAt: Date | null;
}

/**
 * Whether this booking removes its time from sale.
 *
 * **This predicate has one home, and B4's transactional no-overlap check must
 * use this same function.** If the read side and the write side disagreed about
 * which bookings block, a client would be offered a time here and rejected
 * while paying for it — the worst place in the product to be told no.
 *
 * The expired-hold clause is the part that is easy to get wrong by omission.
 * `PENDING_PAYMENT` means a checkout is in flight, and `holdExpiresAt` is when
 * that claim lapses. B7 — the scheduled job that sweeps lapsed holds into
 * `EXPIRED` — ships four stories after this one, so until then a status-only
 * filter would let every abandoned checkout block its slot forever, with no
 * surface anywhere in the product that would explain it to the owner.
 *
 * `PENDING_APPROVAL` is never expired by `holdExpiresAt`: that column is the
 * deadline for *uploading* a receipt, not for *answering* one. Releasing the
 * slot underneath a transfer that the owner is about to approve would sell it
 * twice.
 *
 * **It does stop blocking once its own appointment has passed**, and that is
 * the only exit this status has which does not depend on the owner being
 * attentive. Nothing is sold twice by it — the time is unsellable by then —
 * and without it an unanswered receipt blocks a slot forever. The review
 * surface makes that rarer, not impossible: an owner on holiday blocks the
 * calendar exactly as an absent reviewer would.
 *
 * The comparison is inclusive of the start instant — the booking blocks while
 * `startTime >= now` — because "has passed" is false at the moment something
 * begins. This is the conservative direction: holding one instant too long
 * costs nothing, and releasing one instant too early would offer a time that
 * is being used right now. It is deliberately *not* the half-open rule the
 * interval boundaries follow, which answers a different question.
 *
 * `CONFIRMED` is deliberately *not* given the same treatment. A confirmed
 * appointment in the past is history rather than a hold, and nothing is
 * waiting on it.
 *
 * A null `holdExpiresAt` blocks. The column is optional, and reading its
 * absence as "expired long ago" would release a slot the instant a write set
 * the status without the deadline.
 */
export function blocksAvailability(booking: BlockingCandidate, now: Date): boolean {
  switch (booking.status) {
    case 'CONFIRMED':
      return true;

    case 'PENDING_APPROVAL':
      return booking.startTime.getTime() >= now.getTime();

    case 'PENDING_PAYMENT':
      // Half-open, like every other boundary here: the hold covers
      // [created, holdExpiresAt), so the expiry instant itself is past it.
      return booking.holdExpiresAt === null || booking.holdExpiresAt.getTime() > now.getTime();

    case 'CANCELLED':
    case 'EXPIRED':
      return false;
  }
}

/**
 * Whether the owner may still cancel this booking (C2).
 *
 * **One definition, three callers**, for the same reason `blocksAvailability`
 * has one: the row deciding whether to render a control, the service deciding
 * whether to attempt the write, and the write's own guard all need this answer,
 * and three copies of a status list is three chances for a control to appear
 * where the write refuses.
 *
 * `CANCELLED` and `EXPIRED` are terminal — there is nothing left to release.
 * The other three all occupy their slot in some way and are the whole point of
 * the feature.
 *
 * **It deliberately takes no instant.** A no-show is precisely a past
 * appointment the owner wants off the books, and the list this is offered from
 * is ordered by recency rather than by future-ness. Forbidding a past booking
 * would remove the most common real reason to reach for this control.
 *
 * A `switch` over the union rather than a set membership test, so a new status
 * forces a decision here instead of defaulting to "not cancellable" by silence.
 */
export function isCancellableByOwner(status: BookingStatus): boolean {
  switch (status) {
    case 'CONFIRMED':
    case 'PENDING_PAYMENT':
    case 'PENDING_APPROVAL':
      return true;

    case 'CANCELLED':
    case 'EXPIRED':
      return false;
  }
}

/**
 * When a new provisional hold lapses: the creation instant plus
 * `HOLD_DURATION_MINUTES`, **clamped so it never exceeds `startTime`**.
 *
 * The clamp is correctness, not a preference. An unclamped hold on a
 * near-term appointment would lapse *after* the appointment has already
 * begun, and B7 — once it exists — would expire a booking whose time has
 * passed. `MIN_BOOKING_LEAD_MINUTES` makes that case unreachable today only
 * because it is itself a guess a real shop is likely to have lowered before
 * this clamp is ever exercised, which is exactly why it is written into the
 * rule rather than relied on as a side effect of another constant.
 */
export function holdExpiresAtFor(input: { createdAt: Date; startTime: Date }): Date {
  return holdDeadline(input.createdAt, HOLD_DURATION_MINUTES, input.startTime);
}

/**
 * When a hold lapses once the client has committed to paying by bank transfer:
 * the commitment instant plus `TRANSFER_HOLD_DURATION_MINUTES`, **under the
 * same clamp**.
 *
 * The extension exists because 15 minutes was sized for a hosted checkout and
 * a bank transfer is not one. It is applied at commitment rather than at
 * creation so that a Mercado Pago client never holds a slot three times longer
 * than they need — and because making it a write is what allows the destination
 * to be withheld until it succeeds. A CBU shown during a window that is about
 * to lapse is how a client ends up having transferred real money that no row
 * here records.
 *
 * It shares `holdDeadline` with the creation write rather than restating the
 * clamp. At three times the duration this clamp is materially closer to being
 * reached, so two copies of the rule would be two chances to get it wrong.
 */
export function transferHoldExpiresAtFor(input: { committedAt: Date; startTime: Date }): Date {
  return holdDeadline(input.committedAt, TRANSFER_HOLD_DURATION_MINUTES, input.startTime);
}

/**
 * The instant a lapsed hold must predate before the sweeper may expire it:
 * `now` less `EXPIRY_GRACE_MINUTES`.
 *
 * A `PENDING_PAYMENT` booking is sweepable when `holdExpiresAt < cutoff` —
 * **strictly**, so a hold sitting exactly on the cutoff survives one more run.
 * That is the same conservative direction `blocksAvailability` takes at the
 * start instant: waiting one cycle longer costs nothing, and expiring one
 * instant too early costs a client their paid appointment.
 *
 * The arithmetic lives here rather than at the sweeper's call site for the
 * reason the deadline rules above give: this is a number the write side and the
 * query bound must agree on, and two expressions of it are two chances to
 * disagree. `bookingHorizon.ts` records what the grace protects and why it is
 * free.
 *
 * It is **not** applied to `PENDING_APPROVAL`, which is swept on its own
 * `startTime` and has no gateway whose confirmation could still be in flight.
 */
export function holdSweepCutoff(now: Date): Date {
  return new Date(now.getTime() - EXPIRY_GRACE_MINUTES * 60_000);
}

/**
 * The clamp, in one place.
 *
 * Every write that sets or moves `holdExpiresAt` goes through here. A hold must
 * never be scheduled to lapse after the appointment it holds has already begun:
 * the sweeper would then expire a booking whose time has passed, and the
 * confirmation page would count down to a deadline that means nothing.
 */
function holdDeadline(from: Date, durationMinutes: number, startTime: Date): Date {
  const unclamped = new Date(from.getTime() + durationMinutes * 60_000);
  return unclamped.getTime() > startTime.getTime() ? startTime : unclamped;
}
