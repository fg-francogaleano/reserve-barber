import { describe, it, expect } from 'vitest';
import { isSupabaseAuthCookie } from './sessionCookies';

describe('isSupabaseAuthCookie', () => {
  it('should_match_the_session_cookie', () => {
    expect(isSupabaseAuthCookie('sb-wosyrupjjswipckrsjzh-auth-token')).toBe(true);
  });

  it('should_match_chunked_session_cookies', () => {
    // @supabase/ssr splits large sessions across `.0`, `.1`, ... — missing a
    // chunk would leave a partial session behind on logout
    expect(isSupabaseAuthCookie('sb-wosyrupjjswipckrsjzh-auth-token.0')).toBe(true);
    expect(isSupabaseAuthCookie('sb-wosyrupjjswipckrsjzh-auth-token.1')).toBe(true);
  });

  it('should_match_the_code_verifier_cookie', () => {
    expect(isSupabaseAuthCookie('sb-wosyrupjjswipckrsjzh-auth-token-code-verifier')).toBe(true);
  });

  it('should_not_match_unrelated_cookies', () => {
    expect(isSupabaseAuthCookie('theme')).toBe(false);
    expect(isSupabaseAuthCookie('sb-something-else')).toBe(false);
    expect(isSupabaseAuthCookie('auth-token')).toBe(false);
    expect(isSupabaseAuthCookie('')).toBe(false);
  });
});
