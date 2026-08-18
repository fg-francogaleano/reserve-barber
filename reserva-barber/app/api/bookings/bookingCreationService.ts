import 'server-only';
import { BookingCreationService } from '@/server/application/services/BookingCreationService';
import { PublicAvailabilityService } from '@/server/application/services/PublicAvailabilityService';
import { PrismaBusinessProfileRepository } from '@/server/infrastructure/prisma/PrismaBusinessProfileRepository';
import { PrismaPublicCatalogRepository } from '@/server/infrastructure/prisma/PrismaPublicCatalogRepository';
import { PrismaPaymentConfigRepository } from '@/server/infrastructure/prisma/PrismaPaymentConfigRepository';
import { PrismaBarberAvailabilityRepository } from '@/server/infrastructure/prisma/PrismaBarberAvailabilityRepository';
import { PrismaWorkingHoursRepository } from '@/server/infrastructure/prisma/PrismaWorkingHoursRepository';
import { PrismaClientRepository } from '@/server/infrastructure/prisma/PrismaClientRepository';
import { PrismaBookingRepository } from '@/server/infrastructure/prisma/PrismaBookingRepository';
import { getPrismaClient } from '@/server/infrastructure/prisma/client';
import { systemClock } from '@/server/domain/repositories/IClock';
import { logger } from '@/server/infrastructure/logger';

/**
 * Composition root for the public booking write.
 *
 * **What is absent is still absent** (B1 design D11, B2 design D11, and
 * narrowed rather than relaxed here):
 *
 * - no Supabase client — nothing in this flow uploads, and nothing in it has a
 *   session to resolve;
 * - **no `ICredentialCipher`**. PC3's rule is that a surface with no need for
 *   a cipher must not construct one, and this surface has none: the payment
 *   repository is built without one, so `findMercadoPagoAccessToken` would
 *   throw rather than quietly return a plaintext token. The only payment read
 *   this flow performs is `findPaymentReadinessForPublic`, whose return type
 *   has no field the access token fits into and whose query never selects that
 *   column.
 *
 * The `PaymentConfig` repository **is** wired, which B1, B2 and B3 all
 * deliberately refused. That is this story's one narrowing: the payment gate
 * is a question about that row and it has to be asked somewhere. The guarantee
 * moved from an absent dependency to a projection that cannot express the
 * leak, which is the stronger of the two — an absent dependency protects until
 * someone adds it, a type that cannot carry a value protects afterwards.
 *
 * The timezone assertion lives inside `BookingCreationService.create`, before
 * any repository work, rather than here: a composition root that throws at
 * module scope would take down the route for a request that never needed a
 * timezone, and B3 settled that shape for the read side.
 */
export function bookingCreationService(): BookingCreationService {
  const db = getPrismaClient();

  return new BookingCreationService(
    new PrismaBusinessProfileRepository(db),
    new PrismaPublicCatalogRepository(db),
    // Built with no cipher, deliberately. See the note above.
    new PrismaPaymentConfigRepository(db),
    new PublicAvailabilityService(
      new PrismaBarberAvailabilityRepository(db),
      new PrismaWorkingHoursRepository(db),
      systemClock
    ),
    new PrismaClientRepository(db),
    new PrismaBookingRepository(db),
    systemClock,
    logger
  );
}
