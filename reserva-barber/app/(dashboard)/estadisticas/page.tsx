import Link from 'next/link';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { COPY } from '@/lib/copy';
import { formatCurrency } from '@/lib/formatCurrency';
import { businessToday } from '@/server/domain/models/bookingCalendar';
import {
  bucketEdgesFor,
  granularityFor,
  hourBucketEdgesFor,
  resolveStatisticsRange,
  statisticsRangeHref,
  STATS_RANGE_PARAM,
} from '@/server/application/dashboard/statisticsRangeParams';
import {
  averageDepositPerBooking,
  disambiguateLabels,
  fillHourlyDistribution,
  fillIncomeSeries,
  paymentMethodSplit,
  rankTopN,
  type BusinessStatistics,
} from '@/server/domain/models/statistics';
import { HourlyChart } from './HourlyChart';
import { IncomeChart } from './IncomeChart';
import { PaymentMethodsChart } from './PaymentMethodsChart';
import { RankingChart } from './RankingChart';
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
    const today = businessToday(new Date());
    view = {
      range,
      today,
      // The edges are still resolvable without the database, so the fallback
      // carries a real axis rather than an empty one. Nothing draws it — both
      // datasets are `{ ok: false }` — but a view whose shape depends on whether
      // the read failed is a view with two shapes.
      edges: bucketEdgesFor(range, today),
      hourEdges: hourBucketEdgesFor(range, today),
      statistics: { ok: false },
      charts: { ok: false },
      breakdowns: { ok: false },
    };
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

      <Charts view={view} />

      <Breakdowns view={view} />
    </main>
  );
}

/**
 * The service ranking, the barber ranking and the hour distribution — or one of
 * the states that is not three sections (D7).
 *
 * **Gated on confirmed activity, which is a different question from the one
 * `Figures` and `Charts` ask.** `hasSomethingToReport` is true for a period with
 * cancellations and no confirmations: something happened, and the figures should
 * report it. Every breakdown here counts confirmations only, so that same period
 * would render three empty sections beneath a populated figures block,
 * explaining nothing. The two predicates sit side by side rather than one being
 * redefined, because they answer different questions and the distinction is the
 * thing worth keeping.
 *
 * **A failed read never draws an empty ranking.** An empty ranking is a
 * statement about the business and is indistinguishable from a period nobody
 * booked — the rule the whole page is built on.
 *
 * **The failure copy says nothing about the other two reads**, and this section
 * is not rendered at all when the figures failed. That is the D6 finding one
 * section further down: copy reporting a partial failure implies the rest is
 * current, and printed beneath a card apologising for the figures it is simply
 * false.
 *
 * (The word "l-a-y-e-r" is spelled out of this comment on purpose. The copy scan
 * in this directory is a substring match and cannot tell an English word from a
 * Spanish range slug — the same limitation `bookingCalendar` records about its
 * own scan not telling a comment from a call, and the reason both files describe
 * banned strings rather than quoting them.)
 */
function Breakdowns({ view }: { view: StatisticsView }) {
  // Checked before the failure state: a period with nothing confirmed in it has
  // no breakdown worth reporting a failure for. When the figures themselves
  // failed there is no way to know whether this period had anything, and the
  // section stays silent rather than guessing.
  if (!view.statistics.ok) return null;

  const figures = view.statistics.value;
  if (!figures.hasAnyBookingEver || !hasConfirmedActivity(figures)) return null;

  if (!view.breakdowns.ok) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-2 py-8 text-center">
          <p className="text-sm font-medium">{COPY.statistics.breakdownsFailed}</p>
          <p className="text-muted-foreground text-sm">{COPY.statistics.breakdownsFailedHelp}</p>
        </CardContent>
      </Card>
    );
  }

  const { services, barbers, hours } = view.breakdowns.value;
  const phrase = COPY.statistics.rangesInPhrase[view.range];

  // Ranking, capping and folding are the domain's, once, so the two rankings
  // cannot drift onto two different rules. `disambiguateLabels` applies only to
  // the barbers: a display name is unique per location and not across the
  // business, while a service name is unique per owner.
  const rankedServices = rankTopN(services);
  const rankedBarbers = disambiguateLabels(rankTopN(barbers));
  const distribution = fillHourlyDistribution(hours, view.hourEdges);

  return (
    <div className="flex flex-col gap-8">
      <RankingChart
        entries={rankedServices}
        idPrefix="services"
        heading={COPY.statistics.servicesChartHeading}
        help={COPY.statistics.servicesChartHelp}
        chartLabel={COPY.statistics.servicesChartLabel(phrase)}
        tableCaption={COPY.statistics.servicesChartTableCaption}
        nameColumn={COPY.statistics.servicesChartNameColumn}
        singleSentence={COPY.statistics.servicesChartSingle}
      />

      <RankingChart
        entries={rankedBarbers}
        idPrefix="barbers"
        heading={COPY.statistics.barbersChartHeading}
        help={COPY.statistics.barbersChartHelp}
        chartLabel={COPY.statistics.barbersChartLabel(phrase)}
        tableCaption={COPY.statistics.barbersChartTableCaption}
        nameColumn={COPY.statistics.barbersChartNameColumn}
        singleSentence={COPY.statistics.barbersChartSingle}
      />

      {/*
        `singleDay` is asked through `granularityFor` rather than by comparing
        the range against two slugs. "Which ranges are one day" already has an
        answer in the resolver, and a second copy of it here would be a second
        place to update — the copy scan is what surfaced it, because two of
        those slugs are also Spanish words the product says out loud.
      */}
      <HourlyChart
        buckets={distribution}
        singleDay={granularityFor(view.range) === 'hour'}
        chartLabel={COPY.statistics.hoursChartLabel(phrase)}
      />
    </div>
  );
}

/**
 * Whether this period has confirmed appointments to break down.
 *
 * **Deliberately narrower than `hasSomethingToReport`, and named so the
 * difference survives.** That predicate ORs in cancellations, because a period
 * in which three clients cancelled is a period the figures should report. Every
 * D7 breakdown counts confirmations only, so the same period would draw three
 * empty sections under those figures — the shape of defect D6's adversarial pass
 * found between `Figures` and `Charts`, one section further down.
 */
function hasConfirmedActivity(figures: BusinessStatistics): boolean {
  return figures.confirmedCount > 0;
}

/**
 * The two charts, or one of the states that is not two charts (D6).
 *
 * **Rendered only when `Figures` rendered figures.** Both of its empty states
 * suppress the charts: a shop nobody has ever booked with, and a period in which
 * nothing happened. Two empty axes under a message already saying the period was
 * empty is noise in the first case and a false statement in the second, since
 * the chart's own zero-series copy claims appointments that did not exist.
 *
 * **A failed chart read never draws a zero series.** A flat line at zero is a
 * statement about the business and is indistinguishable from a period that
 * earned nothing. The figures above are unaffected and say so, which is the
 * whole point of the two reads being independent.
 */
function Charts({ view }: { view: StatisticsView }) {
  // **Both of `Figures`' empty states suppress the charts**, and the second one
  // was added by D6's adversarial pass rather than by design: an empty axis
  // under the empty-period message is noise, and the chart's own zero-series
  // sentence claims appointments that did not happen. `hasSomethingToReport` is
  // the shared condition, so the two can no longer drift apart.
  //
  // Checked before the charts' own failure state: a period with nothing in it
  // has no chart worth reporting a failure for.
  if (view.statistics.ok) {
    const figures = view.statistics.value;
    if (!figures.hasAnyBookingEver || !hasSomethingToReport(figures)) return null;
  }

  if (!view.charts.ok) {
    // **When the figures failed too, say nothing here.** The chart failure's
    // copy reassures the owner that the numbers above are current — true and
    // useful when only this read failed, and false when the card directly above
    // is already apologising for them. Independent failure is the feature;
    // vouching for a half that did not succeed is not. Found by D6's
    // adversarial pass, in the same family as the empty-period defect above.
    if (!view.statistics.ok) return null;

    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-2 py-8 text-center">
          <p className="text-sm font-medium">{COPY.statistics.chartsFailed}</p>
          <p className="text-muted-foreground text-sm">{COPY.statistics.chartsFailedHelp}</p>
        </CardContent>
      </Card>
    );
  }

  const { rows } = view.charts.value;

  // Both derived from the same rows, which is what makes the bars and the split
  // reconcile with each other by construction rather than by timing.
  const series = fillIncomeSeries(rows, view.edges);
  const split = paymentMethodSplit(rows);

  return (
    <div className="flex flex-col gap-8">
      <IncomeChart
        series={series}
        granularity={granularityFor(view.range)}
        rangePhrase={COPY.statistics.rangesInPhrase[view.range]}
      />
      <PaymentMethodsChart split={split} />
    </div>
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
/**
 * Whether this period has anything to report at all.
 *
 * **One definition, used by `Figures` to pick its empty state and by `Charts` to
 * decide whether to draw.** They were two independent conditions until D6's
 * adversarial pass, and the gap between them was a false statement: a period
 * with no appointments rendered the empty-period sentence and then, immediately
 * below it, an income chart whose every-bucket-zero copy asserts that
 * appointments *did* happen and merely collected nothing. Both on one screen,
 * one of them wrong.
 *
 * The two sentences are described rather than quoted here, because the copy scan
 * in this directory cannot tell a comment from a call — the convention
 * `bookingCalendar` follows for its own banned literals.
 *
 * Note what it deliberately does **not** cover: a period with appointments that
 * collected nothing. That is an answer, the axis is drawn at zero, and the copy
 * is true. The two cases look identical in the chart data and are opposite in
 * meaning, which is exactly why the decision is made from the figures rather
 * than from the buckets.
 */
function hasSomethingToReport(figures: BusinessStatistics): boolean {
  return figures.confirmedCount > 0 || figures.cancelledCount > 0;
}

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

  if (!hasSomethingToReport(figures)) {
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

      {/*
        The sixth figure, and **the only one on this page bounded on the
        approval rather than on the appointment** (T83). It comes from the chart
        read, so it is absent — rather than zero — when that read failed: a
        money figure reading `$ 0,00` because a query timed out is a false
        statement about the business, which is the rule the whole page is built
        on. Its help text says it will not match the deposits card, because an
        owner who finds that out on their own concludes one of the two is broken.
      */}
      {view.charts.ok ? (
        <Figure
          label={COPY.statistics.cashCollected}
          value={formatCurrency(view.charts.value.cashCollected)}
          help={COPY.statistics.cashCollectedHelp}
        />
      ) : null}
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
