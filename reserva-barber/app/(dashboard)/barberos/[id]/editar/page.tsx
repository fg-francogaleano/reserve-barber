import Link from 'next/link';
import { notFound } from 'next/navigation';
import { COPY } from '@/lib/copy';
import { requireOwner } from '@/server/infrastructure/supabase/requireOwner';
import { BarberService } from '@/server/application/services/BarberService';
import { LocationService } from '@/server/application/services/LocationService';
import { PrismaBarberRepository } from '@/server/infrastructure/prisma/PrismaBarberRepository';
import { PrismaLocationRepository } from '@/server/infrastructure/prisma/PrismaLocationRepository';
import { getPrismaClient } from '@/server/infrastructure/prisma/client';
import { logger } from '@/server/infrastructure/logger';
import { BarberForm } from '../../BarberForm';
import { updateBarberAction } from '../../actions';
import type { LocationOption } from '../../BarberForm';

export const dynamic = 'force-dynamic';

export default async function EditBarberPage({ params }: { params: Promise<{ id: string }> }) {
  const owner = await requireOwner();
  const { id } = await params;

  const db = getPrismaClient();
  let barber;
  let allLocations;

  try {
    [barber, allLocations] = await Promise.all([
      new BarberService(
        new PrismaBarberRepository(db),
        new PrismaLocationRepository(db)
      ).findBarber(owner.id, id),
      new LocationService(new PrismaLocationRepository(db)).listOwnerLocations(owner.id),
    ]);
  } catch (error) {
    logger.error('Failed to load barber for editing', {
      operation: 'findBarberForEdit',
      barberId: id,
      cause: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  if (barber === null) {
    notFound();
  }

  // Design D5: option set = active locations ∪ barber's current location (even
  // if inactive). The current location is included so a save-unchanged succeeds.
  const currentLocationId = barber.locationId;
  const locationOptions: LocationOption[] = [];
  const seenIds = new Set<string>();

  for (const loc of allLocations) {
    if (loc.isActive || loc.id === currentLocationId) {
      locationOptions.push({ id: loc.id, name: loc.name, isActive: loc.isActive });
      seenIds.add(loc.id);
    }
  }

  if (locationOptions.length === 0) {
    return (
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-4 py-12">
        <p className="text-muted-foreground">{COPY.barbers.noLocationsForForm}</p>
        <Link
          href="/sucursales/nueva"
          className="text-primary text-sm font-medium underline-offset-4 hover:underline"
        >
          {COPY.locations.create}
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">{COPY.barbers.form.editHeading}</h1>
      <BarberForm
        action={updateBarberAction}
        barberId={barber.id}
        defaultDisplayName={barber.displayName}
        defaultLocationId={barber.locationId}
        defaultBio={barber.bio ?? undefined}
        locations={locationOptions}
      />
    </main>
  );
}
