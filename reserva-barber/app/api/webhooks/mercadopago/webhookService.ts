import 'server-only';
import { PaymentConfirmationService } from '@/server/application/services/PaymentConfirmationService';
import { BookingConfirmationNotificationService } from '@/server/application/services/BookingConfirmationNotificationService';
import { PrismaPaymentRepository } from '@/server/infrastructure/prisma/PrismaPaymentRepository';
import { PrismaPaymentConfigRepository } from '@/server/infrastructure/prisma/PrismaPaymentConfigRepository';
import { PrismaBookingRepository } from '@/server/infrastructure/prisma/PrismaBookingRepository';
import { MercadoPagoGateway } from '@/server/infrastructure/payments/MercadoPagoGateway';
import { createEmailSender } from '@/server/infrastructure/email/emailSenderFactory';
import { WebCryptoCipher } from '@/server/infrastructure/crypto/WebCryptoCipher';
import { getPrismaClient } from '@/server/infrastructure/prisma/client';
import { systemClock } from '@/server/domain/repositories/IClock';
import { logger } from '@/server/infrastructure/logger';
import { resolveOrigin } from '@/server/application/businessProfile/resolveOrigin';

/**
 * Composition root for the Mercado Pago notification handler.
 *
 * The second of the two roots that construct a cipher, and the reason is the
 * same as the first: authenticating a notification means asking Mercado Pago
 * about the payment with **that owner's** access token, which has to be
 * decrypted to be used. Both roots live under `app/api/**` and both are named
 * in the payment composer test, so listing the callers of `WebCryptoCipher`
 * still answers "what can decrypt a stored credential?" in one search.
 *
 * **This root used to state that it wired no booking repository**, on the
 * grounds that the notification never reads a booking except through the
 * payment's own projection — one carrying no client contact detail and no
 * cancellation token. N1 made that false rather than obsolete, so the claim is
 * replaced instead of quietly left standing (the same treatment B6 gave
 * `bookingConfirmationService.ts` when its own guarantee changed shape).
 *
 * **The narrowed guarantee that holds now:** the notification path reads a
 * booking through exactly one named projection, built for the confirmation
 * message and used for nothing else. It selects the client's name and email —
 * which is where the message goes, not something it might leak — and it
 * selects **no phone, no whole row, no wholesale client relation, and no
 * payment-configuration column of any kind**. The credential rule above is
 * untouched: the access token and the message projection are separate reads
 * over separate types, and neither type has a field the other's value could
 * occupy.
 *
 * **No Supabase client.** This endpoint still has no session and nothing to
 * upload.
 *
 * **`RESEND_API_KEY` is validated by `createEmailSender`, here, and never in a
 * global startup check.** A global one that threw would take down payment
 * confirmation itself over a missing mail credential — turning "clients are not
 * being emailed" into "money moves and no booking confirms".
 *
 * **No optional constructor arguments** (T57), and every one asserted by a test
 * over this file's source.
 */
export function paymentConfirmationService(): PaymentConfirmationService {
  const db = getPrismaClient();

  return new PaymentConfirmationService(
    new PrismaPaymentRepository(db),
    new PrismaPaymentConfigRepository(db, new WebCryptoCipher()),
    new MercadoPagoGateway(),
    systemClock,
    logger,
    new BookingConfirmationNotificationService(
      new PrismaBookingRepository(db),
      createEmailSender(logger),
      systemClock,
      logger,
      // Configuration is read here, at the root, and never inside the service —
      // the pattern every other service in this layer follows. `APP_ORIGIN`'s
      // absence is no longer only cosmetic: it removes the link from every
      // confirmation, which the service reports as its own logged failure.
      resolveOrigin({ configured: process.env.APP_ORIGIN })
    )
  );
}
