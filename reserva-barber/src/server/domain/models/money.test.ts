import { describe, it, expect } from 'vitest';
import {
  parseAmount,
  formatAmount,
  toCents,
  fromCents,
  MAX_PRICE,
  type MoneyError,
} from './money';

/** Narrows the result and fails loudly when the parse went the other way. */
function expectOk(result: ReturnType<typeof parseAmount>): string {
  if (!result.ok) {
    throw new Error(`expected ok, got code: ${result.code}`);
  }
  return result.value;
}

function expectCode(result: ReturnType<typeof parseAmount>, code: MoneyError) {
  if (result.ok) {
    throw new Error(`expected ${code}, but the parse succeeded with ${result.value}`);
  }
  expect(result.code).toBe(code);
}

describe('money - accepted forms', () => {
  it('should_accept_an_integer', () => {
    expect(expectOk(parseAmount('8000'))).toBe('8000.00');
  });

  it('should_accept_a_dot_decimal_separator', () => {
    expect(expectOk(parseAmount('8000.50'))).toBe('8000.50');
  });

  it('should_accept_a_comma_decimal_separator', () => {
    expect(expectOk(parseAmount('8000,50'))).toBe('8000.50');
  });

  it('should_canonicalize_a_single_decimal_place_to_two', () => {
    expect(expectOk(parseAmount('8000.5'))).toBe('8000.50');
  });

  it('should_strip_leading_zeros', () => {
    expect(expectOk(parseAmount('0008000'))).toBe('8000.00');
  });

  it('should_keep_a_single_zero_integer_part', () => {
    expect(expectOk(parseAmount('0.50'))).toBe('0.50');
  });

  it('should_trim_surrounding_whitespace', () => {
    expect(expectOk(parseAmount('  8000,50  '))).toBe('8000.50');
  });

  it('should_accept_the_ceiling_itself', () => {
    expect(expectOk(parseAmount('9999999.99'))).toBe('9999999.99');
  });
});

describe('money - rejected forms', () => {
  it('should_reject_an_empty_string_as_required', () => {
    expectCode(parseAmount(''), 'required');
  });

  it('should_reject_whitespace_only_as_required', () => {
    expectCode(parseAmount('   '), 'required');
  });

  /**
   * Grouped input is refused rather than interpreted: `4.500` means four
   * thousand five hundred under es-AR grouping and four and a half under a dot
   * decimal, and no rule recovers which the owner meant.
   */
  it.each(['4.500', '4,500', '1.234.567', '8.000,50', '4,500.50'])(
    'should_reject_%s_as_an_ambiguous_thousands_separator',
    (raw) => {
      expectCode(parseAmount(raw), 'thousands_separator');
    }
  );

  it('should_reject_three_decimal_places_rather_than_rounding', () => {
    expectCode(parseAmount('8000.505'), 'too_many_decimals');
  });

  it.each(['1e5', 'Infinity', '-0', '+5', 'abc', '8000..50', '8 000', '٥٠٠'])(
    'should_reject_%s_as_an_invalid_format',
    (raw) => {
      expectCode(parseAmount(raw), 'invalid_format');
    }
  );

  it('should_reject_a_value_above_the_ceiling', () => {
    expectCode(parseAmount('10000000'), 'too_large');
  });

  it('should_reject_an_absurdly_long_input_without_converting_it', () => {
    expectCode(parseAmount('9'.repeat(40)), 'too_large');
  });
});

describe('money - cents conversion', () => {
  it('should_convert_a_canonical_amount_to_integer_cents', () => {
    expect(toCents('8000.50')).toBe(800050);
  });

  it('should_convert_a_whole_amount_to_integer_cents', () => {
    expect(toCents('3000.00')).toBe(300000);
  });

  it('should_convert_cents_back_to_a_canonical_amount', () => {
    expect(fromCents(800050)).toBe('8000.50');
  });

  it('should_pad_a_sub_peso_amount_when_converting_back', () => {
    expect(fromCents(50)).toBe('0.50');
  });

  it('should_round_trip_without_drifting', () => {
    for (const amount of ['0.01', '0.50', '2501.67', '9999999.99']) {
      expect(fromCents(toCents(amount))).toBe(amount);
    }
  });

  /**
   * The invariant "already canonical" is enforced here rather than documented.
   *
   * This exact shape shipped a money defect in PC3: the driver returns
   * `2000.5` for a stored `2000.50`, and reading the lone `5` as five centavos
   * turned $2000,50 into $2000,05. That was fixed at the repository boundary,
   * which left the trap loaded for the next caller — B4 computing a deposit,
   * B5 charging it, D5 counting it. A one-digit fraction is tenths, not
   * hundredths, and this function now says so.
   */
  it.each([
    ['2000.5', 200050],
    ['2000.50', 200050],
    ['0.5', 50],
    ['0.05', 5],
    ['2000', 200000],
    ['2000.', 200000],
  ])('should_read_%s_as_%i_cents', (raw, cents) => {
    expect(toCents(raw)).toBe(cents);
  });

  it('should_not_let_a_one_digit_fraction_become_centavos', () => {
    // The defect, stated as its own case: these two are the same amount.
    expect(toCents('2000.5')).toBe(toCents('2000.50'));
    expect(fromCents(toCents('2000.5'))).toBe('2000.50');
  });

  /**
   * The reason this module exists. `2501.67 * 0.3` is 750.5009999999999 in
   * IEEE-754; integer cents make the same operation exact.
   */
  it('should_multiply_without_floating_point_error', () => {
    expect(toCents('2501.67') * 30).toBe(7505010);
  });
});

describe('money - es-AR formatting', () => {
  it('should_format_a_thousands_grouped_amount', () => {
    expect(formatAmount('8000.50')).toBe('8.000,50');
  });

  it('should_format_a_whole_amount', () => {
    expect(formatAmount('3000.00')).toBe('3.000,00');
  });

  it('should_format_a_sub_peso_amount', () => {
    expect(formatAmount('0.50')).toBe('0,50');
  });

  it('should_format_a_millions_amount', () => {
    expect(formatAmount('1234567.89')).toBe('1.234.567,89');
  });
});

describe('money - the ceiling is declared once', () => {
  it('should_expose_the_shared_ceiling', () => {
    expect(MAX_PRICE).toBe(9_999_999.99);
  });
});
