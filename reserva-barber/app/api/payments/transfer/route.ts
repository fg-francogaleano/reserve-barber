import { NextResponse, type NextRequest } from 'next/server';
import {
  BOOKING_OUTCOME_PARAM,
  type PaymentOutcomeCode,
} from '@/server/application/booking/bookingOutcome';
import { BookingThrottle } from '@/server/application/booking/bookingThrottle';
import { MAX_RECEIPT_BYTES } from '@/server/domain/models/receiptFileType';
import { transferPaymentService } from './transferPaymentService';
import { COPY } from '@/lib/copy';
import { logger } from '@/server/infrastructure/logger';
import { toErrorLogContext } from '@/server/infrastructure/errorLogContext';

/**
 * The public bank transfer endpoint: committing to the method, and submitting
 * the proof.
 *
 * **One fixed path with two intents, and both properties are load-bearing.**
 * `decideGuardAction` admits public API paths by exact string equality, so an
 * identifier in the URL could only be permitted by teaching a deny-by-default
 * guard to match patterns — in the one place where a loose match is most
 * expensive. The cancellation token travels in the body, which also keeps a
 * live credential out of access logs and `Referer` headers. Two intents rather
 * than two paths, because each new path is another entry that guard has to be
 * told about by name.
 *
 * A Route Handler rather than a Server Action, per `backend-standards.md`: a
 * Server Action is addressed by a build-time id, and a guest halfway through
 * paying a deposit is exactly the person who must never meet a dead action.
 */
export const dynamic = 'force-dynamic';

/**
 * Per-isolate, best-effort, and shared in shape with the booking write. The
 * database-checked bound that actually holds here is `uploadCount` against
 * `MAX_RECEIPT_UPLOADS_PER_BOOKING` (`tech-debt.md` T55).
 */
const throttle = new BookingThrottle();

/** Generous, like every other bound on a stranger-supplied value in this flow. */
const MAX_TOKEN_LENGTH = 128;

/**
 * The ceiling the route refuses at, before the body is read.
 *
 * A multipart body is buffered in an isolate with a hard memory bound, so this
 * is a memory guard rather than a formality — and it is why it consults
 * `Content-Length` rather than waiting to measure the bytes. The header is
 * client-controlled, so the real length is re-checked afterwards; a request can
 * lie about being small but it cannot lie about what it delivers.
 *
 * The allowance above the file ceiling covers multipart framing: boundaries,
 * headers and the other fields travel in the same body.
 */
const MAX_BODY_BYTES = MAX_RECEIPT_BYTES + 64 * 1024;

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
 * Back to the client's own confirmation page with a code.
 *
 * `303` rather than `302`: it converts the follow-up into a `GET`, so a reload
 * or a back-navigation never re-issues the `POST` — which on this endpoint
 * would mean re-uploading a file.
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

function asToken(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_TOKEN_LENGTH
    ? value
    : null;
}

/** Whether the declared body size is already past what we will accept. */
function declaredBodyTooLarge(request: NextRequest): boolean {
  const declared = Number(request.headers.get('content-length'));
  return Number.isFinite(declared) && declared > MAX_BODY_BYTES;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const origin = originOf(request);

  // **Before the body is read.** Everything below buffers megabytes into an
  // isolate with a 128 MB bound; this is the only check that runs while that is
  // still cheap to avoid.
  if (declaredBodyTooLarge(request)) {
    return jsonError(COPY.booking.receiptTooLarge, 'PAYLOAD_TOO_LARGE', 413);
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

  const receipt = form.get('receipt');
  const isSubmission = receipt !== null && typeof receipt !== 'string';

  try {
    return isSubmission
      ? await handleSubmission(request, token, receipt)
      : await handleCommit(request, token);
  } catch (error) {
    // Never rethrown into a route error boundary, which would replace the page
    // and lose the client's way back. The context carries an operation and an
    // error name — never the token, never a filename, never a destination.
    logger.error(
      'Bank transfer request failed',
      toErrorLogContext('POST /api/payments/transfer', error)
    );
    return jsonError(COPY.booking.apiInvalidRequest, 'INTERNAL_ERROR', 500);
  }
}

/** Intent one: commit to transfer, which extends the hold and unlocks the CBU. */
async function handleCommit(request: NextRequest, token: string): Promise<NextResponse> {
  const result = await transferPaymentService().commit(token);

  switch (result.outcome) {
    // Both endings render the destination, because both mean a live committed
    // transfer exists. A double-tap must be invisible to the person who made it.
    case 'committed':
    case 'alreadyCommitted':
      return backToBooking(request, result.slug, token, 'transferencia-iniciada');

    // A token matching nothing is a 404 that discloses nothing about whether it
    // ever existed — the same answer the confirmation page gives.
    case 'notFound':
      return jsonError(COPY.booking.apiInvalidRequest, 'NOT_FOUND', 404);

    case 'notPayable':
      return backToBooking(request, result.slug, token, 'no-pagable');

    case 'holdExpired':
      return backToBooking(request, result.slug, token, 'vencido');

    case 'notConfigured':
      return backToBooking(request, result.slug, token, 'sin-transferencia');

    // Its own code rather than a generic failure: the client can act on this,
    // by finishing the checkout they already opened.
    case 'mercadoPagoInFlight':
      return backToBooking(request, result.slug, token, 'metodo-en-curso');
  }
}

/** Intent two: the proof itself. */
async function handleSubmission(
  request: NextRequest,
  token: string,
  receipt: File
): Promise<NextResponse> {
  // The real length, after the header's claim. A request can declare itself
  // small and deliver otherwise.
  if (receipt.size > MAX_RECEIPT_BYTES) {
    return jsonError(COPY.booking.receiptTooLarge, 'PAYLOAD_TOO_LARGE', 413);
  }

  const bytes = new Uint8Array(await receipt.arrayBuffer());

  // The declared type and `receipt.name` are read nowhere. Both are
  // client-controlled: the first proves nothing about the bytes, and the second
  // is a traversal primitive if it ever reaches a storage key.
  const result = await transferPaymentService().submitReceipt({
    cancellationToken: token,
    bytes,
  });

  switch (result.outcome) {
    case 'received':
      return backToBooking(request, result.slug, token, 'comprobante-recibido');

    case 'notFound':
      return jsonError(COPY.booking.apiInvalidRequest, 'NOT_FOUND', 404);

    case 'notPayable':
      return backToBooking(request, result.slug, token, 'no-pagable');

    // No committed transfer, so no destination was ever shown and this file
    // cannot be proof of anything. Back to the page, which offers the methods.
    case 'notCommitted':
      return backToBooking(request, result.slug, token, 'no-pagable');

    case 'slotLost':
      return backToBooking(request, result.slug, token, 'transferencia-sin-lugar');

    case 'invalidFile':
      return backToBooking(request, result.slug, token, 'comprobante-invalido');

    case 'fileTooLarge':
      return backToBooking(request, result.slug, token, 'comprobante-grande');

    case 'tooManyAttempts':
      return backToBooking(request, result.slug, token, 'demasiados-comprobantes');
  }
}
