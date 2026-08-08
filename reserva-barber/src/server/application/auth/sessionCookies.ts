/**
 * Identifies the cookies `@supabase/ssr` uses to persist a session, including
 * the numbered chunks it splits large sessions into.
 *
 * Logout clears these directly as a fallback: the provider rejects `signOut`
 * once the access token has expired (403 `bad_jwt`), and the owner must end up
 * signed out regardless of what the provider says.
 */
export function isSupabaseAuthCookie(name: string): boolean {
  return /^sb-.+-auth-token(\.\d+|-code-verifier)?$/.test(name);
}
