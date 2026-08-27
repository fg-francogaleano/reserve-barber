import { NextResponse, type NextRequest } from 'next/server';
import {
  BOOKING_OUTCOME_PARAM,
  type PaymentOutcomeCode,
} from '@/server/application/booking/bookingOutcome';
import { BookingThrottle } from '@/server/application/booking/bookingThrottle';
import type { ClientCancellationRefusal } from '@/server/domain/repositories/IBookingRepository';
import { clientCancellationService } from './clientCancellationService';
import { COPY } from '@/lib/copy';
import { logger } from '@/server/infrastructure/logger';
import { toErrorLogContext } from '@/server/infrastructure/errorLogContext';

/**
 * The client cancels their own booking (C1).
 *
 * **Step two of two.** Step one is a `GET` on the booking page that renders a
 * confirmation and writes nothing; this is the `POST` submitted by somebody who
 * read it. That separation is `tech-debt.md` T69's requirement on this story
 * rather than a preference: the token addressing this booking travels to an
 * address the product has never verified, so a cancel-by-URL would be fired by
 * a mail scanner, a link-preview bot, a corporate security gateway or the
 * framework's own prefetching — none of them meaning to cancel anything.
 *
 * **A Route Handler rather than a Server Action**, per `backend-standards.md`:
 * a Server Action is addressed by a build-time id, and a client trying to give
 * back a slot they cannot use is exactly the person who must never meet a dead
 * action. The fixed path is also what lets the deny-by-default guard admit this
 * endpoint by equality, and the token travels in the body, where it stays out
 * of access logs and `Referer` headers.
 *
 * **No CSRF token.** A cross-site submission has to carry the cancellation
 * token, and anybody holding that token can cancel by design — a CSRF token
 * protects a session-derived authority this endpoint does not have. The actor
 * worth defending against is the credential-free one, and it is defeated by the
 * request being a `POST` at all.
 */
export const dynamic = 'force-dynamic';

/**
 * Per-isolate, best-effort, and shared in shape with the booking write.
 *
 * **Unlike the booking write, there is no second database-checked bound behind
 * it** (`MAX_LIVE_HOLDS_PER_CLIENT` has no analogue here). What actually bounds
 * this endpoint is the credential: a 256-bit token from `crypto.getRandomValues`,
 * generated and never derived, so guessing is not the threat model. This limits
 * the noise a script can make, and `tech-debt.md` T55/T60 record the rest.
 */
const throttle = new BookingThrottle();

/** Generous, like every other bound on a stranger-supplied value in this flow. */
const MAX_TOKEN_LENGTH = 128;

/**
 * The ceiling this route refuses at, **before the body is read**.
 *
 * This endpoint's whole submission is one 256-bit token in a form field, so the
 * real body is a few hundred bytes — but `formData()` buffers whatever arrives
 * into an isolate with a hard memory bound, and nothing else here limits it.
 * The transfer endpoint guards its own multipart body for exactly this reason;
 * the fact that this one carries no file makes the bound *smaller*, not
 * unnecessary.
 *
 * **It is a header check and nothing more, which is worth stating plainly.**
 * `Content-Length` is client-controlled: a request that declares itself large
 * is refused here, and a chunked request that declares nothing is still
 * buffered before anything measures it. The token bound below catches the
 * oversized *value*, not the oversized *body*. The transfer endpoint carries
 * the same residual, and closing it properly means reading the stream rather
 * than the header — deferred, and recorded rather than implied by this
 * function's existence.
 */
const MAX_BODY_BYTES = 8 * 1024;

/** Whether the declared body size is already past what we will accept. */
function declaredBodyTooLarge(request: NextRequest): boolean {
  const declared = Number(request.headers.get('content-length'));
  return Number.isFinite(declared) && declared > MAX_BODY_BYTES;
}

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

function asToken(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_TOKEN_LENGTH
    ? value
    : null;
}

/** The code each refusal is reported with. Two, because they are two facts. */
const REFUSAL_CODES: Record<ClientCancellationRefusal, PaymentOutcomeCode> = {
  alreadyStarted: 'turno-empezado',
  noLongerCancellable: 'cancelacion-no-posible',
};

/**
 * Back to the client's own page.
 *
 * `303` rather than `302`: it converts the follow-up into a `GET`, so a reload
 * or a back-navigation never re-issues the `POST` — which here would mean a
 * second cancellation attempt against a booking that is already cancelled.
 *
 * **The slug comes from the service's projection**, never from the submission.
 * The form carries only a token, so there is nothing to trust in the first
 * place, and this keeps it that way.
 */
function backToBooking(
  request: NextRequest,
  slug: string,
  token: string,
  code?: PaymentOutcomeCode
): NextResponse {
  const url = new URL(`/b/${slug}/reserva/${token}`, request.url);
  if (code !== undefined) url.searchParams.set(BOOKING_OUTCOME_PARAM, code);
  return NextResponse.redirect(url, 303);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const origin = originOf(request);

  // **Before the body is read**, which is the only point at which refusing is
  // still cheap.
  if (declaredBodyTooLarge(request)) {
    return jsonError(COPY.booking.apiInvalidRequest, 'PAYLOAD_TOO_LARGE', 413);
  }

  // The body is read before the throttle is consulted, for the reason the
  // booking write settled after its review: the only thing that says where to
  // send a throttled browser back to is inside the submission.
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonError(COPY.booking.apiInvalidRequest, 'VALIDATION_ERROR', 400);
  }

  const token = asToken(form.get('token'));
  if (token === null) {
    return jsonError(COPY.booking.apiInvalidRequest, 'VALIDATION_ERROR', 400);
  }

  if (throttle.isThrottled(origin)) {
    return jsonError(COPY.booking.tooManyRequests, 'TOO_MANY_REQUESTS', 429);
  }
  throttle.record(origin);

  try {
    const result = await clientCancellationService().cancel(token);

    switch (result.outcome) {
      case 'cancelled':
        // **No code.** The page reads live state and renders the cancelled
        // state from the database; a success code could only agree with it.
        return backToBooking(request, result.slug, token);

      case 'notCancellable':
        return backToBooking(request, result.slug, token, REFUSAL_CODES[result.reason]);

      case 'notFound':
        // A token matching nothing is answered exactly as one whose booking no
        // longer exists — no redirect, because there is nowhere to send them
        // and a destination would disclose that the token resolved.
        return jsonError(COPY.booking.apiInvalidRequest, 'NOT_FOUND', 404);
    }
  } catch (error) {
    // Never rethrown into a route error boundary, which would replace the page
    // and lose the client's way back. The context carries an operation and an
    // error name — never the token.
    logger.error(
      'Client cancellation request failed',
      toErrorLogContext('POST /api/bookings/cancel', error)
    );
    return jsonError(COPY.booking.apiInvalidRequest, 'INTERNAL_ERROR', 500);
  }
}
