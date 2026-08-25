import 'server-only';
import { DashboardSummaryService } from '@/server/application/services/DashboardSummaryService';
import { PrismaDashboardSummaryRepository } from '@/server/infrastructure/prisma/PrismaDashboardSummaryRepository';
import { PrismaTransferReceiptRepository } from '@/server/infrastructure/prisma/PrismaTransferReceiptRepository';
import { getPrismaClient } from '@/server/infrastructure/prisma/client';
import { systemClock } from '@/server/domain/repositories/IClock';
import { logger } from '@/server/infrastructure/logger';

/**
 * Composition root for the dashboard home.
 *
 * **The thinnest one in the project, and that is the point.** This page reads
 * and writes nothing else: no cipher, because it never touches a Mercado Pago
 * credential; no storage client, because it signs no file; no Supabase session
 * client, because nothing here is scoped by a bucket policy. The count of
 * surfaces permitted to decrypt a credential is unchanged by this story.
 *
 * The receipt repository is here for **one method** — the pending count, whose
 * predicate belongs to the review queue and must not be restated in the
 * dashboard's own statement.
 */
export function dashboardSummaryService(): DashboardSummaryService {
  const db = getPrismaClient();
  return new DashboardSummaryService(
    new PrismaDashboardSummaryRepository(db),
    new PrismaTransferReceiptRepository(db),
    systemClock,
    logger
  );
}
