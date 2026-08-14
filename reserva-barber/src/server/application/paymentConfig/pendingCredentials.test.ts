import { describe, it, expect, beforeEach } from 'vitest';
import {
  storePendingCredentials,
  readPendingCredentials,
  clearPendingToken,
  PENDING_COOKIE_NAME,
  PENDING_COOKIE_PATH,
  PENDING_COOKIE_MAX_AGE_SECONDS,
  type PendingCookieStore,
} from './pendingCredentials';
import { WebCryptoCipher } from '@/server/infrastructure/crypto/WebCryptoCipher';
import {
  CredentialDecryptionError,
  CredentialKeyMissingError,
} from '@/server/domain/errors/PaymentConfigErrors';

const OWNER = 'owner-root';
const OTHER_OWNER = 'owner-other';
const TOKEN = 'APP_USR-4934588586838432-081312-abcdef0123456789abcdef0123456789-241983636';
const PUBLIC_KEY = 'APP_USR-d0a26210-1f4b-4c3a-9e21-479f0400869e';
/** The pair, because the confirmation must commit exactly what was verified. */
const PAIR = { accessToken: TOKEN, publicKey: PUBLIC_KEY };
/** The 32-byte cipher key — unrelated to the Mercado Pago public key above. */
const CIPHER_KEY = Buffer.alloc(32, 7).toString('base64');

function cookieStore(): PendingCookieStore & {
  jar: Map<string, { value: string; options: unknown }>;
} {
  const jar = new Map<string, { value: string; options: unknown }>();
  return {
    jar,
    get: (name) => jar.get(name),
    set: (name, value, options) => {
      jar.set(name, { value, options });
    },
    delete: (name) => {
      jar.delete(name);
    },
  };
}

const cipher = new WebCryptoCipher(() => CIPHER_KEY);

describe('pendingCredentials', () => {
  let cookies: ReturnType<typeof cookieStore>;

  beforeEach(() => {
    cookies = cookieStore();
  });

  describe('storing', () => {
    // Both halves, not just the token. The blocker this replaced: the public
    // key travelled through a form field that the confirmation screen does not
    // render, so it arrived empty and every confirmation was rejected as an
    // incomplete pair.
    it('should_round_trip_the_whole_pair', async () => {
      await storePendingCredentials(cookies, cipher, OWNER, PAIR);

      expect(await readPendingCredentials(cookies, cipher, OWNER)).toEqual(PAIR);
    });

    it('should_never_store_either_credential_in_the_clear', async () => {
      await storePendingCredentials(cookies, cipher, OWNER, PAIR);

      const stored = cookies.jar.get(PENDING_COOKIE_NAME)?.value ?? '';
      expect(stored).not.toContain(TOKEN);
      expect(stored).not.toContain(PUBLIC_KEY);
      expect(stored).not.toContain('241983636');
      expect(stored.startsWith('v1.')).toBe(true);
    });

    it('should_reject_a_payload_that_is_not_a_complete_pair', async () => {
      // An authenticated envelope whose contents do not parse means the format
      // changed under a still-valid cookie — a deploy landing mid-confirmation.
      // Half a pair must never reach the write path.
      for (const payload of ['not json', '{}', '{"accessToken":"only-one"}', '{"accessToken":"","publicKey":""}']) {
        cookies.set(PENDING_COOKIE_NAME, await cipher.encrypt(payload, OWNER, 'mp-pending-confirmation'), {
          httpOnly: true,
          secure: true,
          sameSite: 'strict',
          path: PENDING_COOKIE_PATH,
          maxAge: PENDING_COOKIE_MAX_AGE_SECONDS,
        });

        expect(await readPendingCredentials(cookies, cipher, OWNER)).toBeNull();
      }
    });

    it('should_set_the_cookie_beyond_the_reach_of_page_scripts', async () => {
      await storePendingCredentials(cookies, cipher, OWNER, PAIR);

      expect(cookies.jar.get(PENDING_COOKIE_NAME)?.options).toEqual({
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        path: PENDING_COOKIE_PATH,
        maxAge: PENDING_COOKIE_MAX_AGE_SECONDS,
      });
    });

    it('should_scope_the_cookie_to_this_feature_only', async () => {
      // It must not ride along on every request to the origin.
      await storePendingCredentials(cookies, cipher, OWNER, PAIR);

      const options = cookies.jar.get(PENDING_COOKIE_NAME)?.options as { path: string };
      expect(options.path).toBe('/mercado-pago');
    });

    it('should_expire_in_minutes_not_hours', async () => {
      // A hand-off, not storage: an abandoned confirmation must not leave a
      // recoverable credential behind.
      expect(PENDING_COOKIE_MAX_AGE_SECONDS).toBeLessThanOrEqual(900);
    });
  });

  describe('reading', () => {
    it('should_return_null_when_no_confirmation_is_in_progress', async () => {
      expect(await readPendingCredentials(cookies, cipher, OWNER)).toBeNull();
    });

    it('should_return_null_for_an_empty_cookie', async () => {
      cookies.set(PENDING_COOKIE_NAME, '', {
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        path: PENDING_COOKIE_PATH,
        maxAge: PENDING_COOKIE_MAX_AGE_SECONDS,
      });

      expect(await readPendingCredentials(cookies, cipher, OWNER)).toBeNull();
    });

    it('should_return_null_for_a_tampered_cookie', async () => {
      await storePendingCredentials(cookies, cipher, OWNER, PAIR);
      const stored = cookies.jar.get(PENDING_COOKIE_NAME)!;
      const parts = stored.value.split('.');
      parts[2] = parts[2][0] === 'A' ? `B${parts[2].slice(1)}` : `A${parts[2].slice(1)}`;
      cookies.jar.set(PENDING_COOKIE_NAME, { ...stored, value: parts.join('.') });

      expect(await readPendingCredentials(cookies, cipher, OWNER)).toBeNull();
    });

    it('should_return_null_for_another_owners_cookie', async () => {
      await storePendingCredentials(cookies, cipher, OWNER, PAIR);

      expect(await readPendingCredentials(cookies, cipher, OTHER_OWNER)).toBeNull();
    });

    // Design D7's core guarantee. Without purpose binding this cookie would be
    // a way to write a value of the attacker's choosing straight into the
    // credential column.
    it('should_not_be_usable_as_a_stored_credential', async () => {
      await storePendingCredentials(cookies, cipher, OWNER, PAIR);
      const envelope = cookies.jar.get(PENDING_COOKIE_NAME)!.value;

      await expect(cipher.decrypt(envelope, OWNER, 'mp-access-token')).rejects.toBeInstanceOf(
        CredentialDecryptionError
      );
    });

    it('should_not_accept_a_stored_credential_envelope', async () => {
      const storedEnvelope = await cipher.encrypt(TOKEN, OWNER, 'mp-access-token');
      cookies.set(PENDING_COOKIE_NAME, storedEnvelope, {
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        path: PENDING_COOKIE_PATH,
        maxAge: PENDING_COOKIE_MAX_AGE_SECONDS,
      });

      expect(await readPendingCredentials(cookies, cipher, OWNER)).toBeNull();
    });

    // A missing key means the deployment is misconfigured, not that the owner
    // abandoned a confirmation. Reporting it as "nothing pending" would send
    // them round the loop forever with no explanation.
    it('should_propagate_a_missing_key_rather_than_reporting_nothing_pending', async () => {
      await storePendingCredentials(cookies, cipher, OWNER, PAIR);
      const keyless = new WebCryptoCipher(() => '');

      await expect(readPendingCredentials(cookies, keyless, OWNER)).rejects.toBeInstanceOf(
        CredentialKeyMissingError
      );
    });
  });

  describe('clearing', () => {
    it('should_remove_the_cookie', async () => {
      await storePendingCredentials(cookies, cipher, OWNER, PAIR);
      clearPendingToken(cookies);

      expect(cookies.jar.has(PENDING_COOKIE_NAME)).toBe(false);
      expect(await readPendingCredentials(cookies, cipher, OWNER)).toBeNull();
    });

    it('should_be_safe_to_call_when_nothing_is_pending', () => {
      expect(() => clearPendingToken(cookies)).not.toThrow();
    });
  });

  describe('the expired-cookie path', () => {
    it('should_return_the_owner_to_the_editor_rather_than_a_stale_confirmation', async () => {
      // The browser drops an expired cookie, so expiry reaches this code as an
      // absent one — the same outcome as every other unreadable case.
      await storePendingCredentials(cookies, cipher, OWNER, PAIR);
      cookies.jar.delete(PENDING_COOKIE_NAME);

      expect(await readPendingCredentials(cookies, cipher, OWNER)).toBeNull();
    });
  });
});
