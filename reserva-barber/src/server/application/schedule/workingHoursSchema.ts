import { SLOT_GRANULARITY_MINUTES } from '@/server/domain/models/slotGranularity';
import { MINUTES_PER_DAY } from '@/server/domain/models/businessTime';
import { isWeekday, type Weekday } from '@/server/domain/models/weekday';
import type { WorkingWindowErrorCode } from '@/server/domain/errors/WorkingHoursErrors';
import type { NewWorkingWindow } from '@/server/domain/repositories/IWorkingHoursRepository';

/** Rejections that belong to the submission as a whole, not to one day. */
export type WeeklyScheduleFormError = 'invalid_weekday' | 'malformed';

export interface WeeklyScheduleInput {
  windows: NewWorkingWindow[];
}

export type WeeklyScheduleParseResult =
  | { ok: true; data: WeeklyScheduleInput }
  | {
      ok: false;
      /** Keyed by weekday index, so the editor can mark the offending rows. */
      dayErrors: Record<number, WorkingWindowErrorCode>;
      formError: WeeklyScheduleFormError | null;
    };

/** Submitted shape: one start and one end per weekday, keyed by index as strings. */
export interface WeeklySchedulePayload {
  start: Record<string, unknown>;
  end: Record<string, unknown>;
}

const HH_MM = /^([0-9]{1,2}):([0-9]{2})$/;

function asTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Parses "HH:mm" into minutes from midnight, or `null` when it is not a real
 * time of day.
 *
 * `type="time"` submits a canonical 24-hour value, so anything else here is a
 * crafted payload rather than a typo — but it is still rejected rather than
 * coerced, because a coerced time silently changes when the barber works.
 */
function toMinuteOfDay(raw: string): number | null {
  const match = HH_MM.exec(raw);
  if (!match) {
    return null;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) {
    return null;
  }
  const total = hours * 60 + minutes;
  return total < MINUTES_PER_DAY ? total : null;
}

function validateWindow(
  startRaw: string,
  endRaw: string
): { window: { startMinute: number; endMinute: number } } | { error: WorkingWindowErrorCode } {
  // An empty pair is the absence of a window, which is a legitimate state and
  // never an error (data-model.md §8). Only a half-filled pair is a mistake.
  if (startRaw === '' || endRaw === '') {
    return { error: 'incomplete' };
  }

  const startMinute = toMinuteOfDay(startRaw);
  const endMinute = toMinuteOfDay(endRaw);
  if (startMinute === null || endMinute === null) {
    return { error: 'out_of_day' };
  }

  if (startMinute % SLOT_GRANULARITY_MINUTES !== 0 || endMinute % SLOT_GRANULARITY_MINUTES !== 0) {
    return { error: 'not_on_grid' };
  }

  // Strictly after: a zero-length window contains no time, which is the absence
  // of a working day rather than a very short one. A window may not cross
  // midnight — the owner confirmed no barber works past 23:00, so the wrap-around
  // case is unrepresentable by construction (design D3).
  if (endMinute <= startMinute) {
    return { error: 'end_not_after_start' };
  }

  return { window: { startMinute, endMinute } };
}

export function parseWeeklySchedule(payload: unknown): WeeklyScheduleParseResult {
  if (typeof payload !== 'object' || payload === null) {
    return { ok: false, dayErrors: {}, formError: 'malformed' };
  }

  const { start, end } = payload as WeeklySchedulePayload;
  if (typeof start !== 'object' || start === null || typeof end !== 'object' || end === null) {
    return { ok: false, dayErrors: {}, formError: 'malformed' };
  }

  // Every key the payload carries must name a real weekday. An unknown key is
  // rejected rather than ignored: silently dropping it would report success
  // while discarding a window the owner believes they set.
  const submittedKeys = new Set([...Object.keys(start), ...Object.keys(end)]);
  for (const key of submittedKeys) {
    if (!isWeekday(Number(key)) || String(Number(key)) !== key) {
      return { ok: false, dayErrors: {}, formError: 'invalid_weekday' };
    }
  }

  const windows: NewWorkingWindow[] = [];
  const dayErrors: Record<number, WorkingWindowErrorCode> = {};

  for (const key of [...submittedKeys].sort((a, b) => Number(a) - Number(b))) {
    const day = Number(key) as Weekday;
    const startRaw = asTrimmedString(start[key]);
    const endRaw = asTrimmedString(end[key]);

    if (startRaw === '' && endRaw === '') {
      continue;
    }

    const outcome = validateWindow(startRaw, endRaw);
    if ('error' in outcome) {
      dayErrors[day] = outcome.error;
      continue;
    }

    windows.push({
      dayOfWeek: day,
      startMinute: outcome.window.startMinute,
      endMinute: outcome.window.endMinute,
    });
  }

  if (Object.keys(dayErrors).length > 0) {
    return { ok: false, dayErrors, formError: null };
  }

  return { ok: true, data: { windows } };
}
