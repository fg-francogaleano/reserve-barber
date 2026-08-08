import { describe, it, expect, vi } from 'vitest';
import { SupabaseAuthProvider } from './SupabaseAuthProvider';
import { InvalidCredentialsError, AuthProviderUnavailableError } from '@/server/domain/repositories/IAuthProvider';
import type { SupabaseClient } from '@supabase/supabase-js';

function buildClient(overrides: {
  signInWithPassword?: ReturnType<typeof vi.fn>;
  signOut?: ReturnType<typeof vi.fn>;
}): SupabaseClient {
  return {
    auth: {
      signInWithPassword: overrides.signInWithPassword ?? vi.fn(),
      signOut: overrides.signOut ?? vi.fn(),
    },
  } as unknown as SupabaseClient;
}

describe('SupabaseAuthProvider - signInWithPassword', () => {
  it('should_return_the_authUserId_on_success', async () => {
    // Arrange
    const client = buildClient({
      signInWithPassword: vi.fn().mockResolvedValue({ data: { user: { id: 'auth-user-1' } }, error: null }),
    });
    const provider = new SupabaseAuthProvider(client);

    // Act
    const result = await provider.signInWithPassword('owner@example.com', 'pw', AbortSignal.timeout(5000));

    // Assert
    expect(result).toEqual({ authUserId: 'auth-user-1' });
  });

  it('should_throw_invalid_credentials_for_a_400_error', async () => {
    // Arrange
    const client = buildClient({
      signInWithPassword: vi.fn().mockResolvedValue({ data: { user: null }, error: { status: 400, message: 'x' } }),
    });
    const provider = new SupabaseAuthProvider(client);

    // Act & Assert
    await expect(
      provider.signInWithPassword('owner@example.com', 'wrong', AbortSignal.timeout(5000))
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it('should_throw_provider_unavailable_for_a_server_error', async () => {
    // Arrange
    const client = buildClient({
      signInWithPassword: vi.fn().mockResolvedValue({ data: { user: null }, error: { status: 503, message: 'x' } }),
    });
    const provider = new SupabaseAuthProvider(client);

    // Act & Assert
    await expect(
      provider.signInWithPassword('owner@example.com', 'pw', AbortSignal.timeout(5000))
    ).rejects.toBeInstanceOf(AuthProviderUnavailableError);
  });

  it('should_throw_provider_unavailable_when_the_call_rejects', async () => {
    // Arrange
    const client = buildClient({
      signInWithPassword: vi.fn().mockRejectedValue(new Error('network down')),
    });
    const provider = new SupabaseAuthProvider(client);

    // Act & Assert
    await expect(
      provider.signInWithPassword('owner@example.com', 'pw', AbortSignal.timeout(5000))
    ).rejects.toBeInstanceOf(AuthProviderUnavailableError);
  });

  it('should_throw_provider_unavailable_when_the_signal_is_already_aborted', async () => {
    // Arrange
    const client = buildClient({
      signInWithPassword: vi.fn().mockResolvedValue({ data: { user: { id: 'auth-user-1' } }, error: null }),
    });
    const provider = new SupabaseAuthProvider(client);
    const controller = new AbortController();
    controller.abort();

    // Act & Assert
    await expect(
      provider.signInWithPassword('owner@example.com', 'pw', controller.signal)
    ).rejects.toBeInstanceOf(AuthProviderUnavailableError);
  });
});

describe('SupabaseAuthProvider - signOut', () => {
  it('should_resolve_on_success', async () => {
    // Arrange
    const client = buildClient({ signOut: vi.fn().mockResolvedValue({ error: null }) });
    const provider = new SupabaseAuthProvider(client);

    // Act & Assert
    await expect(provider.signOut()).resolves.toBeUndefined();
  });

  it('should_throw_provider_unavailable_on_error', async () => {
    // Arrange
    const client = buildClient({ signOut: vi.fn().mockResolvedValue({ error: { message: 'x' } }) });
    const provider = new SupabaseAuthProvider(client);

    // Act & Assert
    await expect(provider.signOut()).rejects.toBeInstanceOf(AuthProviderUnavailableError);
  });
});
