import { describe, it, expect } from 'vitest';
import { COPY } from '@/lib/copy';
import {
  toFormState,
  describePolicy,
  displayPercent,
  INITIAL_DEPOSIT_FORM_STATE,
  EMPTY_DEPOSIT_FORM_VALUES,
} from './formState';
import type { DepositValueError } from '@/server/application/paymentConfig/depositPolicySchema';

const PERCENT_VALUES = { type: 'PERCENT', value: '30' };
const FIXED_VALUES = { type: 'FIXED', value: '2000' };

describe('formState - displayPercent', () => {
  /**
   * The column is Decimal(12, 2), so 30 comes back as "30.00". Those decimals
   * are an artefact of storage, and the whole-number rule would reject them if
   * the field echoed them back into a save.
   */
  it.each([
    ['30.00', '30'],
    ['100.00', '100'],
    ['1.00', '1'],
    ['30', '30'],
  ])('should_render_%s_as_%s', (stored, shown) => {
    expect(displayPercent(stored)).toBe(shown);
  });
});

describe('formState - describePolicy', () => {
  it('should_render_a_percentage_with_its_sign_and_no_column_decimals', () => {
    expect(describePolicy('PERCENT', '30.00')).toBe('30%');
  });

  it('should_render_a_fixed_amount_in_es_AR_with_a_currency_sign', () => {
    expect(describePolicy('FIXED', '8000.50')).toBe('$8.000,50');
  });

  it('should_group_thousands_in_a_large_fixed_amount', () => {
    expect(describePolicy('FIXED', '1234567.89')).toBe('$1.234.567,89');
  });

  it('should_render_a_sub_peso_amount_without_a_leading_group', () => {
    expect(describePolicy('FIXED', '0.50')).toBe('$0,50');
  });

  /** An unconfigured policy has no value to describe. */
  it('should_render_a_placeholder_when_nothing_is_stored', () => {
    expect(describePolicy('PERCENT', null)).toBe(COPY.deposit.confirmNone);
    expect(describePolicy('FIXED', null)).toBe(COPY.deposit.confirmNone);
  });
});

describe('formState - toFormState maps type codes', () => {
  it('should_map_a_missing_type', () => {
    expect(toFormState({ type: 'required' }, EMPTY_DEPOSIT_FORM_VALUES).fieldErrors.type).toBe(
      COPY.deposit.typeRequired
    );
  });

  it('should_map_an_unrecognized_type', () => {
    expect(toFormState({ type: 'invalid_type' }, EMPTY_DEPOSIT_FORM_VALUES).fieldErrors.type).toBe(
      COPY.deposit.typeInvalid
    );
  });
});

describe('formState - toFormState maps value codes per submitted type', () => {
  /**
   * The same code means different things per type: `out_of_range` is "1 to 100"
   * for a percentage and "greater than zero" for an amount. Reporting the wrong
   * one sends the owner looking for a problem that is not there.
   */
  it('should_map_out_of_range_to_the_percentage_range', () => {
    expect(toFormState({ value: 'out_of_range' }, PERCENT_VALUES).fieldErrors.value).toBe(
      COPY.deposit.percentOutOfRange
    );
  });

  it('should_map_out_of_range_to_the_amount_rule', () => {
    expect(toFormState({ value: 'out_of_range' }, FIXED_VALUES).fieldErrors.value).toBe(
      COPY.deposit.fixedOutOfRange
    );
  });

  it('should_map_invalid_format_to_the_percentage_wording', () => {
    expect(toFormState({ value: 'invalid_format' }, PERCENT_VALUES).fieldErrors.value).toBe(
      COPY.deposit.percentInvalidFormat
    );
  });

  it('should_map_invalid_format_to_the_amount_wording', () => {
    expect(toFormState({ value: 'invalid_format' }, FIXED_VALUES).fieldErrors.value).toBe(
      COPY.deposit.fixedInvalidFormat
    );
  });

  it.each<[DepositValueError, string]>([
    ['required', COPY.deposit.valueRequired],
    ['not_whole', COPY.deposit.percentNotWhole],
    ['too_large', COPY.deposit.fixedTooLarge],
    ['thousands_separator', COPY.deposit.fixedThousandsSeparator],
    ['too_many_decimals', COPY.deposit.fixedTooManyDecimals],
  ])('should_map_%s_the_same_way_for_either_type', (code, message) => {
    expect(toFormState({ value: code }, PERCENT_VALUES).fieldErrors.value).toBe(message);
    expect(toFormState({ value: code }, FIXED_VALUES).fieldErrors.value).toBe(message);
  });

  /** Every code the parser can return must reach a message, or the owner sees nothing. */
  it('should_leave_no_value_code_unmapped', () => {
    const codes: DepositValueError[] = [
      'required',
      'thousands_separator',
      'too_many_decimals',
      'invalid_format',
      'too_large',
      'out_of_range',
      'not_whole',
    ];
    for (const code of codes) {
      for (const values of [PERCENT_VALUES, FIXED_VALUES]) {
        const message = toFormState({ value: code }, values).fieldErrors.value;
        expect(message).toBeDefined();
        expect(message).not.toBe('');
      }
    }
  });
});

describe('formState - toFormState carries the rest of the state', () => {
  it('should_echo_the_submitted_values_back', () => {
    expect(toFormState({ value: 'required' }, FIXED_VALUES).values).toEqual(FIXED_VALUES);
  });

  /** A rejected submission is never a success, and never a pending confirmation. */
  it('should_report_neither_success_nor_a_pending_confirmation', () => {
    const state = toFormState({ value: 'required' }, FIXED_VALUES);

    expect(state.saved).toBe(false);
    expect(state.removed).toBe(false);
    expect(state.pendingConfirmation).toBeNull();
    expect(state.pendingRemoval).toBeNull();
    expect(state.error).toBeNull();
  });

  it('should_carry_no_field_errors_when_none_were_reported', () => {
    expect(toFormState({}, FIXED_VALUES).fieldErrors).toEqual({});
  });
});

describe('formState - the initial state is inert', () => {
  it('should_start_with_nothing_reported', () => {
    expect(INITIAL_DEPOSIT_FORM_STATE).toEqual({
      error: null,
      fieldErrors: {},
      values: EMPTY_DEPOSIT_FORM_VALUES,
      saved: false,
      removed: false,
      noPaymentMethod: false,
      pendingConfirmation: null,
      pendingRemoval: null,
      servicesBelowDeposit: [],
      servicesBelowMinimum: [],
    });
  });
});
