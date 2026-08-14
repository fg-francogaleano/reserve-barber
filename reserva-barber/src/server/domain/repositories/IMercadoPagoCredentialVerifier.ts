/**
 * Asks Mercado Pago whether a submitted access token is real (design D5).
 *
 * Offline checks catch a *malformed* token. They cannot catch one that is
 * well-formed but revoked, expired, or belonging to a different account — and
 * that last case routes clients' deposits to a stranger. PC1 met the same
 * hazard in the alias namespace and had no authority to ask. This is the
 * authority.
 *
 * Behind an interface so it can be stubbed in every test and removed without
 * restructuring anything: it is the only outbound third-party call in the
 * project, and the story must not become impossible to test because of it.
 */

/**
 * Who the credentials belong to, as far as Mercado Pago will say.
 *
 * `accountId` is **not** filled from this call — it is recovered from the token
 * offline (design D6a) and merged in above, so the confirmation still names an
 * account when Mercado Pago is unreachable. What this type carries is the part
 * only Mercado Pago knows.
 */
export interface MercadoPagoAccount {
  /** A nickname or email — something the owner recognizes at a glance. */
  displayName: string | null;
}

export type VerificationOutcome =
  /** The token authenticated. `account` may still be empty: see D5's two jobs. */
  | { status: 'verified'; account: MercadoPagoAccount }
  /**
   * Mercado Pago answered, and the answer is no. **Blocks the write** — the
   * owner's input is wrong, and storing it leaves a payment method that fails
   * when a client tries to pay.
   */
  | { status: 'rejected' }
  /**
   * Unreachable, failing, or too slow. **Does not block the write** — refusing
   * to save because a third party is down would be this feature failing for a
   * reason unrelated to the owner's input.
   */
  | { status: 'unavailable' };

export interface IMercadoPagoCredentialVerifier {
  /**
   * Never throws for an expected condition: every outcome above is a value the
   * caller must branch on, and an exception would make "rejected" and
   * "unavailable" easy to conflate at the catch site — which is exactly the
   * distinction the failure policy turns on.
   *
   * Implementations MUST bound the call with an explicit timeout. Without one,
   * an unresponsive Mercado Pago leaves the request pending until the platform
   * terminates it, the owner submits again, and two writes race.
   *
   * Implementations MUST NOT retry. A settings save is not the place to amplify
   * load against a struggling third party, and the owner can retry themselves.
   */
  verify(accessToken: string): Promise<VerificationOutcome>;
}
