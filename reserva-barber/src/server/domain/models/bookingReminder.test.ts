import { describe, it, expect } from 'vitest';
import { isReminderDue, reminderDueBefore } from './Booking';
import { REMINDER_LEAD_HOURS, REMINDER_MIN_GAP_HOURS } from './bookingHorizon';

/**
 * When a confirmed appointment is due a reminder.
 *
 * **The rule lives here and not in SQL**, for the reason B7's sweep records
 * about its own: the candidate query narrows by status, by the null claim and
 * by a bound on `startTime`, and this predicate decides. A second expression of
 * the rule in a `WHERE` clause drifts from this one the first time either is
 * refined.
 *
 * **One clause is deliberately expressed in both places, and it is the one that
 * cannot be allowed to fail: `startTime > now`.** B7 duplicates its grace
 * window for exactly this shape of reason — the property whose failure is
 * unrecoverable does not get to rest on a bound no unit test can see. Here the
 * failure is a first production run that mails every client the shop has ever
 * had.
 */
const LEAD_MS = REMINDER_LEAD_HOURS * 60 * 60_000;
const GAP_MS = REMINDER_MIN_GAP_HOURS * 60 * 60_000;

const NOW = new Date('2026-08-29T12:00:00.000Z');

/** A booking made long enough before its appointment to be worth reminding. */
function booking(startTime: Date, createdAt = new Date(startTime.getTime() - LEAD_MS * 3)) {
  return { startTime, createdAt };
}

describe('reminderDueBefore', () => {
  it('should_return_the_instant_one_lead_after_now', () => {
    expect(reminderDueBefore(NOW).getTime()).toBe(NOW.getTime() + LEAD_MS);
  });

  it('should_add_a_fixed_duration_rather_than_construct_a_local_calendar_time', () => {
    // The lead is absolute hours, never "the same wall-clock time yesterday".
    // Two consequences: it is unaffected by any future daylight-saving change in
    // the business timezone, and it places the message at approximately the
    // appointment's own hour, which disposes of the quiet-hours question rather
    // than needing a separate rule for it.
    //
    // Proven by asserting the difference is constant across instants that a
    // calendar construction would treat differently — a midnight boundary, and
    // an hour a DST-observing zone would repeat or skip.
    for (const instant of [
      new Date('2026-08-29T23:59:59.000Z'),
      new Date('2026-11-01T05:30:00.000Z'),
      new Date('2026-03-08T06:30:00.000Z'),
    ]) {
      expect(reminderDueBefore(instant).getTime() - instant.getTime()).toBe(LEAD_MS);
    }
  });
});

describe('isReminderDue', () => {
  it('should_refuse_an_appointment_that_has_already_started', () => {
    // The single highest-consequence rule in this capability. Without it the
    // first run in any environment selects every confirmed booking in history —
    // fixtures, gate-script rows and real past appointments alike — and mails
    // all of them. Unbounded, aimed at real inboxes, unrecoverable.
    expect(isReminderDue(booking(new Date(NOW.getTime() - 60_000)), NOW)).toBe(false);
  });

  it('should_refuse_an_appointment_at_exactly_now', () => {
    // Strictly after, matching the conservative direction `blocksAvailability`
    // and `holdSweepCutoff` both take at their own boundaries.
    expect(isReminderDue(booking(NOW), NOW)).toBe(false);
  });

  it('should_refuse_an_appointment_beyond_the_lead', () => {
    const beyond = new Date(NOW.getTime() + LEAD_MS + 60_000);
    expect(isReminderDue(booking(beyond), NOW)).toBe(false);
  });

  it('should_accept_an_appointment_inside_the_lead', () => {
    const inside = new Date(NOW.getTime() + LEAD_MS - 60_000);
    expect(isReminderDue(booking(inside), NOW)).toBe(true);
  });

  it('should_accept_an_appointment_a_minute_from_now', () => {
    // The near edge of the window is open: a booking made days ago for an
    // appointment in one minute has still never been reminded, and telling
    // somebody an hour late is better than not at all.
    const soon = new Date(NOW.getTime() + 60_000);
    expect(isReminderDue(booking(soon), NOW)).toBe(true);
  });

  it('should_refuse_a_booking_made_inside_its_own_lead_window', () => {
    // Someone booking at 08:00 for 09:30 would otherwise get a "reminder"
    // minutes after the confirmation email that carried the same appointment,
    // the same details and the same link.
    const startTime = new Date(NOW.getTime() + 60 * 60_000);
    const createdAt = new Date(startTime.getTime() - GAP_MS + 60_000);
    expect(isReminderDue({ startTime, createdAt }, NOW)).toBe(false);
  });

  it('should_accept_a_booking_made_exactly_the_minimum_gap_before_its_appointment', () => {
    const startTime = new Date(NOW.getTime() + 60 * 60_000);
    const createdAt = new Date(startTime.getTime() - GAP_MS);
    expect(isReminderDue({ startTime, createdAt }, NOW)).toBe(true);
  });

  it('should_measure_the_gap_from_createdAt_and_never_from_updatedAt', () => {
    // `updatedAt` is not the booking's age: `markConfirmationEmailSent` bumps it
    // on every confirmed booking, as Prisma's `@updatedAt` does on every write
    // through the client — measured by the N1 gate. A booking created a week ago
    // and confirmed a minute ago must still be reminded.
    const startTime = new Date(NOW.getTime() + 60 * 60_000);
    const createdAt = new Date(NOW.getTime() - 7 * 24 * 60 * 60_000);

    // The predicate takes no `updatedAt`, which is what makes this unwritable
    // by accident. The assertion is that the shape it accepts is enough.
    expect(isReminderDue({ startTime, createdAt }, NOW)).toBe(true);
  });
});
