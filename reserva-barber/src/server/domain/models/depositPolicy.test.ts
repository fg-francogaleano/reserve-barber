import { describe, it, expect } from 'vitest';
import {
  computeDepositAmount,
  MIN_DEPOSIT_AMOUNT,
  type DepositPolicy,
} from './depositPolicy';

const percent = (value: string): DepositPolicy => ({ type: 'PERCENT', value });
const fixed = (value: string): DepositPolicy => ({ type: 'FIXED', value });

describe('depositPolicy - percentage of the price', () => {
  it('should_take_the_stated_share_of_a_round_price', () => {
    expect(computeDepositAmount(percent('30'), '8000.00')).toBe('2400.00');
  });

  /**
   * The reason the calculation runs over integer cents: `2501.67 * 0.3` is
   * 750.5009999999999 in IEEE-754, and half-up rounding of that lands on the
   * same answer only by luck.
   */
  it('should_round_half_up_when_the_share_does_not_divide_evenly', () => {
    expect(computeDepositAmount(percent('30'), '2501.67')).toBe('750.50');
  });

  it('should_round_a_half_cent_upward', () => {
    // 1% of 100.05 is 1.0005 → 1.00; 50% of 100.05 is 50.025 → 50.03
    expect(computeDepositAmount(percent('50'), '100.05')).toBe('50.03');
  });

  it('should_charge_the_whole_price_at_one_hundred_percent', () => {
    expect(computeDepositAmount(percent('100'), '8000.00')).toBe('8000.00');
  });

  it('should_handle_a_one_percent_policy_on_a_large_price', () => {
    expect(computeDepositAmount(percent('1'), '9999999.99')).toBe('100000.00');
  });
});

describe('depositPolicy - fixed amount', () => {
  it('should_charge_the_configured_amount', () => {
    expect(computeDepositAmount(fixed('2000.00'), '8000.00')).toBe('2000.00');
  });

  /**
   * The cap, not the save-time warning, is what protects the client: a service
   * cheaper than the fixed deposit can be created at any time afterwards.
   */
  it('should_cap_a_fixed_deposit_at_the_service_price', () => {
    expect(computeDepositAmount(fixed('5000.00'), '3000.00')).toBe('3000.00');
  });

  it('should_charge_the_exact_price_when_they_are_equal', () => {
    expect(computeDepositAmount(fixed('3000.00'), '3000.00')).toBe('3000.00');
  });
});

describe('depositPolicy - the minimum chargeable floor', () => {
  it('should_raise_a_computed_deposit_that_falls_below_the_floor', () => {
    // 1% of 50.00 is 0.50, which no gateway will charge.
    expect(computeDepositAmount(percent('1'), '50.00')).toBe(MIN_DEPOSIT_AMOUNT);
  });

  /**
   * The floor is guarded rather than a plain maximum. An unguarded floor would
   * undo the cap above it and charge more than the service costs — the two
   * clamps interact, which is why the order is part of the rule.
   */
  it('should_not_raise_the_deposit_above_a_service_priced_below_the_floor', () => {
    const price = '0.50';
    expect(computeDepositAmount(percent('50'), price)).toBe(price);
  });

  it('should_not_raise_a_fixed_deposit_above_a_service_priced_below_the_floor', () => {
    const price = '0.50';
    expect(computeDepositAmount(fixed('5000.00'), price)).toBe(price);
  });

  it('should_leave_a_deposit_already_at_the_floor_untouched', () => {
    expect(computeDepositAmount(fixed(MIN_DEPOSIT_AMOUNT), '8000.00')).toBe(MIN_DEPOSIT_AMOUNT);
  });
});

describe('depositPolicy - the result is always a canonical amount', () => {
  it.each([
    [percent('30'), '8000.00'],
    [percent('7'), '1234.56'],
    [fixed('2000.00'), '8000.00'],
    [fixed('5000.00'), '3000.00'],
    [percent('1'), '50.00'],
  ])('should_return_two_decimal_places_for_%o_on_%s', (policy, price) => {
    expect(computeDepositAmount(policy, price)).toMatch(/^\d+\.\d{2}$/);
  });

  it('should_never_exceed_the_service_price', () => {
    for (const price of ['0.50', '1.00', '50.00', '3000.00', '9999999.99']) {
      for (const policy of [percent('100'), fixed('9999999.99'), fixed('0.01')]) {
        const deposit = computeDepositAmount(policy, price);
        expect(Number(deposit)).toBeLessThanOrEqual(Number(price));
      }
    }
  });
});

describe('depositPolicy - the floor is measured, not guessed', () => {
  it('should_expose_the_floor_as_a_canonical_amount', () => {
    expect(MIN_DEPOSIT_AMOUNT).toMatch(/^\d+\.\d{2}$/);
  });

  /**
   * **The value is measured, and this test is what stops it drifting back to a
   * guess.**
   *
   * Read from Mercado Pago's `/v1/payment_methods` against a real Argentine
   * account (B5 gate, 2026-08-19). Sixteen active methods, in four bands:
   *
   *   prepaid_card                       min  1 ARS
   *   debit + Visa/Master/Amex credit    min  3 ARS
   *   Diners, Naranja, Argencard, Cabal  min 15 ARS
   *   Rapipago, Pago Fácil (cash)        min 50 ARS
   *
   * **15 is the point at which every card works**, and cards are what this
   * product charges with. One is the literal floor — below it nobody can pay at
   * all — but a deposit of one or two pesos is payable only by prepaid card,
   * which means a client holding an ordinary Visa reaches the checkout and
   * finds nothing they can use. That is the failure this constant exists to
   * prevent, arriving two pesos later.
   *
   * Fifty would also work and is rejected as over-reach: it would silently
   * raise a deposit twenty-five times over what the owner configured, to
   * preserve cash payment methods this product has never mentioned.
   */
  it('should_be_the_measured_amount_at_which_every_card_method_works', () => {
    expect(MIN_DEPOSIT_AMOUNT).toBe('15.00');
  });
});
