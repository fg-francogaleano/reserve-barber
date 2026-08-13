import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';
import { COPY } from '@/lib/copy';
import { BarberCatalogService } from '@/server/application/services/BarberCatalogService';
import { LocationService } from '@/server/application/services/LocationService';
import { PrismaBarberRepository } from '@/server/infrastructure/prisma/PrismaBarberRepository';
import { PrismaLocationRepository } from '@/server/infrastructure/prisma/PrismaLocationRepository';
import { PrismaBarberServiceRepository } from '@/server/infrastructure/prisma/PrismaBarberServiceRepository';
import { PrismaWorkingHoursRepository } from '@/server/infrastructure/prisma/PrismaWorkingHoursRepository';
import { getPrismaClient } from '@/server/infrastructure/prisma/client';
import { logger } from '@/server/infrastructure/logger';
import { toErrorLogContext } from '@/server/infrastructure/errorLogContext';
import { requireOwner } from '@/server/infrastructure/supabase/requireOwner';
import type { BarberWithLocation } from '@/server/domain/repositories/IBarberRepository';
import type { Location } from '@/server/domain/models/Location';

export const dynamic = 'force-dynamic';

async function fetchPageData(ownerId: string): Promise<{
  barbers: BarberWithLocation[];
  locations: Location[];
  assignedCounts: Map<string, number>;
  barbersWithSchedule: Set<string>;
}> {
  const db = getPrismaClient();
  try {
    // Four queries for the whole page, not one per barber: both the assignment
    // count and the schedule indicator are single aggregates for the owner.
    const [barbers, locations, assignedCounts, barbersWithSchedule] = await Promise.all([
      new BarberCatalogService(
        new PrismaBarberRepository(db),
        new PrismaLocationRepository(db)
      ).listBarbers(ownerId),
      new LocationService(new PrismaLocationRepository(db)).listOwnerLocations(ownerId),
      new PrismaBarberServiceRepository(db).countServicesByBarber(ownerId),
      new PrismaWorkingHoursRepository(db).findBarberIdsWithSchedule(ownerId),
    ]);
    return { barbers, locations, assignedCounts, barbersWithSchedule };
  } catch (error) {
    logger.error('Failed to load barberos page data', toErrorLogContext('listBarbers', error));
    throw error;
  }
}

export default async function BarbersPage() {
  const owner = await requireOwner();
  const { barbers, locations, assignedCounts, barbersWithSchedule } = await fetchPageData(owner.id);

  const hasLocations = locations.length > 0;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-12">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">{COPY.barbers.heading}</h1>
        {hasLocations ? (
          <Link href="/barberos/nuevo" className={buttonVariants()}>
            {COPY.barbers.create}
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
                {/* T18: min-w-0 on BOTH levels is load-bearing. A flex item
                    defaults to min-width:auto and refuses to shrink below its
                    content's intrinsic width, so `break-words` never gets the
                    chance to act and a 120-character unbroken name overflows
                    the card. Fixed for the services list in M3 and recorded as
                    debt here; this change adds another element to the same row,
                    which is the trigger that entry named. */}
                <CardTitle className="flex min-w-0 items-start justify-between gap-3">
                  <span className="min-w-0 break-words">{barber.displayName}</span>
                  {!locationIsActive ? (
                    <span className="text-muted-foreground shrink-0 text-xs font-normal">
                      {COPY.barbers.inactiveBadge}
                    </span>
                  ) : null}
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <p className="text-muted-foreground text-sm">{locationName}</p>
                {/* Zero is rendered, never omitted: a barber assigned to nothing
                    cannot be booked for anything, and that is exactly the state
                    worth seeing without opening each barber in turn. */}
                <p className="text-muted-foreground text-sm">
                  {COPY.barberServices.assignedCount(assignedCounts.get(barber.id) ?? 0)}
                </p>
                {/* Shown for every barber, not only in the negative case: a
                    barber with no schedule cannot be booked at any time, which
                    is the same class of fact as having no assigned services. */}
                {barbersWithSchedule.has(barber.id) ? (
                  <p className="text-muted-foreground text-sm">{COPY.workingHours.hasSchedule}</p>
                ) : (
                  <p className="text-destructive text-sm">
                    {COPY.workingHours.noSchedule}
                    <span className="text-muted-foreground block text-xs">
                      {COPY.workingHours.noScheduleHint}
                    </span>
                  </p>
                )}
                {barber.bio ? (
                  <p className="line-clamp-3 text-sm break-words">{barber.bio}</p>
                ) : null}
                <div className="flex flex-wrap items-center gap-4">
                  <Link
                    href={`/barberos/${barber.id}/editar`}
                    aria-label={COPY.barbers.editLabel(barber.displayName)}
                    className="text-primary text-sm font-medium underline-offset-4 hover:underline"
                  >
                    {COPY.barbers.edit}
                  </Link>
                  <Link
                    href={`/barberos/${barber.id}/servicios`}
                    aria-label={COPY.barberServices.manageLabel(barber.displayName)}
                    className="text-primary text-sm font-medium underline-offset-4 hover:underline"
                  >
                    {COPY.barberServices.manage}
                  </Link>
                  <Link
                    href={`/barberos/${barber.id}/horarios`}
                    aria-label={COPY.workingHours.manageLabel(barber.displayName)}
                    className="text-primary text-sm font-medium underline-offset-4 hover:underline"
                  >
                    {COPY.workingHours.manage}
                  </Link>
                  <Link
                    href={`/barberos/${barber.id}/ausencias`}
                    aria-label={COPY.timeOff.manageLabel(barber.displayName)}
                    className="text-primary text-sm font-medium underline-offset-4 hover:underline"
                  >
                    {COPY.timeOff.manage}
                  </Link>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </main>
  );
}
