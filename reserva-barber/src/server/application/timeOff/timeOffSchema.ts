import { localToInstant } from '@/server/domain/models/businessTime';

export type TimeOffFieldError =
  | 'required'
  | 'invalid_date'
  | 'invalid_time'
  | 'incomplete_times'
  | 'end_not_after_start'
  | 'too_long'
  | 'too_far_ahead'
  | 'too_far_back'
  | 'too_long_reason';

export interface TimeOffFieldErrors {
  startDate?: TimeOffFieldError;
  endDate?: TimeOffFieldError;
  startTime?: TimeOffFieldError;
  endTime?: TimeOffFieldError;
  reason?: TimeOffFieldError;
}

export interface TimeOffInput {
  startsAt: Date;
  endsAt: Date;
  reason: string | null;
}

export type TimeOffParseResult =
  | { ok: true; data: TimeOffInput }
  | { ok: false; fieldErrors: TimeOffFieldErrors };

export const MAX_TIME_OFF_DAYS = 365;
export const MAX_YEARS_AHEAD = 2;
export const MAX_YEARS_BACK = 1;
export const MAX_REASON_LENGTH = 255;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const HH_MM = /^(\d{1,2}):(\d{2})$/;
const DAY_MS = 24 * 60 * 60 * 1000;

function asTrimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

/** `type="date"` submits ISO `YYYY-MM-DD`; anything else is a crafted payload. */
function parseDate(raw: string): CalendarDate | null {
  const match = ISO_DATE.exec(raw);
  if (!match) {
    return null;
  }
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  // Reject a day that does not exist in that month (2026-02-30) rather than
  // letting Date roll it forward into March.
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    return null;
  }
  return { year, month, day };
}

function parseMinuteOfDay(raw: string): number | null {
  const match = HH_MM.exec(raw);
  if (!match) {
    return null;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) {
    return null;
  }
  return hours * 60 + minutes;
}

export interface TimeOffPayload {
  startDate?: unknown;
  endDate?: unknown;
  startTime?: unknown;
  endTime?: unknown;
  reason?: unknown;
}

/**
 * Builds the half-open instant range an absence stores.
 *
 * The asymmetry here is the whole point and the likeliest thing to get wrong:
 *
 * - With **no times**, the owner means whole days, and "hasta el 15" includes
 *   the 15th — so the range ends at the **start of the 16th**. Passing
 *   `day + 1` is safe across month and year ends because `Date.UTC` rolls over.
 * - With **times**, the range is exactly the instants named and ends where it
 *   says.
 *
 * Both readings are correct for their input. An off-by-one silently hands the
 * barber back a day, and nothing else in the system would notice.
 */
function toRange(
  start: CalendarDate,
  end: CalendarDate,
  startMinute: number | null,
  endMinute: number | null
): { startsAt: Date; endsAt: Date } {
  if (startMinute === null || endMinute === null) {
    return {
      startsAt: localToInstant({ ...start, minuteOfDay: 0 }),
      endsAt: localToInstant({ year: end.year, month: end.month, day: end.day + 1, minuteOfDay: 0 }),
    };
  }
  return {
    startsAt: localToInstant({ ...start, minuteOfDay: startMinute }),
    endsAt: localToInstant({ ...end, minuteOfDay: endMinute }),
  };
}

export function parseTimeOff(payload: unknown, nowMs: number): TimeOffParseResult {
  const input = (payload ?? {}) as TimeOffPayload;
  const fieldErrors: TimeOffFieldErrors = {};

  const startRaw = asTrimmed(input.startDate);
  const endRaw = asTrimmed(input.endDate);
  const startTimeRaw = asTrimmed(input.startTime);
  const endTimeRaw = asTrimmed(input.endTime);
  const reasonRaw = asTrimmed(input.reason);

  if (startRaw === '') fieldErrors.startDate = 'required';
  if (endRaw === '') fieldErrors.endDate = 'required';

  const start = startRaw === '' ? null : parseDate(startRaw);
  const end = endRaw === '' ? null : parseDate(endRaw);
  if (startRaw !== '' && start === null) fieldErrors.startDate = 'invalid_date';
  if (endRaw !== '' && end === null) fieldErrors.endDate = 'invalid_date';

  // A half-filled time pair is a mistake; both empty is the whole-day case and
  // is not an error at all.
  if ((startTimeRaw === '') !== (endTimeRaw === '')) {
    if (startTimeRaw === '') {
      fieldErrors.startTime = 'incomplete_times';
    } else {
      fieldErrors.endTime = 'incomplete_times';
    }
  }

  const startMinute = startTimeRaw === '' ? null : parseMinuteOfDay(startTimeRaw);
  const endMinute = endTimeRaw === '' ? null : parseMinuteOfDay(endTimeRaw);
  if (startTimeRaw !== '' && startMinute === null) fieldErrors.startTime = 'invalid_time';
  if (endTimeRaw !== '' && endMinute === null) fieldErrors.endTime = 'invalid_time';

  if (reasonRaw.length > MAX_REASON_LENGTH) {
    fieldErrors.reason = 'too_long_reason';
  }

  if (Object.keys(fieldErrors).length > 0 || start === null || end === null) {
    return { ok: false, fieldErrors };
  }

  const { startsAt, endsAt } = toRange(start, end, startMinute, endMinute);

  // Strictly after: a range containing no time records nothing. This also
  // catches an end date before the start date, since the whole-day conversion
  // preserves ordering.
  if (endsAt.getTime() <= startsAt.getTime()) {
    return { ok: false, fieldErrors: { endDate: 'end_not_after_start' } };
  }

  if (endsAt.getTime() - startsAt.getTime() > MAX_TIME_OFF_DAYS * DAY_MS) {
    return { ok: false, fieldErrors: { endDate: 'too_long' } };
  }

  // Bounds exist so a mistyped year is visible. Without them `2099-12-31` is
  // accepted and permanently disables a barber with no error anywhere.
  const aheadLimit = nowMs + MAX_YEARS_AHEAD * 365 * DAY_MS;
  const backLimit = nowMs - MAX_YEARS_BACK * 365 * DAY_MS;
  if (startsAt.getTime() > aheadLimit) {
    return { ok: false, fieldErrors: { startDate: 'too_far_ahead' } };
  }
  if (startsAt.getTime() < backLimit) {
    return { ok: false, fieldErrors: { startDate: 'too_far_back' } };
  }

  return {
    ok: true,
    // A blank note is absence, not an empty value.
    data: { startsAt, endsAt, reason: reasonRaw === '' ? null : reasonRaw },
  };
}
