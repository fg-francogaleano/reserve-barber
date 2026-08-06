/**
 * Thrown when credentials are rejected by the auth provider (unknown email or
 * wrong password).
 *
 * `providerDetail` carries the provider's own message for the server-side log
 * only — never the response. Supabase labels unrelated failures with the same
 * `invalid_credentials` code (a malformed request and an unsupported grant type
 * both report it), so this detail is the only way an anomaly stays observable.
 */
export class InvalidCredentialsError extends Error {
  constructor(public readonly providerDetail?: string) {
    super('Invalid credentials');
    this.name = 'InvalidCredentialsError';
  }
}

/** Thrown when the auth provider is unreachable, errors, or the call times out. */
export class AuthProviderUnavailableError extends Error {
  constructor(cause: unknown) {
    super('Auth provider unavailable');
    this.name = 'AuthProviderUnavailableError';
    this.cause = cause;
  }
}

export interface AuthSignInResult {
  authUserId: string;
}

/**
 * Port over the external authentication system (Supabase Auth).
 * Implementations MUST honor the abort signal so a hung provider degrades
 * within the caller's configured timeout instead of hanging the Worker.
 */
export interface IAuthProvider {
  signInWithPassword(email: string, password: string, signal: AbortSignal): Promise<AuthSignInResult>;
  signOut(): Promise<void>;
}
