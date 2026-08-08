import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { logger } from '@/server/infrastructure/logger';
import { decideGuardAction } from '@/server/application/auth/routeGuard';

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

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
