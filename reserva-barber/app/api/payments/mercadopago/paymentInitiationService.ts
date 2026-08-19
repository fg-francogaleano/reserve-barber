import 'server-only';
import { PaymentInitiationService } from '@/server/application/services/PaymentInitiationService';
import { PrismaBookingRepository } from '@/server/infrastructure/prisma/PrismaBookingRepository';
import { PrismaPaymentRepository } from '@/server/infrastructure/prisma/PrismaPaymentRepository';
import { PrismaPaymentConfigRepository } from '@/server/infrastructure/prisma/PrismaPaymentConfigRepository';
import { MercadoPagoGateway } from '@/server/infrastructure/payments/MercadoPagoGateway';
import { WebCryptoCipher } from '@/server/infrastructure/crypto/WebCryptoCipher';
import { getPrismaClient } from '@/server/infrastructure/prisma/client';
import { systemClock } from '@/server/domain/repositories/IClock';
import { logger } from '@/server/infrastructure/logger';

/**
 * Composition root for the public payment initiation — **the one surface in
 * the public booking flow permitted to decrypt the Mercado Pago access token**
 * (design D4).
 *
 * That is a real change to a guarantee four stories old, so it is stated here
 * rather than discovered later. B1, B2 and B3 kept the encrypted token out of
 * this flow by wiring no `PaymentConfig` repository at all. B4 had to ask
 * whether a deposit could be charged, so it wired one **without a cipher** —
 * `findMercadoPagoAccessToken` would throw there rather than return plaintext —
 * and answered its gate through a projection with no field the token fits into.
 *
 * B5 has to actually charge, so it needs the plaintext. The guarantee changes
 * shape a third time instead of being deleted:
 *
 * - **This file is one of exactly two in the public flow that construct a
 *   cipher**, the other being the notification handler's composer — which needs
 *   one for the same reason, since authenticating a notification means asking
 *   Mercado Pago about the payment with that owner's own token. Both are named
 *   in `paymentInitiationService.test.ts`, which asserts the **complete set** of
 *   constructors in the repository rather than checking a couple of files by
 *   hand. Listing the callers of `WebCryptoCipher` therefore keeps answering
 *   "what can decrypt a stored credential?" in one search, and a third
 *   constructor appearing anywhere fails that test rather than passing quietly.
 * - `app/api/bookings/bookingCreationService.ts` is untouched and still builds
 *   its payment repository with no cipher argument, asserted by its own test.
 * - `PublicPaymentReadiness` gains no field. The readiness gate still cannot
 *   express the token even if someone wanted it to.
 * - The plaintext is handed straight to `MercadoPagoGateway` and exists nowhere
 *   above it: no application type, log context, prop or error payload has a
 *   field capable of holding it.
 *
 * **`PAYMENT_CREDENTIALS_KEY` is validated here, not in `validateEnv()`**
 * (PC2 design D11). A missing key must break only what depends on it, never
 * the whole dashboard, and `WebCryptoCipher` reads the key lazily so
 * constructing this never throws.
 *
 * **No optional constructor arguments on this path** (T57). B4's runtime found
 * a repository wired into the write composer and not the read one because an
 * argument was optional — and an omitted optional argument compiles,
 * typechecks, and passes every unit test that constructs the service directly.
 * Every dependency below is required, and a test over this file's source
 * asserts each one is passed.
 */
export function paymentInitiationService(): PaymentInitiationService {
  const db = getPrismaClient();

  return new PaymentInitiationService(
    new PrismaBookingRepository(db),
    new PrismaPaymentRepository(db),
    // The cipher, and the only place in this flow it appears.
    new PrismaPaymentConfigRepository(db, new WebCryptoCipher()),
    new MercadoPagoGateway(),
    systemClock,
    logger
  );
}
