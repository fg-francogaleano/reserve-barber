import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';
import { PAYMENT_RETURN_COOKIE } from '@/server/application/booking/bookingOutcome';

const initiate = vi.fn();

vi.mock('./paymentInitiationService', () => ({
  paymentInitiationService: () => ({ initiate }),
}));

const TOKEN = 'tok-1';
const SLUG = 'barberia-don-juan';
const INIT_POINT = 'https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=pref-1';

/**
 * Each request gets its own origin address.
 *
 * `BookingThrottle` is module state and every unattributable request shares one
 * key, so without this the file throttles itself partway through and the later
 * tests measure the limiter instead of the handler. Supplying the header is
 * also what production does — Cloudflare sets it on every request.
 */
let caller = 0;

function submit(origin = 'https://shop.example', body = `token=${TOKEN}&slug=${SLUG}`) {
  caller += 1;
  return new NextRequest(new URL('/api/payments/mercadopago', origin), {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'cf-connecting-ip': `203.0.113.${caller}`,
    },
    body,
  });
}

beforeEach(() => {
  initiate.mockReset();
  initiate.mockResolvedValue({ outcome: 'redirect', initPoint: INIT_POINT, slug: SLUG });
});

describe('the origin handed to Mercado Pago', () => {
  /**
   * **The host is read from the request; the scheme is not.**
   *
   * Measured through a TLS-terminating tunnel: `new URL(request.url).origin`
   * produced `http://<public-host>` — reachable, and refused by Mercado Pago
   * with `invalid_auto_return`. The same host over `https` was accepted. The
   * request's scheme says how *this client* reached us; it says nothing about
   * what a *third party* needs to reach us back, and Mercado Pago requires
   * `https` outright.
   */
  it('always hands Mercado Pago an https origin', async () => {
    await POST(submit('http://localhost:8787'));

    expect(initiate).toHaveBeenCalledWith(
      expect.objectContaining({ origin: 'https://localhost:8787' })
    );
  });

  it('keeps the public host the request arrived on', async () => {
    await POST(submit('https://tunnel.example.com'));

    expect(initiate).toHaveBeenCalledWith(
      expect.objectContaining({ origin: 'https://tunnel.example.com' })
    );
  });

  it('does not let the client choose the origin', async () => {
    // Nothing in the body shapes where Mercado Pago calls back to.
    await POST(submit('https://shop.example', `token=${TOKEN}&origin=https://evil.example`));

    expect(initiate).toHaveBeenCalledWith(
      expect.objectContaining({ origin: 'https://shop.example' })
    );
  });
});

describe('the redirect and its cookie', () => {
  it('sends the client to the checkout with a 303', async () => {
    const response = await POST(submit());

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(INIT_POINT);
  });

  /**
   * The token Mercado Pago is deliberately never told (design D11). `Lax` is
   * required and sufficient: the return is a top-level cross-site GET, which
   * `Strict` would withhold, leaving the client with nothing to identify them.
   */
  it('leaves the token behind in an httpOnly, Lax, /b-scoped cookie', async () => {
    const response = await POST(submit());
    const cookie = response.cookies.get(PAYMENT_RETURN_COOKIE);

    expect(cookie?.value).toBe(TOKEN);
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe('lax');
    expect(cookie?.path).toBe('/b');
    expect(cookie?.secure).toBe(true);
  });

  it('never puts the token in the URL it redirects to', async () => {
    const response = await POST(submit());

    expect(response.headers.get('location')).not.toContain(TOKEN);
  });
});

describe('refusals land the client back on their own page', () => {
  it.each([
    ['notPayable', 'no-pagable'],
    ['holdExpired', 'vencido'],
    ['notConfigured', 'sin-mercadopago'],
    ['gatewayUnavailable', 'reintenta'],
  ])('maps %s to the %s code', async (outcome, code) => {
    initiate.mockResolvedValue({ outcome, slug: SLUG });

    const response = await POST(submit());

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(
      `https://shop.example/b/${SLUG}/reserva/${TOKEN}?estado=${code}`
    );
  });

  /**
   * Three causes, one message. An unreadable credential, a rejected one and a
   * refused request are the same situation for the client, and none of them is
   * theirs to act on. The distinction lives in the logs.
   */
  it.each(['credentialUnreadable', 'credentialRejected', 'chargeRefused'])(
    'tells the client %s is the shop\'s problem, not theirs',
    async (outcome) => {
      initiate.mockResolvedValue({ outcome, slug: SLUG });

      const response = await POST(submit());

      expect(response.headers.get('location')).toContain('estado=pagos-no-disponibles');
    }
  );

  it('answers an unknown token with a 404 that discloses nothing', async () => {
    initiate.mockResolvedValue({ outcome: 'notFound' });

    const response = await POST(submit());

    expect(response.status).toBe(404);
  });
});

describe('what never reaches the service', () => {
  it('refuses a submission with no token', async () => {
    const response = await POST(submit('https://shop.example', `slug=${SLUG}`));

    expect(response.status).toBe(400);
    expect(initiate).not.toHaveBeenCalled();
  });

  it('refuses an over-long token', async () => {
    const response = await POST(
      submit('https://shop.example', `token=${'x'.repeat(129)}&slug=${SLUG}`)
    );

    expect(response.status).toBe(400);
    expect(initiate).not.toHaveBeenCalled();
  });

  it('does not leak the failure cause when the service throws', async () => {
    initiate.mockRejectedValue(new Error(`boom ${TOKEN}`));

    const response = await POST(submit());
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(body).not.toContain(TOKEN);
    expect(body).not.toContain('boom');
  });
});
