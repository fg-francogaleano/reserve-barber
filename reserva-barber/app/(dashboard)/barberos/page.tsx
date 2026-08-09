import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';
import { COPY } from '@/lib/copy';
import { BarberService } from '@/server/application/services/BarberService';
import { LocationService } from '@/server/application/services/LocationService';
import { PrismaBarberRepository } from '@/server/infrastructure/prisma/PrismaBarberRepository';
import { PrismaLocationRepository } from '@/server/infrastructure/prisma/PrismaLocationRepository';
import { getPrismaClient } from '@/server/infrastructure/prisma/client';
import { logger } from '@/server/infrastructure/logger';
import { requireOwner } from '@/server/infrastructure/supabase/requireOwner';
import type { BarberWithLocation } from '@/server/domain/repositories/IBarberRepository';
import type { Location } from '@/server/domain/models/Location';

export const dynamic = 'force-dynamic';

async function fetchPageData(
  ownerId: string
): Promise<{ barbers: BarberWithLocation[]; locations: Location[] }> {
  const db = getPrismaClient();
  try {
    const [barbers, locations] = await Promise.all([
      new BarberService(
        new PrismaBarberRepository(db),
        new PrismaLocationRepository(db)
      ).listBarbers(ownerId),
      new LocationService(new PrismaLocationRepository(db)).listOwnerLocations(ownerId),
    ]);
    return { barbers, locations };
  } catch (error) {
    logger.error('Failed to load barberos page data', {
      operation: 'listBarbers',
      cause: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export default async function BarbersPage() {
  const owner = await requireOwner();
  const { barbers, locations } = await fetchPageData(owner.id);

  const hasLocations = locations.length > 0;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-12">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">{COPY.barbers.heading}</h1>
        {hasLocations ? (
          <Link href="/barberos/nuevo" className="inline-flex">
            <span className={buttonVariants()}>{COPY.barbers.create}</span>
          </Link>
        ) : null}
      </div>

      {barbers.length === 0 ? (
        <p className="text-muted-foreground">
          {hasLocations ? COPY.barbers.empty : COPY.barbers.emptyNoLocations}
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {barbers.map(({ barber, locationName, locationIsActive }) => (
            <Card key={barber.id}>
              <CardHeader>
                <CardTitle className="flex items-start justify-between gap-3">
                  <span className="break-words">{barber.displayName}</span>
                  {!locationIsActive ? (
                    <span className="text-muted-foreground shrink-0 text-xs font-normal">
                      {COPY.barbers.inactiveBadge}
                    </span>
                  ) : null}
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <p className="text-muted-foreground text-sm">{locationName}</p>
                {barber.bio ? (
                  <p className="line-clamp-3 text-sm break-words">{barber.bio}</p>
                ) : null}
                <Link
                  href={`/barberos/${barber.id}/editar`}
                  aria-label={COPY.barbers.editLabel(barber.displayName)}
                  className="text-primary text-sm font-medium underline-offset-4 hover:underline"
                >
                  {COPY.barbers.edit}
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </main>
  );
}
