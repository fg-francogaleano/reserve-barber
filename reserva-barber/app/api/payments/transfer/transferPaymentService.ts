import 'server-only';
import { TransferPaymentService } from '@/server/application/services/TransferPaymentService';
import { PrismaBookingRepository } from '@/server/infrastructure/prisma/PrismaBookingRepository';
import { PrismaPaymentRepository } from '@/server/infrastructure/prisma/PrismaPaymentRepository';
import { PrismaPaymentConfigRepository } from '@/server/infrastructure/prisma/PrismaPaymentConfigRepository';
import { PrismaTransferReceiptRepository } from '@/server/infrastructure/prisma/PrismaTransferReceiptRepository';
import { SupabaseReceiptStorage } from '@/server/infrastructure/storage/SupabaseReceiptStorage';
import { createSupabaseAnonClient } from '@/server/infrastructure/supabase/anonClient';
import { getPrismaClient } from '@/server/infrastructure/prisma/client';
import { systemClock } from '@/server/domain/repositories/IClock';
import { logger } from '@/server/infrastructure/logger';

/**
 * Composition root for the public bank transfer endpoint.
 *
 * **No cipher, and that is the point worth stating.** B5 made the Mercado Pago
 * initiation one of exactly two surfaces in the public flow permitted to
 * decrypt the access token, and that count does not change here. This path
 * renders a CBU — three plaintext columns nobody encrypts, because they are
 * shown verbatim to every client who chooses transfer — so it builds
 * `PrismaPaymentConfigRepository` **without** a cipher, the way B4's booking
 * write does. `findMercadoPagoAccessToken` would throw here rather than return
 * plaintext, and `findPaymentReadinessForPublic` derives its Mercado Pago
 * boolean in SQL, so no field on the value it returns could hold a credential
 * even if someone wanted it to.
 *
 * **The one sessionless Supabase client in this application is constructed
 * here** (design D1). Every other Supabase call runs as the owner's own
 * session; this caller is a booking guest who has none, and the confinement
 * that `auth.uid()` provides elsewhere is re-derived inside the database by
 * `public.storage_can_accept_receipt()`. `SupabaseReceiptStorage` can only
 * upload — reading and signing live on a separate class that takes the owner's
 * session — so nothing reachable from this route can read a stored receipt.
 *
 * **No optional constructor arguments** (T57). B4's runtime found a repository
 * wired into the write composer and not the read one because an argument was
 * optional, and an omitted optional argument compiles, typechecks and passes
 * every unit test that constructs the service directly.
 */
export function transferPaymentService(): TransferPaymentService {
  const db = getPrismaClient();

  return new TransferPaymentService(
    new PrismaBookingRepository(db),
    new PrismaPaymentRepository(db),
    // Deliberately cipher-less: this path shows a bank account, never a token.
    new PrismaPaymentConfigRepository(db),
    new PrismaTransferReceiptRepository(db),
    new SupabaseReceiptStorage(createSupabaseAnonClient()),
    systemClock,
    logger
  );
}
