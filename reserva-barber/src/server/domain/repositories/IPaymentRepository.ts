/**
 * Repository contract for payments.
 *
 * Two callers with opposite shapes. The initiation path knows a booking and
 * wants a payment; the notification handler knows only a payment id lifted from
 * a URL a stranger could have typed, and has to reach everything else from
 * there. The projections below are cut for each, and neither carries a field
 * its caller has no use for.
 */

import type { PaymentMethod, PaymentStatus } from '../models/Payment';

/** A payment as the initiation path and the confirmation page read it. */
export interface PaymentRecord {
  readonly id: string;
  readonly bookingId: string;
  /**
   * Which method this payment belongs to.
   *
   * Added by B6: with two methods live in the product, "the booking's live
   * payment" is no longer a complete answer to what the confirmation page
   * should render — a `PENDING` payment means "resume the checkout" for one
   * method and "upload your receipt" for the other.
   */
  readonly method: PaymentMethod;
  readonly status: PaymentStatus;
  readonly amount: string;
  readonly mpPreferenceId: string | null;
  /**
   * Null between this row's creation and the preference's. A live payment with
   * no checkout URL is an unfinished preference creation, and the initiation
   * path retries it rather than reporting a payment already in progress — a
   * gateway timeout must not leave a client unable to pay for a slot they still
   * hold.
   */
  readonly mpInitPoint: string | null;
  readonly approvedAt: Date | null;
}

/**
 * Everything the notification handler needs, resolved from the `ref` in one
 * indexed read.
 *
 * **One read, deliberately.** The handler is a public endpoint anyone can post
 * to, so the cheap rejection has to come before the expensive work: this
 * lookup either resolves or the request is dropped without ever spending an
 * outbound Mercado Pago call (design D1, and the mitigation T60 leans on).
 *
 * It carries `ownerId` because the owner's access token is the only thing that
 * can authenticate the notification, and `barberId`, `startTime` and `endTime`
 * because a lapsed hold has to be re-checked against the calendar before it may
 * confirm. It carries **no client contact detail**: nothing on this path
 * renders a person, and a column that is never selected cannot reach a log.
 */
export interface PaymentForNotification {
  readonly paymentId: string;
  readonly paymentStatus: PaymentStatus;
  readonly amount: string;
  readonly mpPaymentId: string | null;
  readonly bookingId: string;
  readonly bookingStatus: string;
  readonly holdExpiresAt: Date | null;
  readonly startTime: Date;
  readonly endTime: Date;
  readonly barberId: string;
  readonly ownerId: string;
}

/**
 * What creating a payment decided.
 *
 * `alreadyLive` is a **return value, not an exception**, for the same reason
 * `slotTaken` is on the booking repository: a client double-tapping is ordinary
 * behaviour of a public flow, not a failure, and B4 established that a repeat
 * submission must be invisible to the person who made it. The existing payment
 * comes back so the caller can answer with the same checkout.
 */
export type CreatePaymentResult =
  | { readonly outcome: 'created'; readonly payment: PaymentRecord }
  | { readonly outcome: 'alreadyLive'; readonly payment: PaymentRecord };

/**
 * What the confirming transaction decided.
 *
 * Every member is an ordinary outcome. `notPending` is what a duplicate
 * delivery produces — the guarded update matched no rows — and it is
 * emphatically not an error: Mercado Pago retries by design, and a handler that
 * threw on the second delivery would answer `5xx` and ask for a third.
 */
export type ConfirmPaymentResult =
  | { readonly outcome: 'confirmed' }
  /**
   * The guarded update matched nothing, **and the status it actually found is
   * part of the answer**.
   *
   * Without it the caller cannot tell two situations apart that look identical
   * from here and are nothing alike: a duplicate delivery over a booking
   * already `CONFIRMED`, which is the idempotency mechanism working, and an
   * approved payment over a booking that is `CANCELLED` or `EXPIRED`, which is
   * money taken for an appointment that does not exist. The second owes
   * somebody a refund and the first owes nobody anything.
   */
  | { readonly outcome: 'notPending'; readonly bookingStatus: string }
  | { readonly outcome: 'alreadyProcessed' };

/**
 * What committing to a bank transfer decided.
 *
 * `committed` carries the extended deadline because the page renders it
 * immediately, beside the account number, and re-reading the booking to learn a
 * value this transaction just wrote would be a second round trip for nothing.
 */
export type CommitTransferResult =
  | {
      readonly outcome: 'committed';
      readonly payment: PaymentRecord;
      readonly holdExpiresAt: Date;
    }
  /**
   * A `BANK_TRANSFER` payment was already live. The ordinary double-tap, and
   * the deadline is **not** extended again — otherwise a client could hold a
   * slot indefinitely by tapping the control.
   */
  | {
      readonly outcome: 'alreadyCommitted';
      readonly payment: PaymentRecord;
      readonly holdExpiresAt: Date | null;
    }
  /** A Mercado Pago checkout exists and can be paid. See the method rule below. */
  | { readonly outcome: 'mercadoPagoInFlight' }
  /** The booking is no longer accepting a payment; the status found is the answer. */
  | { readonly outcome: 'notPending'; readonly bookingStatus: string }
  /** The hold lapsed before the client chose a method. */
  | { readonly outcome: 'holdExpired' };

export interface IPaymentRepository {
  /**
   * Opens a `BANK_TRANSFER` payment and **extends the hold**, in one
   * transaction.
   *
   * One call rather than two because the two writes are one decision: a payment
   * row without the extension would leave the client looking at an account
   * number behind a deadline sized for a hosted checkout, which is the failure
   * the extension exists to prevent. The deadline comes from
   * `transferHoldExpiresAtFor`, which shares its clamp with the creation write.
   *
   * **No advisory lock, deliberately, and the asymmetry is the point.** This
   * transaction does not change whether the booking blocks — it is
   * `PENDING_PAYMENT` before and after — so no slot is being taken and there is
   * nothing to race. `attachReceipt` and the owner's approval both *do* take
   * the lock, because both move a booking between blocking states.
   *
   * **The method rule (data-model.md §12).** A live `MERCADO_PAGO` payment
   * holding an `mpInitPoint` blocks this and answers `mercadoPagoInFlight`: a
   * checkout exists, it can be paid at any moment, and making room for a second
   * method risks charging the client twice. A live `MERCADO_PAGO` payment with
   * **no** `mpInitPoint` is an unfinished preference creation — no checkout ever
   * existed, so nobody could have paid it — and is set to `REJECTED` inside this
   * same transaction so the client is not trapped by a gateway outage.
   *
   * The partial unique index is still the arbiter between two concurrent
   * commitments. Its violation MUST be translated as `alreadyCommitted` and
   * MUST be qualified on the violated constraint (T15).
   */
  commitBankTransfer(input: {
    bookingId: string;
    amount: string;
    startTime: Date;
    now: Date;
  }): Promise<CommitTransferResult>;

  /**
   * Opens a pending Mercado Pago payment for a booking, or hands back the live
   * one that already exists.
   *
   * The uniqueness is the database's job: two concurrent submissions both read
   * no existing payment, so only the partial unique index
   * `Payment_one_live_per_booking` can decide between them. The implementation
   * MUST translate that violation into `alreadyLive` and re-read, and MUST
   * qualify the translation on the violated constraint — an unqualified
   * unique-violation handler is T15, already a defect in this codebase.
   *
   * `amount` arrives as a canonical decimal string, copied from the booking's
   * snapshot. This repository never computes an amount.
   */
  createPendingMercadoPago(input: {
    bookingId: string;
    amount: string;
  }): Promise<CreatePaymentResult>;

  /**
   * Attaches the preference and its checkout URL once Mercado Pago has created
   * them. Separate from creation because the notification address must carry
   * this row's own id, so the row has to exist first.
   */
  attachPreference(input: {
    paymentId: string;
    preferenceId: string;
    initPoint: string;
  }): Promise<void>;

  /** The booking's live payment, if it has one. Serves the repeat submission. */
  findLiveByBookingId(bookingId: string): Promise<PaymentRecord | null>;

  /**
   * Resolves the `ref` a notification arrived with.
   *
   * Returns `null` for anything that does not resolve, and the caller MUST
   * answer that identically to an already-processed notification. A response
   * that differs turns a public endpoint into an oracle for which bookings
   * exist.
   */
  findForNotification(paymentId: string): Promise<PaymentForNotification | null>;

  /**
   * Approves the payment and confirms its booking, in one transaction.
   *
   * **The booking update MUST be conditional on the status still being
   * `PENDING_PAYMENT`**, matching zero rows on a second delivery rather than
   * reasserting a transition. A handler that assigns the last-seen status lets
   * an out-of-order `pending` un-confirm a booking somebody paid for.
   *
   * `mpPaymentId` is written here, and its unique violation MUST be translated
   * as `alreadyProcessed` rather than propagated: that constraint is the
   * idempotency guarantee, so tripping it is the mechanism working, not
   * failing.
   */
  confirmWithPayment(input: {
    paymentId: string;
    bookingId: string;
    gatewayPaymentId: string;
    approvedAt: Date;
  }): Promise<ConfirmPaymentResult>;

  /**
   * The late-payment branch: approve the payment, and confirm the booking
   * **only if its slot is still free**.
   *
   * Reached when an approved notification arrives after `holdExpiresAt` has
   * passed. The booking has stopped blocking availability by then, so the slot
   * may have been sold to somebody else while the client was at the checkout.
   *
   * **The implementation MUST be one transaction whose first statement takes
   * the same per-barber advisory lock the booking write takes**, then re-read
   * that barber's overlapping bookings and apply `blocksAvailability` — the
   * same function, never a SQL copy. B4 recorded that "an advisory lock binds
   * only code that takes it" and named the sweeper and the transfer approval as
   * the callers that must; this is a third, and the first that *confirms* an
   * existing booking rather than creating one. Skipping the lock here would
   * place a booking into a slot a concurrent write is in the middle of taking.
   *
   * `confirmWithPayment` deliberately takes **no** lock, and the asymmetry is
   * the point: a booking still inside its hold is still blocking availability,
   * so nobody else could have been offered its slot. There is nothing to race.
   *
   * The payment is recorded `APPROVED` on **both** branches, because the charge
   * happened either way. Recording the slot-lost case as `REJECTED` would hide
   * from the owner's accounting a sum they have received and now owe back.
   */
  confirmIfSlotFree(input: {
    paymentId: string;
    bookingId: string;
    barberId: string;
    startTime: Date;
    endTime: Date;
    gatewayPaymentId: string;
    approvedAt: Date;
    now: Date;
  }): Promise<LateConfirmResult>;
}

/**
 * What the late-payment transaction decided.
 *
 * `slotLost` is the honest ending, not an error: the client paid, the slot is
 * gone, and a human owes them a refund. It reaches the caller as a value so it
 * can be logged as its own cause and rendered as its own state.
 */
export type LateConfirmResult =
  | { readonly outcome: 'confirmed' }
  | { readonly outcome: 'slotLost' }
  | { readonly outcome: 'notPending'; readonly bookingStatus: string }
  | { readonly outcome: 'alreadyProcessed' };
