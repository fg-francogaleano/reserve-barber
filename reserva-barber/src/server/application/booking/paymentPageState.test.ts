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
    cancelledBy: null,
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

  it('reports an EXPIRED booking as lapsed rather than payable', () => {
    expect(resolvePaymentPageState(input({ bookingStatus: 'EXPIRED' }))).toBe('holdLapsed');
  });

  /**
   * **This case was asserted alongside `EXPIRED` and it was asserting the bug.**
   *
   * The two statuses were parameterised together as though they meant the same
   * thing to a client, which is the opposite of why the product has both:
   * `EXPIRED` is a deadline and `CANCELLED` is a decision. Telling somebody the
   * shop cancelled on them that their reservation "venció" is not a wording
   * quibble — it blames them for running out of time.
   *
   * Split rather than deleted, so the reversal is visible to whoever reads this
   * file next. See the cancelled-booking block below for the states that
   * replace it.
   */
  it('no longer reports a CANCELLED booking as lapsed', () => {
    expect(resolvePaymentPageState(input({ bookingStatus: 'CANCELLED' }))).not.toBe('holdLapsed');
  });
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

  /**
   * **This test has certified an unreachable branch since B6, and C2's runtime
   * check is what found it.**
   *
   * It constructs `CANCELLED` + receipt `REJECTED`, which is what the database
   * holds after a rejection — but **not what the projection returns**. That
   * read takes only the booking's live payment (`status not REJECTED`), and a
   * rejection sets the payment to `REJECTED` too, so `receiptStatus` reaches
   * this function as `null` and `receiptRejected` never fires.
   *
   * The consequence was invisible and real: every rejected comprobante fell
   * through to `holdLapsed` and told its client the reservation *expired*. C2
   * gives it the generic cancelled message instead, which is true; the
   * specific one stays unreachable and is tracked as debt.
   *
   * Kept, inverted and documented rather than deleted, so the next reader finds
   * the discovery instead of a gap where a test used to be.
   */
  it('cannot reach the rejected-receipt state from what the projection returns', () => {
    // The shape the page actually receives after a rejection.
    expect(
      resolvePaymentPageState(
        input({ bookingStatus: 'CANCELLED', receiptStatus: null, cancelledBy: 'OWNER' })
      )
    ).not.toBe('receiptRejected');
  });

  it('still resolves the rejected state if a receipt status ever reaches it', () => {
    // The branch is not deleted: it becomes correct the moment the projection
    // is widened to carry a rejected payment's receipt.
    expect(
      resolvePaymentPageState(input({ bookingStatus: 'PENDING_APPROVAL', receiptStatus: 'REJECTED' }))
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

/**
 * C2: a cancelled booking stops claiming it expired.
 *
 * `CANCELLED` was written from B6 onward and this table had **no branch for
 * it** — the word appeared nowhere in the module. A cancelled booking fell
 * through every branch to `holdLapsed` and told its client "La reserva venció".
 * That stayed invisible because the only writer of `CANCELLED` also set the
 * receipt to `REJECTED`, and that branch fires first; the fall-through became
 * reachable the moment a second canceller existed.
 */
describe('a cancelled booking', () => {
  const cancelled = (overrides: Partial<PaymentPageInput> = {}) =>
    input({ bookingStatus: 'CANCELLED', holdExpiresAt: null, cancelledBy: 'OWNER', ...overrides });

  it('names the shop rather than reporting an expiry', () => {
    expect(resolvePaymentPageState(cancelled())).toBe('cancelledByShop');
  });

  it('does not fall through to the lapsed hold, whatever the clock says', () => {
    // The fall-through this closes: a cancelled booking whose appointment and
    // hold are both long past.
    expect(
      resolvePaymentPageState(
        cancelled({
          startTime: new Date('2026-08-18T10:00:00.000Z'),
          endTime: new Date('2026-08-18T10:30:00.000Z'),
          holdExpiresAt: new Date('2026-08-18T09:00:00.000Z'),
        })
      )
    ).toBe('cancelledByShop');
  });

  /**
   * **What a real receipt rejection renders — measured, not assumed.**
   *
   * C2's runtime check found that `receiptRejected` is **unreachable from the
   * real projection**, and has been since B6. The projection reads only the
   * booking's *live* payment (`where: { status: { not: 'REJECTED' } }`), and a
   * rejection sets that payment to `REJECTED` — so `receiptStatus` arrives
   * `null` and the rejection branch cannot fire.
   *
   * Before C2 that meant a rejected comprobante fell all the way to
   * `holdLapsed` and told its client **"La reserva venció"** — the same lie
   * this story exists to fix, arriving from a path nobody had looked at. C2
   * does not make the specific message reachable; it makes the generic one
   * true. Tracked as debt.
   *
   * **This is asserted with a `null` receipt on purpose**, because that is what
   * the projection actually produces. The pair of tests that constructed
   * `receiptStatus: 'REJECTED'` here certified a shape no code path emits.
   */
  it('renders the cancellation for a booking whose receipt was rejected', () => {
    // What a real rejection looks like coming out of the projection: the
    // payment is filtered out, so no receipt status survives to reach the page.
    expect(resolvePaymentPageState(cancelled({ receiptStatus: null }))).toBe('cancelledByShop');
  });

  it('renders the cancellation when the receipt was never answered', () => {
    // What C2 produces on a booking awaiting review. The receipt stays PENDING
    // in the database, but its payment is rejected by the cancellation, so the
    // page sees null here too — the two cases converge on one message.
    expect(resolvePaymentPageState(cancelled({ receiptStatus: null }))).toBe('cancelledByShop');
  });

  it('outranks a paid-but-slot-lost reading', () => {
    // "We received your payment but the time was gone" is wrong for a booking
    // the shop itself cancelled.
    expect(resolvePaymentPageState(cancelled({ paymentStatus: 'APPROVED' }))).toBe(
      'cancelledByShop'
    );
  });

  it('is not produced by any outcome code on a live booking', () => {
    // A URL can never invent a cancellation, the same rule every other state
    // on this page follows.
    expect(resolvePaymentPageState(input({ outcome: 'pago-rechazado' }))).not.toBe(
      'cancelledByShop'
    );
  });

  it('blames nobody when no canceller was recorded', () => {
    // Every row cancelled before C2 has a null canceller. Attributing the
    // decision to the shop would be inventing a fact.
    expect(resolvePaymentPageState(cancelled({ cancelledBy: null }))).toBe('cancelled');
  });

  it('does not attribute a client cancellation to the shop', () => {
    // C1 writes this, and it now has a state of its own — asserted below.
    expect(resolvePaymentPageState(cancelled({ cancelledBy: 'CLIENT' }))).not.toBe(
      'cancelledByShop'
    );
  });

  it('still loses to a confirmed booking', () => {
    // Nothing outranks the database saying the appointment is real.
    expect(
      resolvePaymentPageState(cancelled({ bookingStatus: 'CONFIRMED', cancelledBy: 'OWNER' }))
    ).toBe('confirmed');
  });

  it('offers no payment control', () => {
    const state = resolvePaymentPageState(cancelled());
    expect(offersMercadoPago(state, methods())).toBe(false);
    expect(offersTransfer(state, methods())).toBe(false);
  });
});

/**
 * C1: the client cancelled it themselves.
 *
 * The third member of the cancelled set, and the reason `cancelledBy` was put
 * on this input in the first place: `CANCELLED` alone cannot say whether the
 * shop ended the appointment or its client did, and those are opposite
 * messages — one is an apology, the other a receipt.
 */
describe('a booking the client cancelled', () => {
  const byClient = (overrides: Partial<PaymentPageInput> = {}) =>
    input({ bookingStatus: 'CANCELLED', holdExpiresAt: null, cancelledBy: 'CLIENT', ...overrides });

  it('renders the client’s own state rather than the shop’s', () => {
    expect(resolvePaymentPageState(byClient())).toBe('cancelledByClient');
  });

  it('never reports the shop as the canceller', () => {
    // The failure this replaces: telling a client the shop cancelled a booking
    // they cancelled themselves.
    expect(resolvePaymentPageState(byClient())).not.toBe('cancelledByShop');
  });

  it('does not fall through to the lapsed hold, whatever the clock says', () => {
    expect(
      resolvePaymentPageState(
        byClient({
          startTime: new Date('2026-08-18T10:00:00.000Z'),
          endTime: new Date('2026-08-18T10:30:00.000Z'),
          holdExpiresAt: new Date('2026-08-18T09:00:00.000Z'),
        })
      )
    ).toBe('cancelledByClient');
  });

  it('outranks a paid-but-slot-lost reading', () => {
    // A client who cancelled a booking whose deposit was approved is owed the
    // money sentence, not a story about losing a race.
    expect(resolvePaymentPageState(byClient({ paymentStatus: 'APPROVED' }))).toBe(
      'cancelledByClient'
    );
  });

  it('still loses to a confirmed booking', () => {
    expect(
      resolvePaymentPageState(byClient({ bookingStatus: 'CONFIRMED', cancelledBy: 'CLIENT' }))
    ).toBe('confirmed');
  });

  it('is not produced by any outcome code on a live booking', () => {
    expect(resolvePaymentPageState(input({ outcome: 'pago-rechazado' }))).not.toBe(
      'cancelledByClient'
    );
  });

  it('leaves the other two attributions alone', () => {
    // The three are chosen by the canceller and by nothing else.
    expect(resolvePaymentPageState(byClient({ cancelledBy: 'OWNER' }))).toBe('cancelledByShop');
    expect(resolvePaymentPageState(byClient({ cancelledBy: null }))).toBe('cancelled');
  });

  it('offers no payment control', () => {
    const state = resolvePaymentPageState(byClient());
    expect(offersMercadoPago(state, methods())).toBe(false);
    expect(offersTransfer(state, methods())).toBe(false);
  });
});
