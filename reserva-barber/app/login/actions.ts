'use server';

import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { loginSchema } from '@/server/application/auth/loginSchema';
import { getSafeRedirectTarget } from '@/server/application/auth/isSafeRedirect';
import { LoginThrottle } from '@/server/application/auth/loginThrottle';
import { AuthService } from '@/server/application/services/AuthService';
import { SupabaseAuthProvider } from '@/server/infrastructure/supabase/SupabaseAuthProvider';
import { PrismaOwnerRepository } from '@/server/infrastructure/prisma/PrismaOwnerRepository';
import { getPrismaClient } from '@/server/infrastructure/prisma/client';
import { createSupabaseServerClient } from '@/server/infrastructure/supabase/authClient';
import { logger } from '@/server/infrastructure/logger';
import { COPY } from '@/lib/copy';

export type LoginState = { error: string | null };

const DASHBOARD_HOME = '/';

// Per-isolate singleton (design D7): best-effort defense-in-depth, resets per
// isolate — the auth provider's own rate limits are the real backstop.
const throttle = new LoginThrottle();

export async function loginAction(_prevState: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });

  if (!parsed.success) {
    return { error: COPY.auth.credentialsError };
  }

  const { email, password } = parsed.data;
  let target: string;

  try {
    const requestHeaders = await headers();
    // Cloudflare always sets CF-Connecting-IP; X-Forwarded-For is the fallback
    // for other runtimes. Without either, every attempt would share one key.
    const ip =
      requestHeaders.get('cf-connecting-ip') ??
      requestHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      'unknown';

    // Throttled attempts return the credential error, never a distinct
    // "too many attempts" message — that would confirm the email exists.
    if (throttle.isThrottled(email, ip)) {
      logger.error('Login throttled', { operation: 'login', email, ip });
      return { error: COPY.auth.credentialsError };
    }

    const supabase = await createSupabaseServerClient();
    const authService = new AuthService(
      new SupabaseAuthProvider(supabase),
      new PrismaOwnerRepository(getPrismaClient()),
      logger
    );

    const result = await authService.login(email, password);

    if (!result.ok) {
      if (result.reason === 'invalid_credentials') {
        // Only real credential failures count. Counting infrastructure errors
        // would lock the owner out during an auth-provider outage, punishing
        // them for a failure that is not theirs.
        throttle.recordFailure(email, ip);
        return { error: COPY.auth.credentialsError };
      }
      return { error: COPY.auth.infrastructureError };
    }

    throttle.recordSuccess(email, ip);

    const next = formData.get('next');
    target = getSafeRedirectTarget(typeof next === 'string' ? next : null, DASHBOARD_HOME);
  } catch (error) {
    // Last line of defence: anything unforeseen must reach the owner as the
    // generic Spanish message, never as a broken page they can only reload.
    logger.error('Login failed unexpectedly', {
      operation: 'login',
      cause: error instanceof Error ? error.message : String(error),
    });
    return { error: COPY.auth.infrastructureError };
  }

  // Outside the try on purpose: redirect() signals via a thrown value that must
  // reach Next.js, never this action's catch.
  redirect(target);
}
