'use client';

import { useEffect } from 'react';
import { COPY } from '@/lib/copy';

type ErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

/**
 * Error boundary for the public profile.
 *
 * `app/error.tsx` already exists and would catch this — but it is written for
 * someone who administers the business, and a guest who opened a link from a
 * WhatsApp message needs different words. This boundary is the difference
 * between "no pudimos cargar la página" addressed to an owner mid-task and the
 * same failure explained to a stranger who has no idea what this product is.
 *
 * Renders only generic copy — never the error message, which could carry
 * connection details or a stack trace to someone entirely unknown.
 */
export default function PublicProfileErrorBoundary({ error, reset }: ErrorProps) {
  useEffect(() => {
    // English, via console: a client boundary cannot import the server-only
    // logger. The digest correlates with the server-side entry.
    console.error(
      JSON.stringify({
        level: 'error',
        message: 'Unhandled error reached the public profile boundary',
        digest: error.digest ?? null,
      })
    );
  }, [error]);

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-md flex-col items-center justify-center gap-4 px-4 py-24 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">{COPY.publicProfile.errorHeading}</h1>
      <p className="text-muted-foreground">{COPY.publicProfile.errorBody}</p>
      <button
        type="button"
        onClick={() => reset()}
        className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-4 py-2 text-sm font-medium transition-colors"
      >
        {COPY.publicProfile.retry}
      </button>
    </main>
  );
}
