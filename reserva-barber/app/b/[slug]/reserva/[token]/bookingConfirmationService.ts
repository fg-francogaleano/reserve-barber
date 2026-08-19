import 'server-only';
import { PrismaBookingRepository } from '@/server/infrastructure/prisma/PrismaBookingRepository';
import { getPrismaClient } from '@/server/infrastructure/prisma/client';
import type { IBookingRepository } from '@/server/domain/repositories/IBookingRepository';

/**
 * Composition root for the hold-confirmation page.
 *
 * One repository and nothing else: no Supabase client, no cipher, no payment
 * repository. The page reads a booking by its token and renders it; the
 * deposit it shows is the amount already snapshotted on the row, so no live
 * payment configuration is consulted and none can leak here.
 */
export function bookingConfirmationService(): IBookingRepository {
  return new PrismaBookingRepository(getPrismaClient());
}
