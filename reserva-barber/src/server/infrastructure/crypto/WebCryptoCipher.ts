// Relative imports, not aliased: this module is pulled in by the PC2 gate probe,
// which the Node leg runs through `tsx` without the `@/` alias resolver.
import type {
  ICredentialCipher,
  CredentialPurpose,
} from '../../domain/repositories/ICredentialCipher';
import {
  CredentialDecryptionError,
  CredentialKeyMissingError,
} from '../../domain/errors/PaymentConfigErrors';

/**
 * AES-256-GCM over Web Crypto (design D1).
 *
 * `crypto.subtle` is a global on `workerd` and on Node 18+, so this module runs
 * identically in the tests and in the deployed Worker. `node:crypto` is
 * deliberately not used: `nodejs_compat` is enabled, but the one module in this
 * project that must hold no surprises should not depend on a compatibility
 * shim.
 *
 * The stored form is a self-describing envelope:
 *
 *     v1.<base64url iv>.<base64url ciphertext‖tag>
 *
 * The version marker is present from the first stored value so a later key or
 * algorithm change can identify what it is reading rather than infer it. There
 * is no fallback that treats an unparseable value as plaintext — a fallback
 * that guesses is a fallback that silently accepts corrupted data.
 */

export const ENVELOPE_VERSION = 'v1';

const KEY_VARIABLE = 'PAYMENT_CREDENTIALS_KEY';
const KEY_BYTES = 32;
/** 96 bits — the size AES-GCM is specified and optimized for. */
const IV_BYTES = 12;
const ENVELOPE_SEGMENTS = 3;

type KeySource = () => string | undefined;

/**
 * Encodes text into an `ArrayBuffer`-backed view.
 *
 * `TextEncoder.encode` is typed `Uint8Array<ArrayBufferLike>`, which Web
 * Crypto's `BufferSource` will not accept — it excludes `SharedArrayBuffer`,
 * where the bytes could be mutated by another thread mid-operation. Copying
 * into a plain buffer satisfies the type by actually satisfying the guarantee.
 */
function toBytes(value: string): Uint8Array<ArrayBuffer> {
  const encoded = new TextEncoder().encode(value);
  const buffer = new ArrayBuffer(encoded.length);
  const bytes = new Uint8Array(buffer);
  bytes.set(encoded);
  return bytes;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Returns null rather than throwing: every malformed-envelope path converges on
 * one `CredentialDecryptionError`, and a decoder that throws its own error type
 * would leak the distinction between "bad base64" and "bad tag" — a distinction
 * that tells an attacker something and tells the owner nothing.
 */
function fromBase64Url(value: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    return null;
  }
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(new ArrayBuffer(binary.length));
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    return null;
  }
}

export class WebCryptoCipher implements ICredentialCipher {
  /**
   * The key is read through a function, not captured at construction. The
   * composition root builds a cipher per request, and a page that never
   * encrypts anything must not fail because a key it does not use is absent
   * (design D11).
   */
  constructor(private readonly keySource: KeySource = () => process.env[KEY_VARIABLE]) {}

  async encrypt(
    plaintext: string,
    ownerId: string,
    purpose: CredentialPurpose
  ): Promise<string> {
    const key = await this.importKey();
    const iv = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(IV_BYTES)));

    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: this.aad(ownerId, purpose) },
      key,
      toBytes(plaintext)
    );

    return [ENVELOPE_VERSION, toBase64Url(iv), toBase64Url(new Uint8Array(ciphertext))].join('.');
  }

  async decrypt(
    envelope: string,
    ownerId: string,
    purpose: CredentialPurpose
  ): Promise<string> {
    // The key is resolved before the envelope is parsed, so a missing key is
    // reported as the configuration fault it is rather than as a corrupted
    // credential. Telling the owner to re-enter their credentials is the wrong
    // advice for one and the right advice for the other.
    const key = await this.importKey();

    const parts = envelope.split('.');
    if (parts.length !== ENVELOPE_SEGMENTS || parts[0] !== ENVELOPE_VERSION) {
      throw new CredentialDecryptionError();
    }

    const iv = fromBase64Url(parts[1]);
    const body = fromBase64Url(parts[2]);
    if (iv === null || body === null || iv.length !== IV_BYTES) {
      throw new CredentialDecryptionError();
    }

    let plaintext: ArrayBuffer;
    try {
      plaintext = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv, additionalData: this.aad(ownerId, purpose) },
        key,
        body
      );
    } catch {
      // Swallowed on purpose. Web Crypto's failure carries nothing useful, and
      // rethrowing it risks putting driver-supplied text near this material.
      throw new CredentialDecryptionError();
    }

    return new TextDecoder().decode(plaintext);
  }

  /**
   * Binds the owner and the purpose into the ciphertext, so an envelope lifted
   * from another row or another context fails to authenticate rather than
   * decrypting into the wrong place. The separator matters: without it,
   * ('ab', 'c') and ('a', 'bc') would produce the same associated data.
   */
  private aad(ownerId: string, purpose: CredentialPurpose): Uint8Array<ArrayBuffer> {
    // The separator is written as an escape, never as a raw byte: a literal
    // NUL in source makes the file binary to every tool that reads it and is
    // invisible in review. NUL is the right separator precisely because it
    // cannot occur in an owner id or a purpose, so no pair of inputs can
    // collide the way ('ab','c') and ('a','bc') would under a joinable one.
    return toBytes(`${purpose}\u0000${ownerId}`);
  }

  private async importKey(): Promise<CryptoKey> {
    // Trimmed before anything else. A secret uploaded with a trailing newline
    // or a byte-order mark is invisible in a terminal, and this project has
    // already lost time to exactly that once — a polluted `DATABASE_URL` in S0
    // surfaced as an unrelated connection error. Whitespace is never part of a
    // base64 key, so accepting it costs nothing and removes a whole class of
    // deploy accident. The `.env` and `wrangler secret put` guidance still says
    // to pipe exact bytes; this is the net under it, not a licence to be sloppy.
    const raw = this.keySource()?.trim().replace(/^﻿/, '');
    if (!raw) {
      throw new CredentialKeyMissingError('not set');
    }

    const bytes = fromBase64Url(raw.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''));
    if (bytes === null) {
      throw new CredentialKeyMissingError('not valid base64');
    }
    if (bytes.length !== KEY_BYTES) {
      // The length is named, the value never is.
      throw new CredentialKeyMissingError(`expected ${KEY_BYTES} bytes, got ${bytes.length}`);
    }

    return crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, [
      'encrypt',
      'decrypt',
    ]);
  }
}
