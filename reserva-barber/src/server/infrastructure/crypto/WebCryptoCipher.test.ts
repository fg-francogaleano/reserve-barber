import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WebCryptoCipher, ENVELOPE_VERSION } from './WebCryptoCipher';
import {
  CredentialDecryptionError,
  CredentialKeyMissingError,
} from '@/server/domain/errors/PaymentConfigErrors';

const OWNER = 'owner-root';
const OTHER_OWNER = 'owner-other';
const TOKEN = 'APP_USR-4934588586838432-081312-abcdef0123456789abcdef0123456789-241983636';

/** 32 bytes, base64 — the shape a real `PAYMENT_CREDENTIALS_KEY` has. */
const KEY = Buffer.alloc(32, 7).toString('base64');
const OTHER_KEY = Buffer.alloc(32, 9).toString('base64');

function cipher(key: string = KEY): WebCryptoCipher {
  return new WebCryptoCipher(() => key);
}

/** Flips one bit in the nth base64url segment of an envelope. */
function corruptSegment(envelope: string, index: number): string {
  const parts = envelope.split('.');
  const chars = parts[index].split('');
  // Any substitution that lands on a different base64url character works; the
  // point is that the bytes change, not which ones.
  chars[0] = chars[0] === 'A' ? 'B' : 'A';
  parts[index] = chars.join('');
  return parts.join('.');
}

describe('WebCryptoCipher', () => {
  describe('round trip', () => {
    it('should_return_the_original_plaintext', async () => {
      const c = cipher();
      const envelope = await c.encrypt(TOKEN, OWNER, 'mp-access-token');

      expect(await c.decrypt(envelope, OWNER, 'mp-access-token')).toBe(TOKEN);
    });

    it('should_not_contain_the_plaintext_in_the_envelope', async () => {
      const envelope = await cipher().encrypt(TOKEN, OWNER, 'mp-access-token');

      expect(envelope).not.toContain(TOKEN);
      expect(envelope).not.toContain('241983636');
    });

    it('should_round_trip_a_value_with_non_ascii_characters', async () => {
      const c = cipher();
      const value = 'señor-ñandú-☃';
      const envelope = await c.encrypt(value, OWNER, 'mp-access-token');

      expect(await c.decrypt(envelope, OWNER, 'mp-access-token')).toBe(value);
    });
  });

  describe('initialization vector freshness (design D1)', () => {
    // The single most important test in this file. A deterministic envelope
    // means the IV is being reused, which under AES-GCM is a total break of
    // both confidentiality and authenticity — and it is invisible in every
    // other test, because a reused IV still round-trips perfectly.
    it('should_produce_a_different_envelope_each_time_for_the_same_plaintext', async () => {
      const c = cipher();

      const first = await c.encrypt(TOKEN, OWNER, 'mp-access-token');
      const second = await c.encrypt(TOKEN, OWNER, 'mp-access-token');

      expect(first).not.toBe(second);
    });

    it('should_produce_a_different_initialization_vector_each_time', async () => {
      const c = cipher();

      const ivs = new Set<string>();
      for (let i = 0; i < 20; i += 1) {
        ivs.add((await c.encrypt(TOKEN, OWNER, 'mp-access-token')).split('.')[1]);
      }

      expect(ivs.size).toBe(20);
    });

    it('should_still_decrypt_both_of_two_differing_envelopes', async () => {
      const c = cipher();
      const first = await c.encrypt(TOKEN, OWNER, 'mp-access-token');
      const second = await c.encrypt(TOKEN, OWNER, 'mp-access-token');

      expect(await c.decrypt(first, OWNER, 'mp-access-token')).toBe(TOKEN);
      expect(await c.decrypt(second, OWNER, 'mp-access-token')).toBe(TOKEN);
    });
  });

  describe('tampering', () => {
    it('should_reject_a_corrupted_ciphertext', async () => {
      const c = cipher();
      const envelope = await c.encrypt(TOKEN, OWNER, 'mp-access-token');

      await expect(
        c.decrypt(corruptSegment(envelope, 2), OWNER, 'mp-access-token')
      ).rejects.toBeInstanceOf(CredentialDecryptionError);
    });

    it('should_reject_a_corrupted_initialization_vector', async () => {
      const c = cipher();
      const envelope = await c.encrypt(TOKEN, OWNER, 'mp-access-token');

      await expect(
        c.decrypt(corruptSegment(envelope, 1), OWNER, 'mp-access-token')
      ).rejects.toBeInstanceOf(CredentialDecryptionError);
    });

    it('should_reject_an_envelope_encrypted_under_a_different_key', async () => {
      const envelope = await cipher(KEY).encrypt(TOKEN, OWNER, 'mp-access-token');

      await expect(
        cipher(OTHER_KEY).decrypt(envelope, OWNER, 'mp-access-token')
      ).rejects.toBeInstanceOf(CredentialDecryptionError);
    });

    it('should_reject_a_truncated_ciphertext', async () => {
      const c = cipher();
      const envelope = await c.encrypt(TOKEN, OWNER, 'mp-access-token');
      const parts = envelope.split('.');
      parts[2] = parts[2].slice(0, -4);

      await expect(c.decrypt(parts.join('.'), OWNER, 'mp-access-token')).rejects.toBeInstanceOf(
        CredentialDecryptionError
      );
    });
  });

  describe('additional authenticated data', () => {
    it('should_reject_an_envelope_belonging_to_another_owner', async () => {
      const c = cipher();
      const envelope = await c.encrypt(TOKEN, OWNER, 'mp-access-token');

      await expect(c.decrypt(envelope, OTHER_OWNER, 'mp-access-token')).rejects.toBeInstanceOf(
        CredentialDecryptionError
      );
    });

    // Design D7: the pending-confirmation cookie and the stored column use the
    // same key. Without purpose binding, a value from one is a valid value for
    // the other, and the confirmation cookie becomes a way to write directly
    // into the credential column.
    it('should_reject_a_pending_envelope_presented_as_a_stored_credential', async () => {
      const c = cipher();
      const envelope = await c.encrypt(TOKEN, OWNER, 'mp-pending-confirmation');

      await expect(c.decrypt(envelope, OWNER, 'mp-access-token')).rejects.toBeInstanceOf(
        CredentialDecryptionError
      );
    });

    it('should_reject_a_stored_envelope_presented_as_a_pending_credential', async () => {
      const c = cipher();
      const envelope = await c.encrypt(TOKEN, OWNER, 'mp-access-token');

      await expect(c.decrypt(envelope, OWNER, 'mp-pending-confirmation')).rejects.toBeInstanceOf(
        CredentialDecryptionError
      );
    });
  });

  describe('envelope parsing', () => {
    it('should_prefix_the_envelope_with_its_version', async () => {
      const envelope = await cipher().encrypt(TOKEN, OWNER, 'mp-access-token');

      expect(envelope.startsWith(`${ENVELOPE_VERSION}.`)).toBe(true);
      expect(envelope.split('.')).toHaveLength(3);
    });

    // The fallback that must not exist. A cipher that returns unparseable input
    // "as plaintext" would hand a caller a corrupted value that looks fine.
    it('should_never_treat_an_unversioned_value_as_plaintext', async () => {
      await expect(cipher().decrypt(TOKEN, OWNER, 'mp-access-token')).rejects.toBeInstanceOf(
        CredentialDecryptionError
      );
    });

    it.each([
      ['empty', ''],
      ['no separators', 'notanenvelope'],
      ['too few segments', 'v1.onlyonesegment'],
      ['too many segments', 'v1.a.b.c'],
      ['unknown version', 'v99.AAAAAAAAAAAAAAAA.AAAAAAAA'],
      ['non base64url segments', 'v1.!!!!.????'],
    ])('should_reject_a_malformed_envelope_%s', async (_label, value) => {
      await expect(cipher().decrypt(value, OWNER, 'mp-access-token')).rejects.toBeInstanceOf(
        CredentialDecryptionError
      );
    });

    it('should_reject_an_initialization_vector_of_the_wrong_length', async () => {
      // A 96-bit IV is 12 bytes; this one is 8. AES-GCM would otherwise accept
      // a short IV and silently operate under different security properties.
      const shortIv = Buffer.alloc(8, 1).toString('base64url');
      const body = Buffer.alloc(32, 2).toString('base64url');

      await expect(
        cipher().decrypt(`v1.${shortIv}.${body}`, OWNER, 'mp-access-token')
      ).rejects.toBeInstanceOf(CredentialDecryptionError);
    });
  });

  describe('key handling (design D11)', () => {
    it('should_report_an_absent_key_by_name', async () => {
      await expect(cipher('').encrypt(TOKEN, OWNER, 'mp-access-token')).rejects.toBeInstanceOf(
        CredentialKeyMissingError
      );
    });

    it('should_report_a_key_of_the_wrong_length_by_name', async () => {
      const short = Buffer.alloc(16, 1).toString('base64');

      await expect(cipher(short).encrypt(TOKEN, OWNER, 'mp-access-token')).rejects.toBeInstanceOf(
        CredentialKeyMissingError
      );
    });

    it('should_report_a_non_base64_key_by_name', async () => {
      await expect(
        cipher('not base64 !!!!').encrypt(TOKEN, OWNER, 'mp-access-token')
      ).rejects.toBeInstanceOf(CredentialKeyMissingError);
    });

    it('should_name_the_variable_in_the_message', async () => {
      await expect(cipher('').encrypt(TOKEN, OWNER, 'mp-access-token')).rejects.toThrow(
        /PAYMENT_CREDENTIALS_KEY/
      );
    });

    // A missing key is a configuration fault; a bad envelope is a data fault.
    // Telling the owner to re-enter their credentials is right advice for one
    // and wrong for the other, so the two must never collapse.
    it('should_distinguish_a_missing_key_from_a_decryption_failure', async () => {
      const envelope = await cipher().encrypt(TOKEN, OWNER, 'mp-access-token');

      await expect(cipher('').decrypt(envelope, OWNER, 'mp-access-token')).rejects.toBeInstanceOf(
        CredentialKeyMissingError
      );
      await expect(
        cipher().decrypt(corruptSegment(envelope, 2), OWNER, 'mp-access-token')
      ).rejects.toBeInstanceOf(CredentialDecryptionError);
    });

    // The deploy accident this survives: `wrangler secret put` receiving a
    // value with a trailing newline or a BOM. Invisible in a terminal, and in
    // S0 the same pollution on DATABASE_URL surfaced as an unrelated error.
    it.each([
      ['a trailing newline', `${KEY}\n`],
      ['a trailing carriage return', `${KEY}\r\n`],
      ['surrounding spaces', `  ${KEY}  `],
      ['a byte order mark', `﻿${KEY}`],
    ])('should_still_load_a_key_polluted_with_%s', async (_label, polluted) => {
      const c = cipher(polluted);

      expect(
        await c.decrypt(await c.encrypt(TOKEN, OWNER, 'mp-access-token'), OWNER, 'mp-access-token')
      ).toBe(TOKEN);
    });

    it('should_interoperate_with_a_clean_key_after_tolerating_a_polluted_one', async () => {
      // The two must produce interchangeable ciphertexts, or a redeploy that
      // fixed the pollution would orphan everything written before it.
      const envelope = await cipher(`${KEY}\n`).encrypt(TOKEN, OWNER, 'mp-access-token');

      expect(await cipher(KEY).decrypt(envelope, OWNER, 'mp-access-token')).toBe(TOKEN);
    });

    it('should_read_the_key_lazily_rather_than_at_construction', () => {
      // Construction must not throw: the composition root builds the cipher on
      // every request, and a page that never encrypts anything should not fail
      // because a key it does not use is absent.
      expect(() => new WebCryptoCipher(() => '')).not.toThrow();
    });
  });

  describe('errors carry no material', () => {
    it('should_not_include_the_key_in_a_key_error', async () => {
      const key = Buffer.alloc(16, 1).toString('base64');

      const error = await cipher(key)
        .encrypt(TOKEN, OWNER, 'mp-access-token')
        .catch((e: Error) => e);

      expect(String(error)).not.toContain(key);
    });

    it('should_not_include_the_ciphertext_or_the_key_in_a_decryption_error', async () => {
      const envelope = await cipher().encrypt(TOKEN, OWNER, 'mp-access-token');
      const corrupted = corruptSegment(envelope, 2);

      const error = await cipher()
        .decrypt(corrupted, OWNER, 'mp-access-token')
        .catch((e: Error) => e);

      const serialized = `${String(error)}${(error as Error).stack ?? ''}`;
      expect(serialized).not.toContain(corrupted.split('.')[2]);
      expect(serialized).not.toContain(KEY);
      expect(serialized).not.toContain(TOKEN);
    });
  });

  describe('environment sourcing', () => {
    const original = process.env.PAYMENT_CREDENTIALS_KEY;

    beforeEach(() => {
      process.env.PAYMENT_CREDENTIALS_KEY = KEY;
    });

    afterEach(() => {
      if (original === undefined) {
        delete process.env.PAYMENT_CREDENTIALS_KEY;
      } else {
        process.env.PAYMENT_CREDENTIALS_KEY = original;
      }
    });

    it('should_default_to_reading_the_key_from_the_environment', async () => {
      const c = new WebCryptoCipher();

      expect(await c.decrypt(await c.encrypt(TOKEN, OWNER, 'mp-access-token'), OWNER, 'mp-access-token')).toBe(
        TOKEN
      );
    });
  });
});
