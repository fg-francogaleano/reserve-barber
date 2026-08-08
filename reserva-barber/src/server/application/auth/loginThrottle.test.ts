import { describe, it, expect, beforeEach } from 'vitest';
import {
  LoginThrottle,
  MAX_ATTEMPTS,
  WINDOW_MS,
  COOLDOWN_MS,
  MAX_TRACKED_KEYS,
} from './loginThrottle';

const EMAIL = 'owner@example.com';
const IP = '203.0.113.1';

describe('LoginThrottle', () => {
  let now: number;
  let throttle: LoginThrottle;

  beforeEach(() => {
    now = 1_700_000_000_000;
    throttle = new LoginThrottle(() => now);
  });

  it('should_allow_attempts_under_the_threshold', () => {
    for (let i = 0; i < MAX_ATTEMPTS - 1; i++) {
      throttle.recordFailure(EMAIL, IP);
    }

    expect(throttle.isThrottled(EMAIL, IP)).toBe(false);
  });

  it('should_reject_the_attempt_that_reaches_the_threshold', () => {
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      throttle.recordFailure(EMAIL, IP);
    }

    expect(throttle.isThrottled(EMAIL, IP)).toBe(true);
  });

  it('should_release_the_cooldown_after_it_expires', () => {
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      throttle.recordFailure(EMAIL, IP);
    }
    expect(throttle.isThrottled(EMAIL, IP)).toBe(true);

    now += COOLDOWN_MS;

    expect(throttle.isThrottled(EMAIL, IP)).toBe(false);
  });

  it('should_reset_the_counter_on_success', () => {
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      throttle.recordFailure(EMAIL, IP);
    }
    expect(throttle.isThrottled(EMAIL, IP)).toBe(true);

    throttle.recordSuccess(EMAIL, IP);

    expect(throttle.isThrottled(EMAIL, IP)).toBe(false);
  });

  it('should_reset_the_window_after_it_expires_without_reaching_the_threshold', () => {
    for (let i = 0; i < MAX_ATTEMPTS - 1; i++) {
      throttle.recordFailure(EMAIL, IP);
    }

    now += WINDOW_MS + 1;
    throttle.recordFailure(EMAIL, IP);

    expect(throttle.isThrottled(EMAIL, IP)).toBe(false);
  });

  it('should_track_different_email_and_ip_pairs_independently', () => {
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      throttle.recordFailure(EMAIL, IP);
    }

    expect(throttle.isThrottled('other@example.com', IP)).toBe(false);
    expect(throttle.isThrottled(EMAIL, '198.51.100.1')).toBe(false);
  });

  it('should_not_throttle_a_pair_with_no_recorded_attempts', () => {
    expect(throttle.isThrottled(EMAIL, IP)).toBe(false);
  });
});

describe('LoginThrottle - memory bounds', () => {
  let now: number;
  let throttle: LoginThrottle;

  beforeEach(() => {
    now = 1_700_000_000_000;
    throttle = new LoginThrottle(() => now);
  });

  it('should_stay_bounded_when_sprayed_with_distinct_keys', () => {
    // Arrange & Act — an attacker rotating emails must not grow the map forever
    for (let i = 0; i < MAX_TRACKED_KEYS * 3; i++) {
      throttle.recordFailure(`spray-${i}@example.com`, IP);
    }

    // Assert
    expect(throttle.size).toBeLessThanOrEqual(MAX_TRACKED_KEYS);
  });

  it('should_drop_records_whose_window_and_cooldown_have_both_expired', () => {
    // Arrange — one stale record, far past its window
    throttle.recordFailure('stale@example.com', IP);
    now += WINDOW_MS + COOLDOWN_MS + 1;

    // Act — fill up to the cap so pruning runs
    for (let i = 0; i < MAX_TRACKED_KEYS; i++) {
      throttle.recordFailure(`fresh-${i}@example.com`, IP);
    }

    // Assert — the stale key is gone, and the map is bounded
    expect(throttle.isThrottled('stale@example.com', IP)).toBe(false);
    expect(throttle.size).toBeLessThanOrEqual(MAX_TRACKED_KEYS);
  });

  it('should_leave_new_keys_untracked_when_every_slot_is_in_cooldown', () => {
    // Arrange — saturate the tracker with keys that are all locked out
    for (let i = 0; i < MAX_TRACKED_KEYS; i++) {
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        throttle.recordFailure(`locked-${i}@example.com`, IP);
      }
    }
    const sizeWhenSaturated = throttle.size;

    // Act — a brand-new key arrives with no evictable slot available
    throttle.recordFailure('newcomer@example.com', IP);

    // Assert — memory stays bounded and no existing lockout was sacrificed
    expect(throttle.size).toBe(sizeWhenSaturated);
    expect(throttle.isThrottled('newcomer@example.com', IP)).toBe(false);
    expect(throttle.isThrottled('locked-0@example.com', IP)).toBe(true);
  });

  it('should_not_drop_a_record_that_is_still_in_cooldown', () => {
    // Arrange — put the real account into cooldown
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      throttle.recordFailure(EMAIL, IP);
    }
    expect(throttle.isThrottled(EMAIL, IP)).toBe(true);

    // Act — spray to force pruning while the cooldown is still active
    for (let i = 0; i < MAX_TRACKED_KEYS; i++) {
      throttle.recordFailure(`spray-${i}@example.com`, IP);
    }

    // Assert — an attacker must not be able to flush their own cooldown
    expect(throttle.isThrottled(EMAIL, IP)).toBe(true);
  });
});
