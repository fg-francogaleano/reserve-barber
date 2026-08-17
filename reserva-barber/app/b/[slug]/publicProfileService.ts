import 'server-only';
import { PublicProfileService } from '@/server/application/services/PublicProfileService';
import { PublicBookingCatalogService } from '@/server/application/services/PublicBookingCatalogService';
import { PrismaBusinessProfileRepository } from '@/server/infrastructure/prisma/PrismaBusinessProfileRepository';
import { PrismaPublicCatalogRepository } from '@/server/infrastructure/prisma/PrismaPublicCatalogRepository';
import { PrismaBarberAvailabilityRepository } from '@/server/infrastructure/prisma/PrismaBarberAvailabilityRepository';
import { PrismaWorkingHoursRepository } from '@/server/infrastructure/prisma/PrismaWorkingHoursRepository';
import { PublicAvailabilityService } from '@/server/application/services/PublicAvailabilityService';
import { getPrismaClient } from '@/server/infrastructure/prisma/client';
import { systemClock } from '@/server/domain/repositories/IClock';
import { logger } from '@/server/infrastructure/logger';

/**
 * Composition root for the public profile page.
 *
 * Synchronous, unlike `profileService()` — and the reason is the whole point of
 * this route. That composer is async because it builds a **session-bound**
 * Supabase client for uploads; here there is no session to bind to, and nothing
 * on this page writes.
 *
 * Note what is absent and must stay absent: no Supabase client, no cipher, and
 * **no `PaymentConfig` repository** (design D11). That row holds the encrypted
 * Mercado Pago access token. A page anonymous visitors open should have no
 * relationship with it, and the cheapest way to guarantee that is for the
 * composer never to hand one over.
 */
export function publicProfileService(): PublicProfileService {
  return new PublicProfileService(new PrismaBusinessProfileRepository(getPrismaClient()), logger);
}

/**
 * The bookability gate for the "Reservar" control (B2 design D10).
 *
 * Composed here rather than inside `PublicProfileService` because the two answer
 * different questions about different aggregates, and merging them would give
 * the profile service a catalogue repository it has no other use for.
 *
 * **It reads the same catalogue the booking route reads**, not a cheaper count.
 * The page and the route must agree about what "bookable" means, and two
 * queries answering that separately are two definitions waiting to disagree.
 *
 * The absences from `publicProfileService` above apply here unchanged: no
 * Supabase client, no cipher, and no `PaymentConfig` repository. This gate
 * answers *is there anything to book* — whether a deposit can be charged is
 * B4's question.
 */
export function bookingGate(): PublicBookingCatalogService {
  const db = getPrismaClient();

  return new PublicBookingCatalogService(
    new PrismaBusinessProfileRepository(db),
    new PrismaPublicCatalogRepository(db),
    logger,
    // Constructed and never exercised: this gate only ever calls `isBookable`,
    // which reads the catalogue. Instantiating repositories issues no query, so
    // the cost is nothing — but it is named here rather than left to look like
    // the profile page computes availability, which it does not.
    new PublicAvailabilityService(
      new PrismaBarberAvailabilityRepository(db),
      new PrismaWorkingHoursRepository(db),
      systemClock
    )
  );
}
