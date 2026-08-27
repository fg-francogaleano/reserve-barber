import { describe, it, expect } from 'vitest';
import {
  BOOKING_CANCELLATION_EMAIL,
  BOOKING_CONFIRMATION_EMAIL,
} from './emailCapability';

/**
 * Two constants, and the only property that matters about them is that they are
 * not each other.
 *
 * A test over constants is usually noise. This one is not: the defect it guards
 * shipped and ran in production, and its shape was one message wearing another
 * message's name. A new capability added by copying one of these and editing
 * only the comment would recreate it exactly, and nothing else in the suite
 * would notice — every other assertion about email logging is about volume,
 * variable names or leakage, and all of them pass with the wrong name in place.
 */
describe('email capabilities - each message is its own', () => {
  const ALL = [BOOKING_CONFIRMATION_EMAIL, BOOKING_CANCELLATION_EMAIL];

  it('should_give_every_capability_a_distinct_operation', () => {
    const operations = ALL.map((capability) => capability.operation);

    expect(new Set(operations).size).toBe(ALL.length);
  });

  it('should_give_every_capability_a_distinct_subject', () => {
    const subjects = ALL.map((capability) => capability.subject);

    expect(new Set(subjects).size).toBe(ALL.length);
  });

  /**
   * The operation names are the string an operator greps for and a dashboard
   * filters on, so they are pinned literally rather than derived in the
   * assertion: a test that recomputes the name it is checking cannot catch a
   * rename, which is the change that would silently break every saved query.
   */
  it('should_keep_the_names_operators_already_search_for', () => {
    expect(BOOKING_CONFIRMATION_EMAIL.operation).toBe('email.bookingConfirmation');
    expect(BOOKING_CANCELLATION_EMAIL.operation).toBe('email.bookingCancellation');
  });

  /**
   * English, because a log line is a technical artifact (`base-standards.md`
   * §2). The Spanish in this product is what a client reads, and no client
   * reads these.
   */
  it('should_state_the_subject_in_english', () => {
    for (const capability of ALL) {
      expect(capability.subject).toMatch(/^[A-Za-z ]+$/);
    }
  });
});
