import type { Metadata } from 'next';
import { COPY } from '@/lib/copy';

/**
 * A 404 must never be indexed — otherwise a slug change (T33) eventually puts
 * this page into search results under the shop's own name.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/**
 * The public not-found page (B1 design D17).
 *
 * Lives at `app/b/` rather than `app/b/[slug]/` so it covers the **whole**
 * namespace. Under the slug segment it caught `notFound()` from the page but
 * not `/b` itself, which has no `page.tsx` — that fell through to Next's built-in
 * 404 and served a client "This page could not be found", in English, inside an
 * otherwise Spanish product. Trimming a link back to its root is exactly what
 * someone does when a link looks broken.
 *
 * Next resolves the nearest not-found upward, so the page's `notFound()` still
 * lands here.
 *
 * Two things it deliberately does not do:
 *
 * - **It offers no way onward.** A link to `/` would be the dashboard, which
 *   deposits a lost client on a login screen and discloses that an
 *   administrative panel exists behind this namespace.
 * - **It does not say why.** The slug may never have existed, or the owner may
 *   have changed it and stranded this link. The system cannot tell those apart,
 *   so neither can the copy — guessing would be a lie told to the person least
 *   able to check it.
 *
 * What it does instead is give the client the one action that actually works:
 * ask the shop for the current link.
 */
export default function PublicProfileNotFound() {
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-md flex-col items-center justify-center gap-3 px-4 py-24 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">
        {COPY.publicProfile.notFoundHeading}
      </h1>
      <p className="text-muted-foreground">{COPY.publicProfile.notFoundBody}</p>
    </main>
  );
}
