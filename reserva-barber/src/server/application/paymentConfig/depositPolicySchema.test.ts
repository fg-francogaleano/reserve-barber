import { describe, it, expect } from 'vitest';
import {
  parseDepositPolicy,
  type DepositFieldErrors,
} from './depositPolicySchema';
import type { DepositPolicyInput } from '@/server/domain/models/PaymentConfig';

function expectOk(result: ReturnType<typeof parseDepositPolicy>): DepositPolicyInput {
  if (!result.ok) {
    throw new Error(`expected ok, got field errors: ${JSON.stringify(result.fieldErrors)}`);
  }
  return result.data;
}

function expectErrors(result: ReturnType<typeof parseDepositPolicy>): DepositFieldErrors {
  if (result.ok) {
    throw new Error(`expected field errors, but the parse succeeded with ${JSON.stringify(result.data)}`);
  }
  return result.fieldErrors;
}

describe('depositPolicySchema - the type is submitted, never defaulted', () => {
  /**
   * The column defaults to PERCENT so that PC1's and PC2's writes can create
   * the row without choosing a policy. Adopting that default here would store a
   * `50` meant as fifty pesos as fifty percent, and neither half of that pair
   * looks wrong on its own.
   */
  it('should_reject_a_missing_type', () => {
    expect(expectErrors(parseDepositPolicy({ type: undefined, value: '50' })).type).toBe('required');
  });

  it('should_reject_an_empty_type', () => {
    expect(expectErrors(parseDepositPolicy({ type: '', value: '50' })).type).toBe('required');
  });

  it.each(['percent', 'PORCENTAJE', 'FIXED_AMOUNT', 'DROP TABLE'])(
    'should_reject_%s_as_an_unrecognized_type',
    (type) => {
      expect(expectErrors(parseDepositPolicy({ type, value: '50' })).type).toBe('invalid_type');
    }
  );

  it('should_not_carry_an_unrecognized_type_into_the_result', () => {
    const result = parseDepositPolicy({ type: 'PERCENT_OF_SOMETHING', value: '50' });
    expect(result.ok).toBe(false);
  });
});

describe('depositPolicySchema - percentage', () => {
  it('should_accept_a_whole_percentage', () => {
    expect(expectOk(parseDepositPolicy({ type: 'PERCENT', value: '30' }))).toEqual({
      type: 'PERCENT',
      value: '30',
    });
  });

  it('should_accept_one_hundred_percent_as_full_prepayment', () => {
    expect(expectOk(parseDepositPolicy({ type: 'PERCENT', value: '100' })).value).toBe('100');
  });

  it('should_accept_one_percent', () => {
    expect(expectOk(parseDepositPolicy({ type: 'PERCENT', value: '1' })).value).toBe('1');
  });

  it('should_trim_surrounding_whitespace', () => {
    expect(expectOk(parseDepositPolicy({ type: 'PERCENT', value: '  30  ' })).value).toBe('30');
  });

  it.each(['12,5', '12.5', '0.5'])('should_reject_%s_as_a_fractional_percentage', (value) => {
    expect(expectErrors(parseDepositPolicy({ type: 'PERCENT', value })).value).toBe('not_whole');
  });

  it.each(['0', '101', '1000'])('should_reject_%s_as_out_of_range', (value) => {
    expect(expectErrors(parseDepositPolicy({ type: 'PERCENT', value })).value).toBe('out_of_range');
  });

  it.each(['1e2', '-5', '+5', 'abc', '٥٠'])(
    'should_reject_%s_as_an_invalid_percentage_format',
    (value) => {
      expect(expectErrors(parseDepositPolicy({ type: 'PERCENT', value })).value).toBe(
        'invalid_format'
      );
    }
  );
});

describe('depositPolicySchema - fixed amount', () => {
  it('should_accept_an_integer_amount', () => {
    expect(expectOk(parseDepositPolicy({ type: 'FIXED', value: '2000' }))).toEqual({
      type: 'FIXED',
      value: '2000.00',
    });
  });

  it('should_accept_a_comma_decimal_separator', () => {
    expect(expectOk(parseDepositPolicy({ type: 'FIXED', value: '2000,50' })).value).toBe('2000.50');
  });

  it('should_reject_zero', () => {
    expect(expectErrors(parseDepositPolicy({ type: 'FIXED', value: '0' })).value).toBe(
      'out_of_range'
    );
  });

  it('should_reject_a_value_above_the_catalogue_ceiling', () => {
    expect(expectErrors(parseDepositPolicy({ type: 'FIXED', value: '10000000' })).value).toBe(
      'too_large'
    );
  });

  /**
   * Grouped input is ambiguous and is refused rather than interpreted, exactly
   * as the service catalogue refuses it — same parser, same code.
   */
  it('should_reject_a_thousands_grouped_amount', () => {
    expect(expectErrors(parseDepositPolicy({ type: 'FIXED', value: '8.000,50' })).value).toBe(
      'thousands_separator'
    );
  });

  it('should_reject_three_decimal_places', () => {
    expect(expectErrors(parseDepositPolicy({ type: 'FIXED', value: '2000.505' })).value).toBe(
      'too_many_decimals'
    );
  });
});

describe('depositPolicySchema - the empty value is required, never a removal', () => {
  it.each(['', '   '])('should_reject_%s_as_required_for_a_percentage', (value) => {
    expect(expectErrors(parseDepositPolicy({ type: 'PERCENT', value })).value).toBe('required');
  });

  it.each(['', '   '])('should_reject_%s_as_required_for_a_fixed_amount', (value) => {
    expect(expectErrors(parseDepositPolicy({ type: 'FIXED', value })).value).toBe('required');
  });

  it('should_reject_a_missing_value', () => {
    expect(expectErrors(parseDepositPolicy({ type: 'PERCENT', value: undefined })).value).toBe(
      'required'
    );
  });
});

describe('depositPolicySchema - the echoed value round-trips', () => {
  /**
   * The form echoes the canonical value back into the input, so the owner can
   * press save again without editing. If canonical output were not accepted as
   * input, a save would succeed and the identical second save would fail —
   * which is exactly what an es-AR rendering in the field would cause.
   */
  it.each(['2000', '2000,50', '8000.5', '0,99'])(
    'should_accept_its_own_output_for_%s',
    (raw) => {
      const first = expectOk(parseDepositPolicy({ type: 'FIXED', value: raw }));
      const second = expectOk(parseDepositPolicy({ type: 'FIXED', value: first.value }));
      expect(second.value).toBe(first.value);
    }
  );

  it.each(['30', '1', '100', '030'])('should_accept_its_own_output_for_percent_%s', (raw) => {
    const first = expectOk(parseDepositPolicy({ type: 'PERCENT', value: raw }));
    const second = expectOk(parseDepositPolicy({ type: 'PERCENT', value: first.value }));
    expect(second.value).toBe(first.value);
  });
});

describe('depositPolicySchema - each mistake has its own code', () => {
  it('should_distinguish_out_of_range_from_fractional', () => {
    const outOfRange = expectErrors(parseDepositPolicy({ type: 'PERCENT', value: '101' })).value;
    const fractional = expectErrors(parseDepositPolicy({ type: 'PERCENT', value: '12.5' })).value;
    expect(outOfRange).not.toBe(fractional);
  });

  it('should_distinguish_a_type_error_from_a_value_error', () => {
    const errors = expectErrors(parseDepositPolicy({ type: 'nonsense', value: '' }));
    expect(errors.type).toBe('invalid_type');
    expect(errors.value).toBeUndefined();
  });
});
