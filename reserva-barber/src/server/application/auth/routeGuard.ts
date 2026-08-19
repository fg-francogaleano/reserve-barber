export const LOGIN_PATH = '/login';
export const DASHBOARD_HOME = '/';

/**
 * The public booking namespace: the profile page (B1) and, later, the booking
 * wizard beneath it. Everything under here is served to guests with no session.
 */
export const PUBLIC_PROFILE_ROOT = '/b';

/**
 * The public booking write (B4). An anonymous guest must be able to POST a
 * provisional booking, and `decideGuardAction` is deny-by-default — without
 * this entry an anonymous POST here is answered `307` to `/login`, breaking
 * the flow for every guest with no symptom an authenticated owner would ever
 * see.
 *
 * **This is an EXACT path match, checked with `===`, never a prefix.**
 * Opening `/api` as a prefix would admit every future endpoint the moment it
 * is created — the dashboard's own included — which is precisely the failure
 * deny-by-default exists to prevent. B5's Mercado Pago webhook needs its own
 * exact entry when it arrives; it does not inherit this one.
 */
export const PUBLIC_BOOKING_API = '/api/bookings';

/**
 * The hold-confirmation namespace: `/b/{slug}/reserva/{cancellationToken}`.
 *
 * Already public by virtue of `/b/**`. It is named separately because its URL
 * **contains a credential**, and every response under it must carry
 * `Referrer-Policy: no-referrer` (B4 design D10). Without it, B5's redirect
 * from this flow to Mercado Pago would hand a third party the token in the
 * `Referer` header — a leak nobody would think to look for, in a header
 * nobody reads.
 */
export function isBookingConfirmationRoute(pathname: string): boolean {
  return /^\/b\/[^/]+\/reserva\/[^/]+\/?$/.test(pathname);
}

export interface GuardRequest {
  hasSession: boolean;
  pathname: string;
  search: string;
  /** True for Server Action requests, which carry a `Next-Action` header. */
  isServerAction?: boolean;
}

export type GuardAction =
  | { type: 'continue' }
  | { type: 'redirect'; to: string }
  /** Answer immediately with 404. The path is not addressable by this app. */
  | { type: 'reject' };

/**
 * True for the public booking namespace and nothing else.
 *
 * **The segment separator is the boundary, not the character.** A bare
 * `pathname.startsWith(PUBLIC_PROFILE_ROOT)` would also match `/barberos`,
 * `/barberos/{id}/horarios`, `/barberos/{id}/ausencias` and
 * `/barberos/{id}/servicios` — every barber, schedule and absence in the
 * business, readable by anyone. That failure has no symptom: the pages would
 * simply render. It is the one defect in this file a browser check cannot
 * catch, which is why `routeGuard.test.ts` names those paths explicitly.
 */
function isPublicProfileRoute(pathname: string): boolean {
  return pathname === PUBLIC_PROFILE_ROOT || pathname.startsWith(`${PUBLIC_PROFILE_ROOT}/`);
}

/**
 * Whether the path can be percent-decoded at all.
 *
 * **Measured, not anticipated.** `/b/barberia%` returned a **500** on the
 * deployment runtime. The application decodes defensively and answers
 * `notFound()`, but Next decodes the path again further down its own stack and
 * raises a `URIError` where nothing catches it. The middleware is the only
 * layer that runs before that, so a path this malformed has to be refused here
 * or not at all.
 *
 * A stray `%` in a URL is not a slug anyone was given; it is someone probing.
 * Answering 404 is both correct and cheaper than a 500 — which would otherwise
 * be a one-character way to generate error-rate noise on a public page.
 */
function isDecodable(pathname: string): boolean {
  try {
    decodeURIComponent(pathname);
    return true;
  } catch {
    return false;
  }
}

/**
 * Decides what the route guard should do, isolated from Next.js so the policy
 * is directly testable (design D3). Deny-by-default: a route requires a session
 * unless it appears in the small set permitted here, so a new route is
 * protected the moment it exists rather than when someone remembers to add it
 * to a list.
 *
 * That set holds exactly three entries:
 *
 * 1. **`/login`** — the page an unauthenticated owner is sent to.
 * 2. **`/b/**`** — the public booking namespace (B1 design D1). It is served to
 *    guests, so no session is required and an authenticated owner is NOT sent
 *    away from it: the owner checks their own public page by opening it.
 * 3. **`/api/bookings`** (B4 design D1/D2) — the public booking write, an
 *    **exact** match rather than a prefix. See `PUBLIC_BOOKING_API`.
 *
 * Permitting a path here does not make any dashboard page, layout or server
 * action reachable through it. `/b/**` is its own route tree outside the
 * `(dashboard)` group, the booking write authenticates nobody and authorizes
 * nothing by session, and layers 2 and 3 of the guard are untouched.
 *
 * Server Actions are a third exception, and not for convenience: an action POST
 * expects an encoded action result, so answering it with a redirect to an HTML
 * page breaks the client ("An unexpected response was received from the
 * server") and leaves the user stuck until they reload. Actions are instead
 * guarded from the inside by `requireOwner()`, whose `redirect()` Next.js
 * encodes in a form the client can follow — layer 3 of the guard doing exactly
 * the job it exists for.
 */
export function decideGuardAction({
  hasSession,
  pathname,
  search,
  isServerAction = false,
}: GuardRequest): GuardAction {
  // Before everything, including the Server Action exemption: a path that
  // cannot be decoded is not a route of this application, so there is nothing
  // for any later rule to be right about.
  if (!isDecodable(pathname)) {
    return { type: 'reject' };
  }

  if (isServerAction) {
    return { type: 'continue' };
  }

  if (isPublicProfileRoute(pathname) || pathname === PUBLIC_BOOKING_API) {
    return { type: 'continue' };
  }

  const isLoginRoute = pathname === LOGIN_PATH;

  if (!hasSession && !isLoginRoute) {
    const next = encodeURIComponent(`${pathname}${search}`);
    return { type: 'redirect', to: `${LOGIN_PATH}?next=${next}` };
  }

  if (hasSession && isLoginRoute) {
    return { type: 'redirect', to: DASHBOARD_HOME };
  }

  return { type: 'continue' };
}
