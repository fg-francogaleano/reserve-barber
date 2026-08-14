import { describe, it, expect } from 'vitest';
import {
  parseMercadoPagoCredentials,
  type StoredCredentialsContext,
} from './mercadoPagoCredentialsSchema';

const TOKEN = 'APP_USR-4934588586838432-081312-abcdef0123456789abcdef0123456789-241983636';
const KEY = 'APP_USR-d0a26210-1f4b-4c3a-9e21-479f0400869e';
const TEST_TOKEN = 'TEST-4934588586838432-081312-abcdef0123456789abcdef0123456789-241983636';
const TEST_KEY = 'TEST-d0a26210-1f4b-4c3a-9e21-479f0400869e';
const OTHER_KEY = 'APP_USR-aaaaaaaa-1111-2222-3333-bbbbbbbbbbbb';

const NOTHING_STORED: StoredCredentialsContext = {
  hasStoredCredentials: false,
  storedPublicKey: null,
};

const ALREADY_STORED: StoredCredentialsContext = {
  hasStoredCredentials: true,
  storedPublicKey: KEY,
};

describe('parseMercadoPagoCredentials', () => {
  describe('a complete pair', () => {
    it('should_accept_a_production_pair', () => {
      expect(parseMercadoPagoCredentials({ accessToken: TOKEN, publicKey: KEY }, NOTHING_STORED)).toEqual({
        ok: true,
        intent: 'save',
        data: { accessToken: TOKEN, publicKey: KEY },
      });
    });

    it('should_accept_a_test_pair', () => {
      // Allowed on purpose: exercising the booking flow before launch is what
      // test credentials exist for. The persistent banner is what protects the
      // owner who forgets (design D8).
      const result = parseMercadoPagoCredentials(
        { accessToken: TEST_TOKEN, publicKey: TEST_KEY },
        NOTHING_STORED
      );

      expect(result.ok).toBe(true);
    });

    it('should_store_the_normalized_values_not_what_was_typed', () => {
      const result = parseMercadoPagoCredentials(
        { accessToken: `  ${TOKEN}\n`, publicKey: `${KEY}\r\n` },
        NOTHING_STORED
      );

      expect(result).toEqual({
        ok: true,
        intent: 'save',
        data: { accessToken: TOKEN, publicKey: KEY },
      });
    });
  });

  describe('the empty-token matrix (design D3)', () => {
    it('should_treat_an_entirely_empty_submission_as_unchanged', () => {
      expect(parseMercadoPagoCredentials({ accessToken: '', publicKey: '' }, ALREADY_STORED)).toEqual({
        ok: true,
        intent: 'unchanged',
      });
    });

    // The failure this rule exists for: the token field always renders empty,
    // so "empty means clear" would delete the owner's credentials every time
    // they saved an unrelated edit.
    it('should_not_treat_an_empty_token_as_a_request_to_clear', () => {
      const result = parseMercadoPagoCredentials(
        { accessToken: '', publicKey: KEY },
        ALREADY_STORED
      );

      expect(result).toEqual({ ok: true, intent: 'unchanged' });
    });

    it('should_reject_an_empty_token_when_the_public_key_changed', () => {
      const result = parseMercadoPagoCredentials(
        { accessToken: '', publicKey: OTHER_KEY },
        ALREADY_STORED
      );

      expect(result).toEqual({
        ok: false,
        fieldErrors: { form: 'token_required_for_key_change' },
      });
    });

    it('should_reject_a_public_key_alone_on_a_first_configuration', () => {
      expect(parseMercadoPagoCredentials({ accessToken: '', publicKey: KEY }, NOTHING_STORED)).toEqual({
        ok: false,
        fieldErrors: { form: 'incomplete_pair' },
      });
    });

    it('should_treat_a_whitespace_only_token_as_empty', () => {
      const result = parseMercadoPagoCredentials(
        { accessToken: '   \n', publicKey: KEY },
        ALREADY_STORED
      );

      expect(result).toEqual({ ok: true, intent: 'unchanged' });
    });

    it('should_treat_a_non_string_field_as_empty', () => {
      expect(parseMercadoPagoCredentials({ accessToken: null, publicKey: undefined }, ALREADY_STORED)).toEqual(
        { ok: true, intent: 'unchanged' }
      );
    });
  });

  describe('half a pair', () => {
    it('should_reject_a_token_with_no_public_key', () => {
      expect(parseMercadoPagoCredentials({ accessToken: TOKEN, publicKey: '' }, NOTHING_STORED)).toEqual({
        ok: false,
        fieldErrors: { form: 'incomplete_pair' },
      });
    });

    it('should_reject_a_token_with_no_public_key_even_when_credentials_are_stored', () => {
      expect(parseMercadoPagoCredentials({ accessToken: TOKEN, publicKey: '' }, ALREADY_STORED)).toEqual({
        ok: false,
        fieldErrors: { form: 'incomplete_pair' },
      });
    });
  });

  describe('the swap (design D9)', () => {
    // The most consequential rejection here. Stored the wrong way round, the
    // access token lands in the column that is served to every client.
    it('should_report_a_transposed_pair_at_form_level', () => {
      expect(parseMercadoPagoCredentials({ accessToken: KEY, publicKey: TOKEN }, NOTHING_STORED)).toEqual({
        ok: false,
        fieldErrors: { form: 'looks_swapped' },
      });
    });

    it('should_report_a_swap_rather_than_two_format_errors', () => {
      const result = parseMercadoPagoCredentials(
        { accessToken: KEY, publicKey: TOKEN },
        NOTHING_STORED
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.fieldErrors.accessToken).toBeUndefined();
        expect(result.fieldErrors.publicKey).toBeUndefined();
      }
    });

    it('should_report_a_swap_when_only_one_value_is_in_the_wrong_field', () => {
      // A public key in the token field with a malformed public key beside it
      // still reads as a transposition, which is the more useful thing to say.
      const result = parseMercadoPagoCredentials(
        { accessToken: KEY, publicKey: 'APP_USR-broken' },
        NOTHING_STORED
      );

      expect(result).toEqual({ ok: false, fieldErrors: { form: 'looks_swapped' } });
    });
  });

  describe('environment consistency (design D8)', () => {
    it('should_reject_a_test_token_with_a_production_public_key', () => {
      expect(parseMercadoPagoCredentials({ accessToken: TEST_TOKEN, publicKey: KEY }, NOTHING_STORED)).toEqual(
        { ok: false, fieldErrors: { form: 'environment_mismatch' } }
      );
    });

    it('should_reject_a_production_token_with_a_test_public_key', () => {
      expect(parseMercadoPagoCredentials({ accessToken: TOKEN, publicKey: TEST_KEY }, NOTHING_STORED)).toEqual(
        { ok: false, fieldErrors: { form: 'environment_mismatch' } }
      );
    });

    // An unrecognized prefix has no environment to disagree with; saying
    // "mismatch" would name a mistake the owner did not make.
    it('should_report_a_format_error_rather_than_a_mismatch_for_an_unknown_prefix', () => {
      const result = parseMercadoPagoCredentials(
        { accessToken: 'BEARER-1-2-3456', publicKey: KEY },
        NOTHING_STORED
      );

      expect(result).toEqual({ ok: false, fieldErrors: { accessToken: 'invalid_format' } });
    });
  });

  describe('malformed values', () => {
    it('should_report_a_malformed_token_on_its_own_field', () => {
      expect(parseMercadoPagoCredentials({ accessToken: 'APP_USR-nope', publicKey: KEY }, NOTHING_STORED)).toEqual(
        { ok: false, fieldErrors: { accessToken: 'invalid_format' } }
      );
    });

    it('should_report_a_malformed_public_key_on_its_own_field', () => {
      expect(
        parseMercadoPagoCredentials({ accessToken: TOKEN, publicKey: 'APP_USR-d0a26210-1f4b' }, NOTHING_STORED)
      ).toEqual({ ok: false, fieldErrors: { publicKey: 'invalid_format' } });
    });

    it('should_report_both_fields_when_both_are_malformed', () => {
      expect(
        parseMercadoPagoCredentials({ accessToken: 'APP_USR-nope', publicKey: 'APP_USR-also-nope' }, NOTHING_STORED)
      ).toEqual({
        ok: false,
        fieldErrors: { accessToken: 'invalid_format', publicKey: 'invalid_format' },
      });
    });
  });

  describe('the six rejections stay distinct (spec requirement)', () => {
    it('should_produce_a_different_code_for_each_distinct_mistake', () => {
      const codes = [
        parseMercadoPagoCredentials({ accessToken: 'APP_USR-nope', publicKey: KEY }, NOTHING_STORED),
        parseMercadoPagoCredentials({ accessToken: TOKEN, publicKey: 'APP_USR-nope-key' }, NOTHING_STORED),
        parseMercadoPagoCredentials({ accessToken: KEY, publicKey: TOKEN }, NOTHING_STORED),
        parseMercadoPagoCredentials({ accessToken: TEST_TOKEN, publicKey: KEY }, NOTHING_STORED),
        parseMercadoPagoCredentials({ accessToken: TOKEN, publicKey: '' }, NOTHING_STORED),
        parseMercadoPagoCredentials({ accessToken: '', publicKey: OTHER_KEY }, ALREADY_STORED),
      ].map((r) => (r.ok ? 'ok' : JSON.stringify(r.fieldErrors)));

      expect(new Set(codes).size).toBe(6);
    });
  });
});
