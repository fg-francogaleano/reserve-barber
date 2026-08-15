import type { ReactNode } from 'react';

/**
 * The client-facing shell (B1 design D8).
 *
 * Deliberately outside the `(dashboard)` group and deliberately bare: no
 * navigation, no owner email, no logout, and **no route into `/login`**. A guest
 * who opened a link from a WhatsApp message has no business being offered a way
 * into someone else's dashboard, and offering one would disclose that a
 * dashboard exists.
 *
 * This is where B2 hangs the booking wizard.
 */
export default function PublicLayout({ children }: { children: ReactNode }) {
  return <div className="flex min-h-full flex-col">{children}</div>;
}
