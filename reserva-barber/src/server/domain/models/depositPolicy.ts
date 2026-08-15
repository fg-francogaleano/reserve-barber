import { toCents, fromCents } from './money';
import type { DepositType } from './PaymentConfig';

/**
 * The deposit policy and the only implementation of the deposit calculation
 * (`docs/backend-standards.md` — "deposit computation lives only in
 * `DepositPolicy`, reused by the booking flow and the stats module").
 *
 * B4 computes a booking's deposit through here, B5 and B6 charge what it
 * returned, and the deposit editor previews it against real service prices. A
 * second implementation on any of those surfaces would be a second answer to
 * "what does this client owe".
 */

export interface DepositPolicy {
  type: DepositType;
  /** A canonical amount for `FIXED`; a whole number 1–100 for `PERCENT`. */
  value: string;
}

/**
 * The smallest deposit worth creating a charge for, as a canonical amount.
 *
 * **This value is provisional.** A computed deposit below a payment gateway's
 * own minimum produces a charge that cannot be created, and the failure lands
 * inside a client's checkout rather than at configuration time — so a floor has
 * to exist. What Mercado Pago's actual minimum is, is a fact this story does
 * not verify.
 *
 * **B5 confirms it and updates this constant.** That is the first story to call
 * Mercado Pago with real money and therefore the first in a position to know.
 * Until then, treat this as a placeholder that prevents an obviously
 * uncharageable deposit, not as an established limit (see `docs/tech-debt.md`).
 */
export const MIN_DEPOSIT_AMOUNT = '1.00';

/**
 * What a client owes to confirm a booking of a service priced `priceAtBooking`.
 *
 * The steps are ordered, and the order is part of the rule:
 *
 * 1. the fixed amount, or the percentage of the price;
 * 2. rounded half-up to two decimals over integer cents, never a float;
 * 3. capped at the price — a deposit larger than the service is never charged;
 * 4. floored at `MIN_DEPOSIT_AMOUNT`, **unless the price is itself below that
 *    floor**, in which case the deposit is the price.
 *
 * Step 4's guard is the part that is easy to get wrong. An unguarded `max`
 * would undo step 3 for any service cheaper than the floor and charge more than
 * the service costs — which is precisely the failure step 3 exists to prevent.
 *
 * Both arguments are canonical amounts, already parsed. `value` for a `PERCENT`
 * policy is a whole number 1–100, already validated.
 */
export function computeDepositAmount(policy: DepositPolicy, priceAtBooking: string): string {
  return describeDeposit(policy, priceAtBooking).amount;
}

/**
 * The deposit **and which clamps fired getting there**.
 *
 * The deposit editor needs to tell an owner that a fixed amount exceeds a
 * service's price, or that a percentage computes below the minimum. Deriving
 * that by recomputing steps 1 and 2 outside this module would be a second
 * implementation of the calculation — so the calculation reports it instead.
 */
export interface DepositBreakdown {
  amount: string;
  /** The policy asked for more than the service costs, and was capped down. */
  cappedByPrice: boolean;
  /** The policy asked for less than the minimum, and was raised up to it. */
  raisedToMinimum: boolean;
}

export function describeDeposit(policy: DepositPolicy, priceAtBooking: string): DepositBreakdown {
  const priceCents = toCents(priceAtBooking);

  // Step 1 and 2. For PERCENT the multiplication happens in cents and the
  // division by 100 is where rounding is decided; adding half the divisor
  // before an integer division is half-up without a float ever appearing.
  const rawCents =
    policy.type === 'FIXED'
      ? toCents(policy.value)
      : Math.floor((priceCents * Number(policy.value) + 50) / 100);

  // Step 3.
  const cappedCents = Math.min(rawCents, priceCents);

  // Step 4.
  const floorCents = toCents(MIN_DEPOSIT_AMOUNT);
  const finalCents = priceCents < floorCents ? priceCents : Math.max(cappedCents, floorCents);

  return {
    amount: fromCents(finalCents),
    cappedByPrice: rawCents > priceCents,
    // A service priced under the floor meets both rules at once; it is
    // reported as the cap it really is, because raising a deposit above the
    // price is precisely what step 4's guard refuses to do.
    raisedToMinimum: rawCents < floorCents && priceCents >= floorCents,
  };
}
