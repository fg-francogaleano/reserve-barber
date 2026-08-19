import { NextResponse, type NextRequest } from 'next/server';
import { parseMercadoPagoNotification } from '@/server/application/payment/mercadoPagoWebhookSchema';
import { paymentConfirmationService } from './webhookService';
import { logger } from '@/server/infrastructure/logger';
import { toErrorLogContext } from '@/server/infrastructure/errorLogContext';

/**
 * Mercado Pago's notification endpoint.
 *
 * **Unauthenticated by nature, and authenticated by consequence.** No session
 * could stand here — the caller is a third party — and no signature is
 * validated, deliberately (`tech-debt.md` T60): Mercado Pago's `x-signature` is
 * keyed by a per-integration secret this multi-tenant product does not store,
 * and choosing whose secret to use would require resolving the notification
 * first. Authenticity comes instead from re-fetching the payment with the
 * owner's own access token, which an attacker cannot forge.
 *
 * The path is named in the route guard's public set as an **exact** match
 * (`PUBLIC_MP_WEBHOOK`). Without it the deny-by-default guard answers `307` to
 * `/login`, Mercado Pago follows nothing, and every payment silently fails to
 * confirm — the defect B4 found on the booking write, in the one place where
 * nobody would be watching.
 */
export const dynamic = 'force-dynamic';

/**
 * The response policy, in one place.
 *
 * **`200` for everything handled, ignored, or refused.** A `4xx` or `5xx` makes
 * Mercado Pago retry, and retrying a notification we correctly decided to
 * ignore is a self-inflicted load loop on an endpoint that also spends an
 * outbound call. Only a genuinely transient failure earns a `503`, because that
 * is the only case another delivery can resolve.
 *
 * **The body is identical for every non-retry outcome.** A response that
 * differed between "this ref matches nothing", "already processed" and
 * "verification refused" would turn a public endpoint into an oracle for which
 * bookings and payments exist.
 */
const ACKNOWLEDGED = { received: true } as const;

function acknowledge(): NextResponse {
  return NextResponse.json(ACKNOWLEDGED, { status: 200 });
}

function askForRetry(): NextResponse {
  return NextResponse.json({ received: false }, { status: 503 });
}

/** Generous, and far past any real notification. */
const MAX_REF_LENGTH = 64;

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Read before anything else, and bounded: this value indexes a primary key
  // lookup, so a crafted one must not become expensive work.
  const ref = request.nextUrl.searchParams.get('ref');
  if (ref === null || ref.length === 0 || ref.length > MAX_REF_LENGTH) {
    // No reference means no owner, and no owner means no way to ask Mercado
    // Pago anything. Acknowledged rather than refused, so it is not retried.
    return acknowledge();
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    // Mercado Pago's older IPN form carries everything in the query string and
    // may send no body at all, so an unreadable body is not yet a failure.
    body = {};
  }

  const parsed = parseMercadoPagoNotification(body, request.nextUrl.searchParams);
  if (!parsed.ok) {
    // Both `ignored` and `malformed` are acknowledged. A malformed body will be
    // malformed again on every retry, so asking for one buys nothing.
    return acknowledge();
  }

  try {
    const result = await paymentConfirmationService().confirm({
      paymentRef: ref,
      gatewayPaymentId: parsed.notification.gatewayPaymentId,
    });

    return result.outcome === 'retry' ? askForRetry() : acknowledge();
  } catch (error) {
    // An unexpected failure here is most likely the database being unreachable,
    // which is exactly the case a retry can fix. The context carries an
    // operation and an error name — never a credential and never a person.
    logger.error(
      'Notification handling failed',
      toErrorLogContext('POST /api/webhooks/mercadopago', error)
    );
    return askForRetry();
  }
}
