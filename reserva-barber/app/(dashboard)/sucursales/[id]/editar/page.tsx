import { notFound } from 'next/navigation';
import { COPY } from '@/lib/copy';
import { requireOwner } from '@/server/infrastructure/supabase/requireOwner';
import { LocationService } from '@/server/application/services/LocationService';
import { PrismaLocationRepository } from '@/server/infrastructure/prisma/PrismaLocationRepository';
import { getPrismaClient } from '@/server/infrastructure/prisma/client';
import { logger } from '@/server/infrastructure/logger';
import { LocationForm } from '../../LocationForm';
import { updateLocationAction } from '../../actions';

export const dynamic = 'force-dynamic';

export default async function EditLocationPage({ params }: { params: Promise<{ id: string }> }) {
  const owner = await requireOwner();
  const { id } = await params;

  let location;
  try {
    const service = new LocationService(new PrismaLocationRepository(getPrismaClient()));
    location = await service.findLocationForOwner(owner.id, id);
  } catch (error) {
    logger.error('Failed to load location for editing', {
      operation: 'findLocationForOwner',
      locationId: id,
      cause: error instanceof Error ? error.message : String(error),
    });
    throw error; // Re-thrown so error.tsx renders the generic Spanish boundary.
  }

  if (location === null) {
    // Unknown id and someone else's location resolve identically: answering
    // differently would confirm the row exists.
    notFound();
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">{COPY.locations.form.editHeading}</h1>
      <LocationForm
        action={updateLocationAction}
        locationId={location.id}
        defaultName={location.name}
        defaultAddress={location.address ?? undefined}
      />
    </main>
  );
}
