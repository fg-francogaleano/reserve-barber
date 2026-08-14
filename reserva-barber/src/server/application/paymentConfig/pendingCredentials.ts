import type { ICredentialCipher } from '@/server/domain/repositories/ICredentialCipher';
import { CredentialDecryptionError } from '@/server/domain/errors/PaymentConfigErrors';

/**
 * Where the submitted access token waits between verification and the owner's
 * confirmation (design D7).
 *
 * PC1's confirmation carries its pending values through `<input type="hidden">`.
 * For a bank destination that is fine — it is public data. For a bearer
 * credential it would put a live secret in the page source, in the bfcache, in
 * reach of any browser extension, and in any screenshot the owner takes of the
 * confirmation screen. So the token does not go to the browser at all: it goes
 * into a cookie the browser cannot read.
 *
 * Four properties carry the weight, and none is decoration:
 *
 * - **Encrypted**, under a purpose distinct from the stored credential, so a
 *   value from one context cannot be decrypted in the other. Without that, this
 *   cookie would be a way to write directly into the credential column.
 * - **`httpOnly`**, so page scripts cannot read it.
 * - **`Path`-scoped and `SameSite=Strict`**, so it is not sent with unrelated
 *   requests or from another site.
 * - **Minutes-long**, because it is a hand-off, not storage. An abandoned
 *   confirmation must not leave a plaintext credential recoverable an hour later.
 *
 * A server-side store keyed by an opaque id would be equivalent; it was
 * declined because it needs a Workers KV binding this project does not have, a
 * TTL, and a cleanup story — infrastructure added to a change that already adds
 * a cipher.
 */

export const PENDING_COOKIE_NAME = 'mp_pending';
export const PENDING_COOKIE_PATH = '/mercado-pago';
/** Long enough to read a confirmation screen, short enough not to be storage. */
export const PENDING_COOKIE_MAX_AGE_SECONDS = 600;

/**
 * The subset of Next.js's cookie store this module needs. Declared here rather
 * than imported so the logic is testable without a request context.
 */
export interface PendingCookieStore {
  get(name: string): { value: string } | undefined;
  set(name: string, value: string, options: PendingCookieOptions): void;
  delete(name: string): void;
}

export interface PendingCookieOptions {
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'strict';
  path: string;
  maxAge: number;
}

export const PENDING_COOKIE_OPTIONS: PendingCookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: 'strict',
  path: PENDING_COOKIE_PATH,
  maxAge: PENDING_COOKIE_MAX_AGE_SECONDS,
};

/**
 * The pair held between verification and confirmation.
 *
 * **Both halves, not just the token.** The confirmation exists to guarantee that
 * what the owner approved is what gets stored, and that guarantee only holds if
 * the whole pair survives the round trip together. Carrying the public key
 * through the form instead would let a tampered field store a different key than
 * the one whose account was verified and shown — and would have to re-enter the
 * DOM, which the token is deliberately kept out of.
 */
export interface PendingCredentials {
  accessToken: string;
  publicKey: string;
}

export async function storePendingCredentials(
  cookies: PendingCookieStore,
  cipher: ICredentialCipher,
  ownerId: string,
  credentials: PendingCredentials
): Promise<void> {
  const envelope = await cipher.encrypt(
    JSON.stringify(credentials),
    ownerId,
    'mp-pending-confirmation'
  );
  cookies.set(PENDING_COOKIE_NAME, envelope, PENDING_COOKIE_OPTIONS);
}

/**
 * Returns the pending token, or null when there is none or it cannot be read.
 *
 * An expired, tampered, foreign or wrong-purpose cookie all collapse to null on
 * purpose: every one of them means "there is no confirmation in progress", and
 * the owner is returned to the editor rather than to a confirmation that would
 * commit nothing. Distinguishing them would tell an attacker something and the
 * owner nothing.
 */
export async function readPendingCredentials(
  cookies: PendingCookieStore,
  cipher: ICredentialCipher,
  ownerId: string
): Promise<PendingCredentials | null> {
  const cookie = cookies.get(PENDING_COOKIE_NAME);
  if (!cookie || cookie.value === '') {
    return null;
  }

  let plaintext: string;
  try {
    plaintext = await cipher.decrypt(cookie.value, ownerId, 'mp-pending-confirmation');
  } catch (error) {
    if (error instanceof CredentialDecryptionError) {
      return null;
    }
    // A missing key is a configuration fault, not an absent confirmation, and
    // must not be silently reported as "nothing pending".
    throw error;
  }

  // An authenticated envelope whose contents do not parse means the format
  // changed under a still-valid cookie — a deploy landing mid-confirmation.
  // Treated as "nothing pending" so the owner restarts, never as a partial pair.
  try {
    const parsed: unknown = JSON.parse(plaintext);
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof (parsed as PendingCredentials).accessToken !== 'string' ||
      typeof (parsed as PendingCredentials).publicKey !== 'string'
    ) {
      return null;
    }
    const { accessToken, publicKey } = parsed as PendingCredentials;
    return accessToken === '' || publicKey === '' ? null : { accessToken, publicKey };
  } catch {
    return null;
  }
}

/** Called on confirm, on decline, and on a validation failure — every exit path. */
export function clearPendingToken(cookies: PendingCookieStore): void {
  cookies.delete(PENDING_COOKIE_NAME);
}
