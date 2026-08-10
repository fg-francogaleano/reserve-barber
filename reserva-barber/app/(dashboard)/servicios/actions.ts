'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireOwner } from '@/server/infrastructure/supabase/requireOwner';
import { ServiceCatalogService } from '@/server/application/services/ServiceCatalogService';
import { PrismaServiceRepository } from '@/server/infrastructure/prisma/PrismaServiceRepository';
import { getPrismaClient } from '@/server/infrastructure/prisma/client';
import {
  parseCreateService,
  parseUpdateService,
} from '@/server/application/servicesCatalog/serviceSchema';
import {
  ServiceNotFoundError,
  DuplicateServiceNameError,
  ServiceLimitReachedError,
} from '@/server/domain/errors/ServiceErrors';
import { logger } from '@/server/infrastructure/logger';
import { toErrorLogContext } from '@/server/infrastructure/errorLogContext';
import { COPY } from '@/lib/copy';
import { toFormState, type ServiceFormState } from './formState';

const SERVICES_PATH = '/servicios';

function serviceCatalog(): ServiceCatalogService {
  return new ServiceCatalogService(new PrismaServiceRepository(getPrismaClient()));
}

function toFailureState(
  error: unknown,
  operation: string,
  values: ServiceFormState['values']
): ServiceFormState {
  if (error instanceof DuplicateServiceNameError) {
    return { error: null, fieldErrors: { name: COPY.services.form.duplicateName }, values };
  }
  if (error instanceof ServiceLimitReachedError) {
    return { error: COPY.services.form.limitReached, fieldErrors: {}, values };
  }
  if (error instanceof ServiceNotFoundError) {
    return { error: COPY.services.notFound, fieldErrors: {}, values };
  }

  // Design D11: a recognized constraint violation logs its code only. The
  // driver's message embeds the submitted values, which would put business data
  // in the log stream and let a crafted name forge structured log fields.
  logger.error('Service write failed', toErrorLogContext(operation, error));
  return { error: COPY.services.form.infrastructureError, fieldErrors: {}, values };
}

function submittedValues(formData: FormData): ServiceFormState['values'] {
  const read = (field: string): string => {
    const value = formData.get(field);
    return typeof value === 'string' ? value : '';
  };
  return {
    name: read('name'),
    price: read('price'),
    durationMinutes: read('durationMinutes'),
    description: read('description'),
  };
}

export async function createServiceAction(
  _prevState: ServiceFormState,
  formData: FormData
): Promise<ServiceFormState> {
  // requireOwner() MUST be the first line — middleware passes next-action through.
  const owner = await requireOwner();
  const values = submittedValues(formData);

  const parsed = parseCreateService({
    name: formData.get('name'),
    price: formData.get('price'),
    durationMinutes: formData.get('durationMinutes'),
    description: formData.get('description'),
  });
  if (!parsed.ok) {
    return toFormState(parsed.fieldErrors, values);
  }

  try {
    await serviceCatalog().createService(owner.id, parsed.data);
  } catch (error) {
    return toFailureState(error, 'createService', values);
  }

  // redirect() throws NEXT_REDIRECT — it MUST stay outside the try, or a
  // successful create would be reported as an infrastructure failure.
  revalidatePath(SERVICES_PATH);
  redirect(SERVICES_PATH);
}

export async function updateServiceAction(
  _prevState: ServiceFormState,
  formData: FormData
): Promise<ServiceFormState> {
  const owner = await requireOwner();
  const values = submittedValues(formData);

  const parsed = parseUpdateService({
    id: formData.get('id'),
    name: formData.get('name'),
    price: formData.get('price'),
    durationMinutes: formData.get('durationMinutes'),
    description: formData.get('description'),
  });
  if (!parsed.ok) {
    return toFormState(parsed.fieldErrors, values);
  }

  try {
    await serviceCatalog().updateService(owner.id, parsed.data);
  } catch (error) {
    return toFailureState(error, 'updateService', values);
  }

  revalidatePath(SERVICES_PATH);
  redirect(SERVICES_PATH);
}
