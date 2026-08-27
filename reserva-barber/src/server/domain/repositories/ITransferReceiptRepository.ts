/**
 * Repository contract for transfer receipts.
 *
 * Two audiences with opposite authority, and the projections below are cut for
 * each. The client's side knows a booking it holds a token for and wants to
 * attach a file; the owner's side knows their own id and wants a queue. Neither
 * projection carries a field its caller has no use for, and neither carries the
 * client's email or phone — nothing on either path renders a person's contact
 * details, and a column that is never selected cannot reach a log.
 */

import type { ReceiptStatus } from '../models/TransferReceipt';

/** What the client's own confirmation page needs to know about their receipt. */
export interface ReceiptSummary {
  readonly id: string;
  readonly status: ReceiptStatus;
  readonly uploadedAt: Date;
  /**
   * How many submissions this booking has already made.
   *
   * Carried so the **cap can be consulted before an object is written**, not
   * only inside the transaction that records one. `attachReceipt` refuses a
   * capped submission, but by the time it runs the bytes are already in the
   * bucket — so the transactional check bounds rows and does nothing at all for
   * storage. An adversarial review found that gap after the change was
   * otherwise complete; this field is what closes it.
   *
   * The transactional check stays where it is. This one bounds the ordinary
   * case; that one settles the race two concurrent submissions create.
   */
  readonly uploadCount: number;
}

/** One row of the owner's review queue. */
export interface PendingReceipt {
  readonly receiptId: string;
  readonly bookingId: string;
  readonly filePath: string;
  readonly uploadedAt: Date;
  readonly startTime: Date;
  readonly endTime: Date;
  /**
   * The booking's **snapshotted** deposit, as a canonical decimal string.
   *
   * Rendered beside the file because it is the only thing that makes the
   * owner's comparison possible at all. Nothing in this product verifies that a
   * transfer happened or that its amount was right, so the review surface has
   * to put the expected figure in front of the person who can check it.
   *
   * A string for the reason every monetary value in this codebase is one: the
   * driver returns a stored `2000.50` as `2000.5`, and a number here would
   * invite the float arithmetic integer cents exist to avoid.
   */
  readonly depositAmount: string;
  readonly clientName: string;
  readonly barberDisplayName: string;
  readonly serviceName: string;
  readonly locationName: string;
}

/**
 * What attaching a receipt decided.
 *
 * Every member is an ordinary outcome rather than an exception. B4 established
 * that a repeated submission is not a conflict and must be invisible to the
 * person who made it, and that rule governs here too: a client whose connection
 * retried, or who pressed back after success, must not be told their slot is
 * gone.
 */
export type AttachReceiptResult =
  | { readonly outcome: 'created'; readonly receiptId: string }
  /**
   * A receipt already existed and was still `PENDING`, so this submission
   * replaced it. Carries the key it displaced so the caller can remove that
   * object on a best-effort basis after the transaction commits.
   */
  | { readonly outcome: 'replaced'; readonly receiptId: string; readonly previousPath: string }
  /** The per-booking submission cap was already reached. */
  | { readonly outcome: 'capped' }
  /**
   * The booking is no longer accepting a receipt — confirmed, cancelled or
   * expired — **and the status it actually found is part of the answer**.
   *
   * Without it the caller cannot distinguish a double submission over a booking
   * already `PENDING_APPROVAL`, which is the idempotency working, from a
   * submission over a booking that was cancelled underneath the client, which
   * means somebody may have transferred money for an appointment that no longer
   * exists. The second owes a human an explanation; the first owes nobody
   * anything.
   */
  | { readonly outcome: 'notPending'; readonly bookingStatus: string }
  /**
   * The hold lapsed and the slot was taken by somebody else while the client
   * was at their bank.
   *
   * The honest ending, not an error: it reaches the caller as a value so it can
   * be logged as its own cause and rendered as its own state. This is the
   * transfer path's counterpart to the Mercado Pago `slotLost` case, and it is
   * strictly worse — there is no gateway that could tell us whether the money
   * actually moved.
   */
  | { readonly outcome: 'slotLost' };

/**
 * What a review decision decided.
 *
 * `notPending` is what a second submission of the same decision produces — the
 * guarded update matched no rows — and it is not an error. An owner who
 * double-clicks approve must see the approval, not a failure.
 */
export type ReviewResult =
  /**
   * The decision was applied by this call, and by no other.
   *
   * **It carries the booking it applied to** (N1). The caller needs an id to
   * announce a confirmation with, and getting one any other way would mean a
   * second read — one that could return a booking a concurrent write had
   * already moved. Carrying it out of the transaction that changed it is the
   * only way the id is guaranteed to name the row this call actually confirmed.
   */
  | { readonly outcome: 'applied'; readonly bookingId: string }
  | { readonly outcome: 'notPending'; readonly bookingStatus: string }
  /** The receipt id resolved to nothing within this owner's scope. */
  | { readonly outcome: 'notFound' };

export interface ITransferReceiptRepository {
  /**
   * Attaches an already-uploaded receipt to a booking and moves it to
   * `PENDING_APPROVAL`.
   *
   * **The object is uploaded before this is called, never after.** An upload
   * that succeeds over a transaction that fails leaves an orphan, which is
   * bounded and logged; the reverse order leaves a row pointing at nothing,
   * which the owner discovers only when they try to open it.
   *
   * The implementation MUST run one transaction whose first statement takes the
   * **same per-barber advisory lock the booking write takes**, then re-read that
   * barber's overlapping bookings and apply `blocksAvailability` — the same
   * function, never a SQL copy. B4 recorded that "an advisory lock binds only
   * code that takes it" and named the transfer approval as a future caller;
   * this is that caller's sibling, and the first to move a booking *out* of
   * `PENDING_PAYMENT` without confirming it.
   *
   * The lock MUST be acquired with a statement executed for its effect, not a
   * query reading a column back: `pg_advisory_xact_lock` returns `void`, which
   * the driver adapter cannot deserialize, and B4 shipped that defect past a
   * test that mocked the call.
   *
   * The booking update MUST be **conditional** on the booking still being
   * `PENDING_PAYMENT`, so a concurrent transition matches zero rows instead of
   * being overwritten.
   */
  attachReceipt(input: {
    bookingId: string;
    paymentId: string;
    filePath: string;
    barberId: string;
    startTime: Date;
    endTime: Date;
    now: Date;
  }): Promise<AttachReceiptResult>;

  /** The booking's receipt, if it has one. Serves the confirmation page's state. */
  findByBookingId(bookingId: string): Promise<ReceiptSummary | null>;

  /**
   * The owner's queue, oldest first.
   *
   * Oldest first because the oldest is the one whose appointment is nearest to
   * becoming unanswerable — a `PENDING_APPROVAL` booking stops blocking once
   * its own start time has passed, and by then the answer is worth nothing.
   *
   * **"Pending" means the receipt is `PENDING` *and* its booking is still
   * `PENDING_APPROVAL`.** The second half was missing until D1, and its absence
   * was a defect rather than a simplification: the sweep expires a
   * `PENDING_APPROVAL` booking once its appointment has passed and writes
   * `Booking.status` and nothing else, so the receipt stays `PENDING` forever.
   * Without the booking clause those rows sat in the queue under an approve
   * control whose only reachable answer is `noLongerPending`, because `approve`
   * is guarded on `PENDING_APPROVAL`. **This queue is a list of decisions the
   * owner can still make**; a row that cannot be decided does not belong in it.
   */
  findPendingForOwner(ownerId: string): Promise<readonly PendingReceipt[]>;

  /**
   * How many receipts are waiting, over **the same predicate** the listing uses.
   *
   * The implementation SHALL build this from the one shared definition rather
   * than restating the clauses. A counter that disagrees with the queue it
   * summarizes is worse than no counter — the owner is told four are waiting,
   * opens the page, finds three, and now distrusts both numbers. Two copies of
   * a predicate that reads a status is exactly how they come to disagree, and
   * the narrowing above is the second time this predicate has changed.
   */
  countPendingForOwner(ownerId: string): Promise<number>;

  /**
   * Approves: receipt `APPROVED`, payment `APPROVED`, booking `CONFIRMED`.
   *
   * One transaction, holding the per-barber advisory lock, with the booking
   * update conditional on `PENDING_APPROVAL`.
   *
   * The lock is taken even though a `PENDING_APPROVAL` booking has been
   * blocking its slot the whole time and cannot have lost it. It is taken so
   * this caller cannot interleave with a write that is in the middle of taking
   * an adjacent slot for the same barber — the asymmetry with the Mercado Pago
   * path is deliberate and is recorded there too.
   *
   * `ownerId` scopes the resolution: a receipt belonging to another owner and a
   * receipt that does not exist MUST both answer `notFound`.
   */
  approve(input: { receiptId: string; ownerId: string; now: Date }): Promise<ReviewResult>;

  /**
   * Rejects: receipt `REJECTED`, payment `REJECTED`, booking `CANCELLED`, slot
   * released.
   *
   * `CANCELLED` rather than `EXPIRED`: a human decided this, and the two
   * statuses are how the product tells a decision apart from a deadline.
   *
   * No lock is required — this only releases a slot, and releasing one can
   * never double-book. The booking update is still conditional, so a second
   * rejection matches zero rows.
   */
  reject(input: { receiptId: string; ownerId: string; now: Date }): Promise<ReviewResult>;
}
