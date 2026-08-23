import type { ReactNode } from 'react';
import Link from 'next/link';
import { requireOwner } from '@/server/infrastructure/supabase/requireOwner';
import { logoutAction } from './actions';
import { COPY } from '@/lib/copy';

// Reads cookies (via requireOwner) and must never be statically cached —
// design D9: protected pages are dynamic and non-cacheable.
export const dynamic = 'force-dynamic';

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const owner = await requireOwner();

  return (
    <div className="flex min-h-full flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <nav className="flex items-center gap-4">
          <Link
            href="/sucursales"
            className="text-sm font-medium underline-offset-4 hover:underline"
          >
            {COPY.locations.nav}
          </Link>
          <Link href="/barberos" className="text-sm font-medium underline-offset-4 hover:underline">
            {COPY.barbers.nav}
          </Link>
          <Link
            href="/servicios"
            className="text-sm font-medium underline-offset-4 hover:underline"
          >
            {COPY.services.nav}
          </Link>
          <Link href="/perfil" className="text-sm font-medium underline-offset-4 hover:underline">
            {COPY.businessProfile.nav}
          </Link>
          <Link
            href="/transferencia"
            className="text-sm font-medium underline-offset-4 hover:underline"
          >
            {COPY.transfer.nav}
          </Link>
          <Link
            href="/mercado-pago"
            className="text-sm font-medium underline-offset-4 hover:underline"
          >
            {COPY.mercadoPago.nav}
          </Link>
          <Link href="/sena" className="text-sm font-medium underline-offset-4 hover:underline">
            {COPY.deposit.nav}
          </Link>
          {/*
            Last, beside the payment configuration it belongs with. No pending
            count on it: D1's dashboard home owns the counters, and a badge here
            would be a second query on every dashboard render for a number that
            page already has to compute.
          */}
          <Link
            href="/comprobantes"
            className="text-sm font-medium underline-offset-4 hover:underline"
          >
            {COPY.receipts.nav}
          </Link>
        </nav>
        <span className="text-muted-foreground text-sm">{owner.email}</span>
        <form action={logoutAction}>
          <button
            type="submit"
            className="text-primary text-sm font-medium underline-offset-4 hover:underline"
          >
            {COPY.auth.logout}
          </button>
        </form>
      </header>
      <div className="flex flex-1 flex-col">{children}</div>
    </div>
  );
}
