'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireOwner } from '@/server/infrastructure/supabase/requireOwner';
import { BarberCatalogService } from '@/server/application/services/BarberCatalogService';
import { PrismaBarberRepository } from '@/server/infrastructure/prisma/PrismaBarberRepository';
import { PrismaLocationRepository } from '@/server/infrastructure/prisma/PrismaLocationRepository';
import { getPrismaClient } from '@/server/infrastructure/prisma/client';
import { parseCreateBarber, parseUpdateBarber } from '@/server/application/barbers/barberSchema';
import {
  BarberNotFoundError,
  DuplicateBarberNameError,
  LocationNotAvailableError,
  BarberLimitReachedError,
} from '@/server/domain/errors/BarberErrors';
import { logger } from '@/server/infrastructure/logger';
import { toErrorLogContext } from '@/server/infrastructure/errorLogContext';
import { COPY } from '@/lib/copy';
import { toFormState, type BarberFormState } from './formState';

const BARBERS_PATH = '/barberos';

function barberService(): BarberCatalogService {
  const db = getPrismaClient();
  return new BarberCatalogService(
    new PrismaBarberRepository(db),
    new PrismaLocationRepository(db)
  );
}

function toFailureState(
  error: unknown,
  operation: string,
  values: BarberFormState['values']
): BarberFormState {
  if (error instanceof DuplicateBarberNameError) {
    return {
      error: null,
      fieldErrors: { displayName: COPY.barbers.form.duplicateName(error.locationName) },
      values,
    };
  }
  if (error instanceof LocationNotAvailableError) {
    return {
      error: null,
      fieldErrors: { locationId: COPY.barbers.form.locationUnavailable },
      values,
    };
  }
  if (error instanceof BarberLimitReachedError) {
    return { error: COPY.barbers.form.limitReached, fieldErrors: {}, values };
  }
  if (error instanceof BarberNotFoundError) {
    return { error: COPY.barbers.notFound, fieldErrors: {}, values };
  }

  // T20: a recognized constraint violation logs its code and operation only.
  // A PostgreSQL unique-violation message embeds the offending values — logging
  // it verbatim writes the owner's business data into the log stream and lets a
  // display name containing quotes or newlines forge fields in structured
  // output. Unrecognized errors keep their message so they stay diagnosable.
  logger.error('Barber write failed', toErrorLogContext(operation, error));
  return { error: COPY.barbers.form.infrastructureError, fieldErrors: {}, values };
}

function submittedValues(formData: FormData): BarberFormState['values'] {
  const read = (field: string): string => {
    const value = formData.get(field);
    return typeof value === 'string' ? value : '';
  };
  return {
    displayName: read('displayName'),
    locationId: read('locationId'),
    bio: read('bio'),
  };
}

export async function createBarberAction(
  _prevState: BarberFormState,
  formData: FormData
): Promise<BarberFormState> {
  // requireOwner() MUST be the first line — middleware passes next-action through.
  const owner = await requireOwner();
  const values = submittedValues(formData);

  const parsed = parseCreateBarber({
    displayName: formData.get('displayName'),
    locationId: formData.get('locationId'),
    bio: formData.get('bio'),
  });
  if (!parsed.ok) {
    return toFormState(parsed.fieldErrors, values);
  }

  try {
    await barberService().createBarber(owner.id, parsed.data);
  } catch (error) {
    return toFailureState(error, 'createBarber', values);
  }

  // redirect() throws — must be outside try.
  revalidatePath(BARBERS_PATH);
  redirect(BARBERS_PATH);
}

export async function updateBarberAction(
  _prevState: BarberFormState,
  formData: FormData
): Promise<BarberFormState> {
  const owner = await requireOwner();
  const values = submittedValues(formData);

  const parsed = parseUpdateBarber({
    id: formData.get('id'),
    displayName: formData.get('displayName'),
    locationId: formData.get('locationId'),
    bio: formData.get('bio'),
    // Note: no currentLocationId field — design D4 forbids it.
  });
  if (!parsed.ok) {
    return toFormState(parsed.fieldErrors, values);
  }

  try {
    await barberService().updateBarber(owner.id, parsed.data);
  } catch (error) {
    return toFailureState(error, 'updateBarber', values);
  }

  revalidatePath(BARBERS_PATH);
  redirect(BARBERS_PATH);
}
