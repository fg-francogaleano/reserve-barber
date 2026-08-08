import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveOwnerFromSession } from './requireOwner';
import { Owner } from '@/server/domain/models/Owner';
import type { IOwnerRepository } from '@/server/domain/repositories/IOwnerRepository';
import type { SupabaseClient } from '@supabase/supabase-js';

function buildSupabase(user: { id: string } | null): Pick<SupabaseClient, 'auth'> {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user } }),
    },
  } as unknown as Pick<SupabaseClient, 'auth'>;
}

describe('resolveOwnerFromSession', () => {
  let owners: IOwnerRepository;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should_return_null_when_there_is_no_session', async () => {
    // Arrange
    const supabase = buildSupabase(null);
    owners = { findByAuthUserId: vi.fn(), findByEmail: vi.fn() };

    // Act
    const result = await resolveOwnerFromSession(supabase, owners);

    // Assert
    expect(result).toBeNull();
    expect(owners.findByAuthUserId).not.toHaveBeenCalled();
  });

  it('should_return_null_and_log_when_session_has_no_matching_owner', async () => {
    // Arrange
    const supabase = buildSupabase({ id: 'orphaned-auth-user' });
    owners = { findByAuthUserId: vi.fn().mockResolvedValue(null), findByEmail: vi.fn() };

    // Act
    const result = await resolveOwnerFromSession(supabase, owners);

    // Assert
    expect(result).toBeNull();
    expect(owners.findByAuthUserId).toHaveBeenCalledWith('orphaned-auth-user');
  });

  it('should_return_null_when_getUser_throws_instead_of_resolving', async () => {
    // Arrange — e.g. a stale/invalid refresh token cookie
    const supabase: Pick<SupabaseClient, 'auth'> = {
      auth: {
        getUser: vi.fn().mockRejectedValue(new Error('Invalid Refresh Token: Refresh Token Not Found')),
      },
    } as unknown as Pick<SupabaseClient, 'auth'>;
    owners = { findByAuthUserId: vi.fn(), findByEmail: vi.fn() };

    // Act
    const result = await resolveOwnerFromSession(supabase, owners);

    // Assert
    expect(result).toBeNull();
    expect(owners.findByAuthUserId).not.toHaveBeenCalled();
  });

  it('should_propagate_when_the_owner_repository_throws', async () => {
    // Arrange — e.g. a database query timeout or an unreachable server
    const supabase = buildSupabase({ id: 'auth-user-1' });
    owners = {
      findByAuthUserId: vi.fn().mockRejectedValue(new Error('Query read timeout')),
      findByEmail: vi.fn(),
    };

    // Act & Assert — design D12: not being able to ask the database is not a
    // statement about who the visitor is. Answering `null` here makes
    // requireOwner() redirect to /login, where the middleware still sees a
    // valid Supabase Auth session and redirects back — an infinite loop.
    await expect(resolveOwnerFromSession(supabase, owners)).rejects.toThrow('Query read timeout');
  });

  it('should_keep_denying_a_session_whose_owner_lookup_answers_no_row', async () => {
    // The safety property of D12: the failure path was widened, the denial
    // path was not. A completed lookup returning nothing still denies access.
    const supabase = buildSupabase({ id: 'auth-user-1' });
    owners = { findByAuthUserId: vi.fn().mockResolvedValue(null), findByEmail: vi.fn() };

    await expect(resolveOwnerFromSession(supabase, owners)).resolves.toBeNull();
  });

  it('should_return_the_owner_when_the_session_resolves_to_one', async () => {
    // Arrange
    const owner = new Owner('owner-1', 'owner@example.com', 'auth-user-1');
    const supabase = buildSupabase({ id: 'auth-user-1' });
    owners = { findByAuthUserId: vi.fn().mockResolvedValue(owner), findByEmail: vi.fn() };

    // Act
    const result = await resolveOwnerFromSession(supabase, owners);

    // Assert
    expect(result).toEqual(owner);
  });
});
