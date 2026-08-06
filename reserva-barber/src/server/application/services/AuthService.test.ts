import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthService, AUTH_TIMEOUT_MS, MIN_LOGIN_DURATION_MS } from './AuthService';
import { Owner } from '@/server/domain/models/Owner';
import {
  InvalidCredentialsError,
  AuthProviderUnavailableError,
  type IAuthProvider,
} from '@/server/domain/repositories/IAuthProvider';
import type { IOwnerRepository } from '@/server/domain/repositories/IOwnerRepository';
import type { ILogger } from '@/server/domain/repositories/ILogger';
import type { IClock } from '@/server/domain/repositories/IClock';

function buildLogger(): ILogger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

/**
 * Virtual clock: `sleep` advances time instantly and records the request, so
 * padding can be asserted without slowing the suite. `elapse` simulates work
 * taking time inside the service.
 */
function buildClock(): IClock & { elapse: (ms: number) => void; slept: number[] } {
  let current = 1_700_000_000_000;
  const slept: number[] = [];
  return {
    now: () => current,
    sleep: (ms: number) => {
      slept.push(ms);
      current += ms;
      return Promise.resolve();
    },
    elapse: (ms: number) => {
      current += ms;
    },
    slept,
  };
}

/** Builds the service with throwaway collaborators — override to assert on them. */
function buildService(
  authProvider: IAuthProvider,
  owners: IOwnerRepository,
  logger: ILogger = buildLogger(),
  clock: IClock = buildClock()
): AuthService {
  return new AuthService(authProvider, owners, logger, clock);
}

describe('AuthService - login', () => {
  let authProvider: IAuthProvider;
  let owners: IOwnerRepository;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should_return_owner_when_credentials_are_valid_and_owner_exists', async () => {
    // Arrange
    const owner = new Owner('owner-1', 'owner@example.com', 'auth-user-1');
    authProvider = {
      signInWithPassword: vi.fn().mockResolvedValue({ authUserId: 'auth-user-1' }),
      signOut: vi.fn(),
    };
    owners = {
      findByAuthUserId: vi.fn().mockResolvedValue(owner),
      findByEmail: vi.fn(),
    };
    const service = buildService(authProvider, owners);

    // Act
    const result = await service.login('owner@example.com', 'correct-password');

    // Assert
    expect(result).toEqual({ ok: true, owner });
    expect(authProvider.signInWithPassword).toHaveBeenCalledWith(
      'owner@example.com',
      'correct-password',
      expect.any(AbortSignal)
    );
  });

  it('should_return_invalid_credentials_when_provider_rejects_credentials', async () => {
    // Arrange
    authProvider = {
      signInWithPassword: vi.fn().mockRejectedValue(new InvalidCredentialsError()),
      signOut: vi.fn(),
    };
    owners = { findByAuthUserId: vi.fn(), findByEmail: vi.fn() };
    const service = buildService(authProvider, owners);

    // Act
    const result = await service.login('unknown@example.com', 'wrong-password');

    // Assert
    expect(result).toEqual({ ok: false, reason: 'invalid_credentials' });
    expect(owners.findByAuthUserId).not.toHaveBeenCalled();
  });

  it('should_return_invalid_credentials_for_unknown_email_identically_to_wrong_password', async () => {
    // Arrange — both failure causes must produce the exact same result shape
    const unknownEmailProvider: IAuthProvider = {
      signInWithPassword: vi.fn().mockRejectedValue(new InvalidCredentialsError()),
      signOut: vi.fn(),
    };
    const wrongPasswordProvider: IAuthProvider = {
      signInWithPassword: vi.fn().mockRejectedValue(new InvalidCredentialsError()),
      signOut: vi.fn(),
    };
    owners = { findByAuthUserId: vi.fn(), findByEmail: vi.fn() };

    // Act
    const unknownEmailResult = await buildService(unknownEmailProvider, owners).login(
      'ghost@example.com',
      'anything'
    );
    const wrongPasswordResult = await buildService(wrongPasswordProvider, owners).login(
      'owner@example.com',
      'wrong'
    );

    // Assert
    expect(unknownEmailResult).toEqual(wrongPasswordResult);
  });

  it('should_return_infrastructure_error_when_provider_is_unavailable', async () => {
    // Arrange
    authProvider = {
      signInWithPassword: vi.fn().mockRejectedValue(new AuthProviderUnavailableError(new Error('503'))),
      signOut: vi.fn(),
    };
    owners = { findByAuthUserId: vi.fn(), findByEmail: vi.fn() };
    const service = buildService(authProvider, owners);

    // Act
    const result = await service.login('owner@example.com', 'correct-password');

    // Assert
    expect(result).toEqual({ ok: false, reason: 'infrastructure_error' });
  });

  it('should_return_infrastructure_error_when_provider_call_times_out', async () => {
    // Arrange — a timeout/abort surfaces as an unavailable provider, not a credential error
    authProvider = {
      signInWithPassword: vi.fn().mockRejectedValue(new AuthProviderUnavailableError(new DOMException('Aborted'))),
      signOut: vi.fn(),
    };
    owners = { findByAuthUserId: vi.fn(), findByEmail: vi.fn() };
    const service = buildService(authProvider, owners);

    // Act
    const result = await service.login('owner@example.com', 'correct-password');

    // Assert
    expect(result).toEqual({ ok: false, reason: 'infrastructure_error' });
  });

  it('should_use_the_configured_timeout_constant', () => {
    expect(AUTH_TIMEOUT_MS).toBe(5000);
  });

  it('should_return_invalid_credentials_when_session_has_no_matching_owner', async () => {
    // Arrange — authUserId resolved by the provider but no domain Owner row matches it
    authProvider = {
      signInWithPassword: vi.fn().mockResolvedValue({ authUserId: 'orphaned-auth-user' }),
      signOut: vi.fn(),
    };
    owners = {
      findByAuthUserId: vi.fn().mockResolvedValue(null),
      findByEmail: vi.fn(),
    };
    const service = buildService(authProvider, owners);

    // Act
    const result = await service.login('owner@example.com', 'correct-password');

    // Assert
    expect(result).toEqual({ ok: false, reason: 'invalid_credentials' });
  });

  it('should_return_infrastructure_error_when_the_owner_lookup_throws', async () => {
    // Arrange — Supabase authenticates successfully, but the subsequent DB
    // lookup fails (e.g. a query timeout) — must not propagate uncaught
    authProvider = {
      signInWithPassword: vi.fn().mockResolvedValue({ authUserId: 'auth-user-1' }),
      signOut: vi.fn(),
    };
    owners = {
      findByAuthUserId: vi.fn().mockRejectedValue(new Error('Query read timeout')),
      findByEmail: vi.fn(),
    };
    const service = buildService(authProvider, owners);

    // Act
    const result = await service.login('owner@example.com', 'correct-password');

    // Assert
    expect(result).toEqual({ ok: false, reason: 'infrastructure_error' });
  });

  it('should_return_infrastructure_error_when_the_owner_lookup_rejects_with_a_non_error_value', async () => {
    // Arrange — defensive path: some rejection is not an Error instance
    authProvider = {
      signInWithPassword: vi.fn().mockResolvedValue({ authUserId: 'auth-user-1' }),
      signOut: vi.fn(),
    };
    owners = {
      findByAuthUserId: vi.fn().mockRejectedValue('unexpected string rejection'),
      findByEmail: vi.fn(),
    };
    const service = buildService(authProvider, owners);

    // Act
    const result = await service.login('owner@example.com', 'correct-password');

    // Assert
    expect(result).toEqual({ ok: false, reason: 'infrastructure_error' });
  });

  it('should_log_the_provider_detail_when_credentials_are_rejected', async () => {
    // Arrange — Supabase reports unrelated failures under the same code, so the
    // detail must reach the log even though the user sees the generic message
    const logger = buildLogger();
    authProvider = {
      signInWithPassword: vi.fn().mockRejectedValue(new InvalidCredentialsError('unsupported_grant_type')),
      signOut: vi.fn(),
    };
    owners = { findByAuthUserId: vi.fn(), findByEmail: vi.fn() };
    const service = buildService(authProvider, owners, logger);

    // Act
    const result = await service.login('owner@example.com', 'super-secret-password');

    // Assert
    expect(result).toEqual({ ok: false, reason: 'invalid_credentials' });
    expect(logger.warn).toHaveBeenCalledWith(
      'Login rejected: invalid credentials',
      expect.objectContaining({ operation: 'login', providerDetail: 'unsupported_grant_type' })
    );
    expect(JSON.stringify(vi.mocked(logger.warn).mock.calls)).not.toContain('super-secret-password');
  });

  it('should_emit_a_structured_english_error_log_when_the_provider_is_unavailable', async () => {
    // Arrange — the spec requires one structured English error log on infra failure,
    // and it must never carry the password
    const logger = buildLogger();
    authProvider = {
      signInWithPassword: vi.fn().mockRejectedValue(new AuthProviderUnavailableError(new Error('503'))),
      signOut: vi.fn(),
    };
    owners = { findByAuthUserId: vi.fn(), findByEmail: vi.fn() };
    const service = buildService(authProvider, owners, logger);

    // Act
    await service.login('owner@example.com', 'super-secret-password');

    // Assert
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      'Auth provider call failed',
      expect.objectContaining({ operation: 'login' })
    );
    expect(JSON.stringify(vi.mocked(logger.error).mock.calls)).not.toContain('super-secret-password');
  });

  it('should_return_infrastructure_error_when_provider_rejects_with_a_non_error_value', async () => {
    // Arrange — defensive path: some rejection is not an Error instance
    authProvider = {
      signInWithPassword: vi.fn().mockRejectedValue('unexpected string rejection'),
      signOut: vi.fn(),
    };
    owners = { findByAuthUserId: vi.fn(), findByEmail: vi.fn() };
    const service = buildService(authProvider, owners);

    // Act
    const result = await service.login('owner@example.com', 'correct-password');

    // Assert
    expect(result).toEqual({ ok: false, reason: 'infrastructure_error' });
  });

  it('should_not_retry_automatically_on_infrastructure_failure', async () => {
    // Arrange
    authProvider = {
      signInWithPassword: vi.fn().mockRejectedValue(new AuthProviderUnavailableError(new Error('timeout'))),
      signOut: vi.fn(),
    };
    owners = { findByAuthUserId: vi.fn(), findByEmail: vi.fn() };
    const service = buildService(authProvider, owners);

    // Act
    await service.login('owner@example.com', 'correct-password');

    // Assert
    expect(authProvider.signInWithPassword).toHaveBeenCalledTimes(1);
  });
});

describe('AuthService - constant-time padding (anti-enumeration)', () => {
  /**
   * Measured against the live provider: an unknown email answers in ~92ms
   * while a real email with a wrong password takes ~170ms, because only the
   * latter runs a password comparison. Padding both to a fixed floor removes
   * that oracle.
   */
  function loginWithProviderCost(costMs: number, error: Error) {
    const clock = buildClock();
    const authProvider: IAuthProvider = {
      signInWithPassword: vi.fn().mockImplementation(() => {
        clock.elapse(costMs);
        return Promise.reject(error);
      }),
      signOut: vi.fn(),
    };
    const owners: IOwnerRepository = { findByAuthUserId: vi.fn(), findByEmail: vi.fn() };
    const started = clock.now();
    const service = buildService(authProvider, owners, buildLogger(), clock);
    return { clock, service, started };
  }

  it('should_take_the_same_total_time_for_unknown_email_and_wrong_password', async () => {
    // Arrange — the provider answers fast for an unknown email, slow for a real one
    const unknownEmail = loginWithProviderCost(92, new InvalidCredentialsError());
    const wrongPassword = loginWithProviderCost(170, new InvalidCredentialsError());

    // Act
    await unknownEmail.service.login('ghost@example.com', 'x');
    await wrongPassword.service.login('owner@example.com', 'x');

    // Assert — both observable durations collapse onto the same floor
    const unknownTotal = unknownEmail.clock.now() - unknownEmail.started;
    const wrongTotal = wrongPassword.clock.now() - wrongPassword.started;
    expect(unknownTotal).toBe(MIN_LOGIN_DURATION_MS);
    expect(wrongTotal).toBe(MIN_LOGIN_DURATION_MS);
    expect(unknownTotal).toBe(wrongTotal);
  });

  it('should_pad_by_exactly_the_remaining_time', async () => {
    // Arrange
    const { clock, service } = loginWithProviderCost(120, new InvalidCredentialsError());

    // Act
    await service.login('owner@example.com', 'x');

    // Assert
    expect(clock.slept).toEqual([MIN_LOGIN_DURATION_MS - 120]);
  });

  it('should_not_pad_when_the_work_already_exceeded_the_floor', async () => {
    // Arrange — a slow path must not be delayed further
    const overshoot = MIN_LOGIN_DURATION_MS + 250;
    const { clock, service, started } = loginWithProviderCost(
      overshoot,
      new AuthProviderUnavailableError(new Error('slow'))
    );

    // Act
    await service.login('owner@example.com', 'x');

    // Assert
    expect(clock.slept).toEqual([]);
    expect(clock.now() - started).toBe(overshoot);
  });

  it('should_pad_successful_logins_too', async () => {
    // Arrange
    const clock = buildClock();
    const owner = new Owner('owner-1', 'owner@example.com', 'auth-user-1');
    const authProvider: IAuthProvider = {
      signInWithPassword: vi.fn().mockImplementation(() => {
        clock.elapse(150);
        return Promise.resolve({ authUserId: 'auth-user-1' });
      }),
      signOut: vi.fn(),
    };
    const owners: IOwnerRepository = {
      findByAuthUserId: vi.fn().mockResolvedValue(owner),
      findByEmail: vi.fn(),
    };
    const started = clock.now();
    const service = buildService(authProvider, owners, buildLogger(), clock);

    // Act
    const result = await service.login('owner@example.com', 'correct');

    // Assert
    expect(result).toEqual({ ok: true, owner });
    expect(clock.now() - started).toBe(MIN_LOGIN_DURATION_MS);
  });
});

describe('AuthService - logout', () => {
  it('should_call_signOut_on_the_auth_provider', async () => {
    // Arrange
    const authProvider: IAuthProvider = {
      signInWithPassword: vi.fn(),
      signOut: vi.fn().mockResolvedValue(undefined),
    };
    const owners: IOwnerRepository = { findByAuthUserId: vi.fn(), findByEmail: vi.fn() };
    const service = buildService(authProvider, owners);

    // Act
    await service.logout();

    // Assert
    expect(authProvider.signOut).toHaveBeenCalledTimes(1);
  });
});
