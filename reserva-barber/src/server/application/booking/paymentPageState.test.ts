import { describe, it, expect } from 'vitest';
import {
  resolvePaymentPageState,
  offersPayment,
  type PaymentPageInput,
} from './paymentPageState';

const NOW = new Date('2026-08-19T12:00:00.000Z');

function input(overrides: Partial<PaymentPageInput> = {}): PaymentPageInput {
  return {
    bookingStatus: 'PENDING_PAYMENT',
    startTime: new Date('2026-08-19T14:00:00.000Z'),
    endTime: new Date('2026-08-19T14:30:00.000Z'),
    holdExpiresAt: new Date('2026-08-19T12:15:00.000Z'),
    paymentStatus: null,
    hasCheckout: false,
    outcome: null,
    now: NOW,
    ...overrides,
  };
}

describe('the eight states', () => {
  it('offers payment on a live, unpaid hold', () => {
    expect(resolvePaymentPageState(input())).toBe('holdLiveUnpaid');
  });

  it('offers to resume a checkout already opened', () => {
    expect(
      resolvePaymentPageState(input({ paymentStatus: 'PENDING', hasCheckout: true }))
    ).toBe('paymentInFlight');
  });

  it('says it is confirming after a return from the gateway', () => {
    expect(resolvePaymentPageState(input({ outcome: 'pago-pendiente' }))).toBe(
      'awaitingConfirmation'
    );
  });

  it('reports a confirmed booking', () => {
    expect(resolvePaymentPageState(input({ bookingStatus: 'CONFIRMED' }))).toBe('confirmed');
  });

  it('reports a rejection while the hold is still live', () => {
    expect(resolvePaymentPageState(input({ outcome: 'pago-rechazado' }))).toBe(
      'paymentRejected'
    );
  });

  it('reports a lapsed hold', () => {
    expect(
      resolvePaymentPageState(input({ holdExpiresAt: new Date('2026-08-19T11:00:00.000Z') }))
    ).toBe('holdLapsed');
  });

  it('reports a charge that outlived its slot', () => {
    expect(
      resolvePaymentPageState(
        input({
          paymentStatus: 'APPROVED',
          holdExpiresAt: new Date('2026-08-19T11:00:00.000Z'),
        })
      )
    ).toBe('paidSlotLost');
  });

  it.each(['sin-mercadopago', 'pagos-no-disponibles'] as const)(
    'reports the shop as unable to charge for %s',
    (outcome) => {
      expect(resolvePaymentPageState(input({ outcome }))).toBe('paymentsUnavailable');
    }
  );
});

describe('precedence, which is the part that is easy to get wrong', () => {
  /**
   * The page reports what the database says happened, never what a URL claims.
   * A forged success code is inert; so is a stale failure code in a bookmarked
   * URL, which must not tell somebody their confirmed appointment failed.
   */
  it.each([
    'pago-pendiente',
    'pago-rechazado',
    'sin-mercadopago',
    'pagos-no-disponibles',
    'vencido',
    'reintenta',
  ] as const)('lets a confirmed booking outrank the %s code', (outcome) => {
    expect(resolvePaymentPageState(input({ bookingStatus: 'CONFIRMED', outcome }))).toBe(
      'confirmed'
    );
  });

  it('does not claim confirmation from an outcome code alone', () => {
    // There is no success code that can produce `confirmed` — only the database
    // can. This is the forged-return case stated as a rule.
    for (const outcome of ['pago-pendiente', 'pago-rechazado'] as const) {
      expect(resolvePaymentPageState(input({ outcome }))).not.toBe('confirmed');
    }
  });

  /**
   * "Your turn expired" would be a lie to somebody who paid. The approved
   * payment outranks the lapsed hold, which is the whole point of the
   * slot-lost state existing.
   */
  it('lets an approved payment outrank a lapsed hold', () => {
    expect(
      resolvePaymentPageState(
        input({
          paymentStatus: 'APPROVED',
          holdExpiresAt: new Date('2026-08-19T11:00:00.000Z'),
          outcome: 'vencido',
        })
      )
    ).toBe('paidSlotLost');
  });

  it('lets a rejection outrank a resumable checkout', () => {
    // A client who just came back rejected must be told so, not handed the
    // same button as though nothing happened.
    expect(
      resolvePaymentPageState(
        input({ outcome: 'pago-rechazado', paymentStatus: 'PENDING', hasCheckout: true })
      )
    ).toBe('paymentRejected');
  });

  it('does not soften an explicit rejection into a pending message', () => {
    expect(resolvePaymentPageState(input({ outcome: 'pago-rechazado' }))).not.toBe(
      'awaitingConfirmation'
    );
  });

  it('reports a lapsed hold rather than the shop being unable to charge', () => {
    // Once the hold has gone there is nothing to configure a way out of, so the
    // shop-side message would be advice about a turn that no longer exists.
    expect(
      resolvePaymentPageState(
        input({
          holdExpiresAt: new Date('2026-08-19T11:00:00.000Z'),
          outcome: 'sin-mercadopago',
        })
      )
    ).toBe('holdLapsed');
  });

  it('does not offer to resume a checkout with no checkout URL', () => {
    // A preference creation that timed out. The client gets the ordinary button
    // and the initiation retries, rather than being told to resume nothing.
    expect(
      resolvePaymentPageState(input({ paymentStatus: 'PENDING', hasCheckout: false }))
    ).toBe('holdLiveUnpaid');
  });

  it.each(['CANCELLED', 'EXPIRED'] as const)(
    'reports a %s booking as lapsed rather than payable',
    (bookingStatus) => {
      expect(resolvePaymentPageState(input({ bookingStatus }))).toBe('holdLapsed');
    }
  );
});

describe('which states offer a control', () => {
  it.each(['holdLiveUnpaid', 'paymentInFlight', 'paymentRejected'] as const)(
    '%s offers one',
    (state) => {
      expect(offersPayment(state)).toBe(true);
    }
  );

  /**
   * Absent, never disabled. A disabled-looking control invites a tap that
   * cannot succeed, and on this page every one of these states means the client
   * has nothing left to do here.
   */
  it.each([
    'confirmed',
    'holdLapsed',
    'paidSlotLost',
    'paymentsUnavailable',
    'awaitingConfirmation',
  ] as const)('%s offers none', (state) => {
    expect(offersPayment(state)).toBe(false);
  });
});
