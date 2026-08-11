'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireOwner } from '@/server/infrastructure/supabase/requireOwner';
import { parseWeeklySchedule } from '@/server/application/schedule/workingHoursSchema';
import { BarberNotFoundError } from '@/server/domain/errors/BarberErrors';
import { logger } from '@/server/infrastructure/logger';
import { toErrorLogContext } from '@/server/infrastructure/errorLogContext';
import { COPY } from '@/lib/copy';
import { toFormState, emptyWeek, type ScheduleFormState, type WeekValues } from './formState';
import { scheduleService } from './scheduleService';

const BARBERS_PATH = '/barberos';

function submittedWeek(formData: FormData): WeekValues {
  const values = emptyWeek();
  for (let day = 0; day <= 6; day += 1) {
    const key = String(day);
    const start = formData.get(`start-${key}`);
    const end = formData.get(`end-${key}`);
    values[key] = {
      start: typeof start === 'string' ? start : '',
      end: typeof end === 'string' ? end : '',
    };
  }
  return values;
}

function toPayload(values: WeekValues) {
  const start: Record<string, string> = {};
  const end: Record<string, string> = {};
  for (const [day, pair] of Object.entries(values)) {
    start[day] = pair.start;
    end[day] = pair.end;
  }
  return { start, end };
}

function toFailureState(
  error: unknown,
  operation: string,
  values: WeekValues
): ScheduleFormState {
  if (error instanceof BarberNotFoundError) {
    return { error: COPY.workingHours.barberNotFound, dayErrors: {}, values };
  }

  // A recognized constraint violation logs its code only; the driver message
  // embeds submitted values.
  logger.error('Working hours write failed', toErrorLogContext(operation, error));
  return { error: COPY.workingHours.infrastructureError, dayErrors: {}, values };
}

export async function setWorkingHoursAction(
  _prevState: ScheduleFormState,
  formData: FormData
): Promise<ScheduleFormState> {
  // requireOwner() MUST be the first line — middleware passes next-action through.
  const owner = await requireOwner();
  const values = submittedWeek(formData);

  const barberId = formData.get('barberId');
  if (typeof barberId !== 'string' || barberId.trim() === '') {
    return { error: COPY.workingHours.barberNotFound, dayErrors: {}, values };
  }

  const parsed = parseWeeklySchedule(toPayload(values));
  if (!parsed.ok) {
    return toFormState(
      parsed.dayErrors,
      parsed.formError ? COPY.workingHours.invalidSelection : null,
      values
    );
  }

  try {
    await scheduleService().setSchedule(owner.id, barberId.trim(), parsed.data.windows);
  } catch (error) {
    return toFailureState(error, 'setWorkingHours', values);
  }

  revalidatePath(BARBERS_PATH);
  // redirect() throws NEXT_REDIRECT — it MUST stay outside the try, or a
  // successful save would be reported as an infrastructure failure.
  redirect(BARBERS_PATH);
}
