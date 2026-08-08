import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { COPY } from '@/lib/copy';
import { LocationService } from '@/server/application/services/LocationService';
import { PrismaLocationRepository } from '@/server/infrastructure/prisma/PrismaLocationRepository';
import { getPrismaClient } from '@/server/infrastructure/prisma/client';
import { logger } from '@/server/infrastructure/logger';
import type { Location } from '@/server/domain/models/Location';

// Always render at request time — this page exists to prove the live DB read.
export const dynamic = 'force-dynamic';

async function fetchActiveLocations(): Promise<Location[]> {
  try {
    const service = new LocationService(new PrismaLocationRepository(getPrismaClient()));
    return await service.listActiveLocations();
  } catch (error) {
    logger.error('Failed to list active locations', {
      operation: 'listActiveLocations',
      cause: error instanceof Error ? error.message : String(error),
    });
    throw error; // Re-throw so error.tsx renders the generic Spanish boundary.
  }
}

export default async function Home() {
  const locations = await fetchActiveLocations();

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
