import type {
  IMercadoPagoCredentialVerifier,
  VerificationOutcome,
} from '../../domain/repositories/IMercadoPagoCredentialVerifier';

/**
 * Asks Mercado Pago whether a submitted access token is real (design D5).
 *
 * The project's first outbound third-party call from application code, and it
 * sits on the path of a settings save — so every property below is about not
 * letting Mercado Pago's availability become this feature's availability.
 *
 * **Two jobs, deliberately separated** (design D5, amended after task 2.3):
 *
 * 1. **Liveness**, against a documented authenticated endpoint. This drives the
 *    whole failure policy and is the part that must be reliable.
 * 2. **A human-readable name**, from `/users/me`. That endpoint is *not* in
 *    Mercado Pago's public API reference — it is Mercado Libre's and accepts MP
 *    tokens in practice — so it is treated as decoration. When it fails, the
 *    credentials are still verified and the confirmation still names the
 *    account, using the id recovered from the token offline (design D6a).
 *
 * A name lookup that fails is not a verification that failed. Conflating them
 * would let an undocumented endpoint's disappearance start blocking saves.
 */

/**
 * Documented, requires an access token, and answers 401 for a bad one. Chosen
 * over `/users/me` for this job precisely because it is documented.
 */
export const LIVENESS_URL = 'https://api.mercadopago.com/v1/payment_methods';

/** Undocumented for Mercado Pago. Best effort only — never blocks a save. */
export const IDENTITY_URL = 'https://api.mercadopago.com/users/me';

/**
 * Long enough for a slow-but-working Mercado Pago, short enough that an owner
 * does not conclude the form is broken and submit again.
 */
const LIVENESS_TIMEOUT_MS = 8000;

/** Shorter: it is decoration, and it must not extend a save that already knows its answer. */
const IDENTITY_TIMEOUT_MS = 4000;

const REJECTION_STATUSES = new Set([401, 403]);

export class MercadoPagoCredentialVerifier implements IMercadoPagoCredentialVerifier {
  /**
   * The transport is injected so tests never reach the network, and so the
   * timeout behaviour is provable rather than assumed.
   */
  constructor(private readonly transport: typeof fetch = fetch) {}

  async verify(accessToken: string): Promise<VerificationOutcome> {
    const liveness = await this.call(LIVENESS_URL, accessToken, LIVENESS_TIMEOUT_MS);

    if (liveness === null) {
      // Unreachable, slow, or failing. Does not block the write — see D5.
      return { status: 'unavailable' };
    }

    if (REJECTION_STATUSES.has(liveness.status)) {
      // Mercado Pago answered, and the answer is no. Nothing from the response
      // body travels with this: error payloads routinely echo the credential
      // they rejected, and the caller has no use for the text anyway.
      return { status: 'rejected' };
    }

    if (!liveness.ok) {
      // An unexpected status is not a rejection. Treating every non-OK answer
      // as one would block a save on a Mercado Pago quirk and tell the owner
      // their correct credentials are invalid.
      return { status: 'unavailable' };
    }

    return { status: 'verified', account: { displayName: await this.displayName(accessToken) } };
  }

  /**
   * Returns the response, or `null` for anything that prevented one. Collapsing
   * every transport failure here keeps the caller's branching about *policy*
   * rather than about the shape of a network error — and guarantees no thrown
   * message, which may quote the request, escapes this method.
   */
  private async call(url: string, accessToken: string, timeoutMs: number): Promise<Response | null> {
    try {
      return await this.transport(url, {
        method: 'GET',
        headers: {
          // In a header, never a query parameter: a token in a URL lands in
          // access logs, proxy caches and browser history.
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
        // Bounded, always. Without this an unresponsive Mercado Pago leaves the
        // server action pending until the platform kills it, the owner submits
        // again, and two writes race.
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      // Swallowed on purpose: the thrown error may quote the request, including
      // the Authorization header, and nothing in it changes what happens next.
      return null;
    }
  }

  /** Best effort by construction — every failure path yields `null`. */
  private async displayName(accessToken: string): Promise<string | null> {
    const response = await this.call(IDENTITY_URL, accessToken, IDENTITY_TIMEOUT_MS);
    if (response === null || !response.ok) {
      return null;
    }

    try {
      const body: unknown = await response.json();
      if (typeof body !== 'object' || body === null) {
        return null;
      }
      const { nickname, email } = body as { nickname?: unknown; email?: unknown };
      if (typeof nickname === 'string' && nickname !== '') {
        return nickname;
      }
      if (typeof email === 'string' && email !== '') {
        return email;
      }
      return null;
    } catch {
      // An unparseable body is a missing name, not a failed verification.
      return null;
    }
  }
}
