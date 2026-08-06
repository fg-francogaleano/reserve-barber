'use server';

import { redirect } from 'next/navigation';
import { requireOwner, LOGIN_PATH } from '@/server/infrastructure/supabase/requireOwner';
import { AuthService } from '@/server/application/services/AuthService';
import { SupabaseAuthProvider } from '@/server/infrastructure/supabase/SupabaseAuthProvider';
import { PrismaOwnerRepository } from '@/server/infrastructure/prisma/PrismaOwnerRepository';
import { getPrismaClient } from '@/server/infrastructure/prisma/client';
import { createSupabaseServerClient, clearSessionCookies } from '@/server/infrastructure/supabase/authClient';
import { logger } from '@/server/infrastructure/logger';

export async function logoutAction(): Promise<void> {
  await requireOwner(); // re-check per design D3 — no anonymous logout side effects

  try {
    const supabase = await createSupabaseServerClient();
    const authService = new AuthService(
      new SupabaseAuthProvider(supabase),
      new PrismaOwnerRepository(getPrismaClient()),
      logger
    );
    await authService.logout();
  } catch (error) {
    // Signing out must never strand the owner on an error screen. The provider
    // answers 403 `bad_jwt` once the access token has expired — exactly the
    // moment someone is most likely to be clicking "log out". Log it and carry
    // on; the cookie clear below still ends the session locally.
    logger.error('Sign-out at the provider failed; clearing the session anyway', {
      operation: 'logout',
      cause: error instanceof Error ? error.message : String(error),
    });
  }

  await clearSessionCookies();

  // Outside the try on purpose: redirect() signals via a thrown value that must
  // reach Next.js, never this action's catch.
  redirect(LOGIN_PATH);
}
