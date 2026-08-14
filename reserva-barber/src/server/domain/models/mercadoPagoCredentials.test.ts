import { describe, it, expect } from 'vitest';
import {
  normalizeCredential,
  checkAccessToken,
  checkPublicKey,
  looksSwapped,
  credentialEnvironment,
  credentialLastFour,
} from './mercadoPagoCredentials';

/*
 * Fixtures follow the shapes in Mercado Pago's official API reference example
 * (recorded in the module header, confirmed 2026-08-13). The account id is the
 * trailing segment: 241983636 in the token below, matching `user_id` in that
 * same example.
 */
const PROD_TOKEN = 'APP_USR-4934588586838432-081312-abcdef0123456789abcdef0123456789-241983636';
const PROD_KEY = 'APP_USR-d0a26210-1f4b-4c3a-9e21-479f0400869e';
const TEST_TOKEN = 'TEST-4934588586838432-081312-abcdef0123456789abcdef0123456789-241983636';
const TEST_KEY = 'TEST-d0a26210-1f4b-4c3a-9e21-479f0400869e';

describe('normalizeCredential', () => {
  it('should_strip_a_trailing_newline', () => {
    // The failure this exists for: a value copied from Mercado Pago's dashboard
    // passes every shape check and then produces a 401 at payment time.
    expect(normalizeCredential(`${PROD_TOKEN}\n`)).toBe(PROD_TOKEN);
  });

  it('should_strip_surrounding_whitespace', () => {
    expect(normalizeCredential(`   ${PROD_TOKEN}  `)).toBe(PROD_TOKEN);
  });

  it('should_strip_a_non_breaking_space', () => {
    expect(normalizeCredential(`${PROD_TOKEN} `)).toBe(PROD_TOKEN);
  });

  it('should_strip_a_zero_width_character', () => {
    expect(normalizeCredential(`APP_USR​-4934588586838432-081312-abcdef0123456789abcdef0123456789-241983636`)).toBe(
      PROD_TOKEN
    );
  });

  it('should_strip_a_byte_order_mark', () => {
    expect(normalizeCredential(`﻿${PROD_TOKEN}`)).toBe(PROD_TOKEN);
  });

  it('should_strip_a_bidirectional_override', () => {
    expect(normalizeCredential(`${PROD_TOKEN}‮`)).toBe(PROD_TOKEN);
  });

  it('should_rejoin_a_value_broken_across_lines', () => {
    // An email client wrapping a pasted credential. Trimming alone would leave
    // the break in the middle and store a broken value.
    const wrapped = 'APP_USR-4934588586838432-081312-\r\nabcdef0123456789abcdef0123456789-241983636';
    expect(normalizeCredential(wrapped)).toBe(PROD_TOKEN);
  });

  it('should_reduce_a_whitespace_only_value_to_empty', () => {
    expect(normalizeCredential('   \n\t ')).toBe('');
  });

  it('should_reduce_a_value_of_only_invisible_characters_to_empty', () => {
    expect(normalizeCredential('​‮﻿')).toBe('');
  });

  // The normalized value must be what validation sees, not merely what is
  // stored — otherwise a value is accepted in one shape and persisted in
  // another.
  it('should_produce_a_value_that_then_validates', () => {
    expect(checkAccessToken(normalizeCredential(`  ${PROD_TOKEN}\n`))).toBeNull();
  });
});

describe('credentialEnvironment', () => {
  /*
   * Corrected 2026-08-13 against a real Mercado Pago account. The original rule
   * read `APP_USR-` as "production", which is true of OAuth-issued credentials
   * and false of the ones owners actually paste: the "Tus integraciones" panel
   * issues `APP_USR-` for **test and production alike**.
   *
   * The consequence was worse than a missing feature — the page printed
   * "Producción" over a test credential, which reads as confirmation and
   * destroys exactly the doubt the display existed to create. Unknown must stay
   * unknown.
   */
  it('should_not_claim_production_from_the_app_usr_prefix', () => {
    expect(credentialEnvironment(PROD_TOKEN)).toBeNull();
    expect(credentialEnvironment(PROD_KEY)).toBeNull();
  });

  it('should_detect_test_only_from_the_explicit_test_prefix', () => {
    expect(credentialEnvironment(TEST_TOKEN)).toBe('test');
    expect(credentialEnvironment(TEST_KEY)).toBe('test');
  });

  it('should_return_null_for_an_unrecognized_prefix', () => {
    // Reported by the caller as a format error, never as a mismatch: there is
    // no environment to disagree with.
    expect(credentialEnvironment('BEARER-something-else')).toBeNull();
  });

  it('should_still_separate_a_legacy_test_credential_from_an_app_usr_one', () => {
    // The only mismatch this can still catch, and it is worth keeping.
    expect(credentialEnvironment(TEST_TOKEN)).not.toBe(credentialEnvironment(PROD_TOKEN));
  });
});

describe('checkAccessToken', () => {
  it('should_accept_a_production_token', () => {
    expect(checkAccessToken(PROD_TOKEN)).toBeNull();
  });

  it('should_accept_a_test_token', () => {
    expect(checkAccessToken(TEST_TOKEN)).toBeNull();
  });

  // Design D9's headline case. A public key stored as the access token is
  // merely broken; the reverse publishes a live bearer credential to every
  // client, so the pair must be caught before either is written.
  it('should_report_a_public_key_as_swapped_not_as_malformed', () => {
    expect(checkAccessToken(PROD_KEY)).toBe('looks_swapped');
  });

  it('should_report_a_test_public_key_as_swapped', () => {
    expect(checkAccessToken(TEST_KEY)).toBe('looks_swapped');
  });

  it.each([
    ['empty', ''],
    ['no prefix', '4934588586838432-081312-abcdef-241983636'],
    ['prefix only', 'APP_USR-'],
    ['too few segments', 'APP_USR-4934588586838432'],
    ['too short', 'APP_USR-1-2-3'],
    ['a bare word', 'APP_USR-notacredential'],
  ])('should_reject_a_malformed_token_%s', (_label, value) => {
    expect(checkAccessToken(value)).toBe('invalid_format');
  });

  it('should_reject_a_value_longer_than_any_real_credential', () => {
    expect(checkAccessToken(`APP_USR-${'a'.repeat(300)}-1-2`)).toBe('invalid_format');
  });

  // Deliberately loose about middle segments: the reference's own two examples
  // disagree on their count and length, and rejecting a real token from an
  // unseen issuer blocks the owner completely.
  it('should_accept_a_token_whose_middle_segments_differ_from_the_reference', () => {
    expect(checkAccessToken('APP_USR-1585551492-030918-25aa33bb44cc55dd-2880736')).toBeNull();
    expect(checkAccessToken('APP_USR-4934588586838432-XXXXXXXX-241983636')).toBeNull();
  });
});

describe('checkPublicKey', () => {
  it('should_accept_a_production_public_key', () => {
    expect(checkPublicKey(PROD_KEY)).toBeNull();
  });

  it('should_accept_a_test_public_key', () => {
    expect(checkPublicKey(TEST_KEY)).toBeNull();
  });

  it('should_accept_an_uppercase_uuid', () => {
    // Same key, retyped. Rejecting it would be wrong.
    expect(checkPublicKey(PROD_KEY.toUpperCase())).toBeNull();
  });

  it('should_report_an_access_token_as_swapped_not_as_malformed', () => {
    expect(checkPublicKey(PROD_TOKEN)).toBe('looks_swapped');
  });

  it.each([
    ['empty', ''],
    ['no prefix', 'd0a26210-1f4b-4c3a-9e21-479f0400869e'],
    ['truncated uuid', 'APP_USR-d0a26210-1f4b-4c3a-9e21'],
    ['not hex', 'APP_USR-zzzzzzzz-1f4b-4c3a-9e21-479f0400869e'],
  ])('should_reject_a_malformed_public_key_%s', (_label, value) => {
    expect(checkPublicKey(value)).toBe('invalid_format');
  });
});

describe('looksSwapped', () => {
  it('should_detect_the_pair_in_each_others_fields', () => {
    expect(looksSwapped(PROD_KEY, PROD_TOKEN)).toBe(true);
  });

  it('should_not_fire_on_a_correct_pair', () => {
    expect(looksSwapped(PROD_TOKEN, PROD_KEY)).toBe(false);
  });

  it('should_not_fire_when_only_one_value_is_malformed', () => {
    expect(looksSwapped('garbage', PROD_KEY)).toBe(false);
    expect(looksSwapped(PROD_TOKEN, 'garbage')).toBe(false);
  });
});

/*
 * The `accountIdFromToken` suite lived here, and so did an invariant tying it
 * to `checkAccessToken`. Both are gone with the function (2026-08-13).
 *
 * They passed. That was the problem: every fixture came from the OAuth
 * reference example, where the token really does end in the `user_id`. The
 * tests confirmed the code matched the example, not that the example matched
 * the credentials owners paste. A real panel-issued token ended in 1325562541
 * while the owner's User ID was 156842883.
 *
 * Task 2.6 existed to catch exactly this, and did — but only because it
 * demanded a REAL credential rather than another fixture. Keep that shape of
 * check for anything derived from a third party's format.
 */

describe('credentialLastFour', () => {
  it('should_return_the_last_four_characters', () => {
    expect(credentialLastFour(PROD_TOKEN)).toBe('3636');
  });

  it('should_return_null_for_a_null_value', () => {
    expect(credentialLastFour(null)).toBeNull();
  });

  it('should_return_null_rather_than_the_whole_value_when_it_is_too_short', () => {
    expect(credentialLastFour('abc')).toBeNull();
  });
});
