/**
 * The one place any conversion between business local time and a UTC instant
 * happens (design D2).
 *
 * The deployment runtime is UTC and the business is at UTC−3, so between 21:00
 * and 23:59 local the runtime's calendar has already rolled to the next day.
 * `Date.prototype.getDay()`, `getHours()`, `getDate()` and
 * `toISOString().slice(0, 10)` therefore return an answer that is wrong for
 * three hours of every local day — and they return a plausible number rather
 * than throwing, so nothing surfaces it. **Scheduling code must not call them.**
 *
 * A recurring schedule is stored as wall-clock minutes and never converted at
 * rest (design D1). Conversion exists only to compare a schedule against an
 * instant, which is what B3 and B4 will do.
 */

/**
 * Every branch is in Argentina, so this is a constant rather than a column on
 * `Location`. The trigger to revisit is a location outside AR.
 */
export const BUSINESS_TIME_ZONE = 'America/Argentina/Buenos_Aires';

/**
 * Argentina has observed no daylight saving since 2009, so this is the exact
 * offset today rather than an approximation. It backs the fallback path and the
 * gate's sanity check; if DST returns, both this constant and the
 * "every day has 1440 minutes" assumption need revisiting together.
 */
export const BUSINESS_UTC_OFFSET_MINUTES = -180;

export const MINUTES_PER_DAY = 1440;

export interface LocalDateTime {
  year: number;
  month: number; // 1–12
  day: number; // 1–31
  /** Minutes from local midnight, 0–1439. */
  minuteOfDay: number;
}

const PART_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: BUSINESS_TIME_ZONE,
  hour12: false,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

function readParts(instant: Date): Record<string, number> {
  const parts: Record<string, number> = {};
  for (const { type, value } of PART_FORMATTER.formatToParts(instant)) {
    if (type !== 'literal') {
      parts[type] = Number(value);
    }
  }
  // Some engines render midnight as hour 24 under hour12:false.
  if (parts.hour === 24) {
    parts.hour = 0;
  }
  return parts;
}

/**
 * Offset of the business zone at a given instant, in minutes east of UTC
 * (so −180 for Argentina). Computed by formatting rather than assumed, so a
 * future DST rule is honoured without changing callers.
 */
export function offsetMinutesAt(instant: Date): number {
  const p = readParts(instant);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asIfUtc - instant.getTime()) / 60_000);
}

/** Splits a UTC instant into the wall-clock fields the business would read. */
export function instantToLocal(instant: Date): LocalDateTime {
  const p = readParts(instant);
  return {
    year: p.year,
    month: p.month,
    day: p.day,
    minuteOfDay: p.hour * 60 + p.minute,
  };
}

/**
 * Builds the UTC instant for a business-local wall-clock time.
 *
 * Two passes: the offset itself depends on the instant, so the first guess is
 * corrected once. A single pass is wrong across a DST boundary — which cannot
 * occur today, but writing the single-pass version would make the bug arrive
 * silently if it ever can.
 */
export function localToInstant(local: LocalDateTime): Date {
  const naive = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    0,
    local.minuteOfDay
  );
  let timestamp = naive;
  for (let pass = 0; pass < 2; pass += 1) {
    timestamp = naive - offsetMinutesAt(new Date(timestamp)) * 60_000;
  }
  return new Date(timestamp);
}

/**
 * Weekday in the **business's** calendar: 0 = Sunday … 6 = Saturday, matching
 * the stored `dayOfWeek`.
 *
 * This is the function `getDay()` would appear to replace and would get wrong
 * every evening.
 */
export function weekdayOf(instant: Date): number {
  const local = instantToLocal(instant);
  return new Date(Date.UTC(local.year, local.month - 1, local.day)).getUTCDay();
}

/** Minutes from local midnight for an instant — the value a schedule compares against. */
export function minuteOfDayOf(instant: Date): number {
  return instantToLocal(instant).minuteOfDay;
}

/**
 * Whether the runtime actually carries timezone data.
 *
 * A runtime without it does not throw — it silently reports UTC, which would
 * shift every stored instant by three hours with nothing to notice. The check
 * is a known offset rather than a try/catch for exactly that reason.
 */
export function hasTimezoneSupport(): boolean {
  // 2026-01-01T12:00:00Z is 09:00 in Buenos Aires, offset −180, no DST anywhere
  // in Argentina's history for this date.
  return offsetMinutesAt(new Date('2026-01-01T12:00:00.000Z')) === BUSINESS_UTC_OFFSET_MINUTES;
}
