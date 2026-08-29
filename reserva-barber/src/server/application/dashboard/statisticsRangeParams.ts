import {
  addDays,
  dayBoundsOf,
  monthBoundsOf,
  previousMonth,
  weekBoundsOf,
  weekdayOfLocalDate,
  hourEdgesOf,
  dayEdgesBetween,
  type LocalDate,
} from '@/server/domain/models/bookingCalendar';
import {
  STATISTICS_RANGES,
  type BucketGranularity,
  type StatisticsRange,
} from '@/server/domain/models/statistics';
import type { Interval } from '@/server/domain/models/availability';

/**
 * Resolving which period the statistics page reports on, with no I/O.
 *
 * The rule is the one `recentBookingsParams.ts` established and
 * `barberCalendarParams.ts` and `clientPageParams.ts` followed — **bound it,
 * match it, and degrade rather than fail** — with one property specific to this
 * parameter.
 *
 * **The submitted value is matched against a closed set and is never parsed.**
 * That is what keeps it out of SQL. The obvious shortcut for "esta semana" and
 * "este mes" is `date_trunc('week', …)` with the unit taken from the parameter,
 * and a unit is an **identifier position**, which parameterisation does not
 * cover. The matcher's output is a member of the tuple, so the caller's text
 * cannot survive it even by accident.
 *
 * It is also why `intervalFor` lives here and returns two `Date`s: the statement
 * receives instants and computes no dates of its own. Beyond injection,
 * `date_trunc` truncates in the **session's** timezone — UTC on Supavisor and
 * `workerd` — so a 21:30 appointment would land in the next day and a
 * 23:30-on-the-31st one in the next month. It is the SQL twin of the runtime
 * calendar readers `bookingCalendar.ts` bans, and it fails the same way:
 * silently, with a plausible answer, for three hours of every day.
 */

/** The query parameter's name, Spanish to match the Spanish routes. */
export const STATS_RANGE_PARAM = 'rango';

/**
 * Re-exported so the control that renders the six links and the resolver that
 * matches against them cannot drift onto two lists.
 */
export { STATISTICS_RANGES, type StatisticsRange };

/**
 * Ceiling applied before the value is used for anything.
 *
 * Generous rather than exact, for the reason the other resolvers give about
 * their own: its job is to refuse an absurd payload cheaply, not to validate a
 * format. What decides whether a value is real is that it is in the set.
 */
const MAX_RANGE_LENGTH = 32;

/**
 * The single value a parameter carries, or `undefined` when it carries none
 * usable.
 *
 * A repeated parameter resolves to its **first** occurrence rather than being
 * rejected: the framework hands over an array when a parameter appears more than
 * once, and a page that threw on it would break on a URL a browser or a rewrite
 * produced.
 */
function single(raw: string | readonly string[] | undefined): string | undefined {
  const value = Array.isArray(raw) ? raw[0] : (raw as string | undefined);
  if (value === undefined || value.length === 0 || value.length > MAX_RANGE_LENGTH) {
    return undefined;
  }
  return value;
}

/**
 * The period the caller asked for, or today.
 *
 * Anything unusable degrades to `hoy` — never a 404, never a throw. A range is a
 * convenience, and losing the page over a mangled link would trade a small wrong
 * answer for no answer at all.
 *
 * The comparison is exact: `HOY`, ` hoy` and `hoy ` are all refused rather than
 * trimmed or lowercased. The page builds its own links, so a second spelling of
 * one range can only arrive from outside — the same argument `parseLocalDate`
 * makes for refusing `2026-8-1`.
 */
export function resolveStatisticsRange(
  raw: string | readonly string[] | undefined
): StatisticsRange {
  const value = single(raw);
  if (value === undefined) return 'hoy';

  return STATISTICS_RANGES.find((slug) => slug === value) ?? 'hoy';
}

/**
 * The half-open instant range a period covers, in the business's calendar.
 *
 * `today` arrives already resolved from a single `now`, so every range on one
 * render derives from one clock read: two reads at 23:59:59.9 would let the
 * heading and the figures describe different days.
 *
 * Every boundary comes from `bookingCalendar`, which is the only module that
 * turns a business-local wall clock into an instant.
 */
export function intervalFor(range: StatisticsRange, today: LocalDate): Interval {
  switch (range) {
    case 'hoy':
      return dayBoundsOf(today);

    case 'ayer':
      return dayBoundsOf(addDays(today, -1));

    case 'semana':
      return weekBoundsOf(today);

    case 'semana-anterior':
      // Seven days back lands in the previous week whatever weekday today is,
      // and `weekBoundsOf` then finds that week's own Monday. Subtracting from
      // the current week's start instead would need a second conversion back to
      // a local date, which is the step that invites the runtime's readers.
      return weekBoundsOf(addDays(today, -7));

    case 'mes':
      return monthBoundsOf(today);

    case 'mes-anterior':
      return monthBoundsOf(previousMonth(today));
  }
}

/**
 * The link to one period of the page.
 *
 * `hoy` carries **no parameter**: the unparameterised URL is the canonical one
 * and the one the navigation points at, so a link that spelled out the default
 * would make two URLs for one view (`clientPageHref`'s rule).
 *
 * The slugs are URL-safe by construction and asserted to be so in the domain's
 * own tests, so nothing is encoded here — an encoder would only hide a slug that
 * had stopped being safe.
 */
export function statisticsRangeHref(range: StatisticsRange): string {
  return range === 'hoy' ? '/estadisticas' : `/estadisticas?${STATS_RANGE_PARAM}=${range}`;
}

/**
 * How the income chart divides a period (D6).
 *
 * **Chosen by the range, never by the data.** A day with four appointments and
 * a day with forty draw the same 24 bars; a month draws one per calendar day
 * whatever fell in it. Granularity inferred from the rows would change the axis
 * between two periods the owner is comparing, which is the single thing this
 * page exists to let them do.
 */
export function granularityFor(range: StatisticsRange): BucketGranularity {
  return range === 'hoy' || range === 'ayer' ? 'hour' : 'day';
}

/**
 * The instants bounding every bucket of a period's chart: `n` buckets yields
 * `n + 1` edges, and bucket `i` spans `[edges[i], edges[i + 1])`.
 *
 * **This is the whole reason no statement in this capability computes a date.**
 * `date_trunc` is refused twice over — its unit is an identifier position that
 * parameterisation does not cover, and it truncates in the *session's*
 * timezone, which is UTC on Supavisor and `workerd`. A 21:30 appointment would
 * land in the next day's bar and a 23:30-on-the-31st one in the next month's:
 * silently, plausibly, for three hours of every day. Every edge is computed
 * here, from the business calendar, and crosses to SQL as an instant that
 * `width_bucket` only has to compare.
 *
 * The edges span exactly `intervalFor`'s range — same first instant, same last
 * — which is what makes the chart's bars sum to the deposits figure rendered
 * directly above them. Any drift is money in a bar that is in no figure.
 *
 * `today` arrives already resolved from one clock read, as it does for
 * `intervalFor`, so the axis and the figures cannot straddle a rollover.
 */
export function bucketEdgesFor(range: StatisticsRange, today: LocalDate): readonly Date[] {
  switch (range) {
    case 'hoy':
      return hourEdgesOf(today);

    case 'ayer':
      return hourEdgesOf(addDays(today, -1));

    case 'semana':
      return weekEdges(today);

    case 'semana-anterior':
      // Seven days back lands in the previous week whatever weekday today is,
      // and the week's own Monday is then found from there — the argument
      // `intervalFor` makes about the same case.
      return weekEdges(addDays(today, -7));

    case 'mes':
      return monthEdges(today);

    case 'mes-anterior':
      return monthEdges(previousMonth(today));
  }
}

/** The seven days of the local week `date` falls in, Monday first. */
function weekEdges(date: LocalDate): readonly Date[] {
  const daysSinceMonday = (weekdayOfLocalDate(date) + 6) % 7;
  const monday = addDays(date, -daysSinceMonday);
  return dayEdgesBetween(monday, addDays(monday, 6));
}

/**
 * Every day of the local month `date` falls in.
 *
 * The last day is found by stepping back one from the first of the next month,
 * so February contributes 28 buckets and August 31 without this function
 * knowing how long any month is.
 */
function monthEdges(date: LocalDate): readonly Date[] {
  const first: LocalDate = { year: date.year, month: date.month, day: 1 };
  const firstOfNext: LocalDate =
    date.month === 12
      ? { year: date.year + 1, month: 1, day: 1 }
      : { year: date.year, month: date.month + 1, day: 1 };

  return dayEdgesBetween(first, addDays(firstOfNext, -1));
}
