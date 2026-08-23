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

/**
 * The payment round trip's own outcome codes (B5).
 *
 * A separate set from `BOOKING_OUTCOMES` rather than more members on it. The
 * booking codes are read by the wizard's steps and these are read by the
 * confirmation page; one union would let a step render a payment message it has
 * no state for, and a page render a validation message about a form it does not
 * contain. Two sets, two `parse` functions, and neither can answer the other's
 * question.
 */
export const PAYMENT_OUTCOMES = [
  /** Returned from the gateway; the notification has not been processed yet. */
  'pago-pendiente',
  /** The gateway reported the payment as rejected. The hold may still be live. */
  'pago-rechazado',
  /** The booking is no longer payable — already confirmed, cancelled or expired. */
  'no-pagable',
  /** The hold lapsed before the payment was started. */
  'vencido',
  /** This shop has not configured Mercado Pago. */
  'sin-mercadopago',
  /**
   * The shop's stored credential exists but cannot be used — unreadable, or
   * rejected by Mercado Pago. Deliberately ONE code for both: the client's
   * situation is identical and neither cause is theirs to act on, so splitting
   * it would only leak which of the owner's problems it is.
   */
  'pagos-no-disponibles',
  /** Mercado Pago was unreachable. The only code that invites an immediate retry. */
  'reintenta',
  /** The return landed with no cookie, so the booking could not be identified. */
  'link-propio',

  // ---------------------------------------------------------------- B6
  //
  // The transfer path's codes. On the same union as the Mercado Pago ones, and
  // deliberately so: both are read by the confirmation page, which is one page
  // with one state resolver. The split that matters is the one B5 drew —
  // between the wizard's codes and this page's — and it still holds.

  /** The client committed to transfer; the destination is now disclosed. */
  'transferencia-iniciada',
  /** The receipt was accepted and is waiting for the owner. */
  'comprobante-recibido',
  /** The file was not a JPG, PNG or PDF, decided by its bytes. */
  'comprobante-invalido',
  /** The file exceeded the size ceiling. */
  'comprobante-grande',
  /** The per-booking submission cap was reached. */
  'demasiados-comprobantes',
  /** This shop has no usable transfer destination. */
  'sin-transferencia',
  /**
   * A Mercado Pago checkout is already live for this booking.
   *
   * Its own code rather than a generic failure: the client can act on it — by
   * finishing that checkout — and a message that did not say so would leave
   * them tapping a control that will never work.
   */
  'metodo-en-curso',
  /**
   * The hold lapsed and the slot was taken while the client was at their bank.
   *
   * Distinct from `vencido`, which means the turn expired with nothing paid.
   * This one may mean money has moved and nobody here knows it, so it is the
   * one message on this page that owes an explanation rather than an
   * instruction.
   */
  'transferencia-sin-lugar',
] as const;

export type PaymentOutcomeCode = (typeof PAYMENT_OUTCOMES)[number];

export function parsePaymentOutcomeCode(
  raw: string | string[] | undefined
): PaymentOutcomeCode | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return PAYMENT_OUTCOMES.includes(value as PaymentOutcomeCode)
    ? (value as PaymentOutcomeCode)
    : null;
}

/**
 * Carries the cancellation token across the trip to Mercado Pago and back
 * (design D11).
 *
 * The gateway is never told the confirmation page's address, because that
 * address **is** a credential. So the token waits here instead: httpOnly, so no
 * script can read it; `SameSite=Lax`, which is both required and sufficient
 * because the return from Mercado Pago is a top-level cross-site **GET**
 * navigation — `Strict` would drop it and the client would land nowhere;
 * scoped to `/b`, so it never accompanies a dashboard or API request.
 *
 * This is B4's echo-cookie mechanism, reused rather than reinvented.
 */
export const PAYMENT_RETURN_COOKIE = 'rb_payment_return';

/**
 * Comfortably past the 15-minute hold, because a checkout can outlive it and a
 * client who paid late must still land on their own page to be told what
 * happened. Short enough that a shared device does not carry it into another
 * session.
 */
export const PAYMENT_RETURN_MAX_AGE_SECONDS = 3600;
