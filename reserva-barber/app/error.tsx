'use client';

import { useEffect } from 'react';
import { COPY } from '@/lib/copy';

type ErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

/**
 * Root error boundary.
 *
 * A route group's own `error.tsx` wraps the *children* of its layout, not the
 * layout itself — so an error thrown inside `app/(dashboard)/layout.tsx` (which
 * resolves the session on every request) sails straight past it. Without this
 * file it reaches Next.js's built-in page: "A server error occurred", in
 * English, inside an otherwise Spanish product. That is the exact path a
 * database outage takes now that session resolution reports infrastructure
 * failures as errors rather than as logged-out visitors (design D12).
 *
 * Renders only generic copy — never the error message, which could carry
 * connection details or a stack trace.
 */
export default function RootErrorBoundary({ error, reset }: ErrorProps) {
  useEffect(() => {
    // Log in English via console (a client boundary cannot import the
    // server-only logger). The digest correlates with the server-side entry.
    console.error(
      JSON.stringify({
        level: 'error',
        message: 'Unhandled error reached the root boundary',
        digest: error.digest ?? null,
      })
    );
  }, [error]);

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-3xl flex-col items-center justify-center gap-4 px-4 py-24 text-center">
      <p className="text-lg">{COPY.common.error}</p>
      <button
        type="button"
        onClick={() => reset()}
        className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-4 py-2 text-sm font-medium transition-colors"
      >
        {COPY.common.retry}
      </button>
    </main>
  );
}
