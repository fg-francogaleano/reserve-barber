import type { Owner } from '@/server/domain/models/Owner';
import type { IOwnerRepository } from '@/server/domain/repositories/IOwnerRepository';
import { InvalidCredentialsError, type IAuthProvider } from '@/server/domain/repositories/IAuthProvider';
import type { ILogger } from '@/server/domain/repositories/ILogger';
import { systemClock, type IClock } from '@/server/domain/repositories/IClock';

/** Bounded time for every auth provider call (design D7) — no automatic retry on failure. */
export const AUTH_TIMEOUT_MS = 5000;

/**
 * Every login answers no faster than this, so response time reveals nothing
 * about whether an email is registered (design D14). Measured against the live
 * provider: an unknown email answers in ~92ms, a real email with a wrong
 * password in ~170ms — a one-request enumeration oracle without this floor.
 * The value sits comfortably above both.
 */
export const MIN_LOGIN_DURATION_MS = 500;

export type LoginResult =
  | { ok: true; owner: Owner }
  | { ok: false; reason: 'invalid_credentials' | 'infrastructure_error' };

/** Application service orchestrating owner login/logout use cases. */
export class AuthService {
  constructor(
    private readonly authProvider: IAuthProvider,
    private readonly owners: IOwnerRepository,
    private readonly logger: ILogger,
    private readonly clock: IClock = systemClock
  ) {}

  /**
   * Authenticates the owner, padded to a constant floor so that the time taken
   * never distinguishes an unregistered email from a wrong password.
   */
  async login(email: string, password: string): Promise<LoginResult> {
    const startedAt = this.clock.now();
    const result = await this.attemptLogin(email, password);

    const remaining = MIN_LOGIN_DURATION_MS - (this.clock.now() - startedAt);
    if (remaining > 0) {
      await this.clock.sleep(remaining);
    }

    return result;
  }

  private async attemptLogin(email: string, password: string): Promise<LoginResult> {
    const signal = AbortSignal.timeout(AUTH_TIMEOUT_MS);

    let authUserId: string;
    try {
      const result = await this.authProvider.signInWithPassword(email, password, signal);
      authUserId = result.authUserId;
    } catch (error) {
      if (error instanceof InvalidCredentialsError) {
        // Every rejection is logged: it is the audit trail for failed sign-ins,
        // and the provider's detail is what exposes a failure it mislabelled as
        // a credential problem. The password is never included.
        this.logger.warn('Login rejected: invalid credentials', {
          operation: 'login',
          providerDetail: error.providerDetail ?? null,
        });
        return { ok: false, reason: 'invalid_credentials' };
      }
      this.logger.error('Auth provider call failed', {
        operation: 'login',
        cause: error instanceof Error ? error.message : String(error),
      });
      return { ok: false, reason: 'infrastructure_error' };
    }

    let owner: Owner | null;
    try {
      owner = await this.owners.findByAuthUserId(authUserId);
    } catch (error) {
      this.logger.error('Owner lookup failed', {
        operation: 'login',
        cause: error instanceof Error ? error.message : String(error),
      });
      return { ok: false, reason: 'infrastructure_error' };
    }

    if (!owner) {
      this.logger.error('Session has no matching Owner row', { operation: 'login', authUserId });
      return { ok: false, reason: 'invalid_credentials' };
    }

    return { ok: true, owner };
  }

  logout(): Promise<void> {
    return this.authProvider.signOut();
  }
}
