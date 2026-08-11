import { COPY } from '@/lib/copy';
import type { TimeOffFieldError, TimeOffFieldErrors } from '@/server/application/timeOff/timeOffSchema';

export type TimeOffValues = {
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
  reason: string;
};

export type TimeOffFormState = {
  error: string | null;
  fieldErrors: Partial<Record<keyof TimeOffValues, string>>;
  /**
   * Echoed back verbatim so a rejected save is not handed back empty. React 19
   * resets uncontrolled forms when the action resolves, so what the owner typed
   * — including a reason of up to 255 characters — only survives here.
   */
  values: TimeOffValues;
};

export const EMPTY_TIME_OFF_VALUES: TimeOffValues = {
  startDate: '',
  endDate: '',
  startTime: '',
  endTime: '',
  reason: '',
};

export const INITIAL_TIME_OFF_FORM_STATE: TimeOffFormState = {
  error: null,
  fieldErrors: {},
  values: EMPTY_TIME_OFF_VALUES,
};

/**
 * Each rejection reason gets its own message. Collapsing them would tell an
 * owner who typed a stray year that their date is "invalid", which explains the
 * wrong thing — the same reasoning M3 applied to price parsing.
 */
function messageFor(code: TimeOffFieldError, field: keyof TimeOffValues): string {
  switch (code) {
    case 'required':
      return field === 'startDate' ? COPY.timeOff.startDateRequired : COPY.timeOff.endDateRequired;
    case 'invalid_date':
      return COPY.timeOff.invalidDate;
    case 'invalid_time':
      return COPY.timeOff.invalidTime;
    case 'incomplete_times':
      return COPY.timeOff.incompleteTimes;
    case 'end_not_after_start':
      return COPY.timeOff.endNotAfterStart;
    case 'too_long':
      return COPY.timeOff.tooLong;
    case 'too_far_ahead':
      return COPY.timeOff.tooFarAhead;
    case 'too_far_back':
      return COPY.timeOff.tooFarBack;
    default:
      return COPY.timeOff.reasonTooLong;
  }
}

export function toFormState(
  fieldErrors: TimeOffFieldErrors,
  values: TimeOffValues
): TimeOffFormState {
  const mapped: Partial<Record<keyof TimeOffValues, string>> = {};
  for (const [field, code] of Object.entries(fieldErrors)) {
    if (code) {
      const key = field as keyof TimeOffValues;
      mapped[key] = messageFor(code, key);
    }
  }
  return { error: null, fieldErrors: mapped, values };
}
