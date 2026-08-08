import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { COPY } from '@/lib/copy';
import { LocationService } from '@/server/application/services/LocationService';
import { PrismaLocationRepository } from '@/server/infrastructure/prisma/PrismaLocationRepository';
import { getPrismaClient } from '@/server/infrastructure/prisma/client';
import { logger } from '@/server/infrastructure/logger';
import { requireOwner } from '@/server/infrastructure/supabase/requireOwner';
import type { Location } from '@/server/domain/models/Location';

// Always render at request time — this page exists to prove the live DB read.
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
    throw error; // Re-throw so error.tsx renders the generic Spanish boundary.
  }
}

/**
 * Placeholder dashboard home. Locations are managed at `/sucursales` (M1); this
 * route becomes the Inicio summary in story D1, which is why it is left showing
 * the list rather than removed — no route should be left without a page.
 */
export default async function Home() {
  // Guarded in its own right, not only by the middleware and the layout: this
  // page reads the database, and that read must never start for a request
  // without a session. `requireOwner()` is request-cached, so this costs nothing.
  const owner = await requireOwner();

  const locations = await fetchOwnerLocations(owner.id);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">{COPY.locations.heading}</h1>
      {locations.length === 0 ? (
        <p className="text-muted-foreground">{COPY.locations.empty}</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {locations.map((location) => (
            <Card key={location.id}>
              <CardHeader>
                <CardTitle className="break-words">{location.name}</CardTitle>
              </CardHeader>
              {location.address ? (
                <CardContent>
                  <p className="text-muted-foreground text-sm break-words">{location.address}</p>
                </CardContent>
              ) : null}
            </Card>
          ))}
        </div>
      )}
    </main>
  );
}
