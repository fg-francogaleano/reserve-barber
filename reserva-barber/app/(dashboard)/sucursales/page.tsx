import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';
import { COPY } from '@/lib/copy';
import { LocationService } from '@/server/application/services/LocationService';
import { PrismaLocationRepository } from '@/server/infrastructure/prisma/PrismaLocationRepository';
import { getPrismaClient } from '@/server/infrastructure/prisma/client';
import { logger } from '@/server/infrastructure/logger';
import { requireOwner } from '@/server/infrastructure/supabase/requireOwner';
import type { Location } from '@/server/domain/models/Location';

// Reads cookies and the database — never statically cached.
export const dynamic = 'force-dynamic';

async function fetchOwnerLocations(ownerId: string): Promise<Location[]> {
  try {
    const service = new LocationService(new PrismaLocationRepository(getPrismaClient()));
    return await service.listOwnerLocations(ownerId);
  } catch (error) {
    logger.error('Failed to list owner locations', {
      operation: 'listOwnerLocations',
      cause: error instanceof Error ? error.message : String(error),
    });
    throw error; // Re-thrown so error.tsx renders the generic Spanish boundary.
  }
}

export default async function LocationsPage() {
  // Guarded here in its own right, not only by the middleware and the layout:
  // this page reads the database, and that read must never start for a request
  // without a session. `requireOwner()` is request-cached, so this costs nothing.
  const owner = await requireOwner();

  const locations = await fetchOwnerLocations(owner.id);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-12">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">{COPY.locations.manageHeading}</h1>
        {/* The Button primitive renders a real <button>; a navigation control
            must be a link, so it borrows the variant classes instead. */}
        <Link href="/sucursales/nueva" className={buttonVariants()}>
          {COPY.locations.create}
        </Link>
      </div>

      {locations.length === 0 ? (
        // Neutral styling on purpose: an empty list is a starting point, not a
        // failure. The error boundary is what signals a failure.
        <p className="text-muted-foreground">{COPY.locations.emptyManage}</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {locations.map((location) => (
            <Card key={location.id}>
              <CardHeader>
                <CardTitle className="flex items-start justify-between gap-3 break-words">
                  <span className="break-words">{location.name}</span>
                  {!location.isActive ? (
                    <span className="text-muted-foreground shrink-0 text-xs font-normal">
                      {COPY.locations.inactiveBadge}
                    </span>
                  ) : null}
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {location.address ? (
                  <p className="text-muted-foreground text-sm break-words">{location.address}</p>
                ) : null}
                <Link
                  href={`/sucursales/${location.id}/editar`}
                  aria-label={COPY.locations.editLabel(location.name)}
                  className="text-primary text-sm font-medium underline-offset-4 hover:underline"
                >
                  {COPY.locations.edit}
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </main>
  );
}
