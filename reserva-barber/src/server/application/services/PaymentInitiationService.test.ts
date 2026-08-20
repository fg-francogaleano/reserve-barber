import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { PaymentInitiationService } from './PaymentInitiationService';
import {
  CredentialDecryptionError,
  CredentialKeyMissingError,
} from '@/server/domain/errors/PaymentConfigErrors';

const NOW = new Date('2026-08-19T12:00:00.000Z');
const TOKEN = 'tok-1';
const ACCESS_TOKEN = 'APP_USR-secret-token-value';
// A routable host. `.example` is reserved by RFC 2606 and the origin guard
// refuses it, which is correct — so the fixture uses a name that could exist.
const ORIGIN = 'https://shop.example.com';

const INIT_POINT = 'https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=pref-1';

function booking(overrides: Record<string, unknown> = {}) {
  return {
    id: 'bkg-1',
    status: 'PENDING_PAYMENT',
    startTime: new Date('2026-08-19T14:00:00.000Z'),
    endTime: new Date('2026-08-19T14:30:00.000Z'),
    holdExpiresAt: new Date('2026-08-19T12:15:00.000Z'),
    depositAmount: '5000.50',
    serviceName: 'Corte de pelo',
    ownerId: 'owner-root',
    publicSlug: 'barberia-don-juan',
    ...overrides,
  };
}

function payment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pay-1',
    bookingId: 'bkg-1',
    status: 'PENDING',
    amount: '5000.50',
    mpPreferenceId: null,
    mpInitPoint: null,
    approvedAt: null,
    ...overrides,
  };
}

function build(overrides: Record<string, unknown> = {}) {
  const bookings = {
    findForPaymentInitiation: vi.fn().mockResolvedValue(booking()),
  };
  const payments = {
    findLiveByBookingId: vi.fn().mockResolvedValue(null),
    createPendingMercadoPago: vi
      .fn()
      .mockResolvedValue({ outcome: 'created', payment: payment() }),
    attachPreference: vi.fn().mockResolvedValue(undefined),
  };
  const config = {
    findMercadoPagoAccessToken: vi.fn().mockResolvedValue(ACCESS_TOKEN),
  };
  const gateway = {
    createPreference: vi.fn().mockResolvedValue({
      status: 'created',
      preferenceId: 'pref-1',
      initPoint: INIT_POINT,
    }),
  };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

  Object.assign({ bookings, payments, config, gateway }, overrides);

  const service = new PaymentInitiationService(
    bookings as never,
    payments as never,
    config as never,
    gateway as never,
    { now: () => NOW.getTime(), sleep: async () => {} },
    logger as never
  );

  return { service, bookings, payments, config, gateway, logger };
}

const REQUEST = { cancellationToken: TOKEN, origin: ORIGIN };

describe('the happy path', () => {
  it('redirects to the checkout Mercado Pago created', async () => {
    const { service } = build();

    expect(await service.initiate(REQUEST)).toEqual({
      outcome: 'redirect',
      initPoint: INIT_POINT,
      slug: 'barberia-don-juan',
    });
  });

  it('charges the amount snapshotted on the booking', async () => {
    const { service, gateway } = build();

    await service.initiate(REQUEST);

    expect(gateway.createPreference).toHaveBeenCalledWith(
      expect.objectContaining({ amount: '5000.50' }),
      ACCESS_TOKEN
    );
  });

  it('references the booking id and expires with the hold', async () => {
    const { service, gateway } = build();

    await service.initiate(REQUEST);

    expect(gateway.createPreference).toHaveBeenCalledWith(
      expect.objectContaining({
        externalReference: 'bkg-1',
        expiresAt: new Date('2026-08-19T12:15:00.000Z'),
      }),
      ACCESS_TOKEN
    );
  });

  it('addresses the notification to this payment row', async () => {
    const { service, gateway } = build();

    await service.initiate(REQUEST);

    const [input] = gateway.createPreference.mock.calls[0] as [{ notificationUrl: string }];
    expect(input.notificationUrl).toBe(`${ORIGIN}/api/webhooks/mercadopago?ref=pay-1`);
  });

  it('stores the checkout URL so a repeat submission can reuse it', async () => {
    const { service, payments } = build();

    await service.initiate(REQUEST);

    expect(payments.attachPreference).toHaveBeenCalledWith({
      paymentId: 'pay-1',
      preferenceId: 'pref-1',
      initPoint: INIT_POINT,
    });
  });

  /**
   * The token is the client's cancellation credential. `external_reference` is
   * stored by Mercado Pago, shown in their dashboard and echoed in every
   * notification — and the token is unique, so it cannot be rotated without
   * invalidating the link the client holds.
   */
  it('puts the cancellation token in no field of the preference', async () => {
    const { service, gateway } = build();

    await service.initiate(REQUEST);

    const [input] = gateway.createPreference.mock.calls as unknown[][];
    expect(JSON.stringify(input)).not.toContain(TOKEN);
  });

  /**
   * A landing route, not the confirmation page — because the confirmation page
   * is addressed by the cancellation token, and naming it here would store a
   * live credential in Mercado Pago's preference. The slug comes from the
   * booking's own shop, so a submitted slug cannot steer where a payment
   * returns to.
   */
  it('returns the client to a landing route that names no credential', async () => {
    const { service, gateway } = build();

    await service.initiate(REQUEST);

    const [input] = gateway.createPreference.mock.calls[0] as [{ backUrl: string }];
    expect(input.backUrl).toBe(`${ORIGIN}/b/barberia-don-juan/pago/retorno`);
  });
});

describe('what cannot be paid', () => {
  it('reports an unknown token as not found', async () => {
    const { service, bookings } = build();
    bookings.findForPaymentInitiation.mockResolvedValue(null);

    expect(await service.initiate(REQUEST)).toEqual({ outcome: 'notFound' });
  });

  it.each(['CONFIRMED', 'CANCELLED', 'EXPIRED', 'PENDING_APPROVAL'])(
    'refuses a booking in status %s',
    async (status) => {
      const { service, bookings } = build();
      bookings.findForPaymentInitiation.mockResolvedValue(booking({ status }));

      expect(await service.initiate(REQUEST)).toEqual({
        outcome: 'notPayable',
        slug: 'barberia-don-juan',
      });
    }
  );

  it('refuses a hold that has already lapsed', async () => {
    const { service, bookings } = build();
    bookings.findForPaymentInitiation.mockResolvedValue(
      booking({ holdExpiresAt: new Date('2026-08-19T11:59:00.000Z') })
    );

    expect(await service.initiate(REQUEST)).toEqual({
      outcome: 'holdExpired',
      slug: 'barberia-don-juan',
    });
  });

  // No credential, no charge — and no orphan payment row left behind either.
  it('reports a shop with no Mercado Pago credentials without creating a payment', async () => {
    const { service, config, payments } = build();
    config.findMercadoPagoAccessToken.mockResolvedValue(null);

    expect(await service.initiate(REQUEST)).toEqual({
      outcome: 'notConfigured',
      slug: 'barberia-don-juan',
    });
    expect(payments.createPendingMercadoPago).not.toHaveBeenCalled();
  });

  /**
   * The readiness gate asks the database whether a token is present, and a
   * present-but-undecryptable envelope answers yes. So the client reaches this
   * button and only here does the truth surface — as the shop's problem, never
   * as the client's failed payment.
   */
  it.each([
    ['undecryptable', new CredentialDecryptionError()],
    ['a missing key', new CredentialKeyMissingError('absent')],
  ])('reports %s credentials as unreadable', async (_label, error) => {
    const { service, config, payments } = build();
    config.findMercadoPagoAccessToken.mockRejectedValue(error);

    expect(await service.initiate(REQUEST)).toEqual({
      outcome: 'credentialUnreadable',
      slug: 'barberia-don-juan',
    });
    expect(payments.createPendingMercadoPago).not.toHaveBeenCalled();
  });

  it('never lets the access token reach a log line', async () => {
    const { service, config, logger } = build();
    config.findMercadoPagoAccessToken.mockRejectedValue(
      // The reason is the one field these errors carry, so it is the one that
      // could smuggle a credential into a log line.
      new CredentialKeyMissingError(`unusable near ${ACCESS_TOKEN}`)
    );

    await service.initiate(REQUEST);

    const logged = JSON.stringify([
      logger.info.mock.calls,
      logger.warn.mock.calls,
      logger.error.mock.calls,
    ]);
    expect(logged).not.toContain(ACCESS_TOKEN);
    expect(logged).not.toContain(TOKEN);
  });
});

describe('a repeat submission', () => {
  /**
   * B4 established that a double-tap is invisible to the person who made it.
   * The second tap must reach the same checkout, not a second charge and not an
   * error telling a client who succeeded that something went wrong.
   */
  it('reuses the existing checkout without calling Mercado Pago again', async () => {
    const { service, payments, gateway } = build();
    payments.findLiveByBookingId.mockResolvedValue(payment({ mpInitPoint: INIT_POINT }));

    expect(await service.initiate(REQUEST)).toEqual({
      outcome: 'redirect',
      initPoint: INIT_POINT,
      slug: 'barberia-don-juan',
    });
    expect(gateway.createPreference).not.toHaveBeenCalled();
    expect(payments.createPendingMercadoPago).not.toHaveBeenCalled();
  });

  it('reuses the payment the database awarded to the other tap', async () => {
    const { service, payments, gateway } = build();
    payments.createPendingMercadoPago.mockResolvedValue({
      outcome: 'alreadyLive',
      payment: payment({ id: 'pay-winner', mpInitPoint: INIT_POINT }),
    });

    expect(await service.initiate(REQUEST)).toEqual({
      outcome: 'redirect',
      initPoint: INIT_POINT,
      slug: 'barberia-don-juan',
    });
    expect(gateway.createPreference).not.toHaveBeenCalled();
  });

  /**
   * A gateway timeout leaves a live payment with no checkout URL. Treating that
   * as "a payment is already in progress" would leave a client unable to pay
   * for a slot they are still holding — the worst possible dead end.
   */
  it('retries a preference creation that never finished', async () => {
    const { service, payments, gateway } = build();
    payments.findLiveByBookingId.mockResolvedValue(payment({ mpInitPoint: null }));

    expect(await service.initiate(REQUEST)).toEqual({
      outcome: 'redirect',
      initPoint: INIT_POINT,
      slug: 'barberia-don-juan',
    });
    expect(gateway.createPreference).toHaveBeenCalledTimes(1);
    expect(payments.createPendingMercadoPago).not.toHaveBeenCalled();
  });
});

describe('when Mercado Pago refuses', () => {
  it.each([
    ['invalid', 'chargeRefused'],
    ['rejected', 'credentialRejected'],
    ['unavailable', 'gatewayUnavailable'],
  ])('maps a %s preference to %s', async (gatewayStatus, outcome) => {
    const { service, gateway } = build();
    gateway.createPreference.mockResolvedValue({ status: gatewayStatus, reason: null });

    expect(await service.initiate(REQUEST)).toEqual({
      outcome,
      slug: 'barberia-don-juan',
    });
  });

  it('leaves the payment row reusable so the client can try again', async () => {
    const { service, gateway, payments } = build();
    gateway.createPreference.mockResolvedValue({ status: 'unavailable' });

    await service.initiate(REQUEST);

    expect(payments.attachPreference).not.toHaveBeenCalled();
  });
});

describe('what this service is allowed to touch', () => {
  const source = readFileSync(
    new URL('./PaymentInitiationService.ts', import.meta.url),
    'utf8'
  );

  /**
   * The amount is a snapshot (`data-model.md` §11). Recomputing it would reject
   * a client paying a checkout created moments before the owner edited their
   * policy — the payment correct, the system calling it wrong. The natural
   * implementation of an amount is to compute one, which is why this is
   * asserted rather than assumed.
   */
  // Scoped to the import lines, not the whole file: the prose above explains
  // why the policy is absent, and a test that failed on its own explanation
  // would push the reasoning out of the code to satisfy itself.
  const imports = source
    .split('\n')
    .filter((line) => line.startsWith('import'))
    .join('\n');

  it('never imports the deposit policy', () => {
    expect(imports).not.toContain('depositPolicy');
    expect(imports).not.toContain('computeDepositAmount');
    expect(imports).not.toContain('DepositPolicy');
  });

  it('never calls the deposit computation', () => {
    expect(source).not.toContain('computeDepositAmount(');
    expect(source).not.toContain('describeDeposit(');
  });

  it('never imports Prisma or the cipher directly', () => {
    expect(imports).not.toContain('@/generated/prisma');
    expect(imports).not.toContain('WebCryptoCipher');
  });
});

describe('a refused request does not become a story about the amount', () => {
  /**
   * **Found by the preview, not by a test.** A $2.000 deposit — far above every
   * published Mercado Pago minimum — was refused with `invalid_auto_return`,
   * because Mercado Pago will not accept a `localhost` return URL. The code
   * called that outcome `amountRefused` and told the client their deposit had
   * been refused, which would have sent the owner to change a deposit policy
   * that was correct.
   *
   * The cause belongs in the log, where it can be acted on. The client gets the
   * shop-side message, because from where they stand it is the same situation
   * as any other configuration failure.
   */
  it('logs the gateway error code rather than implying the amount was wrong', async () => {
    const { service, gateway, logger } = build();
    gateway.createPreference.mockResolvedValue({
      status: 'invalid',
      reason: 'invalid_auto_return',
    });

    expect(await service.initiate(REQUEST)).toEqual({
      outcome: 'chargeRefused',
      slug: 'barberia-don-juan',
    });
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('refused the preference request'),
      expect.objectContaining({ gatewayError: 'invalid_auto_return', amount: '5000.50' })
    );
  });

  it('records an unspecified cause rather than omitting the field', async () => {
    // A missing code is itself information: it says Mercado Pago refused
    // without naming why, which is a different investigation.
    const { service, gateway, logger } = build();
    gateway.createPreference.mockResolvedValue({ status: 'invalid', reason: null });

    await service.initiate(REQUEST);

    expect(logger.error).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ gatewayError: 'unspecified' })
    );
  });
});

describe('a payment is never taken on an origin that cannot be called back', () => {
  /**
   * **The defect this closes was found by paying for it.** Mercado Pago
   * accepted a preference addressed to `https://localhost:8787`, a client paid,
   * the return died with `ERR_CONNECTION_CLOSED`, and the notification went
   * somewhere undeliverable — leaving a real approved charge against a booking
   * that stayed `PENDING_PAYMENT`.
   *
   * It was introduced by the fix immediately before it. Forcing the scheme to
   * `https` made the URL syntactically acceptable to Mercado Pago, which
   * removed the up-front refusal that had been the only warning.
   */
  it.each([
    'https://localhost:8787',
    'https://127.0.0.1:3000',
    'https://192.168.1.20',
    'https://barberia.local',
  ])('refuses %s before creating a payment', async (origin) => {
    const { service, payments, gateway } = build();

    expect(await service.initiate({ cancellationToken: TOKEN, origin })).toEqual({
      outcome: 'originNotReachable',
      slug: 'barberia-don-juan',
    });
    expect(payments.createPendingMercadoPago).not.toHaveBeenCalled();
    expect(gateway.createPreference).not.toHaveBeenCalled();
  });

  it('refuses before decrypting the credential', async () => {
    // Nothing is worth reaching for a secret over an origin we already know
    // cannot complete the flow.
    const { service, config } = build();

    await service.initiate({ cancellationToken: TOKEN, origin: 'https://localhost:8787' });

    expect(config.findMercadoPagoAccessToken).not.toHaveBeenCalled();
  });

  it('names the origin in the log so the deployment fault is diagnosable', async () => {
    const { service, logger } = build();

    await service.initiate({ cancellationToken: TOKEN, origin: 'https://localhost:8787' });

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('unreachable origin'),
      expect.objectContaining({ origin: 'https://localhost:8787' })
    );
  });

  it('allows a public origin through', async () => {
    const { service } = build();

    expect(
      await service.initiate({ cancellationToken: TOKEN, origin: 'https://shop.example.com' })
    ).toEqual({ outcome: 'redirect', initPoint: INIT_POINT, slug: 'barberia-don-juan' });
  });
});
