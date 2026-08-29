/**
 * Calendar arithmetic for the booking flow, in the business's calendar.
 *
 * Every function here is built on `businessTime.ts`, which remains the only
 * module that talks to `Intl` and the only place a wall clock becomes an
 * instant. This module adds the vocabulary the booking flow needs on top of it:
 * a date without a time, the day a barber's schedule applies to, and the bounds
 * of the range a day's availability is read over.
 *
 * **The runtime's own calendar readers are banned in this feature** — the local
 * getters for weekday, hour and date, and slicing an ISO string down to a date.
 * The deployment runtime is UTC and the business is at UTC−3, so for the last
 * three hours of every local day they answer for tomorrow, and they answer with
 * a plausible number rather than raising. This module exists so no caller is
 * ever tempted to reach for them.
 *
 * They are named in prose rather than quoted because `businessTime.test.ts`
 * scans this directory for those literals and cannot tell a comment from a
 * call. That is the right trade: the scan is what keeps the ban true after
 * everyone has forgotten it was agreed.
 */

import { instantToLocal, localToInstant, MINUTES_PER_DAY } from './businessTime';
import { MAX_BOOKING_HORIZON_DAYS } from './bookingHorizon';
import type { Interval } from './availability';
import type { Weekday } from './weekday';

/** A calendar day in the business's timezone. No time, no instant, no offset. */
export interface LocalDate {
  readonly year: number;
  /** 1–12. */
  readonly month: number;
  /** 1–31. */
  readonly day: number;
}

/** The business's current calendar day — never the runtime's. */
export function businessToday(now: Date): LocalDate {
  const local = instantToLocal(now);
  return { year: local.year, month: local.month, day: local.day };
}

/**
 * The stored `dayOfWeek` a date's schedule comes from: 0 = Sunday … 6 = Saturday.
 *
 * `Date.getUTCDay()` is correct **here** and nowhere else in this feature,
 * because the value it reads is built from local calendar fields that are
 * already resolved — there is no instant left to misinterpret.
 */
export function weekdayOfLocalDate(date: LocalDate): Weekday {
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay() as Weekday;
}

/**
 * The half-open instant range covering a local day: `[00:00, next 00:00)`.
 *
 * This is what bounds the absence and booking reads. It is computed from both
 * midnights rather than by adding 24 hours, so a day that is not 1440 minutes
 * long stays correct — Argentina observes no daylight saving today
 * (`docs/tech-debt.md` T28), and the arithmetic should not be what breaks if
 * that changes.
 */
export function dayBoundsOf(date: LocalDate): Interval {
  return {
    start: localToInstant({ ...date, minuteOfDay: 0 }),
    end: localToInstant({ ...addDays(date, 1), minuteOfDay: 0 }),
  };
}

/**
 * The half-open instant range covering a local **month**: `[first, next first)`.
 *
 * The `day` field of the argument is ignored — a month is decided by its year
 * and month alone — so the caller can hand it today's date without trimming it.
 *
 * This is what bounds a monthly income figure, and both shorter versions of it
 * are wrong:
 *
 * - `new Date(y, m, 1)` (or `Date.UTC`) builds the boundary in the **runtime's**
 *   zone, which is UTC. The business's month begins at 03:00 UTC, so a payment
 *   approved at 23:30 on the 31st would fall inside the *next* month's range —
 *   an income figure the owner cannot reconcile against a bank statement, wrong
 *   in the direction that flatters the newer month. It is the month-scale twin
 *   of the defect `dayBoundsOf` exists to prevent.
 * - Adding a fixed span is wrong for eight months of every year, and adding
 *   "30 days" is not even right for February.
 *
 * Like `dayBoundsOf`, it is computed from **both** boundaries rather than from
 * one plus a duration, so a month that is not a whole number of 24-hour days
 * stays correct if Argentina ever restores daylight saving (`docs/tech-debt.md`
 * T28).
 */
export function monthBoundsOf(date: LocalDate): Interval {
  const first: LocalDate = { year: date.year, month: date.month, day: 1 };
  const nextFirst: LocalDate =
    date.month === 12
      ? { year: date.year + 1, month: 1, day: 1 }
      : { year: date.year, month: date.month + 1, day: 1 };

  return {
    start: localToInstant({ ...first, minuteOfDay: 0 }),
    end: localToInstant({ ...nextFirst, minuteOfDay: 0 }),
  };
}

/**
 * The half-open instant range covering a local **week**: `[Monday, next Monday)`.
 *
 * **The week begins on Monday, and that is a product decision rather than a
 * library default** (design D7 of the D5 change). It is the es-AR convention,
 * and it is written down here because the function that would have made it a
 * Sunday — the runtime's own weekday reader — is banned in this feature anyway.
 *
 * The offset is `(weekday + 6) % 7` rather than `weekday - 1`. On a **Sunday**
 * `weekdayOfLocalDate` answers `0`, so the subtraction yields `-1` and the
 * naive version walks *forward* to the next Monday — placing the last evening
 * of a week in the following one. That is the single case this arithmetic
 * exists to get right, and it is the case a shop actually asks about, because
 * Sunday is when a week's takings are counted.
 *
 * Like `dayBoundsOf` and `monthBoundsOf`, it is computed from **both**
 * boundaries rather than from one plus seven days, so a week that is not a
 * whole number of 24-hour days stays correct if Argentina ever restores
 * daylight saving (`docs/tech-debt.md` T28).
 */
export function weekBoundsOf(date: LocalDate): Interval {
  const daysSinceMonday = (weekdayOfLocalDate(date) + 6) % 7;
  const monday = addDays(date, -daysSinceMonday);

  return {
    start: localToInstant({ ...monday, minuteOfDay: 0 }),
    end: localToInstant({ ...addDays(monday, 7), minuteOfDay: 0 }),
  };
}

/**
 * The month before this date's, as its **first** day.
 *
 * Anchored on the first rather than carrying the incoming day, because
 * `{ ...date, month: date.month - 1 }` over a 31st produces "31 June", which
 * `Date.UTC` silently rolls into 1 July — landing a "last month" range back
 * inside *this* month. The failure is a plausible date rather than an error,
 * which is the family of defect this module exists to prevent.
 *
 * The returned day is `1` and `monthBoundsOf` ignores it either way; it is
 * fixed so that two calls from different days of one month are equal, which is
 * what the range control compares.
 */
export function previousMonth(date: LocalDate): LocalDate {
  return date.month === 1
    ? { year: date.year - 1, month: 12, day: 1 }
    : { year: date.year, month: date.month - 1, day: 1 };
}

/**
 * A day's working windows as instants, chronologically.
 *
 * Windows are stored as wall-clock minutes and are never converted at rest
 * (`data-model.md` §8). This is the conversion the storage convention defers,
 * and the only one slot generation needs.
 */
export function workingIntervalsFor(
  date: LocalDate,
  windows: readonly { startMinute: number; endMinute: number }[]
): Interval[] {
  return windows
    .map((window) => ({
      start: localToInstant({ ...date, minuteOfDay: window.startMinute }),
      end:
        window.endMinute >= MINUTES_PER_DAY
          ? localToInstant({ ...addDays(date, 1), minuteOfDay: window.endMinute - MINUTES_PER_DAY })
          : localToInstant({ ...date, minuteOfDay: window.endMinute }),
    }))
    .sort((a, b) => a.start.getTime() - b.start.getTime());
}

/** Calendar addition that carries months and years, including leap days. */
export function addDays(date: LocalDate, days: number): LocalDate {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

const CANONICAL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * A `YYYY-MM-DD` from a stranger, or `undefined`.
 *
 * Two rules, both deliberate. The spelling must be **canonical** — `2026-8-1`
 * is refused, because the flow builds its own links and a second spelling of one
 * day can only arrive from outside. And the date must be **real**: `2026-02-30`
 * parses fine under a naive reading and then silently becomes the 2nd of March,
 * which would show a client one day's availability under another day's heading.
 * The round trip through `Date.UTC` is what catches it.
 */
export function parseLocalDate(raw: string): LocalDate | undefined {
  const match = CANONICAL_DATE.exec(raw);
  if (match === null) return undefined;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  const probe = new Date(Date.UTC(year, month - 1, day));
  const normalized =
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() + 1 === month &&
    probe.getUTCDate() === day;

  return normalized ? { year, month, day } : undefined;
}

export function formatLocalDate(date: LocalDate): string {
  return `${String(date.year).padStart(4, '0')}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
}

/**
 * A slot's start as the `HH:mm` the business reads on the clock.
 *
 * This is both what `?hora` carries and what the client sees, which is
 * deliberate: the parameter is matched against the formatted list rather than
 * parsed into a time, so the two can never disagree about what "15:05" means.
 */
export function formatSlotTime(instant: Date): string {
  const minuteOfDay = instantToLocal(instant).minuteOfDay;
  const hours = Math.floor(minuteOfDay / 60);
  const minutes = minuteOfDay % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/** Ordering on calendar days, without building an instant for either. */
function compareLocalDates(a: LocalDate, b: LocalDate): number {
  return a.year - b.year || a.month - b.month || a.day - b.day;
}

/**
 * Whether a date may be booked: today or later, and no further ahead than the
 * horizon.
 *
 * The upper bound is not only a product judgement. `?fecha` is stranger-supplied
 * on a route with neither a cache nor a rate limit, and each distinct value
 * costs an availability read (`docs/tech-debt.md` T47).
 */
export function isWithinHorizon(date: LocalDate, today: LocalDate): boolean {
  return (
    compareLocalDates(date, today) >= 0 &&
    compareLocalDates(date, addDays(today, MAX_BOOKING_HORIZON_DAYS)) <= 0
  );
}
