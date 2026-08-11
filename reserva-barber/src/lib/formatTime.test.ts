import { describe, it, expect } from 'vitest';
import { formatMinuteOfDay } from './formatTime';

describe('formatMinuteOfDay', () => {
  it('should_pad_both_parts_to_two_digits', () => {
    expect(formatMinuteOfDay(540)).toBe('09:00');
    expect(formatMinuteOfDay(5)).toBe('00:05');
  });

  it('should_format_midnight_as_zero', () => {
    expect(formatMinuteOfDay(0)).toBe('00:00');
  });

  it('should_format_the_last_representable_minute', () => {
    expect(formatMinuteOfDay(1439)).toBe('23:59');
  });

  it('should_apply_no_offset', () => {
    // The stored value is wall clock. Converting here would silently
    // reinterpret the owner's schedule.
    expect(formatMinuteOfDay(720)).toBe('12:00');
  });
});
