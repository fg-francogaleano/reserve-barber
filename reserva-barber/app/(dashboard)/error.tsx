'use client';

import { useEffect } from 'react';
import { COPY } from '@/lib/copy';

type ErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

/**
 * Error boundary for the dashboard's pages.
 *
 * The copy is deliberately generic: this boundary covers **every** route in the
 * group, so naming one of them would be wrong everywhere else — it used to say
 * "no pudimos cargar las sucursales" and would have said that on `/servicios`
 * too. It sits below the dashboard layout, which means the shell (header,
 * navigation, sign-out) survives the error; a failure thrown by the layout
 * itself — session resolution, for instance — is caught by `app/error.tsx`
 * instead, since a boundary never catches its own layout.
 *
 * Renders only generic Spanish copy — never the error message itself, which
 * could contain connection details or stack traces.
 */
export default function ErrorBoundary({ error, reset }: ErrorProps) {
  useEffect(() => {
    // Log in English via console (client boundary cannot import server-only logger).
    // The digest correlates with the server-side structured log entry.
    console.error(
      JSON.stringify({
        level: 'error',
        message: 'Failed to render a dashboard page',
        digest: error.digest ?? null,
      })
    );
  }, [error]);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center gap-4 px-4 py-24 text-center">
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
