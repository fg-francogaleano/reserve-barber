'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireOwner } from '@/server/infrastructure/supabase/requireOwner';
import { parseSetBarberServices } from '@/server/application/barberServices/barberServicesSchema';
import { BarberNotFoundError } from '@/server/domain/errors/BarberErrors';
import { ServiceNotAssignableError } from '@/server/domain/errors/BarberServiceErrors';
import { logger } from '@/server/infrastructure/logger';
import { toErrorLogContext } from '@/server/infrastructure/errorLogContext';
import { COPY } from '@/lib/copy';
import { toFormState, type BarberServicesFormState } from './formState';
import { assignmentService } from './assignmentService';

const BARBERS_PATH = '/barberos';
const SERVICES_PATH = '/servicios';

function toFailureState(
  error: unknown,
  operation: string,
  values: BarberServicesFormState['values']
): BarberServicesFormState {
  if (error instanceof BarberNotFoundError) {
    return { error: COPY.barberServices.barberNotFound, invalidServiceId: null, values };
  }
  if (error instanceof ServiceNotAssignableError) {
    return {
      // A service the owner cannot see has no name to report — naming it would
      // leak whether the id exists.
      error: error.serviceName
        ? COPY.barberServices.serviceUnavailable(error.serviceName)
        : COPY.barberServices.serviceUnknown,
      invalidServiceId: error.serviceId,
      values,
    };
  }

  // A recognized constraint violation logs its code only: the driver's message
  // embeds submitted values. The submitted service ids are never logged either.
  logger.error('Barber service assignment failed', toErrorLogContext(operation, error));
  return { error: COPY.barberServices.infrastructureError, invalidServiceId: null, values };
}

function submittedIds(formData: FormData, field: string): string[] {
  return formData.getAll(field).filter((value): value is string => typeof value === 'string');
}

export async function setBarberServicesAction(
  _prevState: BarberServicesFormState,
  formData: FormData
): Promise<BarberServicesFormState> {
  // requireOwner() MUST be the first line — middleware passes next-action through.
  const owner = await requireOwner();
  const values = { serviceIds: submittedIds(formData, 'serviceIds') };

  const parsed = parseSetBarberServices({
    barberId: formData.get('barberId'),
    serviceIds: formData.getAll('serviceIds'),
    renderedServiceIds: formData.getAll('renderedServiceIds'),
  });
  if (!parsed.ok) {
    return toFormState(parsed.fieldErrors, values);
  }

  try {
    await assignmentService().setServices(owner.id, parsed.data);
  } catch (error) {
    return toFailureState(error, 'setBarberServices', values);
  }

  // Both paths: an assignment change flips the bookability marker on the
  // services page, which would otherwise render a stale claim about whether a
  // service can be booked.
  revalidatePath(BARBERS_PATH);
  revalidatePath(SERVICES_PATH);
  // redirect() throws NEXT_REDIRECT — it MUST stay outside the try, or a
  // successful save would be reported as an infrastructure failure.
  redirect(BARBERS_PATH);
}
