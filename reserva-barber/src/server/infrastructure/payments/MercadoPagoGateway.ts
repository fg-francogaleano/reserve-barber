import type {
  GatewayPaymentResult,
  IPaymentGateway,
  PreferenceInput,
  PreferenceResult,
} from '@/server/domain/repositories/IPaymentGateway';

/**
 * The two Mercado Pago calls that move money, over the platform `fetch`.
 *
 * **No SDK, deliberately** (design D6). `tech-debt.md` T51 records that the
 * Worker sits roughly 319 KiB under Cloudflare's free-plan script ceiling, and
 * `MercadoPagoCredentialVerifier` already proved this API answers a plain
 * bearer-authenticated request from this runtime. Two endpoints do not justify
 * spending that headroom on a vendor package.
 *
 * Every property below is inherited from that verifier for the same reasons it
 * had them: an injected transport so tests never reach the network, a bounded
 * timeout on every call, the token in a header and never a URL, and **nothing
 * from a response body ever escaping this file**. That last one is not
 * fastidiousness — Mercado Pago's rejection payloads routinely echo the
 * credential they rejected, so a body that reaches a log is a leaked token.
 *
 * This module imports nothing from the database layer, which is the structural
 * form of "no gateway call inside a transaction": a third party's latency must
 * never hold a pooled connection the owner's dashboard is also waiting on.
 */

/** Documented. Creates the hosted checkout the client is redirected to. */
export const PREFERENCES_URL = 'https://api.mercadopago.com/checkout/preferences';

/** Documented. The authority behind every confirmation (design D1). */
export function paymentUrl(gatewayPaymentId: string): string {
  return `https://api.mercadopago.com/v1/payments/${encodeURIComponent(gatewayPaymentId)}`;
}

/**
 * Long enough for a slow-but-working Mercado Pago, short enough that a client
 * does not conclude the button is broken and press it again — which is the
 * double submit the live-payment index then has to absorb.
 */
const PREFERENCE_TIMEOUT_MS = 8000;

/**
 * Shorter, because nobody is watching. The webhook's caller is Mercado Pago,
 * which retries; a request held open helps no one.
 */
const PAYMENT_TIMEOUT_MS = 5000;

/** The credential is wrong, not the request. */
const REJECTION_STATUSES = new Set([401, 403]);

const CURRENCY = 'ARS';

/**
 * A money string to the number Mercado Pago's API takes.
 *
 * There is no alternative — their `unit_price` is a JSON number — so the
 * conversion is confined to this line and happens as late as possible, after
 * every decision about the amount has already been made in integer cents.
 */
function toGatewayAmount(canonical: string): number {
  return Number(canonical);
}

/**
 * Mercado Pago's number back to a string, without a formatter.
 *
 * `String(5000.5)` yields `"5000.5"`, and JavaScript's number-to-string is
 * shortest-round-trip, so any money value inside this product's range
 * (`MAX_PRICE` is 9,999,999.99, well inside 15 significant digits) comes back
 * as the decimal Mercado Pago sent. The domain then compares integer cents, so
 * `"5000.5"` and a stored `"5000.50"` agree — the exact case PC3 measured and
 * `verifyGatewayPayment` is tested against.
 *
 * Deliberately NOT `toFixed(2)`: that routes a float through a rounding step on
 * the value a confirmation depends on, which is the arithmetic the canonical
 * string convention exists to keep out of money.
 */
function fromGatewayAmount(value: number): string {
  return String(value);
}

export class MercadoPagoGateway implements IPaymentGateway {
  /**
   * The transport is injected so tests never reach the network, and so the
   * timeout behaviour is provable rather than assumed.
   */
  constructor(private readonly transport: typeof fetch = fetch) {}

  async createPreference(input: PreferenceInput, accessToken: string): Promise<PreferenceResult> {
    const response = await this.call(
      PREFERENCES_URL,
      accessToken,
      PREFERENCE_TIMEOUT_MS,
      {
        items: [
          {
            // The service's name. Never the client's — this string is stored by
            // Mercado Pago and shown in their dashboard.
            title: input.title,
            quantity: 1,
            unit_price: toGatewayAmount(input.amount),
            currency_id: CURRENCY,
          },
        ],
        // The booking's id, never the cancellation token (design D3).
        external_reference: input.externalReference,
        notification_url: input.notificationUrl,
        back_urls: {
          success: input.backUrl,
          pending: input.backUrl,
          failure: input.backUrl,
        },
        auto_return: 'approved',
        // The first of the three layers against a late payment: Mercado Pago
        // refuses a checkout begun after the hold has lapsed.
        date_of_expiration: input.expiresAt.toISOString(),
        metadata: { booking_id: input.externalReference },
      }
    );

    if (response === null) return { status: 'unavailable' };

    if (REJECTION_STATUSES.has(response.status)) return { status: 'rejected' };

    // Mercado Pago refusing this *charge* — an amount under their minimum is
    // the case B5 exists to discover — not this *credential*.
    if (response.status === 400 || response.status === 422) return { status: 'invalid' };

    if (!response.ok) return { status: 'unavailable' };

    const body = await readJson(response);
    if (body === null) return { status: 'unavailable' };

    const { id, init_point: initPoint } = body as { id?: unknown; init_point?: unknown };

    // A success without a checkout URL is not a created preference. Reporting
    // it as one would redirect the client to nowhere, which is worse than
    // saying the gateway is unavailable.
    if (typeof id !== 'string' || typeof initPoint !== 'string' || initPoint === '') {
      return { status: 'unavailable' };
    }

    return { status: 'created', preferenceId: id, initPoint };
  }

  async getPayment(
    gatewayPaymentId: string,
    accessToken: string
  ): Promise<GatewayPaymentResult> {
    const response = await this.call(paymentUrl(gatewayPaymentId), accessToken, PAYMENT_TIMEOUT_MS);

    if (response === null) return { status: 'unavailable' };

    // Terminal, not transient. A payment the owner's own account does not have
    // is what a forged notification looks like, and treating it as an outage
    // would ask Mercado Pago to retry something that can never resolve.
    if (response.status === 404) return { status: 'notFound' };

    if (REJECTION_STATUSES.has(response.status)) return { status: 'rejected' };

    if (!response.ok) return { status: 'unavailable' };

    const body = await readJson(response);
    if (body === null) return { status: 'unavailable' };

    const {
      id,
      status,
      external_reference: externalReference,
      transaction_amount: transactionAmount,
      currency_id: currencyId,
    } = body as Record<string, unknown>;

    // Anything missing a field a decision depends on is not a payment we can
    // reason about. `external_reference` is exempt: `null` is a real Mercado
    // Pago value, and the domain refuses it as a mismatch rather than here.
    if (
      (typeof id !== 'string' && typeof id !== 'number') ||
      typeof status !== 'string' ||
      typeof transactionAmount !== 'number' ||
      typeof currencyId !== 'string'
    ) {
      return { status: 'unavailable' };
    }

    return {
      status: 'found',
      payment: {
        id: String(id),
        status,
        externalReference: typeof externalReference === 'string' ? externalReference : null,
        transactionAmount: fromGatewayAmount(transactionAmount),
        currencyId,
      },
    };
  }

  /**
   * Returns the response, or `null` for anything that prevented one.
   *
   * Collapsing every transport failure here keeps the callers' branching about
   * *policy* rather than about the shape of a network error — and guarantees
   * that no thrown message, which may quote the request and its `Authorization`
   * header, escapes this method.
   */
  private async call(
    url: string,
    accessToken: string,
    timeoutMs: number,
    body?: unknown
  ): Promise<Response | null> {
    try {
      return await this.transport(url, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          // In a header, never a query parameter: a token in a URL lands in
          // access logs, proxy caches and browser history.
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        // Bounded, always. Without this an unresponsive Mercado Pago leaves the
        // request pending until the platform kills it, the client submits
        // again, and two preferences race.
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      // Swallowed on purpose: the thrown error may quote the request, including
      // the Authorization header, and nothing in it changes what happens next.
      return null;
    }
  }
}

/**
 * The body as an object, or `null` for anything that is not one.
 *
 * Nothing from a failed parse is reported. Mercado Pago serves HTML error pages
 * through the same origin, and an unparseable body says only that this response
 * cannot be reasoned about.
 */
async function readJson(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await response.json();
    return typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
