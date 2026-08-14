import 'server-only';
import { PaymentConfigService } from '@/server/application/services/PaymentConfigService';
import { PrismaPaymentConfigRepository } from '@/server/infrastructure/prisma/PrismaPaymentConfigRepository';
import { getPrismaClient } from '@/server/infrastructure/prisma/client';
import { WebCryptoCipher } from '@/server/infrastructure/crypto/WebCryptoCipher';
import { MercadoPagoCredentialVerifier } from '@/server/infrastructure/payments/MercadoPagoCredentialVerifier';
import type { ICredentialCipher } from '@/server/domain/repositories/ICredentialCipher';

/**
 * Composition root for the Mercado Pago credentials editor.
 *
 * **This is where `PAYMENT_CREDENTIALS_KEY` is validated** — not in
 * `validateEnv()` (design D11). Adding it to the global required set would take
 * the entire dashboard down on a deploy that forgot one secret; a missing key
 * must break only what depends on it. `WebCryptoCipher` reads the key lazily
 * for the same reason: constructing this never throws, so a page that reaches
 * here without encrypting anything still renders.
 */

export function credentialCipher(): ICredentialCipher {
  return new WebCryptoCipher();
}

export function mercadoPagoConfigService(): PaymentConfigService {
  return new PaymentConfigService(
    new PrismaPaymentConfigRepository(getPrismaClient(), credentialCipher()),
    new MercadoPagoCredentialVerifier()
  );
}
