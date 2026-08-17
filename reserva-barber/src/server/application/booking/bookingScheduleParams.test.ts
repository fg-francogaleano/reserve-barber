import { describe, it, expect } from 'vitest';
import { resolveDateSelection, resolveSlotSelection } from './bookingScheduleParams';
import { MAX_BOOKING_HORIZON_DAYS } from '@/server/domain/models/bookingHorizon';
import { addDays, formatLocalDate, type LocalDate } from '@/server/domain/models/bookingCalendar';

const TODAY: LocalDate = { year: 2026, month: 8, day: 17 };

/** Local 09:00, 09:05 and 15:00 on the day under test. */
const SLOTS = [
  new Date('2026-08-17T12:00:00.000Z'),
  new Date('2026-08-17T12:05:00.000Z'),
  new Date('2026-08-17T18:00:00.000Z'),
];

describe('bookingScheduleParams - the requested date', () => {
  it('should_accept_today', () => {
    expect(resolveDateSelection(formatLocalDate(TODAY), TODAY)).toEqual({
      date: TODAY,
      discarded: false,
    });
  });

  it('should_report_no_date_and_no_loss_when_none_was_asked_for', () => {
    // Absent is not discarded. The client who has not chosen yet must not be
    // told that something of theirs is unavailable.
    expect(resolveDateSelection(undefined, TODAY)).toEqual({ discarded: false });
  });

  it('should_discard_a_past_date_rather_than_failing_the_request', () => {
    const result = resolveDateSelection(formatLocalDate(addDays(TODAY, -1)), TODAY);

    expect(result.date).toBeUndefined();
    expect(result.discarded).toBe(true);
  });

  it('should_discard_a_date_beyond_the_horizon', () => {
    const beyond = formatLocalDate(addDays(TODAY, MAX_BOOKING_HORIZON_DAYS + 1));

    expect(resolveDateSelection(beyond, TODAY).discarded).toBe(true);
  });

  it('should_accept_the_last_day_of_the_horizon', () => {
    const last = addDays(TODAY, MAX_BOOKING_HORIZON_DAYS);

    expect(resolveDateSelection(formatLocalDate(last), TODAY).date).toEqual(last);
  });

  it('should_discard_a_non_canonical_spelling', () => {
    expect(resolveDateSelection('2026-8-17', TODAY).discarded).toBe(true);
  });

  it('should_discard_a_date_that_does_not_exist', () => {
    expect(resolveDateSelection('2026-02-30', TODAY).discarded).toBe(true);
  });

  it('should_discard_an_overlong_value_without_parsing_it', () => {
    expect(resolveDateSelection('2026-08-17'.padEnd(5000, '0'), TODAY).discarded).toBe(true);
  });

  it('should_resolve_a_repeated_parameter_to_its_first_occurrence', () => {
    const repeated = [formatLocalDate(TODAY), formatLocalDate(addDays(TODAY, 3))];

    expect(resolveDateSelection(repeated, TODAY).date).toEqual(TODAY);
  });

  it('should_treat_an_empty_value_as_absent_rather_than_discarded', () => {
    expect(resolveDateSelection('', TODAY)).toEqual({ discarded: false });
  });
});

describe('bookingScheduleParams - the requested time', () => {
  it('should_accept_a_time_that_is_on_offer', () => {
    const result = resolveSlotSelection('09:05', SLOTS);

    expect(result.slot).toEqual(SLOTS[1]);
    expect(result.discarded).toBe(false);
  });

  it('should_discard_a_time_that_is_not_on_offer', () => {
    expect(resolveSlotSelection('09:10', SLOTS)).toEqual({ discarded: true });
  });

  it('should_answer_a_taken_time_and_an_absurd_time_identically', () => {
    // No oracle: the response to a start another client just booked must be
    // indistinguishable from the response to junk. B2 established this for ids;
    // a time is the same kind of secret.
    const taken = resolveSlotSelection('09:10', SLOTS);
    const absurd = resolveSlotSelection('99:99', SLOTS);
    const junk = resolveSlotSelection('mañana', SLOTS);

    expect(absurd).toEqual(taken);
    expect(junk).toEqual(taken);
  });

  it('should_discard_an_overlong_value', () => {
    expect(resolveSlotSelection('0'.repeat(4000), SLOTS).discarded).toBe(true);
  });

  it('should_report_no_time_and_no_loss_when_none_was_asked_for', () => {
    expect(resolveSlotSelection(undefined, SLOTS)).toEqual({ discarded: false });
  });

  it('should_discard_every_time_when_nothing_is_on_offer', () => {
    expect(resolveSlotSelection('09:00', []).discarded).toBe(true);
  });

  it('should_not_accept_a_time_that_merely_parses', () => {
    // The parameter is matched, never parsed and trusted. 09:00 exists on the
    // clock and is absent from this list, so it is not a selection.
    expect(resolveSlotSelection('12:00', SLOTS).slot).toBeUndefined();
  });

  it('should_resolve_a_repeated_parameter_to_its_first_occurrence', () => {
    expect(resolveSlotSelection(['09:05', '15:00'], SLOTS).slot).toEqual(SLOTS[1]);
  });
});
