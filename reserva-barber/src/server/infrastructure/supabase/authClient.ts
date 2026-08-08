import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/server/infrastructure/logger';
import { isSupabaseAuthCookie } from '@/server/application/auth/sessionCookies';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/**
 * Next.js throws this when a Server Component tries to write cookies. It is the
 * one failure here that is expected and harmless.
 */
function isReadOnlyCookieStoreError(error: unknown): boolean {
  return error instanceof Error && /cookies can only be modified|read-?only/i.test(error.message);
}

/**
 * Supabase client for Server Components / Server Actions, using only the
 * `@supabase/ssr` cookie-adapter API (no Node-specific imports) so it runs
 * unchanged on the Cloudflare `workerd` runtime.
 *
 * `setAll` is a no-op-safe best-effort: Server Components cannot write
 * cookies. Session refresh happens in `middleware.ts`, which can.
 */
export async function createSupabaseServerClient(): Promise<SupabaseClient> {
  const cookieStore = await cookies();

  return createServerClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_ANON_KEY'), {
    // @supabase/ssr defaults to httpOnly: false and no `secure` flag at all —
    // override both per the "Session in hardened cookies" requirement.
    cookieOptions: { httpOnly: true, secure: true, sameSite: 'lax', path: '/' },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch (error) {
          // Expected during a Server Component render, where cookies are
          // read-only — middleware refreshes the session on every request, so
          // nothing is lost. Anything else is a real failure (e.g. logout not
          // clearing cookies) and must not vanish silently.
          if (!isReadOnlyCookieStoreError(error)) {
            logger.error('Failed to write session cookies', {
              operation: 'setAll',
              cause: error instanceof Error ? error.message : String(error),
            });
          }
        }
      },
    },
  });
}

/**
 * Deletes the session cookies directly. Used as the logout fallback: the
 * provider rejects `signOut` once the access token has expired, and the owner
 * must still end up signed out rather than stranded on an error screen.
 */
export async function clearSessionCookies(): Promise<void> {
  const cookieStore = await cookies();
  for (const cookie of cookieStore.getAll()) {
    if (isSupabaseAuthCookie(cookie.name)) {
      cookieStore.delete(cookie.name);
    }
  }
}
