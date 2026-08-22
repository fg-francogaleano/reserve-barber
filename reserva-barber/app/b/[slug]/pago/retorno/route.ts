import { NextResponse, type NextRequest } from 'next/server';
import {
  PAYMENT_RETURN_COOKIE,
  BOOKING_OUTCOME_PARAM,
  type PaymentOutcomeCode,
} from '@/server/application/booking/bookingOutcome';

/**
 * Where Mercado Pago sends the client back to.
 *
 * **This route exists so that the gateway never learns the confirmation page's
 * address** (design D11). That page is addressed by the cancellation token, so
 * naming it in `back_urls` would store a live credential in Mercado Pago's
 * preference data and dashboard — the same exposure that keeps the token out of
 * `external_reference`, and that B4's `Referrer-Policy: no-referrer` on the
 * confirmation route prevents through the other channel.
 *
 * So the token travels in an httpOnly cookie set when the payment was
 * initiated, and this route reads it back and forwards.
 *
 * **What this route must never do**, and the reason is the whole design: the
 * return URL arrives carrying Mercado Pago's own `external_reference`, which is
 * the booking id. Resolving a booking from it would be easy, would fix the
 * missing-cookie case, and would make the notification `ref` **authorize
 * something** — when the entire safety argument for `ref` being an ordinary
 * query parameter is that it authorizes nothing. A client without their cookie
 * is sent to the shop's page instead. That is the accepted cost, named in D11.
 *
 * A `GET`, because a browser returning from an external site issues one.
 */
export const dynamic = 'force-dynamic';

/**
 * Mercado Pago's `status` parameter, mapped to what the page should say.
 *
 * It is a **hint about what to render**, never evidence: only the webhook, in
 * possession of a re-fetched payment, changes a booking's state. `approved`
 * deliberately maps to the pending message rather than to a success one — the
 * notification may not have arrived yet, and the page reads live state to
 * decide. Claiming success from a query parameter anyone can type is exactly
 * the mistake this flow is built to avoid.
 */
function outcomeFor(status: string | null): PaymentOutcomeCode {
  switch (status) {
    case 'rejected':
    case 'failure':
      return 'pago-rechazado';
    default:
      return 'pago-pendiente';
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { slug } = { slug: slugOf(request.nextUrl.pathname) };

  const token = request.cookies.get(PAYMENT_RETURN_COOKIE)?.value ?? null;

  // No cookie: a different browser, a cleared jar, or a lifetime that ran out.
  // The booking is NOT resolved from the reference Mercado Pago appended —
  // see the note above. They are sent to the shop with a message pointing them
  // at the link they already hold.
  if (token === null || token.length === 0 || token.length > 128) {
    const url = new URL(`/b/${slug}`, request.url);
    url.searchParams.set(BOOKING_OUTCOME_PARAM, 'link-propio' satisfies PaymentOutcomeCode);
    return NextResponse.redirect(url, 303);
  }

  const url = new URL(`/b/${slug}/reserva/${token}`, request.url);
  url.searchParams.set(
    BOOKING_OUTCOME_PARAM,
    outcomeFor(request.nextUrl.searchParams.get('status'))
  );

  const response = NextResponse.redirect(url, 303);
  /**
   * Single use. A stale one would forward a later visitor — on a shared
   * device, a different person — to somebody else's booking, which shows that
   * client's name and appointment and offers to pay their deposit.
   *
   * **The path is required, and omitting it is a silent no-op.** A cookie is
   * identified by name *and* path: this one is set with `path=/b`, so a delete
   * at the default `/` emits a `Set-Cookie` the browser matches against
   * nothing and the original survives its full hour. Measured against the
   * preview — the clear went out as `Path=/` while the cookie lived at `/b`.
   * No unit test would have caught it, because none of them model cookie path
   * semantics; it took reading the actual response header.
   */
  response.cookies.delete({ name: PAYMENT_RETURN_COOKIE, path: '/b' });
  return response;
}

/**
 * The slug from this route's own path.
 *
 * Read from the pathname rather than from a query parameter, so nothing the
 * gateway appends can steer where the client is sent. The shape is fixed by the
 * route's own file location: `/b/{slug}/pago/retorno`.
 */
function slugOf(pathname: string): string {
  return pathname.split('/')[2] ?? '';
}
