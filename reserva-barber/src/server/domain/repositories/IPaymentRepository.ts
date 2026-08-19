/**
 * Repository contract for payments.
 *
 * Two callers with opposite shapes. The initiation path knows a booking and
 * wants a payment; the notification handler knows only a payment id lifted from
 * a URL a stranger could have typed, and has to reach everything else from
 * there. The projections below are cut for each, and neither carries a field
 * its caller has no use for.
 */

import type { PaymentStatus } from '../models/Payment';

/** A payment as the initiation path and the confirmation page read it. */
export interface PaymentRecord {
  readonly id: string;
  readonly bookingId: string;
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
  | { readonly outcome: 'notPending' }
  | { readonly outcome: 'alreadyProcessed' };

export interface IPaymentRepository {
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
   * Records an approved payment whose booking did NOT get confirmed — the
   * slot-lost branch of the late-payment rule.
   *
   * The payment is `APPROVED` because the charge is real. Recording it as
   * `REJECTED` would hide money the owner has actually received and now owes
   * back, which is the opposite of what the owner needs to see. The booking is
   * deliberately left alone.
   */
  approveWithoutConfirming(input: {
    paymentId: string;
    gatewayPaymentId: string;
    approvedAt: Date;
  }): Promise<ConfirmPaymentResult>;
}
