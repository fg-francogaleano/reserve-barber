import Link from 'next/link';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { COPY } from '@/lib/copy';
import { formatCurrency } from '@/lib/formatCurrency';
import { averageDepositPerBooking } from '@/server/domain/models/statistics';
import { businessToday } from '@/server/domain/models/bookingCalendar';
import {
  resolveStatisticsRange,
  statisticsRangeHref,
  STATS_RANGE_PARAM,
} from '@/server/application/dashboard/statisticsRangeParams';
import { requireOwner } from '@/server/infrastructure/supabase/requireOwner';
import { logger } from '@/server/infrastructure/logger';
import { toErrorLogContext } from '@/server/infrastructure/errorLogContext';
import type { StatisticsView } from '@/server/application/services/StatisticsService';
import { RangeNav } from './RangeNav';
import { statisticsService } from './statisticsService';

/**
 * The owner's measurement of their business over a period they choose (D5).
 *
 * **Never cached and never indexed.** It reads a session and reports a shop's
 * revenue; a cached render would hand one owner's figures to whoever asked next
 * — the same reason D1's home and D4's directory both carry these.
 *
 * **No client JavaScript, and this page can genuinely keep that promise.** Every
 * component here is a Server Component and the only interactions are links that
 * navigate — unlike every dashboard *form*, which T44 records as unable to. All
 * `Intl` formatting happens on the server: formatting a currency string on both
 * sides of the render boundary is how a hydration mismatch on money happens.
 *
 * **Read-only.** There is no control here that writes anything.
 */
export const dynamic = 'force-dynamic';

export const metadata = {
  robots: { index: false, follow: false },
};

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function StatisticsPage({ searchParams }: PageProps) {
  // Guarded in its own right, not only by the middleware and the layout: this
  // page reads the database, and that read must never start for a request
  // without a session. `requireOwner()` is request-cached, so it costs nothing.
  const owner = await requireOwner();
  const raw = await searchParams;
  const range = resolveStatisticsRange(raw[STATS_RANGE_PARAM]);

  let view: StatisticsView;
  try {
    view = await statisticsService().loadPage({
      ownerId: owner.id,
      rawRange: raw[STATS_RANGE_PARAM],
    });
  } catch (error) {
    // **The service already catches the read**, and returns `{ ok: false }`
    // rather than throwing. This guards the thin ring around it — resolving the
    // period, and building the composition root — which is where a failure
    // would otherwise escape to the route's error boundary and replace a page
    // that could have said "no pudimos cargar tus estadísticas" with a generic
    // one. D4's page carries the same guard for the same reason.
    //
    // The fallback is built from the period resolved above, so the control
    // keeps its selection through the failure: an owner who cannot tell which
    // period failed has been told less than nothing.
    logger.error('Failed to load statistics', toErrorLogContext('loadStatistics', error));
    view = { range, today: businessToday(new Date()), statistics: { ok: false } };
  }

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-12">
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold tracking-tight">{COPY.statistics.heading}</h1>
        <p className="text-muted-foreground text-sm">{COPY.statistics.intro}</p>
      </header>

      {/*
        Rendered here and, identically, in `loading.tsx` — see `RangeNav` for
        why this segment has no `layout.tsx` and what that answers.
      */}
      <RangeNav current={view.range} />

      <Figures view={view} />
    </main>
  );
}

/**
 * The five figures, or one of the three states that is not five figures.
 *
 * **Zero and failure are different states and never render alike.** A counter
 * that defaulted to `0` on a failed read would make an income card silently say
 * `$ 0,00`, which is a false statement about money and indistinguishable from a
 * period that earned nothing.
 *
 * **A quiet period and a shop nobody has ever booked with are also different
 * states**, which is what `hasAnyBookingEver` is for. Telling an owner with two
 * years of history that "todavía no reservó nadie" because this Tuesday was
 * slow would be false in a way they would notice and not trust again.
 */
function Figures({ view }: { view: StatisticsView }) {
  if (!view.statistics.ok) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-2 py-8 text-center">
          <p className="text-sm font-medium">{COPY.statistics.loadFailed}</p>
          <p className="text-muted-foreground text-sm">{COPY.statistics.loadFailedHelp}</p>
        </CardContent>
      </Card>
    );
  }

  const figures = view.statistics.value;

  if (!figures.hasAnyBookingEver) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-2 py-8 text-center">
          <p className="text-sm font-medium">{COPY.statistics.emptyShop}</p>
          <p className="text-muted-foreground text-sm">{COPY.statistics.emptyShopHint}</p>
          <Link
            href="/perfil"
            className="text-primary text-sm font-medium underline-offset-4 hover:underline"
          >
            {COPY.statistics.emptyShopLink}
          </Link>
        </CardContent>
      </Card>
    );
  }

  if (figures.confirmedCount === 0 && figures.cancelledCount === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-2 py-8 text-center">
          <p className="text-sm font-medium">
            {COPY.statistics.emptyPeriod(COPY.statistics.rangesInPhrase[view.range])}
          </p>
          <p className="text-muted-foreground text-sm">{COPY.statistics.emptyPeriodHint}</p>
          {/*
            The wider period on offer is this month — so it is not offered when
            this month is already what failed to show anything. A link back to
            the page you are on is worse than no link.
          */}
          {view.range === 'mes' ? null : (
            <Link
              href={statisticsRangeHref('mes')}
              prefetch={false}
              className="text-primary text-sm font-medium underline-offset-4 hover:underline"
            >
              {COPY.statistics.emptyPeriodLink}
            </Link>
          )}
        </CardContent>
      </Card>
    );
  }

  // The division is a monetary rule and lives in the domain, once. `null` is a
  // period with no confirmed appointments — not a period that earned nothing.
  const average = averageDepositPerBooking(figures.depositTotal, figures.confirmedCount);

  return (
    <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <Figure
        label={COPY.statistics.confirmedCount}
        value={String(figures.confirmedCount)}
        help={COPY.statistics.confirmedCountHelp}
      />

      <Figure
        label={COPY.statistics.depositTotal}
        value={formatCurrency(figures.depositTotal)}
        help={COPY.statistics.depositTotalHelp}
      />

      {/*
        Zero here is a real and welcome figure and renders as a plain zero. The
        asymmetry with the average below is deliberate: an empty numerator is an
        answer, an empty denominator is the absence of one.
      */}
      <Figure
        label={COPY.statistics.cancelledCount}
        value={String(figures.cancelledCount)}
        help={COPY.statistics.cancelledCountHelp}
      >
        <Breakdown figures={figures} />
      </Figure>

      <Figure
        label={COPY.statistics.averageDeposit}
        value={average === null ? COPY.statistics.averageDepositAbsent : formatCurrency(average)}
        help={
          average === null
            ? COPY.statistics.averageDepositAbsentHelp
            : COPY.statistics.averageDepositHelp
        }
      />

      <Figure
        label={COPY.statistics.uniqueClients}
        value={String(figures.uniqueClients)}
        help={COPY.statistics.uniqueClientsHelp}
      />
    </dl>
  );
}

/**
 * Who ended the cancelled appointments, when anyone did.
 *
 * **Shown only when non-zero**, because a healthy shop would otherwise be given
 * two zeros where the whole point of the split was to separate two opposite
 * facts. The two parts need not sum to the total: a booking cancelled before
 * `cancelledBy` had a writer belongs to neither.
 */
function Breakdown({
  figures,
}: {
  figures: { cancelledByOwner: number; cancelledByClient: number };
}) {
  if (figures.cancelledByOwner === 0 && figures.cancelledByClient === 0) return null;

  return (
    <span className="text-muted-foreground flex flex-col text-xs">
      {figures.cancelledByOwner > 0 ? (
        <span>{COPY.statistics.cancelledByOwner(figures.cancelledByOwner)}</span>
      ) : null}
      {figures.cancelledByClient > 0 ? (
        <span>{COPY.statistics.cancelledByClient(figures.cancelledByClient)}</span>
      ) : null}
    </span>
  );
}

/**
 * One figure. `min-w-0` and wrapping because a period's sum is not bounded by
 * any single price the product otherwise formats — ten thousand appointments at
 * 4500 is inside `Decimal(12,2)` and far outside `MAX_PRICE` (the T18 family of
 * defect).
 */
function Figure({
  label,
  value,
  help,
  children,
}: {
  label: string;
  value: string;
  help: string;
  children?: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <dt className="text-muted-foreground text-sm font-medium">{label}</dt>
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        <dd className="min-w-0 text-3xl font-semibold break-words">{value}</dd>
        <span className="text-muted-foreground text-xs">{help}</span>
        {children}
      </CardContent>
    </Card>
  );
}
