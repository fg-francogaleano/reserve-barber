import { describe, it, expect } from 'vitest';
import {
  SLOT_GRANULARITY_MINUTES,
  MIN_DURATION_MINUTES,
  MAX_DURATION_MINUTES,
} from './slotGranularity';
import { parseDuration } from '@/server/application/servicesCatalog/serviceSchema';

describe('slotGranularity - the constants', () => {
  it('should_divide_the_common_service_durations', () => {
    // The reason 5 was chosen over the 15 named in data-model.md: a 20-minute
    // beard trim must be expressible, and rounding it to 15 or 30 misprices the
    // barber's day.
    for (const duration of [15, 20, 30, 45, 60, 90]) {
      expect(duration % SLOT_GRANULARITY_MINUTES).toBe(0);
    }
  });

  it('should_make_the_minimum_exactly_one_slot', () => {
    expect(MIN_DURATION_MINUTES).toBe(SLOT_GRANULARITY_MINUTES);
  });

  it('should_bound_a_single_appointment_to_a_working_day', () => {
    expect(MAX_DURATION_MINUTES % SLOT_GRANULARITY_MINUTES).toBe(0);
    expect(MAX_DURATION_MINUTES).toBeGreaterThan(MIN_DURATION_MINUTES);
  });
});

describe('slotGranularity - the schema is the single consumer of these bounds', () => {
  // There is deliberately no `isValidDuration()` predicate: the schema must
  // report *which* rule failed, so a boolean cannot serve it, and a second
  // encoding of the rule would be free to drift. These assertions pin the
  // schema's behaviour to the constants so a change to either is caught here.
  it('should_accept_the_minimum_and_the_maximum', () => {
    expect(parseDuration(String(MIN_DURATION_MINUTES))).toEqual({
      ok: true,
      value: MIN_DURATION_MINUTES,
    });
    expect(parseDuration(String(MAX_DURATION_MINUTES))).toEqual({
      ok: true,
      value: MAX_DURATION_MINUTES,
    });
  });

  it('should_reject_one_granularity_step_outside_each_bound', () => {
    expect(parseDuration(String(MIN_DURATION_MINUTES - SLOT_GRANULARITY_MINUTES))).toEqual({
      ok: false,
      code: 'out_of_range',
    });
    expect(parseDuration(String(MAX_DURATION_MINUTES + SLOT_GRANULARITY_MINUTES))).toEqual({
      ok: false,
      code: 'out_of_range',
    });
  });

  it('should_reject_a_duration_that_does_not_tile_the_grid', () => {
    expect(parseDuration(String(MIN_DURATION_MINUTES + 1))).toEqual({
      ok: false,
      code: 'not_multiple',
    });
    expect(parseDuration('37')).toEqual({ ok: false, code: 'not_multiple' });
  });

  it('should_reject_non_integer_and_non_finite_input', () => {
    for (const raw of ['4.5', 'abc', '-15', 'Infinity', 'NaN', '3e1']) {
      expect(parseDuration(raw).ok).toBe(false);
    }
  });
});
