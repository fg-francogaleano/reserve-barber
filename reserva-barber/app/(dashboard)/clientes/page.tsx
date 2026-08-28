import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { COPY } from '@/lib/copy';
import {
  CLIENTS_PAGE_PARAM,
  clientPageHref,
} from '@/server/application/dashboard/clientPageParams';
import { requireOwner } from '@/server/infrastructure/supabase/requireOwner';
import { logger } from '@/server/infrastructure/logger';
import { toErrorLogContext } from '@/server/infrastructure/errorLogContext';
import type { ClientDirectoryRow } from '@/server/domain/repositories/IClientDirectoryRepository';
import type { ClientDirectoryView } from '@/server/application/services/ClientDirectoryService';
import { clientDirectoryService } from './clientDirectoryService';

/**
 * The owner's client directory (D4).
 *
 * **This is the first surface in the product to render a guest's email address
 * and telephone number**, and everything below follows from that. Never cached
 * and never indexed — a cached render hands one shop's customer database to
 * whoever asks next. Session-guarded in its own right, not only by the
 * middleware and the layout, because the read must never start for a request
 * without a session. Nothing personal in a URL, which is why this table has no
 * search. Nothing personal in a log line, ever.
 *
 * **No client JavaScript.** Every component is a Server Component and the only
 * interactions are links that navigate.
 *
 * **Read-only.** There is no control here to edit or remove a client: T56 is a
 * policy decision — anonymise or delete — that nobody has made, and `Client` is
 * `onDelete: Restrict` from `Booking`, so the row cannot go while the bookings
 * stay.
 */
export const dynamic = 'force-dynamic';

export const metadata = {
  robots: { index: false, follow: false },
};

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ClientsPage({ searchParams }: PageProps) {
  const owner = await requireOwner();
  const raw = await searchParams;

  let view: ClientDirectoryView | null = null;
  try {
    view = await clientDirectoryService().loadPage({
      ownerId: owner.id,
      rawPage: raw[CLIENTS_PAGE_PARAM],
    });
  } catch (error) {
    // An operation name and an error name. Never a client, never the page
    // parameter — this page's whole projection is personal data.
    logger.error('Failed to load clients directory', toErrorLogContext('loadClients', error));
  }

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-12">
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold tracking-tight">{COPY.clients.heading}</h1>
        <p className="text-muted-foreground text-sm">{COPY.clients.intro}</p>
      </header>

      {view === null ? <LoadFailed /> : <Directory view={view} />}
    </main>
  );
}

/**
 * The read failed, and the page says so.
 *
 * **Zero and failure never render alike** (D1's rule). An empty table here
 * would tell an owner that nobody has ever booked with them, which is a false
 * statement about their business rather than a missing one.
 */
function LoadFailed() {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-2 py-8 text-center">
        <p className="text-sm font-medium">{COPY.clients.loadFailed}</p>
        <p className="text-muted-foreground text-sm">{COPY.clients.loadFailedHelp}</p>
      </CardContent>
    </Card>
  );
}

function Directory({ view }: { view: ClientDirectoryView }) {
  if (view.total === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-2 py-8 text-center">
          <p className="text-sm font-medium">{COPY.clients.empty}</p>
          <p className="text-muted-foreground text-sm">{COPY.clients.emptyHint}</p>
          <Link
            href="/perfil"
            className="text-primary text-sm font-medium underline-offset-4 hover:underline"
          >
            {COPY.clients.emptyLink}
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/*
        Below `sm` the same rows render as blocks. Four columns of contact
        details do not fit a phone, and a horizontally scrolling table on the
        surface an owner opens between clients is unusable.
      */}
      <div className="hidden sm:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{COPY.clients.columnName}</TableHead>
              <TableHead>{COPY.clients.columnPhone}</TableHead>
              <TableHead>{COPY.clients.columnEmail}</TableHead>
              <TableHead>{COPY.clients.columnBookings}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {view.rows.map((client) => (
              <TableRow key={client.id}>
                <TableCell className="min-w-0 font-medium break-words">{client.name}</TableCell>
                <TableCell className="min-w-0 break-words">
                  <PhoneLink client={client} />
                </TableCell>
                <TableCell className="min-w-0 break-all">
                  <EmailLink client={client} />
                </TableCell>
                <TableCell>
                  <Bookings client={client} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <ul className="flex flex-col gap-3 sm:hidden">
        {view.rows.map((client) => (
          <li key={client.id}>
            <Card>
              <CardContent className="flex flex-col gap-2 py-4">
                <p className="min-w-0 text-sm font-medium break-words">{client.name}</p>
                <p className="min-w-0 text-sm break-words">
                  <PhoneLink client={client} />
                </p>
                <p className="min-w-0 text-sm break-all">
                  <EmailLink client={client} />
                </p>
                <Bookings client={client} />
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>

      <Paging view={view} />
    </div>
  );
}

/**
 * The two counts, or the fact that there are none.
 *
 * **A zero row is not a customer and the copy does not call them one.** A
 * client record can exist with no booking at all — the booking flow creates it
 * before it writes the booking and outside any shared transaction, so a
 * submission refused by the hold cap leaves one behind. Rendering "0 turnos"
 * beside the others would report a failed checkout as business.
 *
 * The secondary count appears only when it is non-zero, because its entire job
 * is to tell a serial canceller apart from somebody who never booked.
 */
function Bookings({ client }: { client: ClientDirectoryRow }) {
  if (client.confirmedCount === 0 && client.inactiveCount === 0) {
    return (
      <span className="text-muted-foreground text-sm">
        {COPY.clients.noBookings}
        <span className="block text-xs">{COPY.clients.noBookingsHint}</span>
      </span>
    );
  }

  return (
    <span className="text-sm">
      {COPY.clients.confirmedCount(client.confirmedCount)}
      {client.inactiveCount > 0 ? (
        <span className="text-muted-foreground block text-xs">
          {COPY.clients.inactiveCount(client.inactiveCount)}
        </span>
      ) : null}
    </span>
  );
}

function PhoneLink({ client }: { client: ClientDirectoryRow }) {
  return (
    <a
      href={`tel:${client.phone}`}
      aria-label={COPY.clients.callLabel(client.name)}
      className="text-primary underline-offset-4 hover:underline"
    >
      {client.phone}
    </a>
  );
}

function EmailLink({ client }: { client: ClientDirectoryRow }) {
  return (
    <a
      href={`mailto:${client.email}`}
      aria-label={COPY.clients.emailLabel(client.name)}
      className="text-primary underline-offset-4 hover:underline"
    >
      {client.email}
    </a>
  );
}

/**
 * Page links, and where in the list the owner is.
 *
 * `prefetch={false}` for the reason D3's design D12 settled after correcting
 * itself: it saves an RSC payload request per link for a page the owner may
 * never open. **Not** because it saves a database round trip — this route has a
 * `loading.tsx`, where the default prefetch stops, and that claim was measured
 * on a route which does not.
 */
function Paging({ view }: { view: ClientDirectoryView }) {
  if (view.lastPage <= 1) {
    return <p className="text-muted-foreground text-sm">{COPY.clients.totalStatus(view.total)}</p>;
  }

  return (
    <nav className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-muted-foreground text-sm">
        {COPY.clients.pageStatus(view.page, view.lastPage)} · {COPY.clients.totalStatus(view.total)}
      </p>
      <div className="flex gap-2">
        {view.page > 1 ? (
          <Link
            href={clientPageHref(view.page - 1)}
            prefetch={false}
            className="border-input hover:bg-accent hover:text-accent-foreground inline-flex h-10 items-center rounded-md border px-3 text-sm font-medium transition-colors"
          >
            {COPY.clients.previousPage}
          </Link>
        ) : null}
        {view.page < view.lastPage ? (
          <Link
            href={clientPageHref(view.page + 1)}
            prefetch={false}
            className="border-input hover:bg-accent hover:text-accent-foreground inline-flex h-10 items-center rounded-md border px-3 text-sm font-medium transition-colors"
          >
            {COPY.clients.nextPage}
          </Link>
        ) : null}
      </div>
    </nav>
  );
}
