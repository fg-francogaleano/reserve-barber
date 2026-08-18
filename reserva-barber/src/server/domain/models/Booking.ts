/**
 * The booking states, the one question availability asks about a booking, and
 * the hold-deadline rule B4 needed once it became the table's writer.
 *
 * B3 created this table and read it, writing nothing. What lived here then was
 * only the part slot generation needed; `holdExpiresAtFor` is the first piece
 * that belongs to a writer.
 */

import { HOLD_DURATION_MINUTES } from './bookingHorizon';

export const BOOKING_STATUSES = [
  'PENDING_PAYMENT',
  'PENDING_APPROVAL',
  'CONFIRMED',
  'CANCELLED',
  'EXPIRED',
] as const;

export type BookingStatus = (typeof BOOKING_STATUSES)[number];

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
 * `PENDING_APPROVAL` is never expired by time: the client has uploaded a
 * receipt and a human owes them an answer. Releasing the slot underneath a
 * transfer that the owner is about to approve would sell it twice.
 *
 * A null `holdExpiresAt` blocks. The column is optional, and reading its
 * absence as "expired long ago" would release a slot the instant a write set
 * the status without the deadline.
 */
export function blocksAvailability(booking: BlockingCandidate, now: Date): boolean {
  switch (booking.status) {
    case 'CONFIRMED':
    case 'PENDING_APPROVAL':
      return true;

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
  const unclamped = new Date(input.createdAt.getTime() + HOLD_DURATION_MINUTES * 60_000);
  return unclamped.getTime() > input.startTime.getTime() ? input.startTime : unclamped;
}
