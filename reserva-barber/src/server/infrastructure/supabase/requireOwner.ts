import { cache } from 'react';
import { redirect } from 'next/navigation';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Owner } from '@/server/domain/models/Owner';
import type { IOwnerRepository } from '@/server/domain/repositories/IOwnerRepository';
import { createSupabaseServerClient } from '@/server/infrastructure/supabase/authClient';
import { PrismaOwnerRepository } from '@/server/infrastructure/prisma/PrismaOwnerRepository';
import { getPrismaClient } from '@/server/infrastructure/prisma/client';
import { logger } from '@/server/infrastructure/logger';

export const LOGIN_PATH = '/login';

/**
 * Pure session → domain Owner resolver (design D3/D4). Returns `null` when
 * there is no session, or when the session's `authUserId` has no matching
 * `Owner` row — both are treated as unauthenticated.
 */
export async function resolveOwnerFromSession(
  supabase: Pick<SupabaseClient, 'auth'>,
  owners: IOwnerRepository
): Promise<Owner | null> {
  let user: { id: string } | null;
  try {
    const result = await supabase.auth.getUser();
    user = result.data.user;
  } catch (error) {
    // A stale/invalid refresh token (e.g. a leftover cookie from an earlier
    // session) throws instead of resolving — fail closed, never crash the
    // request pipeline over it.
    logger.error('Failed to resolve auth session', {
      operation: 'requireOwner',
      cause: error instanceof Error ? error.message : String(error),
    });
    return null;
  }

  if (!user) {
    return null;
  }

  let owner: Owner | null;
  try {
    owner = await owners.findByAuthUserId(user.id);
  } catch (error) {
    logger.error('Failed to resolve owner from repository', {
      operation: 'requireOwner',
      cause: error instanceof Error ? error.message : String(error),
    });
    return null;
  }

  if (!owner) {
    logger.error('Session has no matching Owner row', {
      operation: 'requireOwner',
      authUserId: user.id,
    });
    return null;
  }

  return owner;
}

/**
 * Framework-bound entry point used by every protected page, layout, and
 * server action (design D3). Cached per request so repeated calls within
 * the same render/action don't re-resolve the session.
 */
export const requireOwner = cache(async (): Promise<Owner> => {
  const supabase = await createSupabaseServerClient();
  const owners = new PrismaOwnerRepository(getPrismaClient());
  const owner = await resolveOwnerFromSession(supabase, owners);

  if (!owner) {
    redirect(LOGIN_PATH);
  }

  return owner;
});
