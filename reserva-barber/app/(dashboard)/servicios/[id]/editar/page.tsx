import { notFound } from 'next/navigation';
import { COPY } from '@/lib/copy';
import { requireOwner } from '@/server/infrastructure/supabase/requireOwner';
import { ServiceCatalogService } from '@/server/application/services/ServiceCatalogService';
import { PrismaServiceRepository } from '@/server/infrastructure/prisma/PrismaServiceRepository';
import { getPrismaClient } from '@/server/infrastructure/prisma/client';
import { logger } from '@/server/infrastructure/logger';
import { toErrorLogContext } from '@/server/infrastructure/errorLogContext';
import { ServiceForm } from '../../ServiceForm';
import { updateServiceAction } from '../../actions';

export const dynamic = 'force-dynamic';

export default async function EditServicePage({ params }: { params: Promise<{ id: string }> }) {
  const owner = await requireOwner();
  const { id } = await params;

  let service;
  try {
    service = await new ServiceCatalogService(
      new PrismaServiceRepository(getPrismaClient())
    ).findService(owner.id, id);
  } catch (error) {
    logger.error('Failed to load service for editing', toErrorLogContext('findServiceForEdit', error));
    throw error;
  }

  // A service belonging to another owner resolves to null through the scoped
  // finder, so it is indistinguishable from one that does not exist.
  if (service === null) {
    notFound();
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">{COPY.services.form.editHeading}</h1>
      <ServiceForm
        action={updateServiceAction}
        serviceId={service.id}
        defaultName={service.name}
        defaultPrice={service.price}
        defaultDurationMinutes={String(service.durationMinutes)}
        defaultDescription={service.description ?? undefined}
      />
    </main>
  );
}
