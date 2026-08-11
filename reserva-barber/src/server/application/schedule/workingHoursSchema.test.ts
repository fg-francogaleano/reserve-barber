import { describe, it, expect } from 'vitest';
import { parseWeeklySchedule } from './workingHoursSchema';

/** A submission carries one start and one end per weekday, keyed by index. */
function week(overrides: Record<number, [string, string]> = {}) {
  const start: Record<string, string> = {};
  const end: Record<string, string> = {};
  for (let day = 0; day <= 6; day += 1) {
    const pair = overrides[day];
    start[String(day)] = pair ? pair[0] : '';
    end[String(day)] = pair ? pair[1] : '';
  }
  return { start, end };
}

describe('parseWeeklySchedule - a day without times is a non-working day', () => {
  it('should_accept_a_week_with_every_day_empty', () => {
    const result = parseWeeklySchedule(week());

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.windows).toEqual([]);
  });

  it('should_keep_only_the_days_that_carry_times', () => {
    const result = parseWeeklySchedule(week({ 1: ['09:00', '18:00'], 3: ['10:00', '14:00'] }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.windows).toEqual([
        { dayOfWeek: 1, startMinute: 540, endMinute: 1080 },
        { dayOfWeek: 3, startMinute: 600, endMinute: 840 },
      ]);
    }
  });
});

describe('parseWeeklySchedule - a half-filled day is rejected and named', () => {
  it('should_reject_a_start_without_an_end', () => {
    const result = parseWeeklySchedule(week({ 2: ['09:00', ''] }));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.dayErrors[2]).toBe('incomplete');
  });

  it('should_reject_an_end_without_a_start', () => {
    const result = parseWeeklySchedule(week({ 6: ['', '18:00'] }));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.dayErrors[6]).toBe('incomplete');
  });

  it('should_name_every_offending_day_not_only_the_first', () => {
    const result = parseWeeklySchedule(week({ 1: ['09:00', ''], 4: ['', '18:00'] }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(Object.keys(result.dayErrors).sort()).toEqual(['1', '4']);
    }
  });
});

describe('parseWeeklySchedule - the window must describe real time', () => {
  it('should_reject_an_end_that_is_not_after_the_start', () => {
    const result = parseWeeklySchedule(week({ 1: ['18:00', '09:00'] }));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.dayErrors[1]).toBe('end_not_after_start');
  });

  it('should_reject_a_zero_length_window', () => {
    const result = parseWeeklySchedule(week({ 1: ['09:00', '09:00'] }));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.dayErrors[1]).toBe('end_not_after_start');
  });
});

describe('parseWeeklySchedule - granularity and the day boundary', () => {
  it('should_reject_a_start_off_the_five_minute_grid', () => {
    const result = parseWeeklySchedule(week({ 1: ['09:07', '18:00'] }));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.dayErrors[1]).toBe('not_on_grid');
  });

  it('should_reject_an_end_off_the_five_minute_grid', () => {
    const result = parseWeeklySchedule(week({ 1: ['09:00', '18:03'] }));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.dayErrors[1]).toBe('not_on_grid');
  });

  it('should_accept_the_last_representable_minute_on_the_grid', () => {
    const result = parseWeeklySchedule(week({ 1: ['09:00', '23:55'] }));

    expect(result.ok).toBe(true);
  });

  it('should_reject_a_malformed_time', () => {
    const result = parseWeeklySchedule(week({ 1: ['9am', '18:00'] }));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.dayErrors[1]).toBe('out_of_day');
  });

  it('should_reject_an_hour_outside_the_day', () => {
    const result = parseWeeklySchedule(week({ 1: ['25:00', '26:00'] }));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.dayErrors[1]).toBe('out_of_day');
  });
});

describe('parseWeeklySchedule - weekday keys are validated in full', () => {
  it('should_reject_the_whole_submission_for_a_weekday_above_the_range', () => {
    const payload = week({ 1: ['09:00', '18:00'] });
    payload.start['7'] = '09:00';
    payload.end['7'] = '18:00';

    const result = parseWeeklySchedule(payload);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.formError).toBe('invalid_weekday');
  });

  it('should_reject_the_whole_submission_for_a_negative_weekday', () => {
    const payload = week();
    payload.start['-1'] = '09:00';
    payload.end['-1'] = '18:00';

    const result = parseWeeklySchedule(payload);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.formError).toBe('invalid_weekday');
  });

  it('should_reject_a_non_integer_weekday_rather_than_dropping_that_day', () => {
    // 0.5 passes a naive `>= 0 && <= 6` check and then matches no day. Dropping
    // it would report success while discarding what the owner entered.
    const payload = week();
    payload.start['0.5'] = '09:00';
    payload.end['0.5'] = '18:00';

    const result = parseWeeklySchedule(payload);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.formError).toBe('invalid_weekday');
  });
});
