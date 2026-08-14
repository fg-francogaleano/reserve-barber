import { describe, it, expect, vi } from 'vitest';
import {
  MercadoPagoCredentialVerifier,
  LIVENESS_URL,
  IDENTITY_URL,
} from './MercadoPagoCredentialVerifier';

const TOKEN = 'APP_USR-4934588586838432-081312-abcdef0123456789abcdef0123456789-241983636';

function response(status: number, body: unknown = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** A transport answering each URL from a map, defaulting to a 200. */
function transportFor(routes: Record<string, () => Promise<Response>>): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const handler = routes[url];
    if (!handler) {
      return response(200);
    }
    return handler();
  }) as unknown as typeof fetch;
}

function verifier(routes: Record<string, () => Promise<Response>>): MercadoPagoCredentialVerifier {
  return new MercadoPagoCredentialVerifier(transportFor(routes));
}

describe('MercadoPagoCredentialVerifier', () => {
  describe('liveness drives the outcome', () => {
    it('should_report_verified_when_the_liveness_call_succeeds', async () => {
      const result = await verifier({
        [LIVENESS_URL]: async () => response(200),
        [IDENTITY_URL]: async () => response(200, { nickname: 'BARBERIA-FRANCO' }),
      }).verify(TOKEN);

      expect(result.status).toBe('verified');
    });

    it.each([401, 403])(
      'should_report_rejected_when_mercado_pago_answers_%i',
      async (status) => {
        const result = await verifier({
          [LIVENESS_URL]: async () => response(status, { message: 'invalid access token' }),
        }).verify(TOKEN);

        expect(result.status).toBe('rejected');
      }
    );

    it.each([500, 502, 503, 504])(
      'should_report_unavailable_when_mercado_pago_answers_%i',
      async (status) => {
        const result = await verifier({
          [LIVENESS_URL]: async () => response(status),
        }).verify(TOKEN);

        expect(result.status).toBe('unavailable');
      }
    );

    it('should_report_unavailable_on_a_network_failure', async () => {
      const result = await verifier({
        [LIVENESS_URL]: async () => {
          throw new TypeError('fetch failed');
        },
      }).verify(TOKEN);

      expect(result.status).toBe('unavailable');
    });

    it('should_report_unavailable_when_the_call_times_out', async () => {
      const result = await verifier({
        [LIVENESS_URL]: async () => {
          const error = new Error('The operation was aborted');
          error.name = 'TimeoutError';
          throw error;
        },
      }).verify(TOKEN);

      expect(result.status).toBe('unavailable');
    });

    // An unexpected status is not a rejection. Treating anything non-OK as
    // "rejected" would block a save on a Mercado Pago quirk, telling the owner
    // their correct credentials are invalid.
    it('should_report_unavailable_for_an_unexpected_status', async () => {
      const result = await verifier({
        [LIVENESS_URL]: async () => response(418),
      }).verify(TOKEN);

      expect(result.status).toBe('unavailable');
    });
  });

  describe('the call is bounded', () => {
    it('should_pass_an_abort_signal_to_every_request', async () => {
      const fetchSpy = vi.fn(async () => response(200));
      await new MercadoPagoCredentialVerifier(fetchSpy as unknown as typeof fetch).verify(TOKEN);

      for (const call of fetchSpy.mock.calls) {
        const init = (call as unknown as [string, RequestInit])[1];
        expect(init.signal).toBeInstanceOf(AbortSignal);
      }
    });

    it('should_not_retry_a_failed_call', async () => {
      // A settings save is not the place to amplify load against a struggling
      // third party — and the owner can retry themselves.
      const fetchSpy = vi.fn(async () => response(503));
      await new MercadoPagoCredentialVerifier(fetchSpy as unknown as typeof fetch).verify(TOKEN);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('the friendly name is best effort (design D5)', () => {
    it('should_return_the_nickname_when_the_identity_call_succeeds', async () => {
      const result = await verifier({
        [LIVENESS_URL]: async () => response(200),
        [IDENTITY_URL]: async () => response(200, { nickname: 'BARBERIA-FRANCO' }),
      }).verify(TOKEN);

      expect(result).toEqual({ status: 'verified', account: { displayName: 'BARBERIA-FRANCO' } });
    });

    it('should_fall_back_to_the_email_when_there_is_no_nickname', async () => {
      const result = await verifier({
        [LIVENESS_URL]: async () => response(200),
        [IDENTITY_URL]: async () => response(200, { email: 'duenio@barberia.test' }),
      }).verify(TOKEN);

      expect(result).toEqual({
        status: 'verified',
        account: { displayName: 'duenio@barberia.test' },
      });
    });

    // The whole point of separating the two jobs. `/users/me` is not in Mercado
    // Pago's public reference, so it may change or disappear; when it does, the
    // credentials are still verified and the save still proceeds.
    it.each([
      ['a 404', async () => response(404)],
      ['a 500', async () => response(500)],
      ['a network failure', async () => Promise.reject(new TypeError('fetch failed'))],
      ['an unparseable body', async () => new Response('<html>', { status: 200 })],
      ['a body with no usable name', async () => response(200, { id: 241983636 })],
    ])('should_still_report_verified_when_the_identity_call_fails_with_%s', async (_l, handler) => {
      const result = await verifier({
        [LIVENESS_URL]: async () => response(200),
        [IDENTITY_URL]: handler as () => Promise<Response>,
      }).verify(TOKEN);

      expect(result).toEqual({ status: 'verified', account: { displayName: null } });
    });

    it('should_not_attempt_the_identity_call_when_the_token_was_rejected', async () => {
      const identity = vi.fn(async () => response(200, { nickname: 'nope' }));
      await verifier({
        [LIVENESS_URL]: async () => response(401),
        [IDENTITY_URL]: identity,
      }).verify(TOKEN);

      expect(identity).not.toHaveBeenCalled();
    });
  });

  describe('the token is sent as a bearer credential', () => {
    it('should_send_the_token_in_the_authorization_header_and_never_in_the_url', async () => {
      const fetchSpy = vi.fn(async () => response(200));
      await new MercadoPagoCredentialVerifier(fetchSpy as unknown as typeof fetch).verify(TOKEN);

      for (const call of fetchSpy.mock.calls) {
        const [url, init] = call as unknown as [string, RequestInit];
        // A token in a query string lands in access logs and proxy caches.
        expect(url).not.toContain(TOKEN);
        expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
      }
    });
  });

  describe('errors carry no credential (design D14)', () => {
    // Third-party error bodies routinely echo the credential they rejected.
    it('should_not_surface_a_mercado_pago_body_that_echoes_the_token', async () => {
      const result = await verifier({
        [LIVENESS_URL]: async () =>
          response(401, { message: `invalid token ${TOKEN}`, token: TOKEN }),
      }).verify(TOKEN);

      expect(JSON.stringify(result)).not.toContain(TOKEN);
      expect(JSON.stringify(result)).not.toContain('241983636');
    });

    it('should_not_surface_a_token_echoed_by_a_thrown_transport_error', async () => {
      const result = await verifier({
        [LIVENESS_URL]: async () => {
          throw new Error(`connection failed while sending ${TOKEN}`);
        },
      }).verify(TOKEN);

      expect(JSON.stringify(result)).not.toContain(TOKEN);
    });
  });
});
