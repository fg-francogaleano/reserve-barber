import 'server-only';
import { PublicBookingCatalogService } from '@/server/application/services/PublicBookingCatalogService';
import { PrismaBusinessProfileRepository } from '@/server/infrastructure/prisma/PrismaBusinessProfileRepository';
import { PrismaPublicCatalogRepository } from '@/server/infrastructure/prisma/PrismaPublicCatalogRepository';
import { PrismaBarberAvailabilityRepository } from '@/server/infrastructure/prisma/PrismaBarberAvailabilityRepository';
import { PrismaWorkingHoursRepository } from '@/server/infrastructure/prisma/PrismaWorkingHoursRepository';
import { PublicAvailabilityService } from '@/server/application/services/PublicAvailabilityService';
import { getPrismaClient } from '@/server/infrastructure/prisma/client';
import { systemClock } from '@/server/domain/repositories/IClock';
import { hasTimezoneSupport } from '@/server/domain/models/businessTime';
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
/**
 * Raised before anything is read when the runtime cannot place an instant in the
 * business's calendar.
 *
 * A runtime without timezone data does not throw — it silently reports UTC,
 * which would shift every offered time by three hours with nothing anywhere to
 * notice. So the check is a comparison against a known offset, and it happens
 * **here**, at the composition root, rather than deeper: by the time a slot list
 * has been computed the damage is a page of plausible wrong times, and the
 * client would have no way to tell.
 *
 * Scoped to this route on purpose. The public profile builds the same service
 * for its bookability gate and needs no timezone at all, so asserting there
 * would take down a page over a dependency it does not have.
 */
export class TimezoneUnavailableError extends Error {
  constructor() {
    super('Business timezone data is unavailable on this runtime');
    this.name = 'TimezoneUnavailableError';
  }
}

export function bookingCatalogService(): PublicBookingCatalogService {
  // Before the client, before the repositories, before any query.
  if (!hasTimezoneSupport()) {
    throw new TimezoneUnavailableError();
  }

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
