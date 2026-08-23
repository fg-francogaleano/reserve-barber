import { describe, it, expect } from 'vitest';
import {
  resolvePaymentPageState,
  offersMercadoPago,
  offersTransfer,
  canBePaid,
  type PaymentMethodAvailability,
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
    paymentMethod: null,
    receiptStatus: null,
    outcome: null,
    shopCanBePaid: true,
    now: NOW,
    ...overrides,
  };
}

/** A shop with both methods usable, so a test opts out rather than in. */
function methods(overrides: Partial<PaymentMethodAvailability> = {}): PaymentMethodAvailability {
  return { hasMercadoPago: true, hasTransfer: true, ...overrides };
}

describe('the eight states', () => {
  it('offers payment on a live, unpaid hold', () => {
    expect(resolvePaymentPageState(input())).toBe('holdLiveUnpaid');
  });

  it('offers to resume a checkout already opened', () => {
    expect(
      resolvePaymentPageState(
        input({ paymentStatus: 'PENDING', hasCheckout: true, paymentMethod: 'MERCADO_PAGO' })
      )
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
    expect(resolvePaymentPageState(input({ outcome: 'pago-rechazado' }))).toBe('paymentRejected');
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
    expect(resolvePaymentPageState(input({ paymentStatus: 'PENDING', hasCheckout: false }))).toBe(
      'holdLiveUnpaid'
    );
  });

  it.each(['CANCELLED', 'EXPIRED'] as const)(
    'reports a %s booking as lapsed rather than payable',
    (bookingStatus) => {
      expect(resolvePaymentPageState(input({ bookingStatus }))).toBe('holdLapsed');
    }
  );
});

describe('which states offer a control', () => {
  it.each(['holdLiveUnpaid', 'paymentRejected'] as const)(
    '%s offers both methods at a shop with both',
    (state) => {
      expect(offersMercadoPago(state, methods())).toBe(true);
      expect(offersTransfer(state, methods())).toBe(true);
    }
  );

  it('offers the Mercado Pago control to resume a checkout, and not the other', () => {
    expect(offersMercadoPago('paymentInFlight', methods())).toBe(true);
    expect(offersTransfer('paymentInFlight', methods())).toBe(false);
  });

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
    'receiptUnderReview',
    'receiptRejected',
    'transferSlotLost',
    'transferAwaitingReceipt',
    'methodInUse',
  ] as const)('%s offers none', (state) => {
    expect(offersMercadoPago(state, methods())).toBe(false);
    expect(offersTransfer(state, methods())).toBe(false);
  });
});

describe('the offer reflects what the shop configured', () => {
  /**
   * B5's version offered the Mercado Pago control unconditionally and let the
   * failure surface as `sin-mercadopago` after the POST. Defensible while it
   * was the only method; with two, offering one that cannot work hides the one
   * that can.
   */
  it('hides Mercado Pago at a transfer-only shop', () => {
    const transferOnly = methods({ hasMercadoPago: false });

    expect(offersMercadoPago('holdLiveUnpaid', transferOnly)).toBe(false);
    expect(offersTransfer('holdLiveUnpaid', transferOnly)).toBe(true);
  });

  it('hides transfer at a Mercado Pago only shop', () => {
    const mpOnly = methods({ hasTransfer: false });

    expect(offersMercadoPago('holdLiveUnpaid', mpOnly)).toBe(true);
    expect(offersTransfer('holdLiveUnpaid', mpOnly)).toBe(false);
  });

  /** The gap B6 closes: `isBookable` already admits a shop this page cannot serve. */
  it('reports a shop with neither method as unable to be paid', () => {
    expect(canBePaid(methods({ hasMercadoPago: false, hasTransfer: false }))).toBe(false);
    expect(canBePaid(methods({ hasMercadoPago: false }))).toBe(true);
    expect(canBePaid(methods({ hasTransfer: false }))).toBe(true);
  });
});

describe('the transfer states', () => {
  it('renders the destination once a transfer payment is live', () => {
    expect(
      resolvePaymentPageState(input({ paymentMethod: 'BANK_TRANSFER', paymentStatus: 'PENDING' }))
    ).toBe('transferAwaitingReceipt');
  });

  /**
   * A committed transfer is a state of the database, never of the URL. The
   * destination the page renders comes from a projection that is null unless
   * the commitment exists, and this is the other half of that guarantee.
   */
  it('shows nothing to a forged transfer code', () => {
    expect(resolvePaymentPageState(input({ outcome: 'transferencia-iniciada' }))).toBe(
      'holdLiveUnpaid'
    );
  });

  it('reports a receipt under review', () => {
    expect(
      resolvePaymentPageState(
        input({
          bookingStatus: 'PENDING_APPROVAL',
          paymentMethod: 'BANK_TRANSFER',
          paymentStatus: 'PENDING',
          receiptStatus: 'PENDING',
        })
      )
    ).toBe('receiptUnderReview');
  });

  /**
   * The precedence that matters most in this story. `holdExpiresAt` was the
   * deadline for *uploading* a receipt, not for *answering* one, so a lapsed
   * value on a `PENDING_APPROVAL` booking must not produce "your turn expired"
   * while the owner is looking at the comprobante.
   */
  it('keeps a receipt under review above a lapsed upload deadline', () => {
    expect(
      resolvePaymentPageState(
        input({
          bookingStatus: 'PENDING_APPROVAL',
          holdExpiresAt: new Date('2026-08-19T11:00:00.000Z'),
          paymentMethod: 'BANK_TRANSFER',
          paymentStatus: 'PENDING',
          receiptStatus: 'PENDING',
        })
      )
    ).toBe('receiptUnderReview');
  });

  it('keeps a receipt under review above any stale code', () => {
    expect(
      resolvePaymentPageState(
        input({
          bookingStatus: 'PENDING_APPROVAL',
          receiptStatus: 'PENDING',
          outcome: 'pago-rechazado',
        })
      )
    ).toBe('receiptUnderReview');
  });

  it('reports a rejected receipt rather than a bare cancellation', () => {
    expect(
      resolvePaymentPageState(input({ bookingStatus: 'CANCELLED', receiptStatus: 'REJECTED' }))
    ).toBe('receiptRejected');
  });

  /**
   * No row records this one: the receipt was refused before anything was
   * written. It still outranks the lapsed hold, because this client may have
   * moved real money and no gateway exists that could tell us.
   */
  it('reports a transfer that arrived after the slot was taken', () => {
    expect(
      resolvePaymentPageState(
        input({
          holdExpiresAt: new Date('2026-08-19T11:00:00.000Z'),
          outcome: 'transferencia-sin-lugar',
        })
      )
    ).toBe('transferSlotLost');
  });

  it('reports a Mercado Pago checkout blocking the other method', () => {
    expect(resolvePaymentPageState(input({ outcome: 'metodo-en-curso' }))).toBe('methodInUse');
  });

  it('treats a missing transfer destination as a shop-side failure', () => {
    expect(resolvePaymentPageState(input({ outcome: 'sin-transferencia' }))).toBe(
      'paymentsUnavailable'
    );
  });

  /** A confirmed booking still outranks everything, receipts included. */
  it('keeps a confirmed booking above every transfer state', () => {
    expect(
      resolvePaymentPageState(
        input({
          bookingStatus: 'CONFIRMED',
          receiptStatus: 'PENDING',
          outcome: 'transferencia-sin-lugar',
        })
      )
    ).toBe('confirmed');
  });
});

describe('a forged code cannot invent a lost slot', () => {
  /**
   * **The defect an adversarial review found.** `transferencia-sin-lugar` is
   * the one state on this page with no row behind it — the receipt was refused
   * before anything was written — so it is the only one a URL parameter alone
   * could produce. An earlier version asked for it *above* the live-hold check,
   * which meant appending it to any live booking's URL rendered "your slot was
   * taken" and removed the payment controls.
   *
   * That is the mirror of the forged confirmation this flow has refused since
   * B5, and no less damaging: one invents good news, the other makes somebody
   * abandon a booking that is still theirs.
   */
  it('ignores the code while the hold is still live', () => {
    expect(resolvePaymentPageState(input({ outcome: 'transferencia-sin-lugar' }))).toBe(
      'holdLiveUnpaid'
    );
  });

  it('still offers both methods under a forged code', () => {
    const state = resolvePaymentPageState(input({ outcome: 'transferencia-sin-lugar' }));

    expect(offersMercadoPago(state, methods())).toBe(true);
    expect(offersTransfer(state, methods())).toBe(true);
  });

  it('ignores it over a committed transfer whose hold is live', () => {
    expect(
      resolvePaymentPageState(
        input({
          paymentMethod: 'BANK_TRANSFER',
          paymentStatus: 'PENDING',
          outcome: 'transferencia-sin-lugar',
        })
      )
    ).toBe('transferAwaitingReceipt');
  });

  /** Where it is legitimate: the hold really is gone, and the code says why. */
  it('honours it once the hold has actually lapsed', () => {
    expect(
      resolvePaymentPageState(
        input({
          holdExpiresAt: new Date('2026-08-19T11:00:00.000Z'),
          outcome: 'transferencia-sin-lugar',
        })
      )
    ).toBe('transferSlotLost');
  });

  it('leaves a lapsed hold plain when no code says otherwise', () => {
    expect(
      resolvePaymentPageState(input({ holdExpiresAt: new Date('2026-08-19T11:00:00.000Z') }))
    ).toBe('holdLapsed');
  });
});
