import {
  addDays,
  formatLocalDate,
  parseLocalDate,
  type LocalDate,
} from '@/server/domain/models/bookingCalendar';
import { MAX_BOOKING_HORIZON_DAYS } from '@/server/domain/models/bookingHorizon';

/**
 * Resolving which day the owner's calendar shows, with no I/O.
 *
 * The rule is `recentBookingsParams.ts`'s — **bound it, then resolve it, and
 * degrade rather than fail** — with one difference worth naming, because it
 * looks like a weakening and is not.
 *
 * That resolver matches a submitted id against a list the owner's own scope
 * produced, so no value it accepts can ever have been invented by the caller. A
 * date has no such universe: any well-formed day is a legitimate thing to ask
 * for. What replaces the match is that the resolved day never travels as a
 * string — it becomes two instants through `dayBoundsOf` before anything
 * reaches a query — so there is no shape of input here that could be a
 * predicate. The bounds below exist to stop an absurd request costing a read,
 * not to stop an injection.
 *
 * **Nothing here throws, and nothing here 404s.** A malformed, oversized,
 * repeated or out-of-range value degrades to the business's current day. The
 * parameter is a convenience — a link somebody bookmarked, mangled, or built by
 * hand — and losing the calendar over it would trade a small wrong answer for
 * no answer at all.
 */

/**
 * The query parameter's name.
 *
 * **The same word the public booking flow uses for the same thing**, and that is
 * the whole reason it is this word. `bookingSelectionParams.ts` writes `?fecha`
 * for a chosen calendar day; this started life as `?dia`, which meant one
 * product had two names for one concept and a comment claiming they matched.
 * Renamed before either could be bookmarked.
 */
export const CALENDAR_DAY_PARAM = 'fecha';

/**
 * How far back the calendar may be asked to look.
 *
 * **A judgement, not a measurement**, and named so the next answer is a one-line
 * change rather than a search — the family `bookingHorizon.ts` started.
 *
 * The past is open at all because a calendar whose history is unreachable
 * cannot answer the question an owner actually has: what happened with that
 * client who never showed up. A year covers "this time last year" and stops
 * well short of a value that would let one bookmark walk the whole table.
 *
 * The future reuses `MAX_BOOKING_HORIZON_DAYS` rather than declaring a second
 * constant: no booking can exist beyond it, so a day past the horizon is
 * guaranteed empty and there is nothing there to show.
 */
export const CALENDAR_PAST_DAYS = 365;

/**
 * Ceiling applied before the value is used for anything.
 *
 * A canonical date is ten characters. The bound is generous rather than exact
 * for the reason `recentBookingsParams.ts` gives about its own: its job is to
 * refuse an absurd payload cheaply, not to validate a format. What decides
 * whether a value is real is `parseLocalDate`, which rejects `2026-02-30`
 * — a date that parses fine under a naive reading and then silently becomes the
 * 2nd of March.
 */
const MAX_DAY_LENGTH = 32;

/** Ordering on calendar days, without building an instant for either. */
function compare(a: LocalDate, b: LocalDate): number {
  return a.year - b.year || a.month - b.month || a.day - b.day;
}

/**
 * The single value a parameter carries, or `undefined` when it carries none
 * usable.
 *
 * A repeated parameter resolves to its **first** occurrence rather than being
 * rejected, because the framework hands over an array when a parameter appears
 * more than once and a page that threw on it would break on a URL a browser or
 * an analytics rewrite produced.
 */
function single(raw: string | readonly string[] | undefined): string | undefined {
  const value = Array.isArray(raw) ? raw[0] : (raw as string | undefined);
  if (value === undefined || value.length === 0 || value.length > MAX_DAY_LENGTH) {
    return undefined;
  }
  return value;
}

/**
 * The day the calendar shows: the requested one when it is usable, today
 * otherwise.
 */
export function resolveCalendarDay(
  raw: string | readonly string[] | undefined,
  today: LocalDate
): LocalDate {
  const value = single(raw);
  if (value === undefined) return today;

  const requested = parseLocalDate(value);
  if (requested === undefined) return today;

  const earliest = addDays(today, -CALENDAR_PAST_DAYS);
  const latest = addDays(today, MAX_BOOKING_HORIZON_DAYS);

  return compare(requested, earliest) >= 0 && compare(requested, latest) <= 0 ? requested : today;
}

/**
 * The link to one barber's calendar on one day.
 *
 * Here rather than written at each call site so the page that *writes* a day
 * and the page that *reads* one share a vocabulary; a test asserts the round
 * trip, because the two halves live in different files.
 */
export function calendarDayHref(barberId: string, date: LocalDate): string {
  return `/barberos/${barberId}/calendario?${CALENDAR_DAY_PARAM}=${formatLocalDate(date)}`;
}
