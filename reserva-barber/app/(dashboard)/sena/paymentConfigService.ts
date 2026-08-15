import 'server-only';
import { PaymentConfigService } from '@/server/application/services/PaymentConfigService';
import { PrismaPaymentConfigRepository } from '@/server/infrastructure/prisma/PrismaPaymentConfigRepository';
import { PrismaServiceRepository } from '@/server/infrastructure/prisma/PrismaServiceRepository';
import { getPrismaClient } from '@/server/infrastructure/prisma/client';

/**
 * Composition root for the deposit policy editor.
 *
 * **No cipher, deliberately** (design D10). The readiness panel needs to know
 * whether Mercado Pago is configured, and `findByOwner` already answers that
 * with a boolean derived at the repository boundary without decrypting
 * anything. Wiring `WebCryptoCipher` here would make a page about deposit
 * amounts fail when `PAYMENT_CREDENTIALS_KEY` is missing — widening a blast
 * radius that PC2 deliberately kept to one page.
 *
 * No verifier either: nothing here talks to Mercado Pago.
 */
export function depositPolicyService(): PaymentConfigService {
  const db = getPrismaClient();
  return new PaymentConfigService(
    new PrismaPaymentConfigRepository(db),
    undefined,
    new PrismaServiceRepository(db)
  );
}
