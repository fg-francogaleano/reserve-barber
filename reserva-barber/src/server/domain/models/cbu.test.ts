import { describe, it, expect } from 'vitest';
import {
  normalizeCbu,
  checkCbu,
  normalizeAlias,
  checkAlias,
  formatCbu,
  cbuLastFour,
} from './cbu';

/**
 * Fixture provenance matters here more than anywhere else in the project, so it
 * is recorded rather than assumed (design D2).
 *
 * INDEPENDENT — a published, fully worked example whose arithmetic was verified
 * by hand against the weight tables before this module was written: block one
 * sums to 81 (check digit 9), block two to 139 (check digit 1). This is the
 * fixture that actually falsifies a wrong weight table.
 */
const VERIFIED_CBU = '2850590940090418135201';

/**
 * CORROBORATING — real institutional prefixes whose block-1 check digit the
 * algorithm reproduces. `011` + branch `0599` yields check digit 5 (`01105995`,
 * Banco de la Nación Argentina), and `000` + `0003` yields 1 (`00000031`),
 * which is the prefix every Mercado Pago CVU actually starts with. Two real
 * prefixes agreeing with the block-1 table is independent evidence; their
 * account halves are constructed, so block two is only self-consistent.
 */
const DERIVED_NACION_CBU = '0110599520000012345678';
const DERIVED_MERCADO_PAGO_CVU = '0000003100000001234565';

/**
 * PENDING — a real CBU and a real CVU, from accounts at banks other than the
 * fixture above, still have to be run through `checkCbu` before this validator
 * is trusted in production. See task 2.4: if either fails, the fallback is a
 * soft warning, never adjusting the weights until the fixtures pass.
 */

/** Swaps two adjacent body digits, which is the mistake the checksum exists to catch. */
function transpose(cbu: string, index: number): string {
  const digits = cbu.split('');
  [digits[index], digits[index + 1]] = [digits[index + 1], digits[index]];
  return digits.join('');
}

describe('checkCbu', () => {
  it('should_accept_the_independently_verified_cbu', () => {
    expect(checkCbu(VERIFIED_CBU)).toBeNull();
  });

  it('should_accept_a_cbu_built_on_a_real_bank_prefix', () => {
    expect(checkCbu(DERIVED_NACION_CBU)).toBeNull();
  });

  it('should_accept_a_cvu_built_on_a_real_provider_prefix', () => {
    expect(checkCbu(DERIVED_MERCADO_PAGO_CVU)).toBeNull();
  });

  it('should_reject_when_two_digits_of_the_first_block_are_transposed', () => {
    expect(checkCbu(transpose(VERIFIED_CBU, 4))).toBe('invalid_checksum');
  });

  it('should_reject_when_two_digits_of_the_second_block_are_transposed', () => {
    expect(checkCbu(transpose(VERIFIED_CBU, 14))).toBe('invalid_checksum');
  });

  it('should_reject_a_transposition_in_every_fixture', () => {
    for (const fixture of [VERIFIED_CBU, DERIVED_NACION_CBU, DERIVED_MERCADO_PAGO_CVU]) {
      expect(checkCbu(transpose(fixture, 15))).toBe('invalid_checksum');
    }
  });

  it('should_reject_a_single_altered_digit', () => {
    const altered = `${VERIFIED_CBU.slice(0, 21)}${(Number(VERIFIED_CBU[21]) + 1) % 10}`;
    expect(checkCbu(altered)).toBe('invalid_checksum');
  });

  it('should_reject_a_value_of_twenty_one_digits', () => {
    expect(checkCbu(VERIFIED_CBU.slice(0, 21))).toBe('invalid_length');
  });

  it('should_reject_a_value_of_twenty_three_digits', () => {
    expect(checkCbu(`${VERIFIED_CBU}0`)).toBe('invalid_length');
  });

  it('should_reject_a_value_containing_letters', () => {
    expect(checkCbu('285059094009041813520a')).toBe('invalid_chars');
  });

  it('should_reject_an_empty_value_as_malformed_rather_than_short', () => {
    expect(checkCbu('')).toBe('invalid_chars');
  });

  it('should_report_length_before_checksum', () => {
    // A short value has no check digit to compare, so reporting a checksum
    // failure would name a mistake the owner did not make.
    expect(checkCbu('123')).toBe('invalid_length');
  });
});

describe('normalizeCbu', () => {
  it('should_strip_spaces_from_a_pasted_value', () => {
    expect(normalizeCbu('2850 5909 4009 0418 1352 01')).toBe(VERIFIED_CBU);
  });

  it('should_strip_hyphens_and_a_trailing_newline', () => {
    expect(normalizeCbu(`28505909-40090418135201\n`)).toBe(VERIFIED_CBU);
  });

  it('should_leave_letters_in_place_so_they_are_reported_as_malformed', () => {
    // Stripping every non-digit would turn this into a short numeric value and
    // report a length problem, explaining the wrong mistake.
    expect(checkCbu(normalizeCbu('28505909abc40090418135201'))).toBe('invalid_chars');
  });
});

describe('checkAlias', () => {
  it('should_accept_an_alias_at_the_minimum_length', () => {
    expect(checkAlias('abcdef')).toBeNull();
  });

  it('should_accept_an_alias_at_the_maximum_length', () => {
    expect(checkAlias('a'.repeat(20))).toBeNull();
  });

  it('should_accept_separators_inside_the_alias', () => {
    expect(checkAlias('mi.barberia-01')).toBeNull();
  });

  it('should_reject_an_alias_below_the_minimum_length', () => {
    expect(checkAlias('abcde')).toBe('invalid_length');
  });

  it('should_reject_an_alias_above_the_maximum_length', () => {
    expect(checkAlias('a'.repeat(21))).toBe('invalid_length');
  });

  it('should_reject_an_alias_containing_a_space', () => {
    expect(checkAlias('mi barberia')).toBe('invalid_chars');
  });

  it('should_reject_an_alias_containing_an_underscore', () => {
    expect(checkAlias('mi_barberia')).toBe('invalid_chars');
  });

  it('should_reject_an_alias_beginning_with_a_separator', () => {
    expect(checkAlias('.mibarberia')).toBe('invalid_chars');
  });

  it('should_reject_an_alias_ending_with_a_separator', () => {
    expect(checkAlias('mibarberia-')).toBe('invalid_chars');
  });

  it('should_reject_an_empty_alias', () => {
    expect(checkAlias('')).toBe('invalid_chars');
  });
});

describe('normalizeAlias', () => {
  it('should_lowercase_and_trim', () => {
    expect(normalizeAlias('  Mi.Barberia  ')).toBe('mi.barberia');
  });

  it('should_produce_a_value_that_passes_validation', () => {
    expect(checkAlias(normalizeAlias('MI.BARBERIA'))).toBeNull();
  });
});

describe('formatCbu', () => {
  it('should_group_a_stored_value_into_blocks_of_four', () => {
    expect(formatCbu(VERIFIED_CBU)).toBe('2850 5909 4009 0418 1352 01');
  });

  it('should_round_trip_through_normalization', () => {
    expect(normalizeCbu(formatCbu(VERIFIED_CBU))).toBe(VERIFIED_CBU);
  });
});

describe('cbuLastFour', () => {
  it('should_return_the_last_four_digits', () => {
    expect(cbuLastFour(VERIFIED_CBU)).toBe('5201');
  });

  it('should_return_null_when_no_destination_is_stored', () => {
    expect(cbuLastFour(null)).toBeNull();
  });
});
