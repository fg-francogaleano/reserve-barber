import { describe, it, expect } from 'vitest';
import { formatTimeOffRange, isLocalMidnight } from './formatDate';

const localMidnight = (iso: string) => new Date(iso);

describe('isLocalMidnight', () => {
  it('should_recognize_local_midnight_in_the_business_zone', () => {
    // 03:00Z is midnight in a UTC-3 market.
    expect(isLocalMidnight(localMidnight('2026-08-11T03:00:00.000Z'))).toBe(true);
  });

  it('should_reject_utc_midnight_which_is_not_local_midnight', () => {
    expect(isLocalMidnight(localMidnight('2026-08-11T00:00:00.000Z'))).toBe(false);
  });
});

describe('formatTimeOffRange - whole days are shown by their last covered day', () => {
  it('should_render_a_single_whole_day_as_one_date', () => {
    const text = formatTimeOffRange(
      localMidnight('2026-08-11T03:00:00.000Z'),
      localMidnight('2026-08-12T03:00:00.000Z')
    );

    // The stored end is the 12th at 00:00, but the barber is away on the 11th.
    // Showing the 12th would claim an absence that does not exist.
    expect(text).toBe('11/08/2026');
  });

  it('should_render_a_multi_day_range_ending_on_its_last_covered_day', () => {
    const text = formatTimeOffRange(
      localMidnight('2026-09-01T03:00:00.000Z'),
      localMidnight('2026-09-16T03:00:00.000Z')
    );

    expect(text).toBe('01/09/2026 – 15/09/2026');
  });
});

describe('formatTimeOffRange - timed ranges show their hours', () => {
  it('should_render_a_same_day_timed_range_compactly', () => {
    const text = formatTimeOffRange(
      new Date('2026-08-11T17:00:00.000Z'),
      new Date('2026-08-11T21:00:00.000Z')
    );

    expect(text).toBe('11/08/2026, 14:00–18:00');
  });

  it('should_render_a_range_that_spans_days_with_both_endpoints', () => {
    const text = formatTimeOffRange(
      new Date('2026-08-11T17:00:00.000Z'),
      new Date('2026-08-12T21:00:00.000Z')
    );

    expect(text).toContain('11/08/2026 14:00');
    expect(text).toContain('12/08/2026 18:00');
  });
});
