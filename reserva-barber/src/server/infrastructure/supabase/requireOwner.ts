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
 *
 * It **throws** when the owner lookup could not be performed at all (design
 * D12 of the M1 change). Not being able to reach the database is not a
 * statement about who the visitor is, and reporting it as "unauthenticated"
 * traps them: `requireOwner()` would redirect to `/login`, where the
 * middleware — which consults Supabase Auth, still up, still holding a valid
 * session — redirects them straight back. That loop ends in a browser
 * redirect-limit page instead of the Spanish error state. Letting the failure
 * propagate lets the route's error boundary do its job.
 *
 * The asymmetry is safe in one direction only: this can turn a redirect into
 * an error, never a denial into access.
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
    // Rethrown, not swallowed — see the note above. The caller's error
    // boundary renders the generic Spanish message; the cause stays in the log.
    throw error;
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
