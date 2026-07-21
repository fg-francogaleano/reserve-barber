'use client';

import { useEffect } from 'react';
import { COPY } from '@/lib/copy';

type ErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

/**
 * Route-level error boundary. Renders only generic Spanish copy — never the
 * error message itself, which could contain connection details or stack traces.
 */
export default function ErrorBoundary({ error, reset }: ErrorProps) {
  useEffect(() => {
    // Log in English via console (client boundary cannot import server-only logger).
    // The digest correlates with the server-side structured log entry.
    console.error(
      JSON.stringify({
        level: 'error',
        message: 'Failed to render locations page',
        digest: error.digest ?? null,
      })
    );
  }, [error]);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center gap-4 px-4 py-24 text-center">
      <p className="text-lg">{COPY.locations.error}</p>
      <button
        type="button"
        onClick={() => reset()}
        className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-4 py-2 text-sm font-medium transition-colors"
      >
        {COPY.locations.retry}
      </button>
    </main>
  );
}
