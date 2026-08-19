/**
 * The payment states, the predicate the partial unique index encodes, and the
 * verification that decides whether a payment reported by Mercado Pago is
 * actually ours.
 *
 * Deliberately free of Prisma, crypto and `fetch`. What Mercado Pago's payload
 * looks like is an infrastructure concern; what makes a payment *ours* is a
 * domain rule, and it is the one thing standing between a public webhook and a
 * confirmed appointment.
 */

import { parseAmount, toCents } from './money';

export const PAYMENT_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;

export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_METHODS = ['MERCADO_PAGO', 'BANK_TRANSFER'] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/**
 * Whether this payment occupies its booking's single live slot.
 *
 * The predicate the partial unique index `Payment_one_live_per_booking`
 * encodes, kept here so the application and the database cannot drift into two
 * definitions of "live". `REJECTED` is excluded on purpose: a declined card is
 * exactly the client who will try again, and a failed attempt that blocked the
 * retry would be the worst possible place to enforce a bound.
 */
export function isLivePayment(status: PaymentStatus): boolean {
  return status !== 'REJECTED';
}

/**
 * A payment as Mercado Pago reports it, reduced to the four fields any decision
 * here depends on.
 *
 * `status` is Mercado Pago's own vocabulary (`approved`, `rejected`, `pending`,
 * `refunded`, `charged_back`, `cancelled`, …) and is deliberately left as a
 * string: the set is theirs, it changes without us, and a narrowed union would
 * turn an unrecognized value into a parse failure rather than a notification we
 * can decline to act on.
 *
 * `transactionAmount` is a string for the same reason every monetary value in
 * this codebase is: the driver returns a stored `2000.50` as `2000.5`, and a
 * number here would invite the float arithmetic integer cents exist to avoid.
 */
export interface GatewayPayment {
  readonly id: string;
  readonly status: string;
  readonly externalReference: string | null;
  readonly transactionAmount: string;
  readonly currencyId: string;
}

/** What we believe about the payment, from our own row. Never from the notification. */
export interface PaymentVerificationTarget {
  readonly bookingId: string;
  readonly amount: string;
}

export type PaymentVerificationFailure =
  | 'reference_mismatch'
  | 'amount_mismatch'
  | 'currency_mismatch';

export type PaymentVerification =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: PaymentVerificationFailure };

/** The only currency this product charges in. */
const EXPECTED_CURRENCY = 'ARS';

/**
 * Whether a payment Mercado Pago reported is the one we are waiting for.
 *
 * **This answers identity, not success.** A `rejected` payment that is
 * unambiguously ours passes verification — the caller then applies its own
 * policy to the status. Folding the two questions together would leave no way
 * to distinguish "not our payment" from "our payment, and it failed", and those
 * demand opposite responses.
 *
 * The amount check is the one that carries weight. Without it, any small
 * payment on the owner's Mercado Pago account — or a replayed notification for
 * an unrelated one — would confirm a booking it never paid for. Re-fetching the
 * payment from Mercado Pago proves it exists; only this comparison proves it
 * paid what we asked.
 *
 * A missing reference and an unparseable amount are **failures, not passes**.
 * Treating absence as agreement is how a verification function becomes
 * decoration.
 */
export function verifyGatewayPayment(
  payment: GatewayPayment,
  target: PaymentVerificationTarget
): PaymentVerification {
  if (payment.externalReference !== target.bookingId) {
    return { ok: false, reason: 'reference_mismatch' };
  }

  if (payment.currencyId !== EXPECTED_CURRENCY) {
    return { ok: false, reason: 'currency_mismatch' };
  }

  const reported = parseAmount(payment.transactionAmount);
  const expected = parseAmount(target.amount);

  if (!reported.ok || !expected.ok) {
    return { ok: false, reason: 'amount_mismatch' };
  }

  // Integer cents, never a float and never string equality: the driver's
  // `2000.5` and our stored `2000.50` are the same money and must compare
  // equal, while `2000.05` must not (measured in PC3).
  if (toCents(reported.value) !== toCents(expected.value)) {
    return { ok: false, reason: 'amount_mismatch' };
  }

  return { ok: true };
}
