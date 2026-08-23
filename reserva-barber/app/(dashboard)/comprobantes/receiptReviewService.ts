import 'server-only';
import { ReceiptReviewService } from '@/server/application/services/ReceiptReviewService';
import { PrismaTransferReceiptRepository } from '@/server/infrastructure/prisma/PrismaTransferReceiptRepository';
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
 */
export async function receiptReviewService(): Promise<ReceiptReviewService> {
  return new ReceiptReviewService(
    new PrismaTransferReceiptRepository(getPrismaClient()),
    new SupabaseOwnerReceiptStorage(await createSupabaseServerClient()),
    systemClock,
    logger
  );
}
