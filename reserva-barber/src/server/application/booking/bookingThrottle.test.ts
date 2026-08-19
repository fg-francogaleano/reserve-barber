import { describe, it, expect } from 'vitest';
import {
  BookingThrottle,
  MAX_ATTEMPTS,
  WINDOW_MS,
  COOLDOWN_MS,
  MAX_TRACKED_KEYS,
} from './bookingThrottle';

const ORIGIN = '203.0.113.7';

function clockFrom(start: number) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe('BookingThrottle', () => {
  it('should_not_throttle_below_the_limit', () => {
    const clock = clockFrom(0);
    const throttle = new BookingThrottle(clock.now);

    for (let i = 0; i < MAX_ATTEMPTS - 1; i += 1) throttle.record(ORIGIN);

    expect(throttle.isThrottled(ORIGIN)).toBe(false);
  });

  it('should_throttle_once_the_limit_is_reached', () => {
    const clock = clockFrom(0);
    const throttle = new BookingThrottle(clock.now);

    for (let i = 0; i < MAX_ATTEMPTS; i += 1) throttle.record(ORIGIN);

    expect(throttle.isThrottled(ORIGIN)).toBe(true);
  });

  it('should_count_every_submission_not_only_failures', () => {
    // A booking flood is made of requests that each succeed — that is exactly
    // what makes it a calendar lock. Counting only failures would leave the
    // abuse case untouched.
    const clock = clockFrom(0);
    const throttle = new BookingThrottle(clock.now);

    for (let i = 0; i < MAX_ATTEMPTS; i += 1) throttle.record(ORIGIN);

    expect(throttle.isThrottled(ORIGIN)).toBe(true);
  });

  it('should_release_after_the_cooldown', () => {
    const clock = clockFrom(0);
    const throttle = new BookingThrottle(clock.now);

    for (let i = 0; i < MAX_ATTEMPTS; i += 1) throttle.record(ORIGIN);
    clock.advance(COOLDOWN_MS + 1);

    expect(throttle.isThrottled(ORIGIN)).toBe(false);
  });

  it('should_start_a_fresh_window_after_it_elapses', () => {
    const clock = clockFrom(0);
    const throttle = new BookingThrottle(clock.now);

    for (let i = 0; i < MAX_ATTEMPTS - 1; i += 1) throttle.record(ORIGIN);
    clock.advance(WINDOW_MS + 1);
    throttle.record(ORIGIN);

    expect(throttle.isThrottled(ORIGIN)).toBe(false);
  });

  it('should_isolate_origins_from_each_other', () => {
    const clock = clockFrom(0);
    const throttle = new BookingThrottle(clock.now);

    for (let i = 0; i < MAX_ATTEMPTS; i += 1) throttle.record(ORIGIN);

    expect(throttle.isThrottled('198.51.100.4')).toBe(false);
  });

  it('should_bound_its_own_memory', () => {
    // Without the cap, an attacker rotating origins grows the map until the
    // isolate runs out of memory — a denial of service inside the code meant
    // to blunt one.
    const clock = clockFrom(0);
    const throttle = new BookingThrottle(clock.now);

    for (let i = 0; i < MAX_TRACKED_KEYS * 2; i += 1) throttle.record(`origin-${i}`);

    expect(throttle.size).toBeLessThanOrEqual(MAX_TRACKED_KEYS);
  });

  it('should_never_evict_an_origin_that_is_currently_in_cooldown', () => {
    // Otherwise an attacker flushes their own lockout by spraying origins,
    // which is the one move this module exists to stop.
    const clock = clockFrom(0);
    const throttle = new BookingThrottle(clock.now);

    for (let i = 0; i < MAX_ATTEMPTS; i += 1) throttle.record(ORIGIN);
    expect(throttle.isThrottled(ORIGIN)).toBe(true);

    for (let i = 0; i < MAX_TRACKED_KEYS * 2; i += 1) throttle.record(`spray-${i}`);

    expect(throttle.isThrottled(ORIGIN)).toBe(true);
  });
});
