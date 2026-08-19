import 'server-only';
import { PaymentConfirmationService } from '@/server/application/services/PaymentConfirmationService';
import { PrismaPaymentRepository } from '@/server/infrastructure/prisma/PrismaPaymentRepository';
import { PrismaPaymentConfigRepository } from '@/server/infrastructure/prisma/PrismaPaymentConfigRepository';
import { MercadoPagoGateway } from '@/server/infrastructure/payments/MercadoPagoGateway';
import { WebCryptoCipher } from '@/server/infrastructure/crypto/WebCryptoCipher';
import { getPrismaClient } from '@/server/infrastructure/prisma/client';
import { systemClock } from '@/server/domain/repositories/IClock';
import { logger } from '@/server/infrastructure/logger';

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
 * **What is absent stays absent.** No Supabase client — this endpoint has no
 * session and nothing to upload. No booking repository — the notification never
 * reads a booking except through the payment's own projection, which carries no
 * client contact detail and no cancellation token.
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
    logger
  );
}
