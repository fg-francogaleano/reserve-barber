import type { SupabaseClient } from '@supabase/supabase-js';
import {
  InvalidCredentialsError,
  AuthProviderUnavailableError,
  type IAuthProvider,
  type AuthSignInResult,
} from '@/server/domain/repositories/IAuthProvider';

/** Rejects when `signal` aborts, without cancelling the in-flight `promise`. */
function raceWithSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(new DOMException('Aborted', 'AbortError'));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(new DOMException('Aborted', 'AbortError'));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error as Error);
      }
    );
  });
}

/** Supabase-backed implementation of the auth provider port (design D1/D7). */
export class SupabaseAuthProvider implements IAuthProvider {
  constructor(private readonly client: SupabaseClient) {}

  async signInWithPassword(email: string, password: string, signal: AbortSignal): Promise<AuthSignInResult> {
    let result: Awaited<ReturnType<SupabaseClient['auth']['signInWithPassword']>>;
    try {
      result = await raceWithSignal(this.client.auth.signInWithPassword({ email, password }), signal);
    } catch (error) {
      throw new AuthProviderUnavailableError(error);
    }

    const { data, error } = result;
    if (error) {
      if (error.status === 400 || error.code === 'invalid_credentials') {
        // Supabase reports genuinely different failures under this same code,
        // so pass its message through for the server-side log.
        throw new InvalidCredentialsError(error.message);
      }
      throw new AuthProviderUnavailableError(error);
    }

    return { authUserId: data.user.id };
  }

  async signOut(): Promise<void> {
    const { error } = await this.client.auth.signOut();
    if (error) {
      throw new AuthProviderUnavailableError(error);
    }
  }
}
