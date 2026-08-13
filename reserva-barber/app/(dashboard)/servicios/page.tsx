import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';
import { COPY } from '@/lib/copy';
import { formatCurrency } from '@/lib/formatCurrency';
import { ServiceCatalogService } from '@/server/application/services/ServiceCatalogService';
import { PrismaServiceRepository } from '@/server/infrastructure/prisma/PrismaServiceRepository';
import { PrismaBarberServiceRepository } from '@/server/infrastructure/prisma/PrismaBarberServiceRepository';
import { getPrismaClient } from '@/server/infrastructure/prisma/client';
import { logger } from '@/server/infrastructure/logger';
import { toErrorLogContext } from '@/server/infrastructure/errorLogContext';
import { requireOwner } from '@/server/infrastructure/supabase/requireOwner';
import type { Service } from '@/server/domain/models/Service';

export const dynamic = 'force-dynamic';

async function fetchPageData(
  ownerId: string
): Promise<{ services: Service[]; activeBarberCounts: Map<string, number> }> {
  const db = getPrismaClient();
  try {
    const [services, activeBarberCounts] = await Promise.all([
      new ServiceCatalogService(new PrismaServiceRepository(db)).listServices(ownerId),
      // One aggregate for the whole list, not one query per service (design D12).
      new PrismaBarberServiceRepository(db).countActiveBarbersByService(ownerId),
    ]);
    return { services, activeBarberCounts };
  } catch (error) {
    logger.error('Failed to load servicios page data', toErrorLogContext('listServices', error));
    throw error;
  }
}

/**
 * Bookability is the conjunction of three facts, derived at read time and never
 * cached in a column (design D8). Dropping any one of them makes the dashboard
 * state a lie: without `isActive` a deactivated service reads as bookable, and
 * the count already excludes inactive barbers so a service performed only by
 * inactive barbers does not qualify either.
 */
function isBookable(service: Service, activeBarberCounts: Map<string, number>): boolean {
  return service.isActive && (activeBarberCounts.get(service.id) ?? 0) > 0;
}

export default async function ServicesPage() {
  const owner = await requireOwner();
  const { services, activeBarberCounts } = await fetchPageData(owner.id);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-12">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">{COPY.services.heading}</h1>
        <Link href="/servicios/nuevo" className={buttonVariants()}>
          {COPY.services.create}
        </Link>
      </div>

      {services.length === 0 ? (
        <p className="text-muted-foreground">{COPY.services.empty}</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {services.map((service) => (
            <Card key={service.id}>
              <CardHeader>
                {/* min-w-0 on BOTH levels is load-bearing. A flex item defaults
                    to min-width:auto and refuses to shrink below its content's
                    intrinsic width, so `break-words` never gets the chance to
                    act. The title is itself a grid item inside CardHeader, so
                    clearing it only on the span leaves the title at the word's
                    full width and a 120-character unbroken name overflows the
                    card (found in task 10.22). */}
                <CardTitle className="flex min-w-0 items-start justify-between gap-3">
                  <span className="min-w-0 break-words">{service.name}</span>
                  <span className="text-muted-foreground shrink-0 text-xs font-normal">
                    {COPY.services.duration(service.durationMinutes)}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {/* Formatted here, on the server. Formatting the same value in a
                    Client Component invites a hydration mismatch, since the
                    build's locale data and the browser's need not agree. */}
                <p className="text-sm font-medium">{formatCurrency(service.price)}</p>
                {!isBookable(service, activeBarberCounts) ? (
                  // Text, not colour: the marker has to survive a greyscale
                  // screen and a screen reader alike. `role="status"` puts it in
                  // the accessible description rather than leaving it as
                  // decoration that assistive technology skips.
                  <p role="status" className="text-destructive text-xs font-medium">
                    {COPY.services.notBookableBadge}
                    <span className="text-muted-foreground block font-normal">
                      {COPY.services.notBookableHint}
                    </span>
                  </p>
                ) : null}
                {service.description ? (
                  <p className="line-clamp-3 text-sm break-words">{service.description}</p>
                ) : null}
                <Link
                  href={`/servicios/${service.id}/editar`}
                  aria-label={COPY.services.editLabel(service.name)}
                  className="text-primary text-sm font-medium underline-offset-4 hover:underline"
                >
                  {COPY.services.edit}
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </main>
  );
}
