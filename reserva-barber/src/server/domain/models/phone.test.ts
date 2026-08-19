import { describe, it, expect } from 'vitest';
import { parsePhone } from './phone';

const NBSP = ' ';

describe('phone - equivalent spellings normalize to one value', () => {
  const EXPECTED = '+5491155554444';

  it('should_accept_e164_shaped_input_with_plus_and_separators', () => {
    expect(parsePhone('+54 9 11 5555-4444')).toEqual({ canonical: EXPECTED });
  });

  it('should_accept_the_legacy_trunk_and_mobile_marker_spelling', () => {
    expect(parsePhone('011 15 5555 4444')).toEqual({ canonical: EXPECTED });
  });

  it('should_accept_bare_ten_digits_with_no_markers', () => {
    expect(parsePhone('1155554444')).toEqual({ canonical: EXPECTED });
  });

  it('should_accept_a_leading_trunk_zero_with_no_legacy_marker', () => {
    expect(parsePhone('0 11 5555 4444')).toEqual({ canonical: EXPECTED });
  });

  it('should_tolerate_parentheses_around_the_area_code', () => {
    expect(parsePhone('(011) 15-5555-4444')).toEqual({ canonical: EXPECTED });
  });

  it('should_tolerate_a_non_breaking_space_as_a_separator', () => {
    expect(parsePhone(`011${NBSP}15${NBSP}5555${NBSP}4444`)).toEqual({ canonical: EXPECTED });
  });
});

describe('phone - rejection', () => {
  it('should_reject_an_empty_value', () => {
    expect(parsePhone('')).toEqual({ error: 'invalid_length' });
  });

  it('should_reject_a_whitespace_only_value', () => {
    expect(parsePhone('   ')).toEqual({ error: 'invalid_length' });
  });

  it('should_reject_letters', () => {
    expect(parsePhone('call me maybe')).toEqual({ error: 'invalid_chars' });
  });

  it('should_reject_a_digit_count_that_cannot_form_an_ar_number', () => {
    expect(parsePhone('555')).toEqual({ error: 'invalid_length' });
  });

  it('should_reject_a_wildly_oversized_value', () => {
    expect(parsePhone('1'.repeat(30))).toEqual({ error: 'invalid_length' });
  });

  it('should_reject_a_non_ar_country_code', () => {
    expect(parsePhone('+1 555 555 4444')).toEqual({ error: 'invalid_length' });
  });
});
