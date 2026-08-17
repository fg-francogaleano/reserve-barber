import 'server-only';
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
 * Composition root for the public booking flow.
 *
 * Synchronous, like `publicProfileService()` and for the same reason: there is
 * no session to bind a client to, and nothing in this flow writes. B2 creates no
 * rows — the first mutation on the public surface is B4's, and
 * `backend-standards.md` requires it to be a Route Handler rather than anything
 * composed here.
 *
 * **What is absent must stay absent** (design D11), and the list is the same one
 * B1 wrote down:
 *
 * - no Supabase client — nothing here uploads,
 * - no `ICredentialCipher` — PC3's rule is that a surface with no need for a
 *   cipher must not construct one,
 * - and **no `PaymentConfig` repository**. That row holds the encrypted Mercado
 *   Pago access token. This flow answers *is there anything to book*; whether a
 *   deposit can be charged is B4's question, asked somewhere a stranger is not
 *   already standing.
 *
 * The cheapest way to guarantee all three is for the composer never to hand one
 * over, which is why this file exists rather than the page wiring its own
 * repositories.
 */
export function bookingCatalogService(): PublicBookingCatalogService {
  const db = getPrismaClient();

  return new PublicBookingCatalogService(
    new PrismaBusinessProfileRepository(db),
    new PrismaPublicCatalogRepository(db),
    logger,
    // B3's availability reads. Both repositories are owner-scoped by contract,
    // and the owner they are scoped with is resolved from the slug inside the
    // catalogue service and bound there — the page never receives it.
    //
    // `systemClock` rather than `new Date()` inside the rule: the slot rule's
    // hardest cases are about what time it is, and a module that reads the clock
    // itself cannot be tested for them.
    new PublicAvailabilityService(
      new PrismaBarberAvailabilityRepository(db),
      new PrismaWorkingHoursRepository(db),
      systemClock
    )
  );
}
