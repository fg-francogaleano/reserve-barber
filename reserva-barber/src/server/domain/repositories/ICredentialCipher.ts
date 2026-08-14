/**
 * Encryption for credentials this application stores itself.
 *
 * `mpAccessToken` is the first such value in the project — every other secret
 * either belongs to Supabase Auth or is a deployment secret we never persist.
 * `data-model.md` §14 requires it encrypted at rest; this is the contract that
 * makes that true without any layer above persistence knowing it happened.
 *
 * Deliberately free of crypto imports. The algorithm lives in infrastructure;
 * the domain only knows that a plaintext goes in, an opaque envelope comes out,
 * and that both directions can fail in ways a caller must distinguish.
 */

/**
 * What a ciphertext is *for*, bound into it so one context's envelope cannot be
 * decrypted in another (design D1).
 *
 * Two purposes exist and they must never be interchangeable: the token at rest
 * in the database, and the token waiting in a cookie for the owner to confirm
 * it (design D7). Without this, a value lifted from the confirmation cookie
 * would decrypt as a stored credential and vice versa.
 */
export type CredentialPurpose = 'mp-access-token' | 'mp-pending-confirmation';

export interface ICredentialCipher {
  /**
   * Returns a self-describing envelope. Two calls with identical arguments MUST
   * return different envelopes — the initialization vector is fresh per call,
   * and reusing one under AES-GCM breaks both confidentiality and authenticity.
   */
  encrypt(plaintext: string, ownerId: string, purpose: CredentialPurpose): Promise<string>;

  /**
   * Rejects anything that is not a recognized envelope, and anything whose
   * owner or purpose does not match. There is no fallback that treats an
   * unparseable value as plaintext: a fallback that guesses is a fallback that
   * silently accepts corrupted data.
   *
   * @throws CredentialDecryptionError when the value cannot be authenticated.
   * @throws CredentialKeyMissingError when the key itself is absent or unusable
   *         — a configuration fault, not a data fault, and callers report the
   *         two differently.
   */
  decrypt(envelope: string, ownerId: string, purpose: CredentialPurpose): Promise<string>;
}
