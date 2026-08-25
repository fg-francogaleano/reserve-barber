import Link from 'next/link';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { COPY } from '@/lib/copy';
import { formatCurrency } from '@/lib/formatCurrency';
import { formatBookingDateLong } from '@/lib/formatBookingDate';
import { businessToday, formatSlotTime } from '@/server/domain/models/bookingCalendar';
import { RECENT_FILTER_PARAM } from '@/server/application/dashboard/recentBookingsParams';
import type { RecentBooking } from '@/server/domain/models/dashboardSummary';
import type { DashboardHomeView } from '@/server/application/services/DashboardSummaryService';
import { requireOwner } from '@/server/infrastructure/supabase/requireOwner';
import { dashboardSummaryService } from './dashboardSummaryService';
import { RecentBookingsFilter } from './RecentBookingsFilter';

/**
 * The owner's summary of their business.
 *
 * **Never cached and never indexed.** It reads a session and names clients, so
 * a cached render would hand one owner's figures to whoever asked next — the
 * same reason the receipt queue carries both.
 *
 * **No client JavaScript.** Every component here is a Server Component and the
 * one interaction is a GET form that navigates. All `Intl` formatting happens
 * on the server: formatting a currency string on both sides of the render
 * boundary is how a hydration mismatch on money happens.
 */
export const dynamic = 'force-dynamic';

export const metadata = {
  robots: { index: false, follow: false },
};

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function DashboardHome({ searchParams }: PageProps) {
  // Guarded in its own right, not only by the middleware and the layout: this
  // page reads the database, and that read must never start for a request
  // without a session. `requireOwner()` is request-cached, so it costs nothing.
  const owner = await requireOwner();

  const raw = await searchParams;
  const view = await dashboardSummaryService().loadHome({
    ownerId: owner.id,
    rawBarberFilter: raw[RECENT_FILTER_PARAM],
  });

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-4 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">{COPY.dashboard.heading}</h1>

      <Counters summary={view.summary} />

      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h2 className="text-xl font-semibold tracking-tight">{COPY.dashboard.recentHeading}</h2>
          <RecentBookingsFilter barbers={view.barbers} selectedBarberId={view.selectedBarberId} />
        </div>

        <RecentList view={view} />
      </section>
    </main>
  );
}

/**
 * The six figures, or the fact that they could not be read.
 *
 * **Zero and failure are different states and never render alike.** A counter
 * that defaulted to `0` on a failed read would make an income card silently
 * say `$ 0,00`, which is a false statement about money and indistinguishable
 * from a shop that earned nothing.
 */
function Counters({ summary }: { summary: DashboardHomeView['summary'] }) {
  if (!summary.ok) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <p className="text-muted-foreground text-sm">{COPY.dashboard.countersFailed}</p>
        </CardContent>
      </Card>
    );
  }

  const figures = summary.value;

  return (
    <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <Counter label={COPY.dashboard.confirmedToday} value={String(figures.confirmedToday)}>
        {/*
          A separate number from the one above it, never summed into it. The two
          answer different questions — who is being served today, and what is
          still in flight — and together they are the product's only diagnosis
          of a broken checkout: a large second figure over a zero first one.
        */}
        {figures.heldToday > 0 ? (
          <span className="text-muted-foreground text-xs">
            {COPY.dashboard.heldToday(figures.heldToday)} · {COPY.dashboard.heldTodayHelp}
          </span>
        ) : null}
      </Counter>

      <Counter label={COPY.dashboard.cancelledToday} value={String(figures.cancelledToday)} />
      <Counter label={COPY.dashboard.confirmedAllTime} value={String(figures.confirmedAllTime)} />
      <Counter label={COPY.dashboard.pendingReceipts} value={String(figures.pendingReceipts)} />

      <Counter
        label={COPY.dashboard.monthIncome}
        value={formatCurrency(figures.monthDepositIncome)}
      >
        <span className="text-muted-foreground text-xs">{COPY.dashboard.monthIncomeHelp}</span>
      </Counter>
    </dl>
  );
}

function Counter({
  label,
  value,
  children,
}: {
  label: string;
  value: string;
  children?: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        {/*
          A plain `dt` rather than `CardTitle`: this grid is a description list,
          so the label has to be the term element for the value to be its
          definition. `CardTitle` renders a div and does not forward its element.
        */}
        <dt className="text-muted-foreground text-sm font-medium break-words">{label}</dt>
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        <dd className="text-2xl font-semibold break-words">{value}</dd>
        {children}
      </CardContent>
    </Card>
  );
}

function RecentList({ view }: { view: DashboardHomeView }) {
  if (!view.recent.ok) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <p className="text-muted-foreground text-sm">{COPY.dashboard.recentFailed}</p>
        </CardContent>
      </Card>
    );
  }

  const bookings = view.recent.value;

  if (bookings.length === 0) {
    const selected = view.barbers.find((barber) => barber.id === view.selectedBarberId);

    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-2 py-8 text-center">
          {selected === undefined ? (
            <>
              <p className="text-sm font-medium">{COPY.dashboard.recentEmpty}</p>
              <p className="text-muted-foreground text-sm">{COPY.dashboard.recentEmptyHelp}</p>
              <Link
                href="/perfil"
                className="text-primary text-sm font-medium underline-offset-4 hover:underline"
              >
                {COPY.dashboard.recentEmptyLink}
              </Link>
            </>
          ) : (
            <>
              {/*
                Named, and with the way back. A filtered-empty state that looks
                like a global-empty state reads as a broken dashboard.
              */}
              <p className="text-sm font-medium">
                {COPY.dashboard.recentEmptyFiltered(selected.displayName)}
              </p>
              <Link
                href="/"
                className="text-primary text-sm font-medium underline-offset-4 hover:underline"
              >
                {COPY.dashboard.clearFilter}
              </Link>
            </>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {bookings.map((booking) => (
        <li key={booking.id}>
          <RecentRow booking={booking} />
        </li>
      ))}
    </ul>
  );
}

function RecentRow({ booking }: { booking: RecentBooking }) {
  return (
    <Card>
      <CardContent className="flex flex-wrap items-start justify-between gap-3 py-4">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-sm font-medium break-words">
            {formatBookingDateLong(businessToday(booking.startTime))} ·{' '}
            {formatSlotTime(booking.startTime)}
          </p>
          <p className="text-muted-foreground text-sm break-words">
            {booking.serviceName} · {booking.barberDisplayName}
          </p>
          <p className="text-muted-foreground text-sm break-words">
            {COPY.dashboard.clientLabel}: {booking.clientName}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <StatusBadge status={booking.status} />
          <span className="text-muted-foreground text-sm">
            {COPY.dashboard.depositLabel} {formatCurrency(booking.depositAmount)}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * The five statuses, visually distinguishable.
 *
 * `CANCELLED` and `EXPIRED` must not look alike: one is a decision somebody
 * made and the other is a deadline that passed, and telling them apart is the
 * entire reason this product has two statuses. This list is the first surface
 * in the product where an owner sees either.
 *
 * Sober and bordered rather than five saturated fills — the palette carries the
 * distinction, not the volume.
 */
const STATUS_STYLE: Record<RecentBooking['status'], string> = {
  CONFIRMED: 'border-emerald-600/40 text-emerald-700 dark:text-emerald-400',
  PENDING_PAYMENT: 'border-amber-600/40 text-amber-700 dark:text-amber-400',
  PENDING_APPROVAL: 'border-sky-600/40 text-sky-700 dark:text-sky-400',
  CANCELLED: 'border-destructive/40 text-destructive',
  EXPIRED: 'border-muted-foreground/40 text-muted-foreground',
};

function StatusBadge({ status }: { status: RecentBooking['status'] }) {
  return (
    <span
      className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLE[status]}`}
    >
      {COPY.dashboard.status[status]}
    </span>
  );
}
