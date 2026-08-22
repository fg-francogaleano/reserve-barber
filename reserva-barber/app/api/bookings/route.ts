import { NextResponse, type NextRequest } from 'next/server';
import { parseBookingRequest } from '@/server/application/booking/bookingRequestSchema';
import {
  BOOKING_ECHO_COOKIE,
  BOOKING_ECHO_MAX_AGE_SECONDS,
  BOOKING_OUTCOME_PARAM,
  serializeEcho,
  type BookingOutcomeCode,
} from '@/server/application/booking/bookingOutcome';
import { bookingStepHref } from '@/server/application/booking/bookingSelectionParams';
import { BookingThrottle } from '@/server/application/booking/bookingThrottle';
import { bookingCreationService } from './bookingCreationService';
import { COPY } from '@/lib/copy';
import { logger } from '@/server/infrastructure/logger';
import { toErrorLogContext } from '@/server/infrastructure/errorLogContext';

/**
 * The public booking write.
 *
 * **A Route Handler, and that is a hard rule** (`backend-standards.md`): a
 * Server Action is addressed by an id derived from a build-time key, so a
 * rotated key or a renamed action leaves every open tab calling an id the
 * server no longer knows — and a guest halfway through paying a deposit is
 * exactly the person who must never meet that dead end. This URL never
 * changes.
 *
 * The path is named explicitly in the route guard's public set
 * (`PUBLIC_BOOKING_API`). Without that entry the deny-by-default guard answers
 * `307` to `/login` for every guest, and nothing an owner does while signed in
 * would ever reveal it.
 */
export const dynamic = 'force-dynamic';

/**
 * Per-isolate, best-effort (design D9). The database-checked hold cap in
 * `BookingCreationService` is the bound that actually holds; this one blunts a
 * naive loop and is documented in `tech-debt.md` as not defeating a
 * distributed one.
 */
const throttle = new BookingThrottle();

/**
 * The client's origin, as well as this runtime can tell.
 *
 * `CF-Connecting-IP` is set by Cloudflare and is the trustworthy one here
 * because every request reaches the Worker through it. The fallbacks exist for
 * local development only, and a request with no recognizable origin is grouped
 * under one key rather than exempted — an unattributable request must not be
 * the way past the limit.
 */
function originOf(request: NextRequest): string {
  return (
    request.headers.get('cf-connecting-ip') ??
    request.headers.get('x-real-ip') ??
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown'
  );
}

function wantsJson(request: NextRequest): boolean {
  return request.headers.get('accept')?.includes('application/json') ?? false;
}

/** Success and error envelopes, in the shape `backend-standards.md` defines. */
function jsonError(message: string, code: string, status: number): NextResponse {
  return NextResponse.json({ success: false, error: { message, code } }, { status });
}

async function readSubmission(request: NextRequest): Promise<Record<string, unknown>> {
  const contentType = request.headers.get('content-type') ?? '';

  if (contentType.includes('application/json')) {
    const body: unknown = await request.json();
    return typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  }

  // The no-JavaScript path: a native form posts url-encoded or multipart.
  const form = await request.formData();
  return Object.fromEntries(Array.from(form.entries()).map(([key, value]) => [key, value]));
}

/**
 * Sends the client back into the flow with an outcome code.
 *
 * `303` rather than `302`: it converts the follow-up into a `GET`, so the
 * browser's own back-navigation and reload never re-issue the `POST`. Combined
 * with the idempotency rule in the transaction, that makes a repeat navigation
 * safe rather than a second booking or a false conflict.
 */
function redirectTo(request: NextRequest, path: string, code: BookingOutcomeCode): NextResponse {
  const url = new URL(path, request.url);
  url.searchParams.set(BOOKING_OUTCOME_PARAM, code);
  return NextResponse.redirect(url, 303);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const origin = originOf(request);

  // **The body is read before the throttle is consulted, deliberately.** A
  // throttled browser has to be sent back into the flow with an outcome code,
  // and the only thing that says where "back" is, is the slug inside the
  // submission. Reading a form body is negligible next to the database work
  // this endpoint otherwise does — and the throttle still short-circuits
  // before any query, which is what it exists to protect.
  let submission: Record<string, unknown>;
  try {
    submission = await readSubmission(request);
  } catch {
    return jsonError(COPY.booking.apiInvalidRequest, 'VALIDATION_ERROR', 400);
  }

  // A slug that is not a usable string leaves nowhere to send them back to, so
  // this is the one validation failure answered with a status rather than a
  // redirect into the flow.
  const slug = typeof submission.slug === 'string' ? submission.slug : null;
  if (slug === null || slug.length === 0 || slug.length > 128) {
    return jsonError(COPY.booking.apiInvalidRequest, 'VALIDATION_ERROR', 400);
  }

  // Every submission counts, not only failures: a booking flood is made of
  // requests that each succeed, which is exactly what makes it a calendar lock.
  if (throttle.isThrottled(origin)) {
    if (wantsJson(request)) {
      return jsonError(COPY.booking.tooManyRequests, 'TOO_MANY_REQUESTS', 429);
    }
    // A rendered state, like every other outcome. Answering a browser with a
    // raw JSON body would leave one of the six outcomes with no page at all.
    return redirectTo(request, bookingStepHref(slug, selectionOf(submission)), 'espera');
  }
  throttle.record(origin);

  const parsed = parseBookingRequest(submission);

  const selection = selectionOf(submission);

  const detailsStep = bookingStepHref(slug, selection);
  // A lost time sends them back to the slot step, which is the same URL with
  // the time dropped — their next action is picking another one.
  const timeStep = bookingStepHref(slug, { ...selection, time: undefined });

  if (!parsed.ok) {
    if (parsed.selectionInvalid) {
      return redirectTo(request, detailsStep, 'horario');
    }

    if (wantsJson(request)) {
      return jsonError(COPY.booking.apiValidationFailed, 'VALIDATION_ERROR', 400);
    }

    // The values travel in an httpOnly cookie, never in the query string: a
    // name, an email and a phone in a URL land in browser history, in access
    // logs and in the next request's `Referer`, and this flow's rule is that
    // contact details never reach a log.
    const response = redirectTo(request, detailsStep, 'datos');
    response.cookies.set(BOOKING_ECHO_COOKIE, serializeEcho({
      fieldErrors: parsed.fieldErrors,
      submitted: {
        name: asString(submission.name),
        email: asString(submission.email),
        phone: asString(submission.phone),
      },
    }), {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/b',
      maxAge: BOOKING_ECHO_MAX_AGE_SECONDS,
    });
    return response;
  }

  try {
    const result = await bookingCreationService().create(parsed.data);

    switch (result.outcome) {
      case 'created':
      case 'alreadyHeld': {
        // The same answer for both, which is the whole point of the
        // idempotency rule: a client who double-tapped must not be able to
        // tell that they did.
        const confirmation = `/b/${slug}/reserva/${result.booking.cancellationToken}`;
        if (wantsJson(request)) {
          return NextResponse.json({
            success: true,
            data: { redirectTo: confirmation },
            message: COPY.booking.apiBookingCreated,
          });
        }
        const response = NextResponse.redirect(new URL(confirmation, request.url), 303);
        // The echo has served its purpose; a stale one would repopulate the
        // form on a later visit with data from an attempt long finished.
        //
        // **The path is required.** This cookie is set with `path=/b`, and a
        // delete at the default `/` emits a `Set-Cookie` that matches nothing
        // — so the clear was a no-op and the echo survived its full lifetime.
        // Found in B5 while reading the preview's response headers on the
        // payment return cookie, which had the identical defect.
        response.cookies.delete({ name: BOOKING_ECHO_COOKIE, path: '/b' });
        return response;
      }

      case 'slotTaken':
        return redirectTo(request, timeStep, 'horario');

      case 'selectionStale':
        return redirectTo(request, bookingStepHref(slug), 'horario');

      case 'notPaymentReady':
        return redirectTo(request, detailsStep, 'sin-pagos');

      case 'holdLimitReached':
        return redirectTo(request, detailsStep, 'demasiados');
    }
  } catch (error) {
    // Never rethrown into the route error boundary, which would replace the
    // page and discard everything the client selected. The context carries
    // identifiers and an error name — never the submitted contact details.
    logger.error('Booking write failed', toErrorLogContext('POST /api/bookings', error));
    return redirectTo(request, detailsStep, 'error');
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= 128 ? value : undefined;
}

/**
 * The catalogue and schedule selection as href parts.
 *
 * Extracted because the throttle path needs it before validation runs — it has
 * to know where to send a browser back to — and duplicating the five reads
 * would be two places to keep in step.
 */
function selectionOf(submission: Record<string, unknown>) {
  return {
    locationId: asString(submission.locationId),
    serviceId: asString(submission.serviceId),
    barberId: asString(submission.barberId),
    date: asString(submission.fecha),
    time: asString(submission.hora),
  };
}
