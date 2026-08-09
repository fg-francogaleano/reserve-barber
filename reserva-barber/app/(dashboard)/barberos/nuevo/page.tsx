import Link from 'next/link';
import { COPY } from '@/lib/copy';
import { requireOwner } from '@/server/infrastructure/supabase/requireOwner';
import { LocationService } from '@/server/application/services/LocationService';
import { PrismaLocationRepository } from '@/server/infrastructure/prisma/PrismaLocationRepository';
import { getPrismaClient } from '@/server/infrastructure/prisma/client';
import { logger } from '@/server/infrastructure/logger';
import { BarberForm } from '../BarberForm';
import { createBarberAction } from '../actions';

export const dynamic = 'force-dynamic';

export default async function NewBarberPage() {
  const owner = await requireOwner();

  let locations;
  try {
    locations = await new LocationService(
      new PrismaLocationRepository(getPrismaClient())
    ).listOwnerLocations(owner.id);
  } catch (error) {
    logger.error('Failed to load locations for new barber form', {
      operation: 'listOwnerLocations',
      cause: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  const activeLocations = locations.filter((l) => l.isActive);

  if (activeLocations.length === 0) {
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
      <h1 className="text-3xl font-semibold tracking-tight">{COPY.barbers.form.createHeading}</h1>
      <BarberForm
        action={createBarberAction}
        locations={activeLocations.map((l) => ({ id: l.id, name: l.name, isActive: true }))}
      />
    </main>
  );
}
