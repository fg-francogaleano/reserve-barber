import { createClient, type SupabaseClient } from '@supabase/supabase-js';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/**
 * A Supabase client with **no session at all**, for the one caller in this
 * product that has none: the booking guest uploading a transfer receipt.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS IS FOR, AND WHAT IT MUST NEVER BE USED FOR
 * ---------------------------------------------------------------------------
 *
 * Every other Supabase call in this application runs as the **owner's own
 * session** (`authClient.ts`), and that is what makes P1's storage guarantee a
 * property of the database rather than a promise of the code: the bucket policy
 * compares the object key's leading segment against `auth.uid()`.
 *
 * A booking guest has no `auth.uid()`. This client therefore speaks as the
 * `anon` role, and the confinement that `auth.uid()` used to provide is
 * re-derived by `public.storage_can_accept_receipt()` — a `SECURITY DEFINER`
 * predicate that resolves the key against the booking tables and admits the
 * insert only where it names a real booking, in a live hold, under its real
 * owner (design D1).
 *
 * **Never reach for this to do something the owner's session should do.** It
 * carries no user identity, so nothing it does can be scoped by one, and every
 * row-level policy it meets must therefore be written to defend against an
 * anonymous caller. It exists for exactly one bucket insert. Reading receipts,
 * signing URLs and deleting objects all run as the owner and belong in
 * `authClient.ts`.
 *
 * **It is not the service role.** That key bypasses row-level security across
 * the entire database and is forbidden in the application environment by
 * `.env.example` and `scripts/provision-owner.ts`. This introduces no new
 * secret: `SUPABASE_ANON_KEY` is already present and already server-only.
 * **Do not add a `NEXT_PUBLIC_` alias for it** — the anonymous role's insert
 * grant on the receipts bucket is bounded by the predicate above, but publishing
 * the key is still a change in exposure that this design did not price.
 *
 * Session persistence is disabled explicitly. The defaults would have this
 * client try to store and refresh a session it will never have, on a runtime
 * with no browser storage.
 */
export function createSupabaseAnonClient(): SupabaseClient {
  return createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_ANON_KEY'), {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
