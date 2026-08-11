'use server';

import { revalidatePath } from 'next/cache';
import { requireOwner } from '@/server/infrastructure/supabase/requireOwner';
import { parseTimeOff } from '@/server/application/timeOff/timeOffSchema';
import { BarberNotFoundError } from '@/server/domain/errors/BarberErrors';
import { TimeOffLimitReachedError } from '@/server/domain/errors/TimeOffErrors';
import { logger } from '@/server/infrastructure/logger';
import { toErrorLogContext } from '@/server/infrastructure/errorLogContext';
import { COPY } from '@/lib/copy';
import { toFormState, type TimeOffFormState, type TimeOffValues } from './formState';
import { timeOffService } from './timeOffService';

function read(formData: FormData, field: string): string {
  const value = formData.get(field);
  return typeof value === 'string' ? value : '';
}

function submittedValues(formData: FormData): TimeOffValues {
  return {
    startDate: read(formData, 'startDate'),
    endDate: read(formData, 'endDate'),
    startTime: read(formData, 'startTime'),
    endTime: read(formData, 'endTime'),
    reason: read(formData, 'reason'),
  };
}

function toFailureState(
  error: unknown,
  operation: string,
  values: TimeOffValues
): TimeOffFormState {
  if (error instanceof BarberNotFoundError) {
    return { error: COPY.timeOff.barberNotFound, fieldErrors: {}, values };
  }
  if (error instanceof TimeOffLimitReachedError) {
    return { error: COPY.timeOff.limitReached, fieldErrors: {}, values };
  }

  // `toErrorLogContext` keeps the driver message out of the log. The submitted
  // values are never passed either — `reason` can hold medical information and
  // must not reach the log stream under any circumstance.
  logger.error('Time off write failed', toErrorLogContext(operation, error));
  return { error: COPY.timeOff.infrastructureError, fieldErrors: {}, values };
}

export async function recordAbsenceAction(
  _prevState: TimeOffFormState,
  formData: FormData
): Promise<TimeOffFormState> {
  // requireOwner() MUST be the first line — middleware passes next-action through.
  const owner = await requireOwner();
  const values = submittedValues(formData);

  const barberId = read(formData, 'barberId').trim();
  if (barberId === '') {
    return { error: COPY.timeOff.barberNotFound, fieldErrors: {}, values };
  }

  const parsed = parseTimeOff(values, Date.now());
  if (!parsed.ok) {
    return toFormState(parsed.fieldErrors, values);
  }

  try {
    await timeOffService().recordAbsence(owner.id, barberId, parsed.data);
  } catch (error) {
    return toFailureState(error, 'recordAbsence', values);
  }

  revalidatePath(`/barberos/${barberId}/ausencias`);
  // No redirect: the owner usually records several absences in a row, and
  // bouncing to the barbers list after each one would make that hostile.
  return { error: null, fieldErrors: {}, values: submittedValues(new FormData()) };
}

export async function removeAbsenceAction(formData: FormData): Promise<void> {
  const owner = await requireOwner();

  const timeOffId = read(formData, 'timeOffId').trim();
  const barberId = read(formData, 'barberId').trim();
  if (timeOffId === '') {
    return;
  }

  try {
    await timeOffService().removeAbsence(owner.id, timeOffId);
  } catch (error) {
    // A removal has no form to carry an error back to. Log it and let the
    // revalidated list speak: if the row is still there, the removal failed.
    logger.error('Time off removal failed', toErrorLogContext('removeAbsence', error));
  }

  revalidatePath(`/barberos/${barberId}/ausencias`);
}
