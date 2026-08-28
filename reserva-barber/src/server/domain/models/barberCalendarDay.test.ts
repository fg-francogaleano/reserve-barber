import { describe, it, expect } from 'vitest';
import {
  composeCalendarDay,
  describeAbsence,
  fallsOutsideWorkingHours,
  type CalendarAppointment,
} from './barberCalendarDay';
import { dayBoundsOf, type LocalDate } from './bookingCalendar';
import type { Interval } from './availability';

/**
 * The day under test is a Tuesday. Argentina is UTC−3 and observes no daylight
 * saving (T28), so a local hour `h` is `h + 3` UTC — written out rather than
 * computed, so a broken conversion cannot make the expectation agree with it.
 */
const DATE: LocalDate = { year: 2026, month: 9, day: 8 };

/** Local 09:00 → 12:00Z. */
function at(localHour: number, localMinute = 0): Date {
  return new Date(Date.UTC(2026, 8, 8, localHour + 3, localMinute));
}

const NOW = at(10);

const NINE_TO_SIX = [{ startMinute: 9 * 60, endMinute: 18 * 60 }];

function appointment(overrides: Partial<CalendarAppointment> = {}): CalendarAppointment {
  return {
    id: 'bk-1',
    startTime: at(11),
    endTime: at(11, 30),
    status: 'CONFIRMED',
    holdExpiresAt: null,
    clientName: 'Ana',
    serviceName: 'Corte',
    cancelledBy: null,
    ...overrides,
  };
}

function compose(input: {
  windows?: readonly { startMinute: number; endMinute: number }[];
  absences?: readonly Interval[];
  appointments?: readonly CalendarAppointment[];
  now?: Date;
}) {
  return composeCalendarDay({
    date: DATE,
    windows: input.windows ?? NINE_TO_SIX,
    absences: input.absences ?? [],
    appointments: input.appointments ?? [],
    now: input.now ?? NOW,
  });
}

describe('barberCalendarDay - free time', () => {
  it('should_offer_the_whole_window_when_nothing_touches_it', () => {
    const day = compose({});

    expect(day.freeIntervals).toEqual([{ start: at(9), end: at(18) }]);
  });

  it('should_split_the_window_around_an_appointment', () => {
    const day = compose({ appointments: [appointment()] });

    expect(day.freeIntervals).toEqual([
      { start: at(9), end: at(11) },
      { start: at(11, 30), end: at(18) },
    ]);
  });

  it('should_offer_free_time_inside_each_window_of_a_split_shift', () => {
    // T27: the editor writes one window per weekday today and the schema
    // permits a split shift without a migration. A composition shaped around
    // the editor's current behaviour would be the reason this could not be
    // fixed later.
    const day = compose({
      windows: [
        { startMinute: 9 * 60, endMinute: 13 * 60 },
        { startMinute: 16 * 60, endMinute: 20 * 60 },
      ],
    });

    expect(day.freeIntervals).toEqual([
      { start: at(9), end: at(13) },
      { start: at(16), end: at(20) },
    ]);
  });

  it('should_offer_nothing_when_an_absence_covers_the_whole_window', () => {
    const day = compose({ absences: [{ start: at(8), end: at(19) }] });

    expect(day.freeIntervals).toEqual([]);
  });

  it('should_trim_the_window_where_an_absence_overlaps_its_edge', () => {
    const day = compose({ absences: [{ start: at(8), end: at(12) }] });

    expect(day.freeIntervals).toEqual([{ start: at(12), end: at(18) }]);
  });

  it('should_subtract_an_absence_and_an_appointment_together', () => {
    const day = compose({
      absences: [{ start: at(13), end: at(14) }],
      appointments: [appointment()],
    });

    expect(day.freeIntervals).toEqual([
      { start: at(9), end: at(11) },
      { start: at(11, 30), end: at(13) },
      { start: at(14), end: at(18) },
    ]);
  });

  it('should_offer_nothing_on_a_day_the_barber_does_not_work', () => {
    const day = compose({ windows: [] });

    expect(day.freeIntervals).toEqual([]);
    expect(day.workingIntervals).toEqual([]);
  });

  it('should_not_be_reduced_by_a_booking_that_no_longer_occupies_the_day', () => {
    // A lapsed hold and a cancellation both give their time back, and the
    // owner must see it as sellable — it already is.
    const day = compose({
      appointments: [
        appointment({ id: 'a', status: 'CANCELLED' }),
        appointment({
          id: 'b',
          status: 'PENDING_PAYMENT',
          holdExpiresAt: at(9, 30),
          startTime: at(15),
          endTime: at(15, 30),
        }),
      ],
    });

    expect(day.freeIntervals).toEqual([{ start: at(9), end: at(18) }]);
  });
});

describe('barberCalendarDay - the two lanes', () => {
  it('should_place_an_occupying_appointment_in_the_timeline', () => {
    const day = compose({ appointments: [appointment()] });

    expect(day.occupying.map((entry) => entry.appointment.id)).toEqual(['bk-1']);
    expect(day.recorded).toEqual([]);
  });

  it('should_record_a_cancelled_appointment_beside_the_timeline', () => {
    const day = compose({ appointments: [appointment({ status: 'CANCELLED' })] });

    expect(day.occupying).toEqual([]);
    expect(day.recorded.map((entry) => entry.presence)).toEqual(['cancelled']);
  });

  it('should_keep_a_cancelled_booking_and_its_replacement_apart_at_the_same_time', () => {
    // The ordinary state of any shop that has ever had a cancellation. One lane
    // would overlap them and make the timeline claim the barber is in two
    // places at once.
    const day = compose({
      appointments: [
        appointment({ id: 'gone', status: 'CANCELLED', cancelledBy: 'CLIENT' }),
        appointment({ id: 'kept', status: 'CONFIRMED' }),
      ],
    });

    expect(day.occupying.map((entry) => entry.appointment.id)).toEqual(['kept']);
    expect(day.recorded.map((entry) => entry.appointment.id)).toEqual(['gone']);
  });

  it('should_order_each_lane_by_start_time', () => {
    const day = compose({
      appointments: [
        appointment({ id: 'late', startTime: at(16), endTime: at(16, 30) }),
        appointment({ id: 'early', startTime: at(10), endTime: at(10, 30) }),
        appointment({ id: 'mid', startTime: at(13), endTime: at(13, 30) }),
      ],
    });

    expect(day.occupying.map((entry) => entry.appointment.id)).toEqual(['early', 'mid', 'late']);
  });

  it('should_keep_a_past_unanswered_receipt_in_the_timeline', () => {
    // The case the calendar's own presence rule exists for: the availability
    // rule stops blocking this one once its appointment has started.
    const day = compose({
      appointments: [
        appointment({ status: 'PENDING_APPROVAL', startTime: at(9), endTime: at(9, 30) }),
      ],
      now: at(17),
    });

    expect(day.occupying.map((entry) => entry.presence)).toEqual(['awaitingApproval']);
  });
});

describe('barberCalendarDay - an appointment outside the current schedule', () => {
  it('should_not_flag_an_appointment_inside_its_window', () => {
    expect(fallsOutsideWorkingHours(appointment(), [{ start: at(9), end: at(18) }], [])).toBe(false);
  });

  it('should_flag_an_appointment_that_ends_after_the_window', () => {
    const late = appointment({ startTime: at(17, 30), endTime: at(18, 30) });

    expect(fallsOutsideWorkingHours(late, [{ start: at(9), end: at(18) }], [])).toBe(true);
  });

  it('should_flag_an_appointment_that_starts_before_the_window', () => {
    const early = appointment({ startTime: at(8, 30), endTime: at(9, 30) });

    expect(fallsOutsideWorkingHours(early, [{ start: at(9), end: at(18) }], [])).toBe(true);
  });

  it('should_flag_an_appointment_on_a_weekday_with_no_windows_at_all', () => {
    expect(fallsOutsideWorkingHours(appointment(), [], [])).toBe(true);
  });

  it('should_flag_an_appointment_overlapping_an_absence', () => {
    expect(
      fallsOutsideWorkingHours(
        appointment(),
        [{ start: at(9), end: at(18) }],
        [{ start: at(11, 15), end: at(12) }]
      )
    ).toBe(true);
  });

  it('should_not_flag_an_appointment_that_merely_abuts_an_absence', () => {
    // Half-open intervals: an absence starting exactly when the appointment
    // ends does not overlap it.
    expect(
      fallsOutsideWorkingHours(
        appointment(),
        [{ start: at(9), end: at(18) }],
        [{ start: at(11, 30), end: at(12) }]
      )
    ).toBe(false);
  });

  it('should_not_flag_an_appointment_that_exactly_fills_its_window', () => {
    const full = appointment({ startTime: at(9), endTime: at(18) });

    expect(fallsOutsideWorkingHours(full, [{ start: at(9), end: at(18) }], [])).toBe(false);
  });

  it('should_not_flag_an_appointment_spanning_two_adjacent_windows', () => {
    // Contiguous windows are one span of working time, however they are stored.
    const across = appointment({ startTime: at(12, 30), endTime: at(13, 30) });

    expect(
      fallsOutsideWorkingHours(
        across,
        [
          { start: at(9), end: at(13) },
          { start: at(13), end: at(18) },
        ],
        []
      )
    ).toBe(false);
  });

  it('should_flag_an_appointment_falling_into_the_gap_of_a_split_shift', () => {
    const inTheGap = appointment({ startTime: at(14), endTime: at(14, 30) });

    expect(
      fallsOutsideWorkingHours(
        inTheGap,
        [
          { start: at(9), end: at(13) },
          { start: at(16), end: at(20) },
        ],
        []
      )
    ).toBe(true);
  });

  it('should_mark_the_stranded_entry_in_the_composed_day', () => {
    // T29's whole point, end to end: a schedule narrowed under a booking that
    // already existed. The appointment is still rendered; the free time is not.
    const day = compose({
      windows: [{ startMinute: 9 * 60, endMinute: 17 * 60 }],
      appointments: [appointment({ startTime: at(17, 30), endTime: at(18) })],
    });

    expect(day.occupying).toHaveLength(1);
    expect(day.occupying[0]?.outsideWorkingHours).toBe(true);
    expect(day.freeIntervals).toEqual([{ start: at(9), end: at(17) }]);
  });

  it('should_not_flag_a_recorded_appointment_outside_the_window', () => {
    // A cancelled booking is not a scheduling problem; badging one would report
    // a conflict that no longer exists.
    const day = compose({
      windows: [{ startMinute: 9 * 60, endMinute: 17 * 60 }],
      appointments: [
        appointment({ status: 'CANCELLED', startTime: at(17, 30), endTime: at(18) }),
      ],
    });

    expect(day.recorded[0]?.outsideWorkingHours).toBe(false);
  });
});

describe('barberCalendarDay - describing an absence on a day', () => {
  const DAY_RANGE = dayBoundsOf(DATE);

  it('should_describe_an_absence_inside_the_day_by_its_two_times', () => {
    const described = describeAbsence({ start: at(13), end: at(14) }, DAY_RANGE);

    expect(described).toEqual({ kind: 'between', start: at(13), end: at(14) });
  });

  it('should_describe_a_three_day_absence_on_its_middle_day_as_the_whole_day', () => {
    // **The defect this shape exists for.** Formatted as two wall-clock times,
    // this absence rendered as "10:00 a 18:00" — eight hours on a day the
    // barber is away for all of.
    const described = describeAbsence(
      {
        start: new Date(Date.UTC(2026, 8, 7, 13)),
        end: new Date(Date.UTC(2026, 8, 9, 21)),
      },
      DAY_RANGE
    );

    expect(described).toEqual({ kind: 'wholeDay' });
  });

  it('should_describe_an_absence_that_began_earlier_by_when_it_lifts', () => {
    const described = describeAbsence(
      { start: new Date(Date.UTC(2026, 8, 7, 13)), end: at(12) },
      DAY_RANGE
    );

    expect(described).toEqual({ kind: 'untilTime', end: at(12) });
  });

  it('should_describe_an_absence_that_continues_afterwards_by_when_it_starts', () => {
    const described = describeAbsence(
      { start: at(15), end: new Date(Date.UTC(2026, 8, 10, 13)) },
      DAY_RANGE
    );

    expect(described).toEqual({ kind: 'fromTime', start: at(15) });
  });

  it('should_treat_an_absence_exactly_covering_the_day_as_the_whole_day', () => {
    expect(describeAbsence({ start: DAY_RANGE.start, end: DAY_RANGE.end }, DAY_RANGE)).toEqual({
      kind: 'wholeDay',
    });
  });

  it('should_show_a_time_for_an_absence_starting_exactly_at_midnight', () => {
    // It did not begin *before* this day, and 00:00 is a real time to show.
    const described = describeAbsence({ start: DAY_RANGE.start, end: at(12) }, DAY_RANGE);

    expect(described).toEqual({ kind: 'untilTime', end: at(12) });
  });

  it('should_describe_every_absence_the_composed_day_carries', () => {
    const day = compose({
      absences: [
        { start: at(13), end: at(14) },
        { start: new Date(Date.UTC(2026, 8, 7, 13)), end: new Date(Date.UTC(2026, 8, 9, 21)) },
      ],
    });

    expect(day.absences.map((absence) => absence.kind)).toEqual(['between', 'wholeDay']);
  });

  it('should_never_leak_an_instant_from_another_date_into_the_day', () => {
    // The property, stated rather than described: every instant the composed
    // day hands out for an absence falls inside that day.
    const day = compose({
      absences: [{ start: new Date(Date.UTC(2026, 8, 7, 13)), end: at(12) }],
    });

    for (const absence of day.absences) {
      const instants = [
        'start' in absence ? absence.start : undefined,
        'end' in absence ? absence.end : undefined,
      ].filter((value): value is Date => value !== undefined);

      for (const instant of instants) {
        expect(instant.getTime()).toBeGreaterThanOrEqual(DAY_RANGE.start.getTime());
        expect(instant.getTime()).toBeLessThanOrEqual(DAY_RANGE.end.getTime());
      }
    }
  });
});
