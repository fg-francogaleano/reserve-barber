import { describe, it, expect } from 'vitest';
import { COPY } from '@/lib/copy';
import {
  EMPTY_TIME_OFF_VALUES,
  INITIAL_TIME_OFF_FORM_STATE,
  toFormState,
} from './formState';

const values = EMPTY_TIME_OFF_VALUES;

describe('formState - initial shape', () => {
  it('should_start_empty_with_no_errors', () => {
    expect(INITIAL_TIME_OFF_FORM_STATE.error).toBeNull();
    expect(INITIAL_TIME_OFF_FORM_STATE.fieldErrors).toEqual({});
    expect(INITIAL_TIME_OFF_FORM_STATE.values).toEqual(EMPTY_TIME_OFF_VALUES);
  });
});

describe('formState - each rejection reason gets its own message', () => {
  it('should_distinguish_a_missing_start_date_from_a_missing_end_date', () => {
    // The same code on two fields must not produce the same sentence, or the
    // owner cannot tell which field they left blank.
    expect(toFormState({ startDate: 'required' }, values).fieldErrors.startDate).toBe(
      COPY.timeOff.startDateRequired
    );
    expect(toFormState({ endDate: 'required' }, values).fieldErrors.endDate).toBe(
      COPY.timeOff.endDateRequired
    );
  });

  it('should_explain_a_half_filled_time_pair_rather_than_calling_it_invalid', () => {
    expect(toFormState({ endTime: 'incomplete_times' }, values).fieldErrors.endTime).toBe(
      COPY.timeOff.incompleteTimes
    );
  });

  it('should_point_a_mistyped_year_at_the_year_rather_than_at_the_format', () => {
    // "Revisá el año" is actionable; "fecha inválida" sends the owner looking at
    // the wrong thing.
    expect(toFormState({ startDate: 'too_far_ahead' }, values).fieldErrors.startDate).toBe(
      COPY.timeOff.tooFarAhead
    );
    expect(toFormState({ startDate: 'too_far_back' }, values).fieldErrors.startDate).toBe(
      COPY.timeOff.tooFarBack
    );
  });

  it('should_distinguish_a_too_long_range_from_an_inverted_one', () => {
    expect(toFormState({ endDate: 'too_long' }, values).fieldErrors.endDate).toBe(
      COPY.timeOff.tooLong
    );
    expect(toFormState({ endDate: 'end_not_after_start' }, values).fieldErrors.endDate).toBe(
      COPY.timeOff.endNotAfterStart
    );
  });

  it('should_map_the_remaining_codes', () => {
    expect(toFormState({ startDate: 'invalid_date' }, values).fieldErrors.startDate).toBe(
      COPY.timeOff.invalidDate
    );
    expect(toFormState({ startTime: 'invalid_time' }, values).fieldErrors.startTime).toBe(
      COPY.timeOff.invalidTime
    );
    expect(toFormState({ reason: 'too_long_reason' }, values).fieldErrors.reason).toBe(
      COPY.timeOff.reasonTooLong
    );
  });

  it('should_map_every_offending_field_not_only_the_first', () => {
    const state = toFormState({ startDate: 'required', endTime: 'incomplete_times' }, values);

    expect(Object.keys(state.fieldErrors).sort()).toEqual(['endTime', 'startDate']);
  });

  it('should_pass_the_submitted_values_through_untouched', () => {
    const submitted = { ...EMPTY_TIME_OFF_VALUES, reason: 'Vacaciones', startDate: '2026-08-11' };

    expect(toFormState({ endDate: 'required' }, submitted).values).toEqual(submitted);
  });
});
