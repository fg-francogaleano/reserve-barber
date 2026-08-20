import { NextResponse, type NextRequest } from 'next/server';
import {
  PAYMENT_RETURN_COOKIE,
  PAYMENT_RETURN_MAX_AGE_SECONDS,
  BOOKING_OUTCOME_PARAM,
  type PaymentOutcomeCode,
} from '@/server/application/booking/bookingOutcome';
import { BookingThrottle } from '@/server/application/booking/bookingThrottle';
import { paymentInitiationService } from './paymentInitiationService';
import { COPY } from '@/lib/copy';
import { logger } from '@/server/infrastructure/logger';
import { toErrorLogContext } from '@/server/infrastructure/errorLogContext';

/**
 * The public payment initiation.
 *
 * **A Route Handler on a fixed path, and both properties are load-bearing.**
 * `backend-standards.md` makes the public flow's mutations Route Handlers
 * rather than Server Actions, because a Server Action is addressed by a
 * build-time id and a guest halfway through paying a deposit is exactly the
 * person who must never meet a dead action. And the path carries **no
 * identifier**: `decideGuardAction` admits public paths by exact string
 * equality, so a token in the URL could not be permitted without teaching the
 * deny-by-default guard to match patterns — in the one place where a loose
 * match is most expensive. The token travels in the body, which also keeps a
 * live credential out of access logs and `Referer` headers.
 */
export const dynamic = 'force-dynamic';

/**
 * Per-isolate, best-effort, and shared in shape with the booking write. The
 * database-checked bound that actually holds here is the live-payment index:
 * one booking, one live payment, decided by the database rather than by this
 * counter (`tech-debt.md` T55).
 */
const throttle = new BookingThrottle();

function originOf(request: NextRequest): string {
  return (
    request.headers.get('cf-connecting-ip') ??
    request.headers.get('x-real-ip') ??
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown'
  );
}

function jsonError(message: string, code: string, status: number): NextResponse {
  return NextResponse.json({ success: false, error: { message, code } }, { status });
}

/**
 * The origin Mercado Pago must use to reach this application back.
 *
 * **The host comes from the request; the scheme does not, and that distinction
 * is the whole point.** We cannot know our own public hostname any other way,
 * but the request's scheme describes how *this client* reached us — not what a
 * *third party* needs in order to reach us. Mercado Pago requires `https` and
 * refuses anything else outright, so the scheme is a property of the
 * integration and is stated rather than inferred.
 *
 * **Measured, and it is not a hypothetical distinction.** Through a
 * TLS-terminating tunnel, `new URL(request.url).origin` yielded
 * `http://<public-host>` — a perfectly reachable address — and Mercado Pago
 * refused it with `invalid_auto_return`. The same host with `https` was
 * accepted. Deriving the scheme from the request made the payment path depend
 * on how the app happens to be fronted, which is exactly the kind of coupling
 * that is invisible until it is in front of a client.
 *
 * This is consistent with what the rest of the flow already assumes: every
 * cookie in it is set `secure`, so an `http` origin was never a state this
 * application intended to serve.
 */
function publicOriginOf(request: NextRequest): string {
  return `https://${new URL(request.url).host}`;
}

async function readSubmission(request: NextRequest): Promise<Record<string, unknown>> {
  const contentType = request.headers.get('content-type') ?? '';

  if (contentType.includes('application/json')) {
    const body: unknown = await request.json();
    return typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  }

  const form = await request.formData();
  return Object.fromEntries(Array.from(form.entries()).map(([key, value]) => [key, value]));
}

/** Generous, like every other bound on a stranger-supplied value in this flow. */
const MAX_TOKEN_LENGTH = 128;

function asToken(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_TOKEN_LENGTH
    ? value
    : null;
}

/**
 * Back to the client's own confirmation page with a code.
 *
 * `303` rather than `302`: it converts the follow-up into a `GET`, so a reload
 * or a back-navigation never re-issues the `POST`. Combined with the
 * live-payment bound, a repeat navigation is safe rather than a second charge.
 */
function backToBooking(
  request: NextRequest,
  slug: string,
  token: string,
  code: PaymentOutcomeCode
): NextResponse {
  const url = new URL(`/b/${slug}/reserva/${token}`, request.url);
  url.searchParams.set(BOOKING_OUTCOME_PARAM, code);
  return NextResponse.redirect(url, 303);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const origin = originOf(request);

  // The body is read before the throttle is consulted, for the reason the
  // booking write settled after its review: the only thing that says where to
  // send a throttled browser back to is inside the submission. Reading a form
  // body is negligible next to the work this endpoint otherwise does, and the
  // throttle still short-circuits before any query or outbound call.
  let submission: Record<string, unknown>;
  try {
    submission = await readSubmission(request);
  } catch {
    return jsonError(COPY.booking.apiInvalidRequest, 'VALIDATION_ERROR', 400);
  }

  const token = asToken(submission.token);
  if (token === null) {
    return jsonError(COPY.booking.apiInvalidRequest, 'VALIDATION_ERROR', 400);
  }

  if (throttle.isThrottled(origin)) {
    return jsonError(COPY.booking.tooManyRequests, 'TOO_MANY_REQUESTS', 429);
  }
  throttle.record(origin);

  try {
    const result = await paymentInitiationService().initiate({
      cancellationToken: token,
      origin: publicOriginOf(request),
    });

    switch (result.outcome) {
      case 'redirect': {
        const response = NextResponse.redirect(result.initPoint, 303);
        // The token the gateway is deliberately never told (design D11). It
        // waits here for the landing route to read back.
        response.cookies.set(PAYMENT_RETURN_COOKIE, token, {
          httpOnly: true,
          secure: true,
          // Lax, not Strict: the return from Mercado Pago is a top-level
          // cross-site GET navigation. Strict would withhold the cookie and
          // the client would land with nothing to identify their booking.
          sameSite: 'lax',
          path: '/b',
          maxAge: PAYMENT_RETURN_MAX_AGE_SECONDS,
        });
        return response;
      }

      // A token matching nothing is a 404 that discloses nothing about whether
      // it ever existed — the same answer the confirmation page gives.
      case 'notFound':
        return jsonError(COPY.booking.apiInvalidRequest, 'NOT_FOUND', 404);

      case 'notPayable':
        return backToBooking(request, result.slug, token, 'no-pagable');

      case 'holdExpired':
        return backToBooking(request, result.slug, token, 'vencido');

      case 'notConfigured':
        return backToBooking(request, result.slug, token, 'sin-mercadopago');

      // One code for two causes, on purpose: an unreadable credential and a
      // rejected one are the same situation for the client, and neither is
      // theirs to act on. The distinction lives in the logs, where the owner
      // can act on it.
      case 'credentialUnreadable':
      case 'credentialRejected':
      // A refused request joins them: whatever Mercado Pago objected to, the
      // client cannot act on it and the cause is already in the log.
      case 'chargeRefused':
        return backToBooking(request, result.slug, token, 'pagos-no-disponibles');

      case 'gatewayUnavailable':
        return backToBooking(request, result.slug, token, 'reintenta');
    }
  } catch (error) {
    // Never rethrown into a route error boundary, which would replace the page
    // and lose the client's way back. The context carries an operation and an
    // error name — never the token, and never a credential.
    logger.error(
      'Payment initiation failed',
      toErrorLogContext('POST /api/payments/mercadopago', error)
    );
    return jsonError(COPY.booking.apiInvalidRequest, 'INTERNAL_ERROR', 500);
  }
}
