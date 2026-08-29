import { describe, it, expect } from 'vitest';
import {
  addDays,
  businessToday,
  dayBoundsOf,
  formatLocalDate,
  isWithinHorizon,
  monthBoundsOf,
  parseLocalDate,
  previousMonth,
  weekBoundsOf,
  weekdayOfLocalDate,
  workingIntervalsFor,
  type LocalDate,
} from './bookingCalendar';
import { MAX_BOOKING_HORIZON_DAYS } from './bookingHorizon';

/**
 * 23:30 in Buenos Aires on Sunday 2026-08-16 is 02:30 UTC on Monday the 17th.
 *
 * This is the three-hour window every evening in which the runtime's calendar
 * has already rolled over and the business's has not. Every assertion below
 * that uses it would pass against `getDay()` / `getDate()` on a different
 * instant and fail here — which is the only reason it is worth testing.
 */
const SUNDAY_NIGHT_LOCAL = new Date('2026-08-17T02:30:00.000Z');

describe('bookingCalendar - the business calendar at the end of a local day', () => {
  it('should_resolve_today_as_the_business_date_not_the_runtime_one', () => {
    expect(businessToday(SUNDAY_NIGHT_LOCAL)).toEqual({ year: 2026, month: 8, day: 16 });
    expect(SUNDAY_NIGHT_LOCAL.getUTCDate()).toBe(17);
  });

  it('should_resolve_the_weekday_as_the_business_one', () => {
    // 0 = Sunday. The runtime would say Monday.
    expect(weekdayOfLocalDate(businessToday(SUNDAY_NIGHT_LOCAL))).toBe(0);
    expect(SUNDAY_NIGHT_LOCAL.getUTCDay()).toBe(1);
  });

  it('should_bound_the_local_day_from_local_midnight_to_the_next', () => {
    const bounds = dayBoundsOf({ year: 2026, month: 8, day: 16 });

    expect(bounds.start.toISOString()).toBe('2026-08-16T03:00:00.000Z');
    expect(bounds.end.toISOString()).toBe('2026-08-17T03:00:00.000Z');
  });

  it('should_place_the_evening_instant_inside_its_own_local_day', () => {
    const bounds = dayBoundsOf(businessToday(SUNDAY_NIGHT_LOCAL));

    expect(SUNDAY_NIGHT_LOCAL.getTime()).toBeGreaterThanOrEqual(bounds.start.getTime());
    expect(SUNDAY_NIGHT_LOCAL.getTime()).toBeLessThan(bounds.end.getTime());
  });
});

describe('bookingCalendar - working windows become instants', () => {
  const monday: LocalDate = { year: 2026, month: 8, day: 17 };

  it('should_convert_a_wall_clock_window_to_the_instants_it_names', () => {
    const [window] = workingIntervalsFor(monday, [{ startMinute: 9 * 60, endMinute: 18 * 60 }]);

    expect(window!.start.toISOString()).toBe('2026-08-17T12:00:00.000Z');
    expect(window!.end.toISOString()).toBe('2026-08-17T21:00:00.000Z');
  });

  it('should_convert_every_window_of_a_split_shift', () => {
    const windows = workingIntervalsFor(monday, [
      { startMinute: 9 * 60, endMinute: 13 * 60 },
      { startMinute: 16 * 60, endMinute: 20 * 60 },
    ]);

    expect(windows).toHaveLength(2);
    expect(windows[1]!.start.toISOString()).toBe('2026-08-17T19:00:00.000Z');
  });

  it('should_return_nothing_for_a_day_with_no_window', () => {
    expect(workingIntervalsFor(monday, [])).toEqual([]);
  });

  it('should_return_windows_in_chronological_order_whatever_order_they_arrive_in', () => {
    const windows = workingIntervalsFor(monday, [
      { startMinute: 16 * 60, endMinute: 20 * 60 },
      { startMinute: 9 * 60, endMinute: 13 * 60 },
    ]);

    expect(windows[0]!.start.getTime()).toBeLessThan(windows[1]!.start.getTime());
  });
});

describe('bookingCalendar - a date supplied by a stranger', () => {
  it('should_accept_a_canonical_date', () => {
    expect(parseLocalDate('2026-08-17')).toEqual({ year: 2026, month: 8, day: 17 });
  });

  it('should_reject_a_non_canonical_spelling', () => {
    // Accepting `2026-8-1` would mean two spellings of one day, and the flow
    // builds its own links — so a second spelling can only arrive from outside.
    expect(parseLocalDate('2026-8-1')).toBeUndefined();
    expect(parseLocalDate('2026-08-1')).toBeUndefined();
  });

  it('should_reject_a_date_that_does_not_exist', () => {
    expect(parseLocalDate('2026-02-30')).toBeUndefined();
    expect(parseLocalDate('2026-13-01')).toBeUndefined();
    expect(parseLocalDate('2026-00-10')).toBeUndefined();
    expect(parseLocalDate('2026-04-31')).toBeUndefined();
  });

  it('should_accept_a_real_leap_day_and_reject_a_false_one', () => {
    expect(parseLocalDate('2028-02-29')).toEqual({ year: 2028, month: 2, day: 29 });
    expect(parseLocalDate('2026-02-29')).toBeUndefined();
  });

  it('should_reject_junk_without_throwing', () => {
    for (const junk of [
      '',
      '  ',
      'hoy',
      '2026-08-17T10:00',
      '17/08/2026',
      '0000-01-01',
      'x'.repeat(4000),
    ]) {
      expect(parseLocalDate(junk)).toBeUndefined();
    }
  });

  it('should_round_trip_a_date_through_its_canonical_form', () => {
    expect(formatLocalDate({ year: 2026, month: 8, day: 7 })).toBe('2026-08-07');
    expect(parseLocalDate(formatLocalDate({ year: 2026, month: 8, day: 7 }))).toEqual({
      year: 2026,
      month: 8,
      day: 7,
    });
  });
});

describe('bookingCalendar - the horizon', () => {
  const today: LocalDate = { year: 2026, month: 8, day: 16 };

  it('should_accept_today_and_the_last_day_of_the_horizon', () => {
    expect(isWithinHorizon(today, today)).toBe(true);
    expect(isWithinHorizon(addDays(today, MAX_BOOKING_HORIZON_DAYS), today)).toBe(true);
  });

  it('should_reject_yesterday_and_the_day_after_the_horizon', () => {
    expect(isWithinHorizon(addDays(today, -1), today)).toBe(false);
    expect(isWithinHorizon(addDays(today, MAX_BOOKING_HORIZON_DAYS + 1), today)).toBe(false);
  });

  it('should_reject_a_mistyped_year', () => {
    expect(isWithinHorizon({ year: 2126, month: 8, day: 16 }, today)).toBe(false);
    expect(isWithinHorizon({ year: 2020, month: 8, day: 16 }, today)).toBe(false);
  });

  it('should_cross_a_month_boundary_without_inventing_a_date', () => {
    expect(addDays({ year: 2026, month: 8, day: 30 }, 5)).toEqual({
      year: 2026,
      month: 9,
      day: 4,
    });
  });

  it('should_cross_a_year_boundary_without_producing_a_thirteenth_month', () => {
    expect(addDays({ year: 2026, month: 12, day: 30 }, 5)).toEqual({
      year: 2027,
      month: 1,
      day: 4,
    });
  });

  it('should_cross_february_in_a_leap_year', () => {
    expect(addDays({ year: 2028, month: 2, day: 28 }, 1)).toEqual({
      year: 2028,
      month: 2,
      day: 29,
    });
  });
});

/**
 * 23:30 in Buenos Aires on the last day of August 2026 is 02:30 UTC on the 1st
 * of September.
 *
 * The month-boundary twin of `SUNDAY_NIGHT_LOCAL`, and the instant that decides
 * whether an income figure lands in the right month. A boundary built as
 * `Date.UTC(2026, 8, 1)` sits three hours early, so this payment would be
 * counted in September — a figure the owner cannot reconcile against a bank
 * statement, wrong in the direction that flatters the newer month.
 */
const MONTH_END_NIGHT_LOCAL = new Date('2026-09-01T02:30:00.000Z');

describe('bookingCalendar - month bounds in the business calendar', () => {
  it('should_bound_a_month_from_its_own_first_local_midnight_to_the_next', () => {
    const bounds = monthBoundsOf({ year: 2026, month: 8, day: 16 });

    expect(bounds.start.toISOString()).toBe('2026-08-01T03:00:00.000Z');
    expect(bounds.end.toISOString()).toBe('2026-09-01T03:00:00.000Z');
  });

  it('should_ignore_the_day_because_a_month_is_decided_by_year_and_month_alone', () => {
    const fromFirst = monthBoundsOf({ year: 2026, month: 8, day: 1 });
    const fromLast = monthBoundsOf({ year: 2026, month: 8, day: 31 });

    expect(fromFirst).toEqual(fromLast);
  });

  it('should_place_the_last_evening_of_a_month_inside_that_month', () => {
    const august = monthBoundsOf(businessToday(MONTH_END_NIGHT_LOCAL));

    expect(businessToday(MONTH_END_NIGHT_LOCAL)).toEqual({ year: 2026, month: 8, day: 31 });
    expect(MONTH_END_NIGHT_LOCAL.getTime()).toBeGreaterThanOrEqual(august.start.getTime());
    expect(MONTH_END_NIGHT_LOCAL.getTime()).toBeLessThan(august.end.getTime());
  });

  it('should_exclude_the_last_evening_of_the_previous_month_from_this_one', () => {
    const september = monthBoundsOf({ year: 2026, month: 9, day: 3 });

    // The instant the naive UTC construction would wrongly admit.
    expect(MONTH_END_NIGHT_LOCAL.getTime()).toBeLessThan(september.start.getTime());
  });

  it('should_be_half_open_so_the_first_instant_of_the_next_month_is_outside', () => {
    const august = monthBoundsOf({ year: 2026, month: 8, day: 1 });
    const september = monthBoundsOf({ year: 2026, month: 9, day: 1 });

    expect(august.end.getTime()).toBe(september.start.getTime());
    expect(august.end.getTime()).toBeGreaterThan(august.start.getTime());
  });

  it('should_carry_the_year_across_a_december_rollover', () => {
    const december = monthBoundsOf({ year: 2026, month: 12, day: 25 });

    expect(december.start.toISOString()).toBe('2026-12-01T03:00:00.000Z');
    expect(december.end.toISOString()).toBe('2027-01-01T03:00:00.000Z');
  });

  it('should_size_february_from_the_calendar_rather_than_from_a_fixed_span', () => {
    const leap = monthBoundsOf({ year: 2028, month: 2, day: 10 });
    const common = monthBoundsOf({ year: 2026, month: 2, day: 10 });

    const days = (bounds: { start: Date; end: Date }): number =>
      (bounds.end.getTime() - bounds.start.getTime()) / 86_400_000;

    expect(days(leap)).toBe(29);
    expect(days(common)).toBe(28);
    // The "add 30 days" version would answer 30 for both, and would be wrong
    // for eight months of every year rather than for an edge case.
    expect(days(monthBoundsOf({ year: 2026, month: 1, day: 1 }))).toBe(31);
  });
});

/**
 * Week bounds, added by D5 — the first range in this product that is neither a
 * day nor a month.
 *
 * The reference week is Monday 2026-08-10 to Sunday 2026-08-16. It is chosen
 * because its Sunday is `SUNDAY_NIGHT_LOCAL`'s business date, so the same
 * instant that proves `businessToday` is not the runtime's date also proves the
 * week it belongs to.
 */
describe('bookingCalendar - week bounds in the business calendar', () => {
  it('should_bound_a_week_from_its_own_monday_midnight_to_the_next', () => {
    const bounds = weekBoundsOf({ year: 2026, month: 8, day: 12 });

    expect(bounds.start.toISOString()).toBe('2026-08-10T03:00:00.000Z');
    expect(bounds.end.toISOString()).toBe('2026-08-17T03:00:00.000Z');
  });

  it('should_treat_monday_as_the_first_day_rather_than_sunday', () => {
    const monday: LocalDate = { year: 2026, month: 8, day: 10 };

    expect(weekdayOfLocalDate(monday)).toBe(1);
    // A Sunday-first week would put this Monday at the *end* of the previous
    // week, so its own midnight would not be the range's start.
    expect(weekBoundsOf(monday).start.toISOString()).toBe('2026-08-10T03:00:00.000Z');
  });

  it('should_resolve_a_sunday_to_the_week_that_began_six_days_earlier', () => {
    const sunday: LocalDate = { year: 2026, month: 8, day: 16 };

    expect(weekdayOfLocalDate(sunday)).toBe(0);
    // The whole point: `weekday - 1` is -1 on a Sunday, and the naive version
    // lands on the *next* Monday instead of the previous one.
    expect(weekBoundsOf(sunday)).toEqual(weekBoundsOf({ year: 2026, month: 8, day: 10 }));
  });

  it('should_place_the_last_evening_of_a_week_inside_that_week', () => {
    // 23:30 on Sunday the 16th locally is 02:30 UTC on Monday the 17th — the
    // runtime has already rolled into the next week and the business has not.
    const week = weekBoundsOf(businessToday(SUNDAY_NIGHT_LOCAL));

    expect(businessToday(SUNDAY_NIGHT_LOCAL)).toEqual({ year: 2026, month: 8, day: 16 });
    expect(SUNDAY_NIGHT_LOCAL.getTime()).toBeGreaterThanOrEqual(week.start.getTime());
    expect(SUNDAY_NIGHT_LOCAL.getTime()).toBeLessThan(week.end.getTime());
  });

  it('should_be_half_open_so_the_first_instant_of_the_next_week_is_outside', () => {
    const thisWeek = weekBoundsOf({ year: 2026, month: 8, day: 12 });
    const nextWeek = weekBoundsOf({ year: 2026, month: 8, day: 19 });

    expect(thisWeek.end.getTime()).toBe(nextWeek.start.getTime());
    expect(thisWeek.end.getTime()).toBeGreaterThan(thisWeek.start.getTime());
  });

  it('should_give_every_day_of_one_week_the_same_bounds', () => {
    const monday = weekBoundsOf({ year: 2026, month: 8, day: 10 });

    for (let offset = 1; offset <= 6; offset += 1) {
      expect(weekBoundsOf(addDays({ year: 2026, month: 8, day: 10 }, offset))).toEqual(monday);
    }
  });

  it('should_carry_a_week_across_a_month_end', () => {
    // Monday 2026-08-31 to Sunday 2026-09-06: the week straddles the month.
    const bounds = weekBoundsOf({ year: 2026, month: 9, day: 2 });

    expect(bounds.start.toISOString()).toBe('2026-08-31T03:00:00.000Z');
    expect(bounds.end.toISOString()).toBe('2026-09-07T03:00:00.000Z');
  });

  it('should_carry_a_week_across_a_year_end', () => {
    // Monday 2026-12-28 to Sunday 2027-01-03.
    const bounds = weekBoundsOf({ year: 2027, month: 1, day: 1 });

    expect(bounds.start.toISOString()).toBe('2026-12-28T03:00:00.000Z');
    expect(bounds.end.toISOString()).toBe('2027-01-04T03:00:00.000Z');
  });

  it('should_be_seven_days_long_computed_from_both_boundaries', () => {
    const bounds = weekBoundsOf({ year: 2026, month: 8, day: 12 });

    expect((bounds.end.getTime() - bounds.start.getTime()) / 86_400_000).toBe(7);
  });
});

describe('bookingCalendar - the previous month', () => {
  it('should_return_the_preceding_month_of_the_same_year', () => {
    expect(previousMonth({ year: 2026, month: 8, day: 16 })).toEqual({
      year: 2026,
      month: 7,
      day: 1,
    });
  });

  it('should_decrement_the_year_in_january', () => {
    expect(previousMonth({ year: 2026, month: 1, day: 20 })).toEqual({
      year: 2025,
      month: 12,
      day: 1,
    });
  });

  it('should_not_produce_an_invalid_date_from_a_thirty_first', () => {
    // The naive `{ ...date, month: date.month - 1 }` yields "31 June", which
    // `Date.UTC` silently rolls into 1 July — landing the "last month" range
    // back inside this month. Anchoring on the first is what avoids it.
    const fromLastDay = previousMonth({ year: 2026, month: 7, day: 31 });

    expect(fromLastDay).toEqual({ year: 2026, month: 6, day: 1 });
    expect(monthBoundsOf(fromLastDay).start.toISOString()).toBe('2026-06-01T03:00:00.000Z');
  });

  it('should_ignore_the_day_because_the_answer_is_a_month', () => {
    const fromFirst = previousMonth({ year: 2026, month: 8, day: 1 });
    const fromLast = previousMonth({ year: 2026, month: 8, day: 31 });

    expect(fromFirst).toEqual(fromLast);
  });

  it('should_bound_a_whole_calendar_month_rather_than_a_fixed_span', () => {
    const february = monthBoundsOf(previousMonth({ year: 2026, month: 3, day: 15 }));

    expect(february.start.toISOString()).toBe('2026-02-01T03:00:00.000Z');
    expect(february.end.toISOString()).toBe('2026-03-01T03:00:00.000Z');
    expect((february.end.getTime() - february.start.getTime()) / 86_400_000).toBe(28);
  });

  it('should_resolve_the_previous_month_from_the_business_date_not_the_runtime_one', () => {
    // 02:30 UTC on 1 September is 23:30 on 31 August in the business calendar,
    // so "last month" is July — the runtime's reading would answer August.
    expect(previousMonth(businessToday(MONTH_END_NIGHT_LOCAL))).toEqual({
      year: 2026,
      month: 7,
      day: 1,
    });
  });
});
