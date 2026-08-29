import 'server-only';
import { StatisticsService } from '@/server/application/services/StatisticsService';
import { PrismaStatisticsRepository } from '@/server/infrastructure/prisma/PrismaStatisticsRepository';
import { getPrismaClient } from '@/server/infrastructure/prisma/client';
import { systemClock } from '@/server/domain/repositories/IClock';
import { logger } from '@/server/infrastructure/logger';

/**
 * Composition root for the statistics page.
 *
 * **Three collaborators, and the clock is the one that earns its place.** Every
 * period this page reports on is a business-local calendar boundary, so what day
 * it is decides what the figures cover — and it must be *asked* rather than
 * read, which is what makes the timezone behaviour testable at all.
 *
 * No cipher, because nothing here touches a Mercado Pago credential; no storage
 * client, because nothing signs a file; no Supabase session client, because
 * nothing is scoped by a bucket policy; no mail sender and no booking or client
 * repository, because this story has no write path at all. The count of
 * surfaces permitted to decrypt a credential is unchanged by D5, and every claim
 * in this comment is asserted by a test over this file's source.
 *
 * The logger **is** wired into the service here, unlike D4's root. The
 * difference is what the two can log: D4's projection is a stranger's name,
 * email address and telephone number, so the logger stayed with the page. This
 * projection is five integers and a decimal, and the service is the layer that
 * knows a read failed.
 */
export function statisticsService(): StatisticsService {
  return new StatisticsService(
    new PrismaStatisticsRepository(getPrismaClient()),
    systemClock,
    logger
  );
}
