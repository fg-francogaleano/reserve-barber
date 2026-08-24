import { describe, it, expect } from 'vitest';
import {
  blocksAvailability,
  holdExpiresAtFor,
  holdSweepCutoff,
  transferHoldExpiresAtFor,
  type BlockingCandidate,
} from './Booking';
import { EXPIRY_GRACE_MINUTES } from './bookingHorizon';

const NOW = new Date('2026-08-17T15:00:00.000Z');
const AN_HOUR_AGO = new Date('2026-08-17T14:00:00.000Z');
const IN_TEN_MINUTES = new Date('2026-08-17T15:10:00.000Z');

function booking(overrides: Partial<BlockingCandidate>): BlockingCandidate {
  return {
    startTime: new Date('2026-08-18T13:00:00.000Z'),
    endTime: new Date('2026-08-18T13:30:00.000Z'),
    status: 'CONFIRMED',
    holdExpiresAt: null,
    ...overrides,
  };
}

describe('Booking - which bookings remove a time from sale', () => {
  it('should_block_when_confirmed', () => {
    expect(blocksAvailability(booking({ status: 'CONFIRMED' }), NOW)).toBe(true);
  });

  it('should_block_a_pending_payment_whose_hold_is_still_live', () => {
    expect(
      blocksAvailability(booking({ status: 'PENDING_PAYMENT', holdExpiresAt: IN_TEN_MINUTES }), NOW)
    ).toBe(true);
  });

  it('should_not_block_a_pending_payment_whose_hold_has_expired', () => {
    // The reason this clause exists: B7 — the job that expires abandoned holds
    // — ships four stories after this one. Without it, every abandoned checkout
    // removes a slot from sale permanently, and no surface in the product would
    // show the owner why.
    expect(
      blocksAvailability(booking({ status: 'PENDING_PAYMENT', holdExpiresAt: AN_HOUR_AGO }), NOW)
    ).toBe(false);
  });

  it('should_block_a_pending_approval_however_old_its_hold_is', () => {
    // A receipt has been uploaded and a human owes an answer. This one is never
    // expired by the passage of time.
    expect(
      blocksAvailability(booking({ status: 'PENDING_APPROVAL', holdExpiresAt: AN_HOUR_AGO }), NOW)
    ).toBe(true);
  });

  it('should_not_block_when_cancelled', () => {
    expect(blocksAvailability(booking({ status: 'CANCELLED' }), NOW)).toBe(false);
  });

  it('should_not_block_when_expired', () => {
    expect(blocksAvailability(booking({ status: 'EXPIRED' }), NOW)).toBe(false);
  });

  it('should_block_a_pending_payment_carrying_no_hold_expiry', () => {
    // A null holdExpiresAt is not "expired long ago". The column is optional in
    // the schema, and reading absence as expiry would release a slot the moment
    // a write set the status without the deadline.
    expect(
      blocksAvailability(booking({ status: 'PENDING_PAYMENT', holdExpiresAt: null }), NOW)
    ).toBe(true);
  });

  it('should_treat_the_expiry_instant_itself_as_expired', () => {
    // Half-open, like every other boundary in this feature: the hold covers
    // [created, holdExpiresAt).
    expect(
      blocksAvailability(booking({ status: 'PENDING_PAYMENT', holdExpiresAt: NOW }), NOW)
    ).toBe(false);
  });
});

describe('Booking - the hold deadline', () => {
  it('should_be_the_creation_instant_plus_the_hold_duration_for_an_ordinary_appointment', () => {
    const createdAt = new Date('2026-08-17T15:00:00.000Z');
    const startTime = new Date('2026-08-18T13:00:00.000Z'); // far beyond the hold duration
    expect(holdExpiresAtFor({ createdAt, startTime })).toEqual(
      new Date('2026-08-17T15:15:00.000Z')
    );
  });

  it('should_clamp_to_startTime_for_a_near_term_appointment', () => {
    const createdAt = new Date('2026-08-17T15:00:00.000Z');
    const startTime = new Date('2026-08-17T15:05:00.000Z'); // 5 minutes out, sooner than the 15-minute hold
    expect(holdExpiresAtFor({ createdAt, startTime })).toEqual(startTime);
  });

  it('should_never_exceed_startTime_even_at_the_exact_boundary', () => {
    const createdAt = new Date('2026-08-17T15:00:00.000Z');
    const startTime = new Date('2026-08-17T15:15:00.000Z'); // exactly the hold duration out
    const result = holdExpiresAtFor({ createdAt, startTime });
    expect(result.getTime()).toBeLessThanOrEqual(startTime.getTime());
    expect(result).toEqual(startTime);
  });
});

describe('Booking - an unanswered receipt eventually stops blocking', () => {
  // `holdExpiresAt` is the deadline for UPLOADING a receipt, never for
  // answering one. Releasing the slot underneath a transfer the owner is about
  // to approve would sell it twice.
  it('should_still_block_a_pending_approval_whose_appointment_is_ahead', () => {
    expect(
      blocksAvailability(
        booking({
          status: 'PENDING_APPROVAL',
          holdExpiresAt: AN_HOUR_AGO,
          startTime: new Date('2026-08-18T13:00:00.000Z'),
          endTime: new Date('2026-08-18T13:30:00.000Z'),
        }),
        NOW
      )
    ).toBe(true);
  });

  // The one exception, and the only exit this status has that does not depend
  // on the owner being attentive. The time cannot be sold to anyone any more,
  // so releasing it sells nothing twice.
  it('should_stop_blocking_a_pending_approval_whose_appointment_has_passed', () => {
    expect(
      blocksAvailability(
        booking({
          status: 'PENDING_APPROVAL',
          holdExpiresAt: AN_HOUR_AGO,
          startTime: new Date('2026-08-17T13:00:00.000Z'),
          endTime: new Date('2026-08-17T13:30:00.000Z'),
        }),
        NOW
      )
    ).toBe(false);
  });

  it('should_block_a_pending_approval_at_the_exact_start_instant', () => {
    // "Has passed" is false at the instant something begins. The conservative
    // direction: holding one instant too long costs nothing, releasing one
    // instant too early offers a time that is being used right now.
    expect(
      blocksAvailability(
        booking({
          status: 'PENDING_APPROVAL',
          holdExpiresAt: AN_HOUR_AGO,
          startTime: NOW,
          endTime: new Date('2026-08-17T15:30:00.000Z'),
        }),
        NOW
      )
    ).toBe(true);
  });

  it('should_not_change_what_a_confirmed_booking_does_after_its_appointment', () => {
    // A confirmed appointment in the past is history, not a hold, and this
    // rule must not reach it.
    expect(
      blocksAvailability(
        booking({
          status: 'CONFIRMED',
          startTime: new Date('2026-08-17T13:00:00.000Z'),
          endTime: new Date('2026-08-17T13:30:00.000Z'),
        }),
        NOW
      )
    ).toBe(true);
  });
});

describe('Booking - the transfer hold extension', () => {
  it('should_be_the_commitment_instant_plus_the_transfer_duration', () => {
    const committedAt = new Date('2026-08-17T15:00:00.000Z');
    const startTime = new Date('2026-08-18T13:00:00.000Z');
    expect(transferHoldExpiresAtFor({ committedAt, startTime })).toEqual(
      new Date('2026-08-17T15:45:00.000Z')
    );
  });

  it('should_obey_the_same_clamp_the_creation_write_obeys', () => {
    const committedAt = new Date('2026-08-17T15:00:00.000Z');
    const startTime = new Date('2026-08-17T15:20:00.000Z'); // sooner than 45 minutes
    expect(transferHoldExpiresAtFor({ committedAt, startTime })).toEqual(startTime);
  });

  it('should_never_exceed_startTime_at_the_exact_boundary', () => {
    const committedAt = new Date('2026-08-17T15:00:00.000Z');
    const startTime = new Date('2026-08-17T15:45:00.000Z');
    expect(transferHoldExpiresAtFor({ committedAt, startTime })).toEqual(startTime);
  });

  // The extension is three times the creation duration, so the clamp it shares
  // with `holdExpiresAtFor` is materially closer to being reached here. That is
  // the reason it is one function rather than a rule each writer restates.
  it('should_extend_beyond_what_the_creation_duration_would_have_given', () => {
    const at = new Date('2026-08-17T15:00:00.000Z');
    const startTime = new Date('2026-08-18T13:00:00.000Z');
    expect(transferHoldExpiresAtFor({ committedAt: at, startTime }).getTime()).toBeGreaterThan(
      holdExpiresAtFor({ createdAt: at, startTime }).getTime()
    );
  });
});

describe('Booking - when a lapsed hold becomes sweepable', () => {
  // The whole point of the grace: the slot is already sellable, and the row is
  // kept only so a payment approved moments after the deadline can still find
  // the `PENDING_PAYMENT` status its confirmation is guarded on.
  const sweepable = (holdExpiresAt: Date): boolean =>
    holdExpiresAt.getTime() < holdSweepCutoff(NOW).getTime();

  it('should_not_be_sweepable_while_inside_the_grace_window', () => {
    const lapsedThreeMinutesAgo = new Date(NOW.getTime() - 3 * 60_000);
    expect(sweepable(lapsedThreeMinutesAgo)).toBe(false);
  });

  it('should_be_sweepable_once_the_grace_window_has_passed', () => {
    const lapsedElevenMinutesAgo = new Date(NOW.getTime() - 11 * 60_000);
    expect(sweepable(lapsedElevenMinutesAgo)).toBe(true);
  });

  // Stated rather than left to whoever reads the comparison next: a hold
  // sitting exactly on the cutoff survives one more run. Holding one cycle
  // longer costs nothing; expiring one instant early costs a paid appointment.
  it('should_not_be_sweepable_at_the_cutoff_instant_itself', () => {
    expect(sweepable(holdSweepCutoff(NOW))).toBe(false);
  });

  it('should_place_the_cutoff_exactly_one_grace_window_before_now', () => {
    expect(NOW.getTime() - holdSweepCutoff(NOW).getTime()).toBe(EXPIRY_GRACE_MINUTES * 60_000);
  });

  // A hold that never lapsed cannot be swept by arithmetic alone, which is why
  // the sweeper still asks `blocksAvailability` rather than trusting the bound.
  it('should_not_be_sweepable_while_the_hold_is_still_live', () => {
    expect(sweepable(IN_TEN_MINUTES)).toBe(false);
    expect(
      blocksAvailability(booking({ status: 'PENDING_PAYMENT', holdExpiresAt: IN_TEN_MINUTES }), NOW)
    ).toBe(true);
  });

  // The grace delays the *record*, never the slot: availability released this
  // time the moment the hold lapsed, well before the cutoff.
  it('should_leave_the_slot_sellable_throughout_the_grace_window', () => {
    const lapsedOneMinuteAgo = new Date(NOW.getTime() - 60_000);
    expect(sweepable(lapsedOneMinuteAgo)).toBe(false);
    expect(
      blocksAvailability(
        booking({ status: 'PENDING_PAYMENT', holdExpiresAt: lapsedOneMinuteAgo }),
        NOW
      )
    ).toBe(false);
  });
});
