import Link from 'next/link';
import { COPY } from '@/lib/copy';

/**
 * Rendered when a location id resolves to nothing — either because it does not
 * exist or because it belongs to another owner. The two cases are deliberately
 * indistinguishable here: a different answer for the second would confirm the
 * row exists. Without this file the visitor gets Next.js's default English 404
 * inside an otherwise Spanish dashboard.
 */
export default function LocationNotFound() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center gap-4 px-4 py-24 text-center">
      <p className="text-lg">{COPY.locations.notFound}</p>
      <Link href="/sucursales" className="text-primary text-sm font-medium underline-offset-4 hover:underline">
        {COPY.locations.manageHeading}
      </Link>
    </main>
  );
}
