/**
 * The booking states, and the one question availability asks about a booking.
 *
 * This change creates the `Booking` table and reads it; it writes nothing. The
 * entity as a whole belongs to B4 — what lives here is the part slot generation
 * needs, defined where B4 will find it rather than inside the availability rule
 * that happens to be its first consumer.
 */

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
