import {
  normalizeCredential,
  checkAccessToken,
  checkPublicKey,
  looksSwapped,
  credentialEnvironment,
} from '@/server/domain/models/mercadoPagoCredentials';
import type { MercadoPagoCredentials } from '@/server/domain/models/PaymentConfig';

/**
 * Parses and validates the Mercado Pago credential pair.
 *
 * Returns error **codes**, never Spanish strings: mapping a code to a message
 * is the presentation layer's job, and each code names a distinct mistake. Six
 * rejections are distinguished, because collapsing any two of them describes
 * the wrong problem to the owner — telling someone who transposed two fields
 * that their token "has an invalid format" describes something they did not do.
 *
 * Follows the hand-rolled parser shape every other schema module in this
 * project uses (`{ ok, data } | { ok: false, fieldErrors }`), not Zod.
 */

export type CredentialFieldError = 'invalid_format';

export type CredentialFormError =
  /** The two values are in each other's fields (design D9). */
  | 'looks_swapped'
  /** One test credential and one production credential (design D8). */
  | 'environment_mismatch'
  /** Exactly one of the two supplied, on a first configuration. */
  | 'incomplete_pair'
  /** The public key changed but the token field was left empty (design D3). */
  | 'token_required_for_key_change';

export interface CredentialFieldErrors {
  accessToken?: CredentialFieldError;
  publicKey?: CredentialFieldError;
  /** Not attached to a field: the mistake is the combination, not any one input. */
  form?: CredentialFormError;
}

/**
 * What the owner is asking for, resolved from the submission plus what is
 * already stored.
 *
 * `unchanged` exists because the token field always renders empty (design D3).
 * An empty submission is the overwhelmingly common case — the owner opened the
 * page and saved without touching anything — and it must be a no-op rather than
 * a clear, or an unrelated edit would delete their credentials.
 */
export type CredentialsParseResult =
  | { ok: true; intent: 'unchanged' }
  | { ok: true; intent: 'save'; data: MercadoPagoCredentials }
  | { ok: false; fieldErrors: CredentialFieldErrors };

export interface RawCredentialsInput {
  accessToken: unknown;
  publicKey: unknown;
}

/**
 * What is already stored. The parser needs it because the meaning of an empty
 * token field depends on it: harmless when nothing else changed, and a mistake
 * when the public key did.
 */
export interface StoredCredentialsContext {
  hasStoredCredentials: boolean;
  storedPublicKey: string | null;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function parseMercadoPagoCredentials(
  raw: RawCredentialsInput,
  stored: StoredCredentialsContext
): CredentialsParseResult {
  // Normalized first, and the normalized value is what everything below sees.
  // A token with a trailing newline otherwise passes every check here and then
  // fails at payment time (design D10).
  const accessToken = normalizeCredential(asString(raw.accessToken));
  const publicKey = normalizeCredential(asString(raw.publicKey));

  if (accessToken === '' && publicKey === '') {
    // Nothing submitted. Never a clear — removal is its own explicit intent.
    return { ok: true, intent: 'unchanged' };
  }

  if (accessToken === '') {
    if (!stored.hasStoredCredentials) {
      // A public key alone cannot authorize a charge.
      return { ok: false, fieldErrors: { form: 'incomplete_pair' } };
    }
    if (publicKey !== stored.storedPublicKey) {
      // The pair is issued together. A public key rotated without its token
      // produces a checkout that fails only when a real client reaches it, so
      // this is refused rather than half-applied.
      return { ok: false, fieldErrors: { form: 'token_required_for_key_change' } };
    }
    return { ok: true, intent: 'unchanged' };
  }

  if (publicKey === '') {
    // An access token alone cannot initialize the client-side checkout.
    return { ok: false, fieldErrors: { form: 'incomplete_pair' } };
  }

  // Checked before the per-field rules so the owner is told what actually
  // happened. A swap is one mistake, not two, and its consequence — an access
  // token written into the column served to every client — is not something
  // two "invalid format" messages would convey.
  if (looksSwapped(accessToken, publicKey)) {
    return { ok: false, fieldErrors: { form: 'looks_swapped' } };
  }

  const fieldErrors: CredentialFieldErrors = {};

  const tokenError = checkAccessToken(accessToken);
  const keyError = checkPublicKey(publicKey);

  // A single value in the wrong field, with the other malformed, still reads as
  // a transposition to the owner — and is the more useful thing to say.
  if (tokenError === 'looks_swapped' || keyError === 'looks_swapped') {
    return { ok: false, fieldErrors: { form: 'looks_swapped' } };
  }

  if (tokenError !== null) {
    fieldErrors.accessToken = tokenError;
  }
  if (keyError !== null) {
    fieldErrors.publicKey = keyError;
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, fieldErrors };
  }

  // Only meaningful once both values are well-formed: an unrecognized prefix
  // has no environment to disagree with, and reporting a mismatch there would
  // name the wrong mistake.
  if (credentialEnvironment(accessToken) !== credentialEnvironment(publicKey)) {
    return { ok: false, fieldErrors: { form: 'environment_mismatch' } };
  }

  return { ok: true, intent: 'save', data: { accessToken, publicKey } };
}
