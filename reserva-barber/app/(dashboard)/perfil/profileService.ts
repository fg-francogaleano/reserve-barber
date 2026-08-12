import 'server-only';
import { BusinessProfileService } from '@/server/application/services/BusinessProfileService';
import { PrismaBusinessProfileRepository } from '@/server/infrastructure/prisma/PrismaBusinessProfileRepository';
import { SupabaseImageStorage } from '@/server/infrastructure/storage/SupabaseImageStorage';
import { createSupabaseServerClient } from '@/server/infrastructure/supabase/authClient';
import { getPrismaClient } from '@/server/infrastructure/prisma/client';
import { logger } from '@/server/infrastructure/logger';

/**
 * Composition root for the profile editor.
 *
 * Async, unlike the other feature composers, because the storage adapter needs
 * the **session-bound** Supabase client — the same one the auth layer builds
 * from the request's cookies. That is the whole of design D13: uploads run with
 * the owner's own session and are authorized by the bucket policy, so no
 * service-role credential exists in the application's runtime.
 *
 * Building the client here rather than inside the adapter keeps the adapter
 * unable to construct a privileged one even by accident.
 */
export async function profileService(): Promise<BusinessProfileService> {
  const supabase = await createSupabaseServerClient();

  return new BusinessProfileService(
    new PrismaBusinessProfileRepository(getPrismaClient()),
    new SupabaseImageStorage(supabase),
    logger
  );
}
