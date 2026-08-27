import { describe, it, expect, vi } from 'vitest';
import { PaymentConfirmationService } from './PaymentConfirmationService';
import { CredentialKeyMissingError } from '@/server/domain/errors/PaymentConfigErrors';

const NOW = new Date('2026-08-19T12:00:00.000Z');
const ACCESS_TOKEN = 'APP_USR-secret-token-value';

const REQUEST = { paymentRef: 'pay-1', gatewayPaymentId: '12345678' };

function record(overrides: Record<string, unknown> = {}) {
  return {
    paymentId: 'pay-1',
    paymentStatus: 'PENDING',
    amount: '5000.50',
    mpPaymentId: null,
    bookingId: 'bkg-1',
    bookingStatus: 'PENDING_PAYMENT',
    // Fifteen minutes ahead of NOW: the hold is live.
    holdExpiresAt: new Date('2026-08-19T12:15:00.000Z'),
    startTime: new Date('2026-08-19T14:00:00.000Z'),
    endTime: new Date('2026-08-19T14:30:00.000Z'),
    barberId: 'barber-1',
    ownerId: 'owner-root',
    ...overrides,
  };
}

function gatewayPayment(overrides: Record<string, unknown> = {}) {
  return {
    id: '12345678',
    status: 'approved',
    externalReference: 'bkg-1',
    transactionAmount: '5000.5',
    currencyId: 'ARS',
    ...overrides,
  };
}

function build() {
  const payments = {
    findForNotification: vi.fn().mockResolvedValue(record()),
    confirmWithPayment: vi.fn().mockResolvedValue({ outcome: 'confirmed' }),
    confirmIfSlotFree: vi.fn().mockResolvedValue({ outcome: 'confirmed' }),
  };
  const config = { findMercadoPagoAccessToken: vi.fn().mockResolvedValue(ACCESS_TOKEN) };
  const gateway = {
    getPayment: vi.fn().mockResolvedValue({ status: 'found', payment: gatewayPayment() }),
  };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const notifications = { notifyConfirmed: vi.fn().mockResolvedValue(undefined) };

  const service = new PaymentConfirmationService(
    payments as never,
    config as never,
    gateway as never,
    { now: () => NOW.getTime(), sleep: async () => {} },
    logger as never,
    notifications as never
  );

  return { service, payments, config, gateway, logger, notifications };
}

describe('the cheap rejection comes first', () => {
  /**
   * The endpoint is unauthenticated and anyone can post to it. With no
   * signature validated (T60), this ordering is what keeps a forged
   * notification from costing an outbound call to Mercado Pago.
   */
  it('spends no gateway call when the ref resolves nothing', async () => {
    const { service, payments, gateway } = build();
    payments.findForNotification.mockResolvedValue(null);

    expect(await service.confirm(REQUEST)).toEqual({ outcome: 'unresolved' });
    expect(gateway.getPayment).not.toHaveBeenCalled();
  });

  it('asks Mercado Pago with the owner own token', async () => {
    const { service, gateway, config } = build();

    await service.confirm(REQUEST);

    expect(config.findMercadoPagoAccessToken).toHaveBeenCalledWith('owner-root');
    expect(gateway.getPayment).toHaveBeenCalledWith('12345678', ACCESS_TOKEN);
  });
});

describe('the gateway is the authority', () => {
  /**
   * Terminal, not transient. This is the shape a forged notification takes, and
   * retrying it would ask Mercado Pago to redeliver something that can never
   * resolve.
   */
  it('confirms nothing when Mercado Pago does not have the payment', async () => {
    const { service, gateway, payments } = build();
    gateway.getPayment.mockResolvedValue({ status: 'notFound' });

    expect(await service.confirm(REQUEST)).toEqual({ outcome: 'notAtGateway' });
    expect(payments.confirmWithPayment).not.toHaveBeenCalled();
  });

  it('asks for a retry only when the gateway is unavailable', async () => {
    const { service, gateway } = build();
    gateway.getPayment.mockResolvedValue({ status: 'unavailable' });

    expect(await service.confirm(REQUEST)).toEqual({ outcome: 'retry' });
  });

  it('confirms nothing when the stored credential cannot be read', async () => {
    const { service, config, gateway } = build();
    config.findMercadoPagoAccessToken.mockRejectedValue(new CredentialKeyMissingError('gone'));

    expect(await service.confirm(REQUEST)).toEqual({ outcome: 'unresolved' });
    expect(gateway.getPayment).not.toHaveBeenCalled();
  });
});

describe('three properties are verified before anything moves', () => {
  /**
   * Without this, any small payment on the owner's account — or a replayed
   * notification for an unrelated one — confirms a booking it never paid for.
   * The re-fetch proves the payment is real; only this proves it paid us.
   */
  it('refuses an amount that does not match the snapshot', async () => {
    const { service, gateway, payments } = build();
    gateway.getPayment.mockResolvedValue({
      status: 'found',
      payment: gatewayPayment({ transactionAmount: '1.00' }),
    });

    expect(await service.confirm(REQUEST)).toEqual({ outcome: 'mismatch' });
    expect(payments.confirmWithPayment).not.toHaveBeenCalled();
  });

  it('refuses a reference belonging to another booking', async () => {
    const { service, gateway } = build();
    gateway.getPayment.mockResolvedValue({
      status: 'found',
      payment: gatewayPayment({ externalReference: 'bkg-other' }),
    });

    expect(await service.confirm(REQUEST)).toEqual({ outcome: 'mismatch' });
  });

  it('refuses a currency other than ARS', async () => {
    const { service, gateway } = build();
    gateway.getPayment.mockResolvedValue({
      status: 'found',
      payment: gatewayPayment({ currencyId: 'USD' }),
    });

    expect(await service.confirm(REQUEST)).toEqual({ outcome: 'mismatch' });
  });

  // The measured case: a stored 5000.50 arrives from the gateway as 5000.5.
  it('accepts the gateway trailing-zero form of the same amount', async () => {
    const { service } = build();

    expect(await service.confirm(REQUEST)).toEqual({ outcome: 'confirmed' });
  });
});

describe('the hold decides which transaction runs', () => {
  /**
   * The asymmetry is the design. A booking inside its hold still blocks
   * availability, so nobody could have been offered its slot — nothing to race,
   * no lock.
   */
  it('confirms without the lock while the hold is live', async () => {
    const { service, payments } = build();

    expect(await service.confirm(REQUEST)).toEqual({ outcome: 'confirmed' });
    expect(payments.confirmWithPayment).toHaveBeenCalledTimes(1);
    expect(payments.confirmIfSlotFree).not.toHaveBeenCalled();
  });

  it('re-checks under the lock once the hold has lapsed', async () => {
    const { service, payments } = build();
    payments.findForNotification.mockResolvedValue(
      record({ holdExpiresAt: new Date('2026-08-19T11:00:00.000Z') })
    );

    expect(await service.confirm(REQUEST)).toEqual({ outcome: 'confirmed' });
    expect(payments.confirmIfSlotFree).toHaveBeenCalledWith(
      expect.objectContaining({ barberId: 'barber-1', bookingId: 'bkg-1' })
    );
    expect(payments.confirmWithPayment).not.toHaveBeenCalled();
  });

  it('reports the slot-lost ending rather than confirming', async () => {
    const { service, payments } = build();
    payments.findForNotification.mockResolvedValue(
      record({ holdExpiresAt: new Date('2026-08-19T11:00:00.000Z') })
    );
    payments.confirmIfSlotFree.mockResolvedValue({ outcome: 'slotLost' });

    expect(await service.confirm(REQUEST)).toEqual({ outcome: 'slotLost' });
  });

  it('logs a slot-lost payment at error, because a human owes a refund', async () => {
    const { service, payments, logger } = build();
    payments.findForNotification.mockResolvedValue(
      record({ holdExpiresAt: new Date('2026-08-19T11:00:00.000Z') })
    );
    payments.confirmIfSlotFree.mockResolvedValue({ outcome: 'slotLost' });

    await service.confirm(REQUEST);

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('slot was taken'),
      expect.objectContaining({ bookingId: 'bkg-1', paymentId: 'pay-1' })
    );
  });
});

describe('duplicate and out-of-order deliveries', () => {
  it('reports a duplicate gateway id as already processed', async () => {
    const { service, payments } = build();
    payments.confirmWithPayment.mockResolvedValue({ outcome: 'alreadyProcessed' });

    expect(await service.confirm(REQUEST)).toEqual({ outcome: 'alreadyProcessed' });
  });

  it('reports a duplicate delivery over a CONFIRMED booking as already processed', async () => {
    const { service, payments } = build();
    payments.confirmWithPayment.mockResolvedValue({
      outcome: 'notPending',
      bookingStatus: 'CONFIRMED',
    });

    expect(await service.confirm(REQUEST)).toEqual({ outcome: 'alreadyProcessed' });
  });

  it('does not confirm on a notification that is not approved', async () => {
    const { service, gateway, payments } = build();
    gateway.getPayment.mockResolvedValue({
      status: 'found',
      payment: gatewayPayment({ status: 'pending' }),
    });

    expect(await service.confirm(REQUEST)).toEqual({ outcome: 'notApproved' });
    expect(payments.confirmWithPayment).not.toHaveBeenCalled();
  });

  /**
   * The out-of-order case that would un-confirm a paid booking if the handler
   * assigned the last-seen status instead of guarding on the current one.
   */
  it('leaves a confirmed booking alone when a pending arrives late', async () => {
    const { service, gateway, payments } = build();
    payments.findForNotification.mockResolvedValue(record({ bookingStatus: 'CONFIRMED' }));
    gateway.getPayment.mockResolvedValue({
      status: 'found',
      payment: gatewayPayment({ status: 'pending' }),
    });

    expect(await service.confirm(REQUEST)).toEqual({ outcome: 'notApproved' });
    expect(payments.confirmWithPayment).not.toHaveBeenCalled();
  });
});

describe('money that comes back after confirmation', () => {
  /**
   * Cancelling a confirmed appointment because a dispute was *filed* — one the
   * owner may well win — would silently empty their agenda and leave the client
   * arriving to nothing. A human owns that decision; this makes sure they can
   * learn of it.
   */
  it.each(['refunded', 'charged_back', 'cancelled'])(
    'changes nothing when a %s payment is reported on a confirmed booking',
    async (status) => {
      const { service, gateway, payments } = build();
      payments.findForNotification.mockResolvedValue(record({ bookingStatus: 'CONFIRMED' }));
      gateway.getPayment.mockResolvedValue({
        status: 'found',
        payment: gatewayPayment({ status }),
      });

      expect(await service.confirm(REQUEST)).toEqual({
        outcome: 'reversedAfterConfirmation',
      });
      expect(payments.confirmWithPayment).not.toHaveBeenCalled();
      expect(payments.confirmIfSlotFree).not.toHaveBeenCalled();
    }
  );

  it('logs the reversal with all three identifiers', async () => {
    const { service, gateway, payments, logger } = build();
    payments.findForNotification.mockResolvedValue(record({ bookingStatus: 'CONFIRMED' }));
    gateway.getPayment.mockResolvedValue({
      status: 'found',
      payment: gatewayPayment({ status: 'charged_back' }),
    });

    await service.confirm(REQUEST);

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('reversed'),
      expect.objectContaining({
        bookingId: 'bkg-1',
        paymentId: 'pay-1',
        gatewayPaymentId: '12345678',
        gatewayStatus: 'charged_back',
      })
    );
  });

  // A reversal is only inert *after* confirmation. Before it, the payment is
  // simply not approved and takes the ordinary path.
  it('treats a reversal on an unconfirmed booking as not approved', async () => {
    const { service, gateway } = build();
    gateway.getPayment.mockResolvedValue({
      status: 'found',
      payment: gatewayPayment({ status: 'refunded' }),
    });

    expect(await service.confirm(REQUEST)).toEqual({ outcome: 'notApproved' });
  });
});

describe('what the logs may carry', () => {
  it('never logs the access token', async () => {
    const { service, gateway, logger } = build();
    gateway.getPayment.mockResolvedValue({ status: 'rejected' });

    await service.confirm(REQUEST);

    const logged = JSON.stringify([
      logger.info.mock.calls,
      logger.warn.mock.calls,
      logger.error.mock.calls,
    ]);
    expect(logged).not.toContain(ACCESS_TOKEN);
  });

  /**
   * The projection this service reads carries no client name, email or phone,
   * so there is nothing for a log line to leak — but the assertion is here
   * because a future field would otherwise arrive silently.
   */
  it('logs identifiers and amounts, never a person', async () => {
    const { service, gateway, logger } = build();
    gateway.getPayment.mockResolvedValue({
      status: 'found',
      payment: gatewayPayment({ transactionAmount: '1.00' }),
    });

    await service.confirm(REQUEST);

    const logged = JSON.stringify(logger.error.mock.calls);
    expect(logged).toContain('bkg-1');
    expect(logged).toContain('amount_mismatch');
    expect(logged).not.toMatch(/email|phone|clientName|cancellationToken/i);
  });

  it('distinguishes each refusal by its own cause', async () => {
    const { service, gateway, logger } = build();
    gateway.getPayment.mockResolvedValue({
      status: 'found',
      payment: gatewayPayment({ currencyId: 'USD' }),
    });

    await service.confirm(REQUEST);

    expect(logger.error).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ reason: 'currency_mismatch' })
    );
  });
});

describe('a payment approved for a booking that no longer exists', () => {
  /**
   * **Found in review, not by a test, and it had been found once before.**
   *
   * The edge-case hunt that preceded this change wrote: *"A booking already
   * CANCELLED receives an approved payment. No rule today."* It never became a
   * rule, and the implementation collapsed it into the duplicate-delivery
   * branch — a single `info` line reading "Notification already handled" over a
   * real charge for an appointment that does not exist.
   *
   * It is materially the slot-lost case. Nobody took the slot; the booking
   * itself went away. Both owe a refund and both need a human, so both are
   * logged at `error`.
   *
   * **Unreachable today** — nothing writes `CANCELLED` until C1/C2 and nothing
   * writes `EXPIRED` until B7 — which is precisely why it is decided now rather
   * than discovered by whichever of those ships first.
   */
  it.each(['CANCELLED', 'EXPIRED', 'MISSING'])(
    'reports an approved payment over a %s booking as bookingUnavailable',
    async (bookingStatus) => {
      const { service, payments } = build();
      payments.confirmWithPayment.mockResolvedValue({ outcome: 'notPending', bookingStatus });

      expect(await service.confirm(REQUEST)).toEqual({ outcome: 'bookingUnavailable' });
    }
  );

  it('logs it at error, like the slot-lost branch, because a human owes a refund', async () => {
    const { service, payments, logger } = build();
    payments.confirmWithPayment.mockResolvedValue({
      outcome: 'notPending',
      bookingStatus: 'CANCELLED',
    });

    await service.confirm(REQUEST);

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('no longer exists'),
      expect.objectContaining({
        bookingId: 'bkg-1',
        paymentId: 'pay-1',
        bookingStatus: 'CANCELLED',
        amount: '5000.50',
      })
    );
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('does not report it as routine idempotency', async () => {
    // The defect this closes, stated directly: one "already handled" line for
    // two situations that are nothing alike.
    const { service, payments, logger } = build();
    payments.confirmWithPayment.mockResolvedValue({
      outcome: 'notPending',
      bookingStatus: 'EXPIRED',
    });

    await service.confirm(REQUEST);

    expect(logger.info).not.toHaveBeenCalledWith(
      expect.stringContaining('already handled'),
      expect.anything()
    );
  });
});

/**
 * The security property of N1, tested branch by branch rather than by a
 * representative case.
 *
 * `POST /api/webhooks/mercadopago` is public and redelivery is normal
 * operation for this gateway. A send keyed on the booking *being* `CONFIRMED`
 * — rather than on this call being the one that confirmed it — would let
 * anyone who has seen a `ref` send unlimited mail to one real person and burn
 * the provider quota doing it. Every outcome below therefore gets its own
 * assertion; a single "the happy path notifies" test would not catch a
 * regression that also notified on redelivery.
 */
describe('PaymentConfirmationService - the confirmation email trigger', () => {
  it('notifies when the guarded write actually confirmed the booking', async () => {
    const { service, notifications } = build();

    const result = await service.confirm(REQUEST);

    expect(result.outcome).toBe('confirmed');
    expect(notifications.notifyConfirmed).toHaveBeenCalledExactlyOnceWith('bkg-1');
  });

  it('notifies on a late confirmation whose slot survived', async () => {
    const { service, payments, notifications } = build();
    // Hold lapsed, so the slot-free path runs instead.
    payments.findForNotification.mockResolvedValue(
      record({ holdExpiresAt: new Date('2026-08-19T11:45:00.000Z') })
    );
    payments.confirmIfSlotFree.mockResolvedValue({ outcome: 'confirmed' });

    await service.confirm(REQUEST);

    expect(notifications.notifyConfirmed).toHaveBeenCalledExactlyOnceWith('bkg-1');
  });

  it('does not notify on a redelivered notification', async () => {
    const { service, payments, notifications } = build();
    payments.confirmWithPayment.mockResolvedValue({ outcome: 'alreadyProcessed' });

    const result = await service.confirm(REQUEST);

    expect(result.outcome).toBe('alreadyProcessed');
    expect(notifications.notifyConfirmed).not.toHaveBeenCalled();
  });

  it('does not notify when the booking was already CONFIRMED by the other path', async () => {
    const { service, payments, notifications } = build();
    payments.confirmWithPayment.mockResolvedValue({
      outcome: 'notPending',
      bookingStatus: 'CONFIRMED',
    });

    await service.confirm(REQUEST);

    expect(notifications.notifyConfirmed).not.toHaveBeenCalled();
  });

  it('does not notify when the booking no longer exists', async () => {
    const { service, payments, notifications } = build();
    payments.confirmWithPayment.mockResolvedValue({
      outcome: 'notPending',
      bookingStatus: 'EXPIRED',
    });

    await service.confirm(REQUEST);

    expect(notifications.notifyConfirmed).not.toHaveBeenCalled();
  });

  it('does not notify when the slot was lost', async () => {
    const { service, payments, notifications } = build();
    payments.findForNotification.mockResolvedValue(
      record({ holdExpiresAt: new Date('2026-08-19T11:45:00.000Z') })
    );
    payments.confirmIfSlotFree.mockResolvedValue({ outcome: 'slotLost' });

    await service.confirm(REQUEST);

    expect(notifications.notifyConfirmed).not.toHaveBeenCalled();
  });

  it('does not notify when the reference resolves nothing', async () => {
    const { service, payments, notifications } = build();
    payments.findForNotification.mockResolvedValue(null);

    await service.confirm(REQUEST);

    expect(notifications.notifyConfirmed).not.toHaveBeenCalled();
  });

  it('does not notify when Mercado Pago does not have the payment', async () => {
    const { service, gateway, notifications } = build();
    gateway.getPayment.mockResolvedValue({ status: 'notFound' });

    await service.confirm(REQUEST);

    expect(notifications.notifyConfirmed).not.toHaveBeenCalled();
  });

  it('does not notify when verification fails on the amount', async () => {
    const { service, gateway, notifications } = build();
    gateway.getPayment.mockResolvedValue({
      status: 'found',
      payment: gatewayPayment({ transactionAmount: '1.00' }),
    });

    await service.confirm(REQUEST);

    expect(notifications.notifyConfirmed).not.toHaveBeenCalled();
  });

  it('does not notify when the payment is not approved', async () => {
    const { service, gateway, notifications } = build();
    gateway.getPayment.mockResolvedValue({
      status: 'found',
      payment: gatewayPayment({ status: 'in_process' }),
    });

    await service.confirm(REQUEST);

    expect(notifications.notifyConfirmed).not.toHaveBeenCalled();
  });

  it('does not notify on a reversal reported after confirmation', async () => {
    const { service, payments, gateway, notifications } = build();
    payments.findForNotification.mockResolvedValue(record({ bookingStatus: 'CONFIRMED' }));
    gateway.getPayment.mockResolvedValue({
      status: 'found',
      payment: gatewayPayment({ status: 'refunded' }),
    });

    await service.confirm(REQUEST);

    expect(notifications.notifyConfirmed).not.toHaveBeenCalled();
  });

  it('does not notify when the gateway is unavailable and a retry is asked for', async () => {
    const { service, gateway, notifications } = build();
    gateway.getPayment.mockResolvedValue({ status: 'unavailable' });

    const result = await service.confirm(REQUEST);

    expect(result.outcome).toBe('retry');
    expect(notifications.notifyConfirmed).not.toHaveBeenCalled();
  });

  it('reports confirmed even when the notification service fails', async () => {
    // A mail provider must not be able to fail a payment confirmation. The
    // service is specified never to throw; this proves the caller survives if
    // that contract is ever broken.
    const { service, notifications } = build();
    notifications.notifyConfirmed.mockRejectedValue(new Error('provider down'));

    const result = await service.confirm(REQUEST);

    expect(result.outcome).toBe('confirmed');
  });
});
