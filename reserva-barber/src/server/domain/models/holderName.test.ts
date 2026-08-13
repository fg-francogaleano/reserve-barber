import { describe, it, expect } from 'vitest';
import { normalizeHolderName, checkHolderName } from './holderName';

describe('normalizeHolderName', () => {
  it('should_collapse_internal_whitespace_and_trim', () => {
    expect(normalizeHolderName('  Barberia   Franco  ')).toBe('Barberia Franco');
  });

  it('should_discard_a_bidirectional_override', () => {
    // U+202E reverses rendering, so a name carrying it displays as something
    // other than what is stored.
    expect(normalizeHolderName('Franco‮G')).toBe('FrancoG');
  });

  it('should_discard_zero_width_characters', () => {
    expect(normalizeHolderName('Fran​co')).toBe('Franco');
  });

  it('should_reduce_a_whitespace_only_value_to_empty', () => {
    expect(normalizeHolderName('   ')).toBe('');
  });

  it('should_reduce_a_value_of_only_invisible_characters_to_empty', () => {
    expect(normalizeHolderName('​‮')).toBe('');
  });

  it('should_preserve_accented_letters', () => {
    expect(normalizeHolderName('Martín Núñez')).toBe('Martín Núñez');
  });
});

describe('checkHolderName', () => {
  it('should_accept_a_plain_name', () => {
    expect(checkHolderName('Franco Galeano')).toBeNull();
  });

  it('should_accept_accents_and_the_spanish_n', () => {
    expect(checkHolderName('Martín Núñez')).toBeNull();
  });

  it('should_accept_an_apostrophe_a_hyphen_and_a_period', () => {
    expect(checkHolderName("O'Brien-Sanz Jr.")).toBeNull();
  });

  it('should_accept_a_name_at_the_minimum_length', () => {
    expect(checkHolderName('Al')).toBeNull();
  });

  it('should_accept_a_name_at_the_maximum_length', () => {
    expect(checkHolderName('a'.repeat(120))).toBeNull();
  });

  it('should_reject_a_name_above_the_maximum_length', () => {
    expect(checkHolderName('a'.repeat(121))).toBe('invalid_length');
  });

  it('should_reject_a_single_character_name', () => {
    expect(checkHolderName('A')).toBe('invalid_length');
  });

  it('should_reject_a_name_containing_markup', () => {
    expect(checkHolderName('<script>alert(1)</script>')).toBe('invalid_chars');
  });

  it('should_reject_a_name_containing_an_angle_bracket', () => {
    expect(checkHolderName('Franco <Galeano')).toBe('invalid_chars');
  });

  it('should_reject_a_name_containing_digits', () => {
    // An account holder is a person or a company name, never a number, and
    // allowing digits widens the whitelist for no real case.
    expect(checkHolderName('Cuenta 12345')).toBe('invalid_chars');
  });

  it('should_reject_an_empty_value_as_malformed_rather_than_short', () => {
    expect(checkHolderName('')).toBe('invalid_chars');
  });

  it('should_reject_a_control_character_that_normalization_does_not_strip', () => {
    // normalizeName removes zero-width and bidi characters but not C0 controls,
    // so the whitelist is what stops this one. Written as an escape so the test
    // does not depend on an invisible byte surviving an edit.
    expect(checkHolderName(`Franco${String.fromCharCode(7)}`)).toBe('invalid_chars');
  });
});
