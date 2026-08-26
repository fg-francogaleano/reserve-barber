import 'server-only';
import { ReceiptReviewService } from '@/server/application/services/ReceiptReviewService';
import { BookingConfirmationNotificationService } from '@/server/application/services/BookingConfirmationNotificationService';
import { PrismaTransferReceiptRepository } from '@/server/infrastructure/prisma/PrismaTransferReceiptRepository';
import { PrismaBookingRepository } from '@/server/infrastructure/prisma/PrismaBookingRepository';
import { createEmailSender } from '@/server/infrastructure/email/emailSenderFactory';
import { resolveOrigin } from '@/server/application/businessProfile/resolveOrigin';
import { SupabaseOwnerReceiptStorage } from '@/server/infrastructure/storage/SupabaseReceiptStorage';
import { createSupabaseServerClient } from '@/server/infrastructure/supabase/authClient';
import { getPrismaClient } from '@/server/infrastructure/prisma/client';
import { systemClock } from '@/server/domain/repositories/IClock';
import { logger } from '@/server/infrastructure/logger';

/**
 * Composition root for the owner's receipt review.
 *
 * **Built with the owner's own session client**, which is what confines every
 * read to their own prefix — the bucket's `select` policy compares the key's
 * leading segment against `auth.uid()`. That is P1's guarantee, available again
 * here because this caller, unlike the booking guest, has a session.
 *
 * `SupabaseOwnerReceiptStorage` can only sign. The uploader is a different
 * class taking a different client, so the sessionless credential the public
 * route uses is not reachable from anything on this page — and nothing here can
 * write to the bucket at all.
 *
 * **No cipher.** This surface never touches a Mercado Pago credential; the
 * count of public-flow surfaces permitted to decrypt one is B5's, and it is
 * unchanged.
 *
 * **It now also composes the confirmation email** (N1), which brings a booking
 * repository onto an owner-facing page for the first time. The projection
 * behind it is the same one the notification path uses and carries the same
 * bounds: the client's name and email because that is where the message goes,
 * and no phone, no whole row and no payment-configuration column. Note the
 * repository is built on the **Prisma** client, not the owner's Supabase
 * session — the scoping that matters here was already done by the approval,
 * which resolved the receipt within this owner's scope before confirming it.
 *
 * `RESEND_API_KEY` is validated by `createEmailSender`, here rather than in a
 * global startup check, so a deploy missing it costs the emails and not the
 * review queue.
 */
export async function receiptReviewService(): Promise<ReceiptReviewService> {
  const db = getPrismaClient();

  return new ReceiptReviewService(
    new PrismaTransferReceiptRepository(db),
    new SupabaseOwnerReceiptStorage(await createSupabaseServerClient()),
    systemClock,
    logger,
    new BookingConfirmationNotificationService(
      new PrismaBookingRepository(db),
      createEmailSender(logger),
      systemClock,
      logger,
      resolveOrigin({ configured: process.env.APP_ORIGIN })
    )
  );
}
