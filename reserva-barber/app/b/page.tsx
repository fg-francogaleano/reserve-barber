import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';

/**
 * The public namespace has no page of its own — `/b` addresses no barbershop.
 *
 * This file exists so that saying so is *this product's* 404 rather than the
 * framework's. Without a `page.tsx` here, Next answers `/b` with its built-in
 * error page: "404: This page could not be found", in English, to a client of a
 * Spanish product. A segment's `not-found.tsx` is only reached when something
 * inside it raises, so nothing but a page can route this case to ours.
 *
 * Trimming a link back to its root is exactly what someone does when a link
 * looks broken, which makes this a likelier arrival than it appears.
 */
export default function PublicNamespaceRoot() {
  notFound();
}
