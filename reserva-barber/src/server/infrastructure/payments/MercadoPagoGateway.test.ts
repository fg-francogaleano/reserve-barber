import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { MercadoPagoGateway, PREFERENCES_URL, paymentUrl } from './MercadoPagoGateway';
import type { PreferenceInput } from '@/server/domain/repositories/IPaymentGateway';

const TOKEN = 'APP_USR-4934588586838432-081312-abcdef0123456789abcdef0123456789-241983636';

const INPUT: PreferenceInput = {
  title: 'Corte de pelo',
  amount: '5000.50',
  externalReference: 'bkg-1',
  notificationUrl: 'https://shop.example/api/webhooks/mercadopago?ref=pay-1',
  backUrl: 'https://shop.example/b/barberia/reserva/tok-1',
  expiresAt: new Date('2026-08-19T12:15:00.000Z'),
};

function response(status: number, body: unknown = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function gateway(handler: (url: string, init?: RequestInit) => Promise<Response>) {
  // The mock is kept in its own binding: casting it to `typeof fetch` for the
  // constructor erases `.mock`, and the assertions below are about how the call
  // was made, not only about what it returned.
  const transport = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    handler(String(input), init)
  );
  return {
    gateway: new MercadoPagoGateway(transport as unknown as typeof fetch),
    transport,
  };
}

const CREATED = {
  id: 'pref-1',
  init_point: 'https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=pref-1',
};

const PAID = {
  id: 12345678,
  status: 'approved',
  external_reference: 'bkg-1',
  transaction_amount: 5000.5,
  currency_id: 'ARS',
};

describe('createPreference', () => {
  it('returns the preference id and its checkout URL', async () => {
    const { gateway: gw } = gateway(async () => response(201, CREATED));

    const result = await gw.createPreference(INPUT, TOKEN);

    expect(result).toEqual({
      status: 'created',
      preferenceId: 'pref-1',
      initPoint: CREATED.init_point,
    });
  });

  it('posts to the documented preferences endpoint', async () => {
    const { gateway: gw, transport } = gateway(async () => response(201, CREATED));

    await gw.createPreference(INPUT, TOKEN);

    expect(transport).toHaveBeenCalledWith(PREFERENCES_URL, expect.anything());
  });

  /**
   * In a header, never a query parameter. A token in a URL lands in access
   * logs, proxy caches and browser history — the rule
   * `MercadoPagoCredentialVerifier` already set for this API.
   */
  it('sends the token in a header and never in the URL', async () => {
    const { gateway: gw, transport } = gateway(async () => response(201, CREATED));

    await gw.createPreference(INPUT, TOKEN);

    const [url, init] = transport.mock.calls[0] as [string, RequestInit];
    expect(url).not.toContain(TOKEN);
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('bounds the call with an abort signal', async () => {
    const { gateway: gw, transport } = gateway(async () => response(201, CREATED));

    await gw.createPreference(INPUT, TOKEN);

    const [, init] = transport.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('builds the payload from the input alone', async () => {
    const { gateway: gw, transport } = gateway(async () => response(201, CREATED));

    await gw.createPreference(INPUT, TOKEN);

    const [, init] = transport.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body));

    expect(body.items).toEqual([
      { title: 'Corte de pelo', quantity: 1, unit_price: 5000.5, currency_id: 'ARS' },
    ]);
    expect(body.external_reference).toBe('bkg-1');
    expect(body.notification_url).toBe(INPUT.notificationUrl);
    expect(body.date_of_expiration).toBe('2026-08-19T12:15:00.000Z');
  });

  /**
   * The two mean opposite things about the owner's configuration. `invalid` is
   * Mercado Pago refusing this *request*; `rejected` is Mercado Pago refusing
   * this *credential*. Collapsing them tells an owner their token is broken
   * when the problem is the request they sent.
   *
   * What `invalid` is **not** is a statement about the amount. The preview
   * proved that: a valid deposit refused with `invalid_auto_return`. The cause
   * travels in `reason`, and the block below asserts what may and may not be
   * lifted out of the body to carry it.
   */
  it('reports a 400 as invalid, not as a rejected credential', async () => {
    const { gateway: gw } = gateway(async () => response(400, { message: 'invalid unit_price' }));

    expect(await gw.createPreference(INPUT, TOKEN)).toEqual({
      status: 'invalid',
      reason: null,
    });
  });

  it.each([401, 403])('reports %i as a rejected credential', async (status) => {
    const { gateway: gw } = gateway(async () => response(status));

    expect(await gw.createPreference(INPUT, TOKEN)).toEqual({ status: 'rejected' });
  });

  it('reports a 500 as unavailable', async () => {
    const { gateway: gw } = gateway(async () => response(500));

    expect(await gw.createPreference(INPUT, TOKEN)).toEqual({ status: 'unavailable' });
  });

  it('reports a transport failure as unavailable rather than throwing', async () => {
    const { gateway: gw } = gateway(async () => {
      throw new Error(`timeout calling with Bearer ${TOKEN}`);
    });

    expect(await gw.createPreference(INPUT, TOKEN)).toEqual({ status: 'unavailable' });
  });

  it('reports an unparseable body as unavailable', async () => {
    const { gateway: gw } = gateway(
      async () => new Response('<html>gateway timeout</html>', { status: 200 })
    );

    expect(await gw.createPreference(INPUT, TOKEN)).toEqual({ status: 'unavailable' });
  });

  /**
   * A 201 without a checkout URL is not a created preference. Returning
   * `created` with an empty `initPoint` would redirect the client to nowhere,
   * which is a worse failure than saying the gateway is unavailable.
   */
  it('reports a success body missing the checkout URL as unavailable', async () => {
    const { gateway: gw } = gateway(async () => response(201, { id: 'pref-1' }));

    expect(await gw.createPreference(INPUT, TOKEN)).toEqual({ status: 'unavailable' });
  });
});

describe('getPayment', () => {
  it('returns the four fields a decision depends on', async () => {
    const { gateway: gw } = gateway(async () => response(200, PAID));

    const result = await gw.getPayment('12345678', TOKEN);

    expect(result).toEqual({
      status: 'found',
      payment: {
        id: '12345678',
        status: 'approved',
        externalReference: 'bkg-1',
        transactionAmount: '5000.5',
        currencyId: 'ARS',
      },
    });
  });

  it('asks the documented payments endpoint for that id', async () => {
    const { gateway: gw, transport } = gateway(async () => response(200, PAID));

    await gw.getPayment('12345678', TOKEN);

    expect(transport).toHaveBeenCalledWith(paymentUrl('12345678'), expect.anything());
  });

  /**
   * Terminal, not transient. A notification naming a payment the owner's own
   * account does not have is the shape a forged notification takes, and
   * answering it as an outage asks Mercado Pago to retry something that will
   * never resolve.
   */
  it('reports a 404 as notFound', async () => {
    const { gateway: gw } = gateway(async () => response(404));

    expect(await gw.getPayment('12345678', TOKEN)).toEqual({ status: 'notFound' });
  });

  it.each([401, 403])('reports %i as a rejected credential', async (status) => {
    const { gateway: gw } = gateway(async () => response(status));

    expect(await gw.getPayment('12345678', TOKEN)).toEqual({ status: 'rejected' });
  });

  it('reports a 500 as unavailable', async () => {
    const { gateway: gw } = gateway(async () => response(500));

    expect(await gw.getPayment('12345678', TOKEN)).toEqual({ status: 'unavailable' });
  });

  it('reports a transport failure as unavailable', async () => {
    const { gateway: gw } = gateway(async () => {
      throw new Error('network down');
    });

    expect(await gw.getPayment('12345678', TOKEN)).toEqual({ status: 'unavailable' });
  });

  it('reports a body missing the fields a decision needs as unavailable', async () => {
    const { gateway: gw } = gateway(async () => response(200, { id: 1, status: 'approved' }));

    expect(await gw.getPayment('12345678', TOKEN)).toEqual({ status: 'unavailable' });
  });

  // A null external_reference is a real Mercado Pago value, not a malformed
  // body. It must survive to the domain, which refuses it as a mismatch.
  it('carries a null external reference through rather than refusing the body', async () => {
    const { gateway: gw } = gateway(async () =>
      response(200, { ...PAID, external_reference: null })
    );

    const result = await gw.getPayment('12345678', TOKEN);

    expect(result).toEqual({
      status: 'found',
      payment: expect.objectContaining({ externalReference: null }),
    });
  });

  /**
   * The amount crosses as a string, and the conversion has to survive the
   * driver-and-JSON round trip that already burned this codebase once: a stored
   * 5000.50 arrives as the number 5000.5, and the domain compares integer
   * cents. Anything that routes through a fixed-decimal formatter here would
   * reintroduce the float arithmetic that conversion exists to avoid.
   */
  it('carries a two-decimal amount without losing or inventing a digit', async () => {
    const { gateway: gw } = gateway(async () =>
      response(200, { ...PAID, transaction_amount: 1000.1 })
    );

    const result = await gw.getPayment('12345678', TOKEN);

    expect(result).toEqual({
      status: 'found',
      payment: expect.objectContaining({ transactionAmount: '1000.1' }),
    });
  });
});

describe('what this module is allowed to touch', () => {
  const source = readFileSync(
    new URL('./MercadoPagoGateway.ts', import.meta.url),
    'utf8'
  );

  /**
   * A gateway call inside a transaction holds a pooled connection for a third
   * party's latency, and that pool is shared with the owner's dashboard. The
   * structural guarantee is that this module cannot reach the database at all.
   */
  it('imports nothing from Prisma or the database layer', () => {
    expect(source).not.toContain('@/generated/prisma');
    expect(source).not.toMatch(/from '.*prisma/i);
    expect(source).not.toContain('$transaction');
  });

  /**
   * T51: the Worker is close to the free plan's size ceiling, and two endpoints
   * do not justify spending it. `MercadoPagoCredentialVerifier` already proved
   * raw `fetch` works against this API.
   */
  it('uses no Mercado Pago SDK', () => {
    expect(source).not.toMatch(/from ['"]mercadopago/);
  });

  it('is not declared a dependency either', () => {
    const pkg = JSON.parse(
      readFileSync(new URL('../../../../package.json', import.meta.url), 'utf8')
    ) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };

    expect(pkg.dependencies ?? {}).not.toHaveProperty('mercadopago');
    expect(pkg.devDependencies ?? {}).not.toHaveProperty('mercadopago');
  });
});

describe('a refused request carries its cause, and nothing else', () => {
  /**
   * The single, deliberate exception to "no response body escapes this module".
   * A `400` with no code is a diagnosis nobody can act on — the preview proved
   * it, refusing a valid $2.000 deposit with `invalid_auto_return` because
   * Mercado Pago will not accept a `localhost` return URL, which the caller
   * then reported to the client as the amount being wrong.
   */
  it('reports the machine code Mercado Pago sends', async () => {
    const { gateway: gw } = gateway(async () =>
      response(400, {
        message: 'auto_return invalid. back_url.success must be defined',
        error: 'invalid_auto_return',
        status: 400,
      })
    );

    expect(await gw.createPreference(INPUT, TOKEN)).toEqual({
      status: 'invalid',
      reason: 'invalid_auto_return',
    });
  });

  /**
   * `message` is prose and can quote the request; `error` is a short
   * identifier. Only the identifier is taken, and this asserts the distinction
   * rather than trusting it.
   */
  it('never carries the prose message, which can quote the request', async () => {
    const { gateway: gw } = gateway(async () =>
      response(400, {
        message: `rejected token ${TOKEN}`,
        error: 'some_code',
      })
    );

    const result = await gw.createPreference(INPUT, TOKEN);

    expect(JSON.stringify(result)).not.toContain(TOKEN);
    expect(JSON.stringify(result)).not.toContain('rejected token');
  });

  it('bounds the code so a surprising payload cannot become a log dump', async () => {
    const { gateway: gw } = gateway(async () =>
      response(400, { error: 'x'.repeat(65) })
    );

    expect(await gw.createPreference(INPUT, TOKEN)).toEqual({ status: 'invalid', reason: null });
  });

  it('reports a null cause when Mercado Pago names none', async () => {
    const { gateway: gw } = gateway(async () => response(422, { message: 'nope' }));

    expect(await gw.createPreference(INPUT, TOKEN)).toEqual({ status: 'invalid', reason: null });
  });
});
