/**
 * Composing one barber's day for the owner's calendar (D3).
 *
 * Everything here is pure: no clock of its own, no I/O, no framework. What it
 * takes is the three facts the day is drawn from — the barber's working windows
 * for that weekday, the absences overlapping it, and the bookings inside it —
 * and what it returns is the day as the page renders it.
 *
 * **It generates no slots, and that is a rule rather than an omission.** A
 * bookable slot needs a chosen service's duration and a lead time, and this
 * surface has neither: no service is selected on a calendar. The free time here
 * is *time*, and calling `generateSlots` would turn it into a bookability claim
 * the page cannot support.
 *
 * The interval arithmetic is `availability.ts`'s, not a second copy: the same
 * `subtractAll` the public flow subtracts blockers with, applied to a different
 * question.
 */

import { overlaps, subtractAll, type Interval } from './availability';
import {
  calendarPresence,
  occupiesCalendar,
  type BookingStatus,
  type CalendarPresence,
  type CancelledBy,
} from './Booking';
import { dayBoundsOf, workingIntervalsFor, type LocalDate } from './bookingCalendar';

/**
 * One appointment as the calendar needs it.
 *
 * **No email, no telephone, no price, no deposit.** A field that is not
 * selected cannot reach a log line or a serialized prop; contact details belong
 * to D4 and money to D5. `holdExpiresAt` is here only because the presence rule
 * reads it, and `cancelledBy` because a surface that cannot tell "I cancelled
 * this" from "my client did" is not carrying the fact (C1).
 */
export interface CalendarAppointment {
  readonly id: string;
  readonly startTime: Date;
  readonly endTime: Date;
  readonly status: BookingStatus;
  readonly holdExpiresAt: Date | null;
  readonly clientName: string;
  readonly serviceName: string;
  readonly cancelledBy: CancelledBy | null;
}

/** An appointment with the two facts the page needs about it. */
export interface CalendarEntry {
  readonly appointment: CalendarAppointment;
  readonly presence: CalendarPresence;
  /**
   * Whether this appointment falls outside the schedule **as it stands now**.
   *
   * Always `false` for a recorded entry: a cancelled or lapsed booking is not a
   * scheduling problem, and badging one would report a conflict that no longer
   * exists.
   */
  readonly outsideWorkingHours: boolean;
}

/**
 * An absence as it should be *described* on one day.
 *
 * **A shape rather than two instants, because two instants are how the page
 * lied about one.** An absence running from the day before to the day after
 * carries a start and an end whose wall-clock times belong to other dates; a
 * chip rendering them as "10:00 a 18:00" says the barber is away for eight
 * hours on a day they are away for all of it.
 *
 * The variants are the four ways an absence can meet a day, and each one has
 * something different and true to say. The page picks copy; this decides which
 * sentence is available to it, so a component cannot format its way back into
 * the wrong one.
 *
 * Boundaries are strict: an absence beginning exactly at the day's first instant
 * has not begun *before* the day, and 00:00 is a real time to show.
 */
export type AbsenceOnDay =
  /** Covers the day from end to end — it may extend past either edge. */
  | { readonly kind: 'wholeDay' }
  /** Began before this day and lifts during it. */
  | { readonly kind: 'untilTime'; readonly end: Date }
  /** Begins during this day and continues past it. */
  | { readonly kind: 'fromTime'; readonly start: Date }
  /** Begins and ends inside this day. */
  | { readonly kind: 'between'; readonly start: Date; readonly end: Date };

export interface CalendarDay {
  /** The weekday's stored windows, as instants, chronologically. */
  readonly workingIntervals: readonly Interval[];
  /** Described relative to this day, never as a bare pair of instants. */
  readonly absences: readonly AbsenceOnDay[];
  /** Confirmed, awaiting approval, or holding a live hold — the timeline. */
  readonly occupying: readonly CalendarEntry[];
  /** Cancelled or lapsed — recorded beside the timeline, never inside it. */
  readonly recorded: readonly CalendarEntry[];
  /** Working time minus absences minus occupying appointments. */
  readonly freeIntervals: readonly Interval[];
}

/**
 * Whether an appointment is not fully covered by the schedule as it stands.
 *
 * **This is what makes a stranded appointment visible** (`docs/tech-debt.md`
 * T29). Saving a schedule replaces the barber's week wholesale, so narrowing or
 * removing a window leaves the appointments already inside it outside working
 * hours — and until this calendar, nothing in the product compared a booking
 * against the schedule it was made under, so a stranded one rendered as
 * entirely ordinary.
 *
 * Both operands arrive from the same read, so the check costs no query.
 *
 * The containment test is `subtractAll` with the roles inverted — the
 * appointment as the window, the working intervals as the blockers — so what
 * comes back is the part of the appointment that no window covers. That reuse
 * is what makes two **adjacent** windows behave as one span of working time,
 * because `subtractAll` merges its blockers before subtracting; a naive "is it
 * inside any single window" test would flag an appointment that crosses from
 * one window into the next.
 *
 * An absence is a second reason, tested by overlap rather than containment: any
 * intersection at all means the barber is away for part of an appointment they
 * are booked for. Half-open, like every boundary here, so an absence beginning
 * exactly when an appointment ends does not overlap it.
 *
 * A weekday with no windows at all flags every appointment on it — the union
 * is empty, so nothing is contained — which is the correct answer and the most
 * severe form of the condition.
 */
export function fallsOutsideWorkingHours(
  appointment: CalendarAppointment,
  workingIntervals: readonly Interval[],
  absences: readonly Interval[]
): boolean {
  const span: Interval = { start: appointment.startTime, end: appointment.endTime };

  const uncovered = subtractAll(span, workingIntervals);
  if (uncovered.length > 0) return true;

  return absences.some((absence) => overlaps(absence, span));
}

/**
 * How one absence meets one day.
 *
 * The read returns every absence *overlapping* the day — which is what stops a
 * multi-day absence vanishing from its middle days — so an absence arriving here
 * may begin before this day, end after it, or both. Only this function knows
 * which, and it is the only place that may decide what the page is allowed to
 * claim about it.
 */
export function describeAbsence(absence: Interval, dayRange: Interval): AbsenceOnDay {
  const startsBefore = absence.start.getTime() <= dayRange.start.getTime();
  const endsAfter = absence.end.getTime() >= dayRange.end.getTime();

  if (startsBefore && endsAfter) return { kind: 'wholeDay' };
  if (startsBefore) return { kind: 'untilTime', end: absence.end };
  if (endsAfter) return { kind: 'fromTime', start: absence.start };
  return { kind: 'between', start: absence.start, end: absence.end };
}

/**
 * The day, composed.
 *
 * `now` is consulted for one thing only — whether a hold is still live — and it
 * is passed in rather than read, because a module that reads a clock cannot be
 * tested against the three hours a day on which this product's calendar and its
 * runtime's disagree.
 */
export function composeCalendarDay(input: {
  date: LocalDate;
  windows: readonly { startMinute: number; endMinute: number }[];
  absences: readonly Interval[];
  appointments: readonly CalendarAppointment[];
  now: Date;
}): CalendarDay {
  const workingIntervals = workingIntervalsFor(input.date, input.windows);

  const byStart = [...input.appointments].sort(
    (a, b) => a.startTime.getTime() - b.startTime.getTime()
  );

  const occupying: CalendarEntry[] = [];
  const recorded: CalendarEntry[] = [];

  for (const appointment of byStart) {
    const presence = calendarPresence(appointment, input.now);

    if (occupiesCalendar(presence)) {
      occupying.push({
        appointment,
        presence,
        outsideWorkingHours: fallsOutsideWorkingHours(
          appointment,
          workingIntervals,
          input.absences
        ),
      });
    } else {
      recorded.push({ appointment, presence, outsideWorkingHours: false });
    }
  }

  // Only the occupying lane reduces free time. A cancelled or lapsed booking
  // has already given its time back — the availability read says so, and a
  // calendar that disagreed would show the owner a slot as taken that a client
  // can buy from under them.
  const blockers: Interval[] = [
    ...input.absences,
    ...occupying.map((entry) => ({
      start: entry.appointment.startTime,
      end: entry.appointment.endTime,
    })),
  ];

  const freeIntervals = workingIntervals.flatMap((window) => subtractAll(window, blockers));

  // The raw intervals do the arithmetic above; only the described form leaves
  // this module, so nothing downstream can render an instant that belongs to
  // another date as though it belonged to this one.
  const dayRange = dayBoundsOf(input.date);

  return {
    workingIntervals,
    absences: input.absences.map((absence) => describeAbsence(absence, dayRange)),
    occupying,
    recorded,
    freeIntervals,
  };
}
