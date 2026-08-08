'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireOwner } from '@/server/infrastructure/supabase/requireOwner';
import { LocationService } from '@/server/application/services/LocationService';
import { PrismaLocationRepository } from '@/server/infrastructure/prisma/PrismaLocationRepository';
import { getPrismaClient } from '@/server/infrastructure/prisma/client';
import {
  parseCreateLocation,
  parseUpdateLocation,
} from '@/server/application/locations/locationSchema';
import {
  DuplicateLocationNameError,
  LocationLimitReachedError,
  LocationNotFoundError,
} from '@/server/domain/errors/LocationErrors';
import { logger } from '@/server/infrastructure/logger';
import { COPY } from '@/lib/copy';
import { toFormState, type LocationFormState } from './formState';

const LOCATIONS_PATH = '/sucursales';

function locationService(): LocationService {
  return new LocationService(new PrismaLocationRepository(getPrismaClient()));
}

/**
 * Turns a failure into form state. Domain errors are expected outcomes and are
 * not logged as failures; anything else is an infrastructure problem, which is
 * logged in English and shown as the generic Spanish message.
 *
 * Nothing here throws: a thrown error would reach the route error boundary,
 * which replaces the page and discards everything the owner typed (design D10).
 */
function toFailureState(
  error: unknown,
  operation: string,
  values: LocationFormState['values']
): LocationFormState {
  if (error instanceof DuplicateLocationNameError) {
    return { error: null, fieldErrors: { name: COPY.locations.form.duplicateName }, values };
  }
  if (error instanceof LocationLimitReachedError) {
    return { error: COPY.locations.form.limitReached, fieldErrors: {}, values };
  }
  if (error instanceof LocationNotFoundError) {
    return { error: COPY.locations.notFound, fieldErrors: {}, values };
  }

  logger.error('Location write failed', {
    operation,
    cause: error instanceof Error ? error.message : String(error),
  });
  return { error: COPY.locations.form.infrastructureError, fieldErrors: {}, values };
}

/** Echoes back exactly what was typed, so a rejected form is not handed back empty. */
function submittedValues(formData: FormData): LocationFormState['values'] {
  const read = (field: string): string => {
    const value = formData.get(field);
    return typeof value === 'string' ? value : '';
  };
  return { name: read('name'), address: read('address') };
}

export async function createLocationAction(
  _prevState: LocationFormState,
  formData: FormData
): Promise<LocationFormState> {
  // First line, always: the middleware lets Server Action POSTs through by
  // design, so this is the only barrier in front of the write.
  const owner = await requireOwner();
  const values = submittedValues(formData);

  const parsed = parseCreateLocation({
    name: formData.get('name'),
    address: formData.get('address'),
  });
  if (!parsed.ok) {
    return toFormState(parsed.fieldErrors, values);
  }

  try {
    await locationService().createLocation(owner.id, parsed.data);
  } catch (error) {
    return toFailureState(error, 'createLocation', values);
  }

  // Outside the try on purpose: redirect() signals via a thrown value that must
  // reach Next.js, never this action's catch.
  revalidatePath(LOCATIONS_PATH);
  redirect(LOCATIONS_PATH);
}

export async function updateLocationAction(
  _prevState: LocationFormState,
  formData: FormData
): Promise<LocationFormState> {
  const owner = await requireOwner();
  const values = submittedValues(formData);

  const parsed = parseUpdateLocation({
    id: formData.get('id'),
    name: formData.get('name'),
    address: formData.get('address'),
  });
  if (!parsed.ok) {
    return toFormState(parsed.fieldErrors, values);
  }

  try {
    await locationService().updateLocation(owner.id, parsed.data);
  } catch (error) {
    return toFailureState(error, 'updateLocation', values);
  }

  revalidatePath(LOCATIONS_PATH);
  redirect(LOCATIONS_PATH);
}
