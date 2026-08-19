import type { BookingFieldErrors } from './bookingRequestSchema';

/**
 * How the booking write reports itself back to the flow (B4 design D8).
 *
 * The handler answers a browser submission with `303` and one of these codes
 * in the query string; the page renders the message from the server. That is
 * what makes the no-JavaScript promise hold here — client action state does
 * not survive a no-script POST, and this flow has no Server Action anyway.
 *
 * Each code is a distinct rendered state. None of them names a cause the
 * client cannot act on: a slot taken by a booking, by a new absence and by a
 * narrowed schedule are one outcome, because the client's next move is the
 * same in all three.
 */
export const BOOKING_OUTCOME_PARAM = 'estado';

export const BOOKING_OUTCOMES = [
  'datos',
  'horario',
  'sin-pagos',
  /** The per-client hold cap: several turns already waiting to be paid. */
  'demasiados',
  /** The per-origin throttle: going too fast. A different fact, so a different code. */
  'espera',
  'error',
] as const;

export type BookingOutcomeCode = (typeof BOOKING_OUTCOMES)[number];

export function parseOutcomeCode(raw: string | string[] | undefined): BookingOutcomeCode | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return BOOKING_OUTCOMES.includes(value as BookingOutcomeCode)
    ? (value as BookingOutcomeCode)
    : null;
}

/**
 * The rejected submission, carried back in a **single-use httpOnly cookie**
 * rather than in the redirect URL.
 *
 * The specification requires that a rejection preserve what the client typed,
 * and it also requires that their name, email and phone never reach a log. A
 * `303` carrying them as query parameters would satisfy the first and break
 * the second: query strings land in browser history, in access logs, and in
 * the `Referer` header of the next request. So the codes travel in the URL,
 * where they are safe and where a server render can read them, and the values
 * travel in a cookie that is unreadable to script, scoped to this flow, and
 * short-lived.
 */
export const BOOKING_ECHO_COOKIE = 'rb_booking_echo';

/** Long enough to retype three fields, short enough not to outlive the attempt. */
export const BOOKING_ECHO_MAX_AGE_SECONDS = 600;

export interface BookingEcho {
  readonly fieldErrors: BookingFieldErrors;
  readonly submitted: { name?: string; email?: string; phone?: string };
}

/**
 * Bound on the stored value. Three fields at their own maxima plus the error
 * codes fit well inside it; anything larger is not a submission this flow
 * produced and is discarded rather than parsed.
 */
const MAX_ECHO_LENGTH = 2_000;

export function serializeEcho(echo: BookingEcho): string {
  return encodeURIComponent(JSON.stringify(echo));
}

/**
 * Reads the echo cookie back, defensively.
 *
 * A cookie is client-controlled, so nothing here trusts its shape: a value
 * that is oversized, is not JSON, or does not carry the two expected objects
 * yields `null` and the form renders empty. The worst case of a malformed
 * cookie is a client retyping three fields — never a thrown error on a public
 * page.
 */
export function parseEcho(raw: string | undefined): BookingEcho | null {
  if (raw === undefined || raw.length === 0 || raw.length > MAX_ECHO_LENGTH) return null;

  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(raw));
    if (typeof parsed !== 'object' || parsed === null) return null;

    const { fieldErrors, submitted } = parsed as Partial<BookingEcho>;
    if (typeof fieldErrors !== 'object' || fieldErrors === null) return null;
    if (typeof submitted !== 'object' || submitted === null) return null;

    return {
      fieldErrors: {
        ...(typeof fieldErrors.name === 'string' && { name: fieldErrors.name }),
        ...(typeof fieldErrors.email === 'string' && { email: fieldErrors.email }),
        ...(typeof fieldErrors.phone === 'string' && { phone: fieldErrors.phone }),
      } as BookingFieldErrors,
      submitted: {
        ...(typeof submitted.name === 'string' && { name: submitted.name }),
        ...(typeof submitted.email === 'string' && { email: submitted.email }),
        ...(typeof submitted.phone === 'string' && { phone: submitted.phone }),
      },
    };
  } catch {
    return null;
  }
}
