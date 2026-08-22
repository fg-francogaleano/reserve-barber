import { describe, expect, it } from 'vitest';
import {
  PAYMENT_STATUSES,
  isLivePayment,
  verifyGatewayPayment,
  type GatewayPayment,
  type PaymentVerificationTarget,
} from './Payment';

const target: PaymentVerificationTarget = {
  bookingId: 'bkg_1',
  amount: '5000.00',
};

function gatewayPayment(overrides: Partial<GatewayPayment> = {}): GatewayPayment {
  return {
    id: 'mp_1',
    status: 'approved',
    externalReference: 'bkg_1',
    transactionAmount: '5000.00',
    currencyId: 'ARS',
    ...overrides,
  };
}

describe('PAYMENT_STATUSES', () => {
  it('holds exactly the three states the column declares', () => {
    expect(PAYMENT_STATUSES).toEqual(['PENDING', 'APPROVED', 'REJECTED']);
  });
});

describe('isLivePayment', () => {
  // The predicate behind the partial unique index. A rejected attempt must not
  // block a retry — a declined card is precisely the person who tries again.
  it('counts a pending payment as live', () => {
    expect(isLivePayment('PENDING')).toBe(true);
  });

  it('counts an approved payment as live', () => {
    expect(isLivePayment('APPROVED')).toBe(true);
  });

  it('does not count a rejected payment as live', () => {
    expect(isLivePayment('REJECTED')).toBe(false);
  });
});

describe('verifyGatewayPayment', () => {
  it('accepts a payment that matches on all three properties', () => {
    expect(verifyGatewayPayment(gatewayPayment(), target)).toEqual({ ok: true });
  });

  // Without this, any small payment on the owner's account — or a replayed
  // notification for an unrelated one — confirms a booking it never paid for.
  it('refuses an amount that does not match the snapshotted deposit', () => {
    const result = verifyGatewayPayment(
      gatewayPayment({ transactionAmount: '1.00' }),
      target
    );

    expect(result).toEqual({ ok: false, reason: 'amount_mismatch' });
  });

  it('refuses a reference belonging to another booking', () => {
    const result = verifyGatewayPayment(
      gatewayPayment({ externalReference: 'bkg_2' }),
      target
    );

    expect(result).toEqual({ ok: false, reason: 'reference_mismatch' });
  });

  it('refuses a currency other than ARS', () => {
    const result = verifyGatewayPayment(gatewayPayment({ currencyId: 'USD' }), target);

    expect(result).toEqual({ ok: false, reason: 'currency_mismatch' });
  });

  it('refuses a missing reference rather than treating absence as a match', () => {
    const result = verifyGatewayPayment(
      gatewayPayment({ externalReference: null }),
      target
    );

    expect(result).toEqual({ ok: false, reason: 'reference_mismatch' });
  });

  /**
   * **The measured case, not a hypothetical one.**
   *
   * The driver returns a stored `2000.50` as `2000.5`. String equality would
   * call those different and refuse a correct payment; a float comparison
   * would introduce the representation error integer cents exist to avoid.
   * Measured in PC3 and already binding on `Service.price` and `Booking`.
   */
  it('treats 2000.5 and 2000.50 as the same amount', () => {
    const result = verifyGatewayPayment(
      gatewayPayment({ transactionAmount: '2000.5' }),
      { bookingId: 'bkg_1', amount: '2000.50' }
    );

    expect(result).toEqual({ ok: true });
  });

  it('does not read a trailing 5 as five centavos', () => {
    const result = verifyGatewayPayment(
      gatewayPayment({ transactionAmount: '2000.05' }),
      { bookingId: 'bkg_1', amount: '2000.50' }
    );

    expect(result).toEqual({ ok: false, reason: 'amount_mismatch' });
  });

  it('accepts an integer amount reported without decimals', () => {
    const result = verifyGatewayPayment(
      gatewayPayment({ transactionAmount: '5000' }),
      target
    );

    expect(result).toEqual({ ok: true });
  });

  // An unparseable amount is not a match. Reading it as zero, or as equal,
  // would confirm a booking on a value we could not understand.
  it('refuses an amount it cannot parse', () => {
    const result = verifyGatewayPayment(
      gatewayPayment({ transactionAmount: 'many pesos' }),
      target
    );

    expect(result).toEqual({ ok: false, reason: 'amount_mismatch' });
  });

  /**
   * Verification answers "is this payment ours, and for the right money" — not
   * "did it succeed". Keeping the status question out of here is what lets the
   * caller apply its own policy to a `rejected` or `refunded` payment that is
   * unambiguously ours.
   */
  it('verifies identity independently of the reported status', () => {
    expect(verifyGatewayPayment(gatewayPayment({ status: 'rejected' }), target)).toEqual({
      ok: true,
    });
  });
});
