import { describe, it, expect } from 'vitest';
import { parseTimeOff, MAX_REASON_LENGTH } from './timeOffSchema';

/** Fixed "now" so the bound checks are deterministic: 2026-08-11T12:00:00Z. */
const NOW = Date.parse('2026-08-11T12:00:00.000Z');

function parse(fields: Record<string, string>) {
  return parseTimeOff(
    { startDate: '', endDate: '', startTime: '', endTime: '', reason: '', ...fields },
    NOW
  );
}

describe('parseTimeOff - whole days, with the end date read inclusively', () => {
  it('should_cover_a_single_whole_day_and_end_at_the_start_of_the_next', () => {
    const result = parse({ startDate: '2026-08-11', endDate: '2026-08-11' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Local midnight in a UTC-3 market.
      expect(result.data.startsAt.toISOString()).toBe('2026-08-11T03:00:00.000Z');
      expect(result.data.endsAt.toISOString()).toBe('2026-08-12T03:00:00.000Z');
    }
  });

  it('should_include_the_last_day_of_a_multi_day_absence', () => {
    // "Vacaciones del 1 al 15" must cover the 15th. The range therefore ends at
    // the start of the 16th — the off-by-one this conversion exists to avoid.
    const result = parse({ startDate: '2026-09-01', endDate: '2026-09-15' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.endsAt.toISOString()).toBe('2026-09-16T03:00:00.000Z');
    }
  });

  it('should_roll_over_a_month_end_correctly', () => {
    const result = parse({ startDate: '2026-08-31', endDate: '2026-08-31' });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.endsAt.toISOString()).toBe('2026-09-01T03:00:00.000Z');
  });

  it('should_roll_over_a_year_end_correctly', () => {
    const result = parse({ startDate: '2026-12-31', endDate: '2026-12-31' });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.endsAt.toISOString()).toBe('2027-01-01T03:00:00.000Z');
  });
});

describe('parseTimeOff - timed ranges end where they say', () => {
  it('should_use_exactly_the_instants_named', () => {
    const result = parse({
      startDate: '2026-08-11',
      endDate: '2026-08-11',
      startTime: '14:00',
      endTime: '18:00',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.startsAt.toISOString()).toBe('2026-08-11T17:00:00.000Z');
      expect(result.data.endsAt.toISOString()).toBe('2026-08-11T21:00:00.000Z');
    }
  });

  it('should_not_extend_a_timed_range_to_the_next_day', () => {
    const whole = parse({ startDate: '2026-08-11', endDate: '2026-08-11' });
    const timed = parse({
      startDate: '2026-08-11',
      endDate: '2026-08-11',
      startTime: '00:00',
      endTime: '23:00',
    });

    expect(whole.ok && timed.ok).toBe(true);
    if (whole.ok && timed.ok) {
      expect(timed.data.endsAt.getTime()).toBeLessThan(whole.data.endsAt.getTime());
    }
  });
});

describe('parseTimeOff - half-filled and malformed input', () => {
  it('should_reject_a_start_time_without_an_end_time', () => {
    const result = parse({ startDate: '2026-08-11', endDate: '2026-08-11', startTime: '14:00' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors.endTime).toBe('incomplete_times');
  });

  it('should_reject_an_end_time_without_a_start_time', () => {
    const result = parse({ startDate: '2026-08-11', endDate: '2026-08-11', endTime: '18:00' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors.startTime).toBe('incomplete_times');
  });

  it('should_require_both_dates', () => {
    const result = parse({ endDate: '2026-08-11' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors.startDate).toBe('required');
  });

  it('should_reject_a_date_that_does_not_exist', () => {
    // Rolling 2026-02-30 forward into March would record an absence the owner
    // never asked for.
    const result = parse({ startDate: '2026-02-30', endDate: '2026-03-01' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors.startDate).toBe('invalid_date');
  });

  it('should_reject_a_malformed_time', () => {
    const result = parse({
      startDate: '2026-08-11',
      endDate: '2026-08-11',
      startTime: '25:00',
      endTime: '26:00',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors.startTime).toBe('invalid_time');
  });
});

describe('parseTimeOff - the range must describe real, bounded time', () => {
  it('should_reject_a_zero_length_timed_range', () => {
    const result = parse({
      startDate: '2026-08-11',
      endDate: '2026-08-11',
      startTime: '14:00',
      endTime: '14:00',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors.endDate).toBe('end_not_after_start');
  });

  it('should_reject_an_end_date_before_the_start_date', () => {
    const result = parse({ startDate: '2026-08-11', endDate: '2026-08-01' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors.endDate).toBe('end_not_after_start');
  });

  it('should_reject_a_range_longer_than_the_maximum', () => {
    const result = parse({ startDate: '2026-08-11', endDate: '2027-09-11' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors.endDate).toBe('too_long');
  });

  it('should_reject_a_start_too_far_in_the_future', () => {
    // The shape a mistyped year takes.
    const result = parse({ startDate: '2099-01-01', endDate: '2099-01-02' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors.startDate).toBe('too_far_ahead');
  });

  it('should_reject_a_start_too_far_in_the_past', () => {
    const result = parse({ startDate: '2020-01-01', endDate: '2020-01-02' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors.startDate).toBe('too_far_back');
  });

  it('should_accept_a_recent_past_absence', () => {
    // Recording an absence after the fact is legitimate.
    const result = parse({ startDate: '2026-07-01', endDate: '2026-07-03' });

    expect(result.ok).toBe(true);
  });
});

describe('parseTimeOff - reason', () => {
  it('should_store_a_blank_reason_as_null_rather_than_an_empty_string', () => {
    const result = parse({ startDate: '2026-08-11', endDate: '2026-08-11', reason: '   ' });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.reason).toBeNull();
  });

  it('should_keep_a_provided_reason', () => {
    const result = parse({ startDate: '2026-08-11', endDate: '2026-08-11', reason: 'Vacaciones' });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.reason).toBe('Vacaciones');
  });

  it('should_reject_a_reason_over_the_maximum', () => {
    const result = parse({
      startDate: '2026-08-11',
      endDate: '2026-08-11',
      reason: 'x'.repeat(MAX_REASON_LENGTH + 1),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors.reason).toBe('too_long_reason');
  });
});
