import { describe, it, expect } from 'vitest';
import { COPY } from '@/lib/copy';
import { emptyWeek, toFormState, INITIAL_SCHEDULE_FORM_STATE } from './formState';

describe('emptyWeek', () => {
  it('should_carry_every_weekday_so_no_day_is_absent_from_the_form', () => {
    const week = emptyWeek();

    expect(Object.keys(week).sort()).toEqual(['0', '1', '2', '3', '4', '5', '6']);
    expect(week['0']).toEqual({ start: '', end: '' });
  });

  it('should_produce_a_fresh_object_each_call', () => {
    const first = emptyWeek();
    first['1'] = { start: '09:00', end: '18:00' };

    expect(emptyWeek()['1']).toEqual({ start: '', end: '' });
  });

  it('should_leave_the_initial_state_empty', () => {
    expect(INITIAL_SCHEDULE_FORM_STATE.dayErrors).toEqual({});
    expect(INITIAL_SCHEDULE_FORM_STATE.error).toBeNull();
  });
});

describe('toFormState - each rejection reason gets its own message', () => {
  const values = emptyWeek();

  it('should_distinguish_all_four_day_level_codes', () => {
    // Collapsing them would tell an owner who typed 09:07 that their day is
    // "incomplete", which explains the wrong thing.
    expect(toFormState({ 1: 'incomplete' }, null, values).dayErrors[1]).toBe(
      COPY.workingHours.dayIncomplete
    );
    expect(toFormState({ 1: 'end_not_after_start' }, null, values).dayErrors[1]).toBe(
      COPY.workingHours.dayEndNotAfterStart
    );
    expect(toFormState({ 1: 'not_on_grid' }, null, values).dayErrors[1]).toBe(
      COPY.workingHours.dayNotOnGrid
    );
    expect(toFormState({ 1: 'out_of_day' }, null, values).dayErrors[1]).toBe(
      COPY.workingHours.dayOutOfDay
    );
  });

  it('should_map_every_offending_day_not_only_the_first', () => {
    const state = toFormState({ 1: 'incomplete', 4: 'not_on_grid' }, null, values);

    expect(Object.keys(state.dayErrors).sort()).toEqual(['1', '4']);
  });

  it('should_keep_the_form_level_error_separate_from_the_day_errors', () => {
    const state = toFormState({}, COPY.workingHours.invalidSelection, values);

    expect(state.error).toBe(COPY.workingHours.invalidSelection);
    expect(state.dayErrors).toEqual({});
  });

  it('should_pass_the_submitted_values_through_untouched', () => {
    const submitted = emptyWeek();
    submitted['1'] = { start: '07:30', end: '18:00' };

    expect(toFormState({ 1: 'incomplete' }, null, submitted).values['1']).toEqual({
      start: '07:30',
      end: '18:00',
    });
  });
});
