import 'server-only';
import { BookingCancellationService } from '@/server/application/services/BookingCancellationService';
import { PrismaBookingRepository } from '@/server/infrastructure/prisma/PrismaBookingRepository';
import { getPrismaClient } from '@/server/infrastructure/prisma/client';
import { systemClock } from '@/server/domain/repositories/IClock';
import { logger } from '@/server/infrastructure/logger';
import { BookingCancellationNotificationService } from '@/server/application/services/BookingCancellationNotificationService';
import { createEmailSender } from '@/server/infrastructure/email/emailSenderFactory';

/**
 * Composition root for the owner's cancellation (C2).
 *
 * **One repository and nothing else.** No Supabase client — this write touches
 * no storage and needs no signed URL. No cipher — this surface never reaches a
 * Mercado Pago credential, and B5's count of public-flow roots permitted to
 * decrypt one is unchanged.
 *
 * **No booking projection carrying contact detail is reachable from here.** The
 * repository has one (N1's confirmation-email read) and this root's service
 * never calls it: the cancellation is handed two identifiers and returns an
 * outcome, so there is nothing for a later change to log or render by accident.
 *
 * **No optional constructor arguments** (T57), and every one asserted by a test
 * over this file's source.
 */
export function bookingCancellationService(): BookingCancellationService {
  const bookings = new PrismaBookingRepository(getPrismaClient());

  return new BookingCancellationService(
    bookings,
    systemClock,
    logger,
    // One repository instance, shared: the notice reuses the confirmation
    // projection rather than adding a second read, and its builder's input type
    // omits the slug and the token so it cannot compose a link from them.
    new BookingCancellationNotificationService(bookings, createEmailSender(logger), logger)
  );
}
