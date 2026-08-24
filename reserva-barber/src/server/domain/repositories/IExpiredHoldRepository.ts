import type { BookingStatus } from '../models/Booking';

/**
 * A booking as the sweep reads it, and nothing more.
 *
 * The four columns `blocksAvailability` needs, plus the id it will write to.
 * No client, no token, no price, no deposit — the same projection discipline
 * the availability read follows, for the same reason: a field that does not
 * exist cannot reach a log line.
 */
export interface ExpirableBooking {
  readonly id: string;
  readonly status: BookingStatus;
  readonly startTime: Date;
  readonly endTime: Date;
  readonly holdExpiresAt: Date | null;
}

/**
 * A booking that was expired while its deposit had already been paid.
 *
 * This is `confirmIfSlotFree`'s slot-lost ending, read back after the fact: the
 * charge went through, the slot was gone, and the booking was left for the
 * sweeper. Once swept it stops looking anomalous anywhere in the product, so
 * the sweep is the last surface that can say a refund is owed.
 */
export interface ExpiredBookingWithApprovedPayment {
  readonly bookingId: string;
  readonly paymentId: string;
  readonly amount: string;
}

/**
 * Reading and expiring abandoned holds across every shop at once.
 *
 * ---
 *
 * **This is the second deliberate exception to owner scoping in this project,
 * and the first that writes.**
 *
 * `IBookingRepository` states that every one of its methods is keyed by
 * something owner-scoped, so an unscoped query is inexpressible through it —
 * the property every repository here holds. A sweep cannot honour that. It is a
 * maintenance job over the whole table by definition: it is triggered by a
 * clock rather than by a request, there is no owner in scope to key it by, and
 * running it once per owner would mean enumerating owners in order to preserve
 * the appearance of a guarantee it would not actually be providing.
 *
 * `IBusinessProfileRepository.findByPublicSlug` established how this project
 * handles such a case — a named exception carrying its reason, bounded by
 * something else instead. It is written here rather than as a method on
 * `IBookingRepository` for exactly that reason: widening that contract would
 * void a property it states about itself, and the next reader would have no way
 * to tell a deliberate exception from an erosion.
 *
 * **What bounds it instead**, since ownership does not:
 *
 * 1. The projection above, which carries no personal data and no money.
 * 2. `limit` on every read, so no single statement faces the whole table.
 * 3. `expire` can only ever set **one column to one value**, on ids it was
 *    handed, and only where the row still holds the status the caller expected.
 *    There is no shape of bug in this contract that can write anything else.
 *
 * Cross-owner isolation has no enforcement here, so it is proven by test
 * instead: every implementation of this port is tested against a fixture
 * containing two owners.
 */
export interface IExpiredHoldRepository {
  /**
   * Candidate `PENDING_PAYMENT` bookings whose hold lapsed before `cutoff`.
   *
   * `cutoff` is `holdSweepCutoff(now)` — `now` less the grace window — and it
   * arrives already computed, because the arithmetic is a domain rule and the
   * repository decides nothing.
   *
   * **These are candidates, not decisions.** The query narrows by status and by
   * the deadline column; whether a row is actually no longer holding anything
   * is answered by `blocksAvailability` above this layer. The rule is never
   * re-expressed in SQL: it reads a deadline, and a second copy of it would
   * drift from the availability read the first time either was refined
   * (`IBookingRepository.createProvisional` records the same constraint).
   */
  findLapsedHolds(input: { cutoff: Date; limit: number }): Promise<ExpirableBooking[]>;

  /**
   * Candidate `PENDING_APPROVAL` bookings whose appointment has already begun.
   *
   * Keyed on `startTime`, **never on `holdExpiresAt`**: that column is the
   * deadline for uploading a receipt, not for answering one. The grace window
   * does not apply here either — it protects an in-flight gateway confirmation,
   * and this path has no gateway.
   */
  findUnansweredReceipts(input: { now: Date; limit: number }): Promise<ExpirableBooking[]>;

  /**
   * Expires the named bookings, and only those still holding `expectedStatus`.
   *
   * Returns how many rows actually moved.
   *
   * **The status guard is what makes the sweep safe without a lock.** A booking
   * that changed underneath the run — a receipt attached, a payment confirmed,
   * an owner's decision recorded — matches zero rows instead of having
   * `EXPIRED` stamped over a newer truth. It is also what makes a second run,
   * and two overlapping invocations, report nothing rather than reassert the
   * first.
   *
   * No advisory lock is taken, deliberately. Every caller of that lock *places*
   * a booking into a slot and the lock exists so two of them cannot choose the
   * same one; a sweep only ever releases, and a release cannot double-book.
   *
   * The implementation SHALL write `status` and nothing else: `Payment` rows
   * are untouched so a late notification can still complete the payment's own
   * history, `cancelledAt`/`cancelledBy` stay null because `CancelledBy` admits
   * only `OWNER` and `CLIENT` and a deadline is not a decision, and
   * `holdExpiresAt` is preserved as the evidence of why the booking ended.
   */
  expire(input: { ids: readonly string[]; expectedStatus: BookingStatus }): Promise<number>;

  /**
   * Any `APPROVED` payment belonging to the bookings just expired.
   *
   * Called only after a non-empty write, so the common path — a run that
   * expires nothing — spends nothing.
   *
   * **The read SHALL also require the booking to be `EXPIRED` now**, and that
   * condition is not defensive padding. The caller can only offer the ids it
   * *tried* to expire, which is a superset of the ids that moved: a booking
   * that raced from `PENDING_PAYMENT` to `CONFIRMED` between the read and the
   * write is in that set, and it has an `APPROVED` payment for the ordinary
   * reason that somebody paid for an appointment they still have. Without this
   * condition the sweep would report a refund owed on the one booking in the
   * batch that ended happily.
   *
   * The amount crosses as a canonical decimal string, the convention every
   * monetary column in this project follows: the driver returns a stored
   * `2000.50` as `2000.5`, and integer-cent arithmetic then reads the lone `5`
   * as five centavos.
   */
  findApprovedPaymentsFor(
    bookingIds: readonly string[]
  ): Promise<ExpiredBookingWithApprovedPayment[]>;
}
