import { describe, it, expect } from 'vitest';
import { blocksAvailability, type BlockingCandidate } from './Booking';

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
