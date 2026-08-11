import { COPY } from '@/lib/copy';
import type { WorkingWindowErrorCode } from '@/server/domain/errors/WorkingHoursErrors';

/** One start/end pair per weekday, keyed by weekday index as a string. */
export type WeekValues = Record<string, { start: string; end: string }>;

export type ScheduleFormState = {
  error: string | null;
  /** Keyed by weekday index, so the editor can mark the offending rows. */
  dayErrors: Record<number, string>;
  /**
   * Echoed back verbatim so a rejected save is not handed back the *stored*
   * week. React 19 resets uncontrolled forms when the action resolves, so what
   * the owner actually typed only survives here — fourteen fields of it.
   */
  values: WeekValues;
};

export function emptyWeek(): WeekValues {
  const values: WeekValues = {};
  for (let day = 0; day <= 6; day += 1) {
    values[String(day)] = { start: '', end: '' };
  }
  return values;
}

export const INITIAL_SCHEDULE_FORM_STATE: ScheduleFormState = {
  error: null,
  dayErrors: {},
  values: emptyWeek(),
};

function dayMessage(code: WorkingWindowErrorCode): string {
  switch (code) {
    case 'incomplete':
      return COPY.workingHours.dayIncomplete;
    case 'end_not_after_start':
      return COPY.workingHours.dayEndNotAfterStart;
    case 'not_on_grid':
      return COPY.workingHours.dayNotOnGrid;
    default:
      return COPY.workingHours.dayOutOfDay;
  }
}

export function toFormState(
  dayErrors: Record<number, WorkingWindowErrorCode>,
  formError: string | null,
  values: WeekValues
): ScheduleFormState {
  const mapped: Record<number, string> = {};
  for (const [day, code] of Object.entries(dayErrors)) {
    mapped[Number(day)] = dayMessage(code);
  }
  return { error: formError, dayErrors: mapped, values };
}
