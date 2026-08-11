import { describe, it, expect } from 'vitest';
import { WEEKDAYS, WEEKDAY_DISPLAY_ORDER, isWeekday } from './weekday';

describe('weekday - storage index and display order disagree on purpose', () => {
  it('should_store_sunday_as_zero_matching_the_data_model', () => {
    expect(WEEKDAYS[0]).toBe(0);
    expect(WEEKDAYS).toHaveLength(7);
  });

  it('should_display_monday_first_and_sunday_last_for_es_AR', () => {
    expect(WEEKDAY_DISPLAY_ORDER).toEqual([1, 2, 3, 4, 5, 6, 0]);
  });

  it('should_cover_every_stored_day_exactly_once_in_the_display_order', () => {
    // Two encodings of the same week is how a schedule ends up shifted by a day.
    expect([...WEEKDAY_DISPLAY_ORDER].sort()).toEqual([...WEEKDAYS]);
  });
});

describe('weekday - isWeekday', () => {
  it('should_accept_every_day_in_range', () => {
    for (const day of WEEKDAYS) {
      expect(isWeekday(day)).toBe(true);
    }
  });

  it('should_reject_values_outside_the_range', () => {
    expect(isWeekday(7)).toBe(false);
    expect(isWeekday(-1)).toBe(false);
  });

  it('should_reject_a_non_integer_that_falls_inside_the_range', () => {
    // 0.5 satisfies a naive `>= 0 && <= 6` check and then matches no day.
    expect(isWeekday(0.5)).toBe(false);
  });

  it('should_reject_non_numbers_and_special_numbers', () => {
    expect(isWeekday('1')).toBe(false);
    expect(isWeekday(null)).toBe(false);
    expect(isWeekday(NaN)).toBe(false);
    expect(isWeekday(Infinity)).toBe(false);
  });
});
