import { describe, it, expect } from 'vitest';
import {
  resolveConfirmationEmailNotice,
  EMAIL_NOTICE_GRACE_SECONDS,
} from './confirmationEmailNotice';

const NOW = new Date('2026-08-25T12:00:00.000Z');

function secondsAgo(seconds: number): Date {
  return new Date(NOW.getTime() - seconds * 1000);
}

describe('resolveConfirmationEmailNotice', () => {
  it('should_report_sent_when_the_provider_accepted_it', () => {
    // Arrange
    const input = { sentAt: secondsAgo(5), updatedAt: secondsAgo(6), now: NOW };

    // Act & Assert
    expect(resolveConfirmationEmailNotice(input)).toBe('sent');
  });

  it('should_report_sent_however_old_the_booking_is', () => {
    // Arrange: a recorded send is a fact, not something that expires.
    const input = { sentAt: secondsAgo(90_000), updatedAt: secondsAgo(90_000), now: NOW };

    // Act & Assert
    expect(resolveConfirmationEmailNotice(input)).toBe('sent');
  });

  it('should_stay_quiet_while_the_send_may_still_be_in_flight', () => {
    // Arrange: a client who beat the write to the page must not be told their
    // confirmation failed.
    const input = { sentAt: null, updatedAt: secondsAgo(2), now: NOW };

    // Act & Assert
    expect(resolveConfirmationEmailNotice(input)).toBe('pending');
  });

  it('should_report_failed_once_the_grace_window_has_passed', () => {
    // Arrange
    const input = {
      sentAt: null,
      updatedAt: secondsAgo(EMAIL_NOTICE_GRACE_SECONDS + 1),
      now: NOW,
    };

    // Act & Assert
    expect(resolveConfirmationEmailNotice(input)).toBe('failed');
  });

  it('should_report_failed_exactly_on_the_boundary', () => {
    // Arrange: the boundary is decided rather than left to chance. Failing at
    // the instant is the honest direction — the send is bounded well inside it.
    const input = { sentAt: null, updatedAt: secondsAgo(EMAIL_NOTICE_GRACE_SECONDS), now: NOW };

    // Act & Assert
    expect(resolveConfirmationEmailNotice(input)).toBe('failed');
  });

  it('should_report_failed_for_a_booking_confirmed_long_ago_and_never_recorded', () => {
    // Arrange: the pre-N1 backlog. Every booking confirmed before this story
    // reads as never told, which is exactly what is true of them.
    const input = { sentAt: null, updatedAt: secondsAgo(90_000), now: NOW };

    // Act & Assert
    expect(resolveConfirmationEmailNotice(input)).toBe('failed');
  });

  it('should_stay_quiet_rather_than_accuse_when_the_clock_is_skewed', () => {
    // Arrange: a row written "in the future" relative to this render. Clock
    // skew between the database and the Worker must not produce a false report
    // that a real confirmation failed.
    const input = { sentAt: null, updatedAt: new Date(NOW.getTime() + 5_000), now: NOW };

    // Act & Assert
    expect(resolveConfirmationEmailNotice(input)).toBe('pending');
  });
});
