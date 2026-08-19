import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { logger } from '@/server/infrastructure/logger';
import {
  decideGuardAction,
  isBookingConfirmationRoute,
} from '@/server/application/auth/routeGuard';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/**
 * Refreshes the Supabase session and guards every route (design D3/D9):
 * unauthenticated requests to protected routes redirect to `/login` carrying
 * a `next` param; authenticated requests to `/login` redirect to the
 * dashboard home. Session refresh happens here — not in pages — so
 * refreshed cookies are set before the response streams.
 */
export async function middleware(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_ANON_KEY'), {
    // @supabase/ssr defaults to httpOnly: false and no `secure` flag at all —
    // override both per the "Session in hardened cookies" requirement.
    cookieOptions: { httpOnly: true, secure: true, sameSite: 'lax', path: '/' },
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  let user: { id: string } | null;
  try {
    const result = await supabase.auth.getUser();
    user = result.data.user;
  } catch (error) {
    // A stale/invalid refresh token cookie throws instead of resolving —
    // fail closed (treat as unauthenticated), never crash the request.
    logger.error('Failed to resolve auth session', {
      operation: 'middleware',
      cause: error instanceof Error ? error.message : String(error),
    });
    user = null;
  }

  const action = decideGuardAction({
    hasSession: user !== null,
    pathname: request.nextUrl.pathname,
    search: request.nextUrl.search,
    // Next.js marks Server Action requests with this header. They must not be
    // answered with a redirect — see decideGuardAction.
    isServerAction: request.headers.has('next-action'),
  });

  if (action.type === 'redirect') {
    return NextResponse.redirect(new URL(action.to, request.url), 307);
  }

  if (action.type === 'reject') {
    // Answered here rather than by the router: the path cannot be decoded, and
    // letting it reach Next produces a 500 rather than a 404 (see
    // `isDecodable`). No body — there is no page to render for a path that
    // cannot be parsed.
    return new NextResponse(null, { status: 404 });
  }

  // The hold-confirmation URL carries the booking's cancellation token (B4
  // design D10). Set here rather than in the page because it must cover every
  // response under that path — including the ones the page never renders — and
  // because B5 will redirect away from it to an external payment provider,
  // which is the navigation that would otherwise leak the token in `Referer`.
  if (isBookingConfirmationRoute(request.nextUrl.pathname)) {
    response.headers.set('Referrer-Policy', 'no-referrer');
  }

  return response;
}

// Verified to reach `/b`, `/b/{slug}`, `/b/{slug}/reservar` and, as of B4,
// `/api/bookings` — none of them match the image-extension or `_next`
// exclusions below, so the public paths opened in `decideGuardAction`
// (`PUBLIC_PROFILE_ROOT`, `PUBLIC_BOOKING_API`) are actually evaluated here
// rather than bypassing the middleware entirely.
//
// The image-extension exclusion does skip a path like `/b/foto.webp`, and that
// is harmless twice over: a valid slug can never contain a dot (it matches
// `^[a-z0-9]+(-[a-z0-9]+)*$`), so such a path is never a profile; and since
// `/b/**` is public, a request that bypasses this middleware reaches the route
// tree and gets the same 404 it would have got anyway. `/api/bookings` carries
// no extension and is unaffected by that exclusion.
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
