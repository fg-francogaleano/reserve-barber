import { describe, it, expect } from 'vitest';
import {
  blocksAvailability,
  calendarPresence,
  CALENDAR_PRESENCES,
  OCCUPYING_PRESENCES,
  holdExpiresAtFor,
  holdSweepCutoff,
  isCancellableByClient,
  isCancellableByOwner,
  transferHoldExpiresAtFor,
  BOOKING_STATUSES,
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

/**
 * C2: which bookings the owner may cancel.
 *
 * The predicate exists because three callers need the same answer — the row
 * deciding whether to render a control, the service deciding whether to try,
 * and the write's own guard. Three copies of a status list is three chances for
 * a control to appear where the write refuses.
 */
describe('isCancellableByOwner', () => {
  it.each(['CONFIRMED', 'PENDING_PAYMENT', 'PENDING_APPROVAL'] as const)(
    'should_admit_%s_because_it_still_holds_or_occupies_its_slot',
    (status) => {
      expect(isCancellableByOwner(status)).toBe(true);
    }
  );

  it.each(['CANCELLED', 'EXPIRED'] as const)(
    'should_refuse_%s_because_it_is_terminal',
    (status) => {
      expect(isCancellableByOwner(status)).toBe(false);
    }
  );

  it('should_cover_every_member_of_the_status_enum', () => {
    // A new status must force a decision here rather than defaulting to
    // "not cancellable" by omission.
    for (const status of BOOKING_STATUSES) {
      expect(typeof isCancellableByOwner(status)).toBe('boolean');
    }
  });

  it('should_not_consult_the_appointment_time', () => {
    // A no-show is exactly a past appointment the owner wants off the books,
    // and the list this is offered from is ordered by recency.
    expect(isCancellableByOwner('CONFIRMED')).toBe(true);
    expect(isCancellableByOwner.length).toBe(1);
  });
});

/**
 * C1: which bookings the *client* may cancel.
 *
 * Built on `blocksAvailability` rather than on a status list, because that
 * predicate already answers this question: is this booking still holding its
 * time? A client cancels in order to give time back, so a booking holding none
 * has nothing to release.
 */
describe('isCancellableByClient', () => {
  const future = { startTime: new Date('2026-08-18T13:00:00.000Z'), endTime: new Date('2026-08-18T13:30:00.000Z') };
  const past = { startTime: new Date('2026-08-17T13:00:00.000Z'), endTime: new Date('2026-08-17T13:30:00.000Z') };

  it('should_admit_a_confirmed_appointment_that_has_not_started', () => {
    expect(isCancellableByClient(booking({ status: 'CONFIRMED', ...future }), NOW)).toBe(true);
  });

  it('should_admit_a_pending_payment_whose_hold_is_still_live', () => {
    expect(
      isCancellableByClient(
        booking({ status: 'PENDING_PAYMENT', holdExpiresAt: IN_TEN_MINUTES, ...future }),
        NOW
      )
    ).toBe(true);
  });

  it('should_admit_a_pending_payment_carrying_no_hold_expiry', () => {
    // Same reading `blocksAvailability` gives it: absence is not expiry.
    expect(
      isCancellableByClient(
        booking({ status: 'PENDING_PAYMENT', holdExpiresAt: null, ...future }),
        NOW
      )
    ).toBe(true);
  });

  it('should_refuse_an_appointment_that_has_already_started', () => {
    // A past slot cannot be released. Cancelling one would only record an
    // appointment that happened as cancelled — which the dashboard counts.
    expect(isCancellableByClient(booking({ status: 'CONFIRMED', ...past }), NOW)).toBe(false);
  });

  it('should_refuse_at_the_exact_start_instant', () => {
    // Strictly after: "has not started" is false at the moment something begins.
    expect(
      isCancellableByClient(
        booking({ status: 'CONFIRMED', startTime: NOW, endTime: new Date('2026-08-17T15:30:00.000Z') }),
        NOW
      )
    ).toBe(false);
  });

  it('should_refuse_a_booking_whose_hold_has_lapsed', () => {
    // The paid-slot-lost shape: the slot is already gone, and cancelling would
    // convert the client's bad luck into their own recorded decision.
    expect(
      isCancellableByClient(
        booking({ status: 'PENDING_PAYMENT', holdExpiresAt: AN_HOUR_AGO, ...future }),
        NOW
      )
    ).toBe(false);
  });

  it('should_refuse_a_receipt_that_is_under_review', () => {
    // The client already transferred real money and a human owes them an
    // answer. The owner's queue filters on the booking's status, so cancelling
    // would hide the receipt from the only surface anybody looks at it on.
    expect(
      isCancellableByClient(
        booking({ status: 'PENDING_APPROVAL', holdExpiresAt: AN_HOUR_AGO, ...future }),
        NOW
      )
    ).toBe(false);
  });

  it.each(['CANCELLED', 'EXPIRED'] as const)('should_refuse_%s_because_it_is_terminal', (status) => {
    expect(isCancellableByClient(booking({ status, ...future }), NOW)).toBe(false);
  });

  it('should_cover_every_member_of_the_status_enum', () => {
    for (const status of BOOKING_STATUSES) {
      expect(typeof isCancellableByClient(booking({ status, ...future }), NOW)).toBe('boolean');
    }
  });

  it('should_never_admit_a_booking_that_no_longer_blocks_availability', () => {
    // The dependency stated as a property rather than left to the reader: this
    // predicate can only ever be narrower than `blocksAvailability`.
    for (const status of BOOKING_STATUSES) {
      for (const holdExpiresAt of [null, IN_TEN_MINUTES, AN_HOUR_AGO]) {
        for (const times of [future, past]) {
          const candidate = booking({ status, holdExpiresAt, ...times });
          if (isCancellableByClient(candidate, NOW)) {
            expect(blocksAvailability(candidate, NOW)).toBe(true);
          }
        }
      }
    }
  });

  it('should_disagree_with_the_owner_rule_about_a_past_appointment', () => {
    // The asymmetry, asserted rather than described. A no-show is precisely the
    // past appointment an owner wants off the books; for a client it is the one
    // case where cancelling achieves nothing.
    const noShow = booking({ status: 'CONFIRMED', ...past });
    expect(isCancellableByOwner(noShow.status)).toBe(true);
    expect(isCancellableByClient(noShow, NOW)).toBe(false);
  });

  it('should_disagree_with_the_owner_rule_about_a_receipt_under_review', () => {
    const underReview = booking({ status: 'PENDING_APPROVAL', ...future });
    expect(isCancellableByOwner(underReview.status)).toBe(true);
    expect(isCancellableByClient(underReview, NOW)).toBe(false);
  });
});

describe('Booking - how a booking appears on the owner calendar', () => {
  it('should_present_a_confirmed_booking_as_confirmed', () => {
    expect(calendarPresence(booking({ status: 'CONFIRMED' }), NOW)).toBe('confirmed');
  });

  it('should_present_a_cancelled_booking_as_cancelled', () => {
    expect(calendarPresence(booking({ status: 'CANCELLED' }), NOW)).toBe('cancelled');
  });

  it('should_present_a_swept_booking_as_lapsed', () => {
    expect(calendarPresence(booking({ status: 'EXPIRED' }), NOW)).toBe('lapsed');
  });

  it('should_present_a_live_hold_as_holding', () => {
    expect(
      calendarPresence(booking({ status: 'PENDING_PAYMENT', holdExpiresAt: IN_TEN_MINUTES }), NOW)
    ).toBe('holding');
  });

  it('should_present_a_lapsed_hold_as_lapsed_even_before_the_sweep_runs', () => {
    // The slot is back on sale the instant the hold lapses. A calendar drawing
    // it as taken would show the owner a booked time a client can still buy.
    expect(
      calendarPresence(booking({ status: 'PENDING_PAYMENT', holdExpiresAt: AN_HOUR_AGO }), NOW)
    ).toBe('lapsed');
  });

  it('should_treat_the_hold_deadline_itself_as_lapsed', () => {
    // Half-open, like every other boundary in this feature: the hold covers
    // [created, holdExpiresAt), so the expiry instant is already past it.
    expect(calendarPresence(booking({ status: 'PENDING_PAYMENT', holdExpiresAt: NOW }), NOW)).toBe(
      'lapsed'
    );
  });

  it('should_present_a_hold_with_no_deadline_as_holding', () => {
    // Mirrors `blocksAvailability`: reading a missing deadline as "expired long
    // ago" would erase a booking the instant a write set the status without it.
    expect(
      calendarPresence(booking({ status: 'PENDING_PAYMENT', holdExpiresAt: null }), NOW)
    ).toBe('holding');
  });

  it('should_present_an_unanswered_receipt_as_awaiting_approval_whatever_the_clock_says', () => {
    // **The reason this predicate exists at all.** `blocksAvailability` answers
    // `false` here — correctly, since nothing can be sold into a time already
    // being used — so reusing it would file yesterday's real appointment under
    // "no effect" and tell the owner it never happened.
    const yesterday = {
      startTime: new Date('2026-08-16T13:00:00.000Z'),
      endTime: new Date('2026-08-16T13:30:00.000Z'),
    };
    const stale = booking({ status: 'PENDING_APPROVAL', holdExpiresAt: AN_HOUR_AGO, ...yesterday });

    expect(blocksAvailability(stale, NOW)).toBe(false);
    expect(calendarPresence(stale, NOW)).toBe('awaitingApproval');
  });

  it('should_present_a_future_receipt_as_awaiting_approval_too', () => {
    expect(
      calendarPresence(booking({ status: 'PENDING_APPROVAL', holdExpiresAt: AN_HOUR_AGO }), NOW)
    ).toBe('awaitingApproval');
  });

  it('should_answer_for_every_member_of_the_status_enum', () => {
    for (const status of BOOKING_STATUSES) {
      expect(CALENDAR_PRESENCES).toContain(calendarPresence(booking({ status }), NOW));
    }
  });

  it('should_occupy_the_day_whenever_the_time_is_still_off_sale', () => {
    // The two rules are allowed to differ in one direction only: anything the
    // availability rule still blocks must occupy the calendar, or the owner
    // would see free time a client cannot buy. The converse is false, and the
    // past receipt above is the case that makes it false.
    for (const status of BOOKING_STATUSES) {
      for (const holdExpiresAt of [null, IN_TEN_MINUTES, AN_HOUR_AGO]) {
        const candidate = booking({ status, holdExpiresAt });
        if (blocksAvailability(candidate, NOW)) {
          expect(OCCUPYING_PRESENCES).toContain(calendarPresence(candidate, NOW));
        }
      }
    }
  });
});
