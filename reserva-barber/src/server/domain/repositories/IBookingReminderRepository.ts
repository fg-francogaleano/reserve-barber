/**
 * A booking as the reminder job reads it, and nothing more.
 *
 * Exactly the fields the message renders. **No phone**, which the projection
 * behind the confirmation message also refuses on the grounds that a shape
 * which cannot hold it cannot render it by accident. **No owner id**, which
 * `data-model.md` records never reaches a rendering layer. **No status and no
 * claim instant**: by the time a row is in this shape the claim has already
 * matched it, so re-reading either would invite a second, weaker copy of the
 * guarantee the conditional update provides.
 *
 * The projection is doing work that `ownerId` does everywhere else in this
 * project. This is an unscoped read, so nothing here can carry a field into a
 * log line or a message for the simple reason that it is never selected.
 */
export interface ReminderBooking {
  readonly id: string;
  readonly clientName: string;
  readonly clientEmail: string;
  readonly shopName: string;
  readonly shopSlug: string;
  readonly locationName: string;
  readonly locationAddress: string | null;
  readonly barberName: string;
  readonly serviceName: string;
  readonly startTime: Date;
  /** Canonical decimal strings, as every money value crosses this boundary. */
  readonly priceAtBooking: string;
  readonly depositAmount: string;
  readonly cancellationToken: string;
}

/**
 * What the candidate query returns: the two instants the domain rule needs, and
 * the id the claim will name.
 *
 * **Deliberately not the message projection.** A candidate is not yet a
 * recipient — the predicate may still reject it, and the claim may still match
 * zero rows — so reading a client's name and address for a row that will be
 * discarded would be personal data selected for nothing. The message shape
 * arrives only from `claimDue`, which returns exactly the rows this job now
 * owns.
 */
export interface ReminderCandidateRow {
  readonly id: string;
  readonly startTime: Date;
  readonly createdAt: Date;
}

/**
 * Reading and claiming due reminders across every shop at once.
 *
 * ---
 *
 * **This is the third deliberate exception to owner scoping in this project,
 * and the second that writes.**
 *
 * `IBookingRepository` states that every one of its methods is keyed by
 * something owner-scoped, so an unscoped query is inexpressible through it. A
 * scheduled job cannot honour that, for the reasons `IExpiredHoldRepository`
 * sets out about the sweep: it is triggered by a clock rather than by a
 * request, there is no owner in scope to key it by, and running it once per
 * owner would mean enumerating owners in order to preserve the appearance of a
 * guarantee it would not actually be providing.
 *
 * `IBusinessProfileRepository.findByPublicSlug` established how this project
 * handles such a case — a named exception carrying its reason, bounded by
 * something else instead — and the sweep's port is the precedent for a *write*
 * shaped that way. This is written as its own port for the same reason both
 * were: widening `IBookingRepository` would void a property it states about
 * itself, and the next reader would have no way to tell a deliberate exception
 * from an erosion.
 *
 * **What bounds it instead**, since ownership does not:
 *
 * 1. Two projections, neither carrying a phone number or an owner id, and the
 *    candidate one carrying no personal data at all.
 * 2. `limit` on every read, so no single statement faces the whole table.
 * 3. `claimDue` can only ever set **one column to one value**, on ids it was
 *    handed, and only where the row is still `CONFIRMED` and still unclaimed.
 *    There is no shape of bug in this contract that can write anything else.
 *
 * Cross-owner isolation has no enforcement here, so it is proven by test
 * instead: every implementation of this port is tested against a fixture
 * containing two owners.
 *
 * ---
 *
 * **The one thing this port does differently from every other in the project,
 * and it is the whole design of the capability.** Reading and marking are a
 * single method, because they are a single statement. Splitting them into a
 * read and a later write would open the window that makes at-most-once
 * impossible: the reminder has no guarded status transition to inherit
 * idempotency from — its trigger is time passing, and nothing in the row
 * changes to say a booking is due — so the claim *is* the guarantee.
 */
export interface IBookingReminderRepository {
  /**
   * Candidate `CONFIRMED` bookings that have never been claimed and whose
   * appointment falls inside the reminder window.
   *
   * `windowEnd` is `reminderDueBefore(now)` and arrives already computed,
   * because the arithmetic is a domain rule and the repository decides nothing.
   *
   * **These are candidates, not decisions.** The query narrows by status, by
   * the null claim instant and by a bound on `startTime`; whether a row is
   * actually due is answered by `isReminderDue` above this layer, which also
   * applies the minimum-gap rule this query deliberately does not express. A
   * second copy of the rule in SQL would drift from the domain the first time
   * either was refined — the constraint `IExpiredHoldRepository` and
   * `IBookingRepository.createProvisional` both record about themselves.
   *
   * **`startTime > now` is the one clause this query and the predicate BOTH
   * assert, and the duplication is deliberate.** It is the only bound in the
   * capability whose failure is unrecoverable: without it the first run selects
   * every confirmed booking in history and mails all of them. A safety property
   * of that size does not get to rest on a bound no unit test can see.
   */
  findDueCandidates(input: {
    now: Date;
    windowEnd: Date;
    limit: number;
  }): Promise<ReminderCandidateRow[]>;

  /**
   * Claims the named bookings for this invocation, and returns the ones it won
   * — already in the shape the message needs.
   *
   * One conditional update: it sets the claim instant **only** where that
   * column is still null and the status is still `CONFIRMED`, and returns what
   * it matched. A booking that was cancelled, expired or claimed by an
   * overlapping invocation between `findDueCandidates` and this call matches
   * zero rows and is simply absent from the result.
   *
   * **This runs BEFORE the message is sent, which is the reverse of
   * `markConfirmationEmailSent`'s ordering, and the reversal is the point.**
   * That method records after the provider accepts, because its at-most-once
   * comes from elsewhere and a null there means "this client was never told".
   * Here the column is the mechanism. Recording after the send would leave a
   * window — a dying Worker, a provider that accepts and then times out — in
   * which the row is unclaimed and the next invocation sends again, once per
   * invocation, for as long as the appointment stays due.
   *
   * **Nothing un-claims a row afterwards.** A claimed row whose send failed may
   * already have been delivered, so releasing it is how a bounded loss becomes
   * an unbounded duplicate. A failed send is a log line, and the row it left
   * behind is a `WHERE` clause.
   *
   * No transaction: a single statement is already atomic, and wrapping it would
   * hold a connection from a pool capped at five — shared with the owner's
   * dashboard and the public booking write — across a decision made in
   * application code.
   *
   * No advisory lock, deliberately. Every caller of that lock *places* a
   * booking into a slot and the lock exists so two of them cannot choose the
   * same one; this claims a row and sends a message, and cannot double-book.
   * The same reasoning the sweep and the receipt rejection both record.
   *
   * The implementation SHALL write the claim instant and nothing else — never
   * `status`, never `holdExpiresAt`, never a monetary snapshot, never the
   * token. Prisma's `@updatedAt` moves with it, as it does on every write
   * through the client; the N1 gate caught an earlier contract in this project
   * claiming a single-column write it could not deliver, so this one says so
   * rather than repeating the claim.
   */
  claimDue(input: { ids: readonly string[]; claimedAt: Date }): Promise<ReminderBooking[]>;
}
