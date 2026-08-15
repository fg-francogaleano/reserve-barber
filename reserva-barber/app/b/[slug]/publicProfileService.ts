import 'server-only';
import { PublicProfileService } from '@/server/application/services/PublicProfileService';
import { PrismaBusinessProfileRepository } from '@/server/infrastructure/prisma/PrismaBusinessProfileRepository';
import { getPrismaClient } from '@/server/infrastructure/prisma/client';
import { logger } from '@/server/infrastructure/logger';

/**
 * Composition root for the public profile page.
 *
 * Synchronous, unlike `profileService()` — and the reason is the whole point of
 * this route. That composer is async because it builds a **session-bound**
 * Supabase client for uploads; here there is no session to bind to, and nothing
 * on this page writes.
 *
 * Note what is absent and must stay absent: no Supabase client, no cipher, and
 * **no `PaymentConfig` repository** (design D11). That row holds the encrypted
 * Mercado Pago access token. A page anonymous visitors open should have no
 * relationship with it, and the cheapest way to guarantee that is for the
 * composer never to hand one over.
 */
export function publicProfileService(): PublicProfileService {
  return new PublicProfileService(new PrismaBusinessProfileRepository(getPrismaClient()), logger);
}
