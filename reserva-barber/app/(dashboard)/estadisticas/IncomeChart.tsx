import { BUSINESS_TIME_ZONE } from '@/server/domain/models/businessTime';
import { COPY } from '@/lib/copy';
import { formatCurrency } from '@/lib/formatCurrency';
import type { BucketGranularity, IncomeBucket } from '@/server/domain/models/statistics';
import { CHART_VIEWBOX, barsFor, labelStrideFor } from './chartGeometry';

/**
 * Deposit income across the selected period, as bars (D6).
 *
 * **A Server Component drawing inline SVG.** No charting library, no
 * `ResponsiveContainer`, no measurement, and therefore nothing to hydrate — the
 * page's no-client-JavaScript requirement holds for the charts exactly as it
 * holds for the figures. `chartGeometry.ts` carries the argument for why that
 * was the choice rather than Recharts.
 *
 * **The table is not a fallback; it is the chart's equivalent.** A chart is an
 * image to a screen reader and to anyone who cannot resolve its colours, so
 * every value drawn above is also written below, at the same precision. It is
 * visually hidden rather than absent, which is the difference between an
 * accessible chart and a chart with an apology attached.
 *
 * **Scaling is relative to the period.** The tallest bar fills the plot, so the
 * shape is readable whatever the shop's scale — and the absolute numbers live in
 * the figures above and in the table below, which is where a reader who needs
 * them should look anyway.
 *
 * All `Intl` formatting happens here, on the server. Formatting money on both
 * sides of the render boundary is how a hydration mismatch on a currency value
 * happens, and it is the reason this page has a rule about it.
 */

const DAY_LABEL = new Intl.DateTimeFormat('es-AR', {
  timeZone: BUSINESS_TIME_ZONE,
  day: 'numeric',
  month: 'numeric',
});

const HOUR_LABEL = new Intl.DateTimeFormat('es-AR', {
  timeZone: BUSINESS_TIME_ZONE,
  hour: '2-digit',
  hour12: false,
});

/**
 * The bucket's own name, in the **business's** timezone.
 *
 * Never the runtime's: the deployment is UTC and the business is at UTC−3, so a
 * label read from the runtime would put the 21:00 bar under "00" and the last
 * day of a month under the first of the next — the same three hours of wrong
 * answers `bookingCalendar` exists to prevent, printed on an axis.
 */
function labelFor(bucket: IncomeBucket, granularity: BucketGranularity): string {
  return granularity === 'hour' ? HOUR_LABEL.format(bucket.start) : DAY_LABEL.format(bucket.start);
}

export function IncomeChart({
  series,
  granularity,
  rangePhrase,
}: {
  series: readonly IncomeBucket[];
  granularity: BucketGranularity;
  rangePhrase: string;
}) {
  const bars = barsFor(series);
  const stride = labelStrideFor(series.length);
  const everyBucketIsZero = series.every((bucket) => bucket.total === '0.00');

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-lg font-medium">{COPY.statistics.incomeChartHeading}</h2>
      <p className="text-muted-foreground text-sm">
        {granularity === 'hour'
          ? COPY.statistics.incomeChartHelpHourly
          : COPY.statistics.incomeChartHelp}
      </p>

      {/*
        The period earned nothing, and that is an answer rather than an absence:
        the axis is still drawn, at zero, and the sentence says why it is flat.
        Hiding the chart here would make a quiet period look like a broken one.
      */}
      {everyBucketIsZero ? (
        <p className="text-muted-foreground text-sm">{COPY.statistics.incomeChartAllZero}</p>
      ) : null}

      <svg
        viewBox={`0 0 ${CHART_VIEWBOX.width} ${CHART_VIEWBOX.height}`}
        // `w-full` with no height: the viewBox scales it to whatever the card
        // gives it, which is what keeps a 31-bar month inside a 360 px phone
        // without measuring anything.
        className="h-auto w-full"
        role="img"
        aria-label={COPY.statistics.incomeChartLabel(rangePhrase)}
      >
        {/* The baseline, so a period of zeros still reads as an axis. */}
        <line
          x1={0}
          y1={CHART_VIEWBOX.plotHeight}
          x2={CHART_VIEWBOX.width}
          y2={CHART_VIEWBOX.plotHeight}
          className="stroke-border"
          strokeWidth={1}
        />

        {bars.map((bar) => (
          <rect
            key={bar.bucket.start.toISOString()}
            x={bar.x}
            y={bar.y}
            width={bar.width}
            height={bar.height}
            rx={2}
            className="fill-primary"
          >
            {/*
              A title on each bar is the one piece of interactivity available
              without scripting — the browser draws the tooltip itself.
            */}
            <title>{`${labelFor(bar.bucket, granularity)}: ${formatCurrency(bar.bucket.total)}`}</title>
          </rect>
        ))}

        {bars.map((bar, index) =>
          index % stride === 0 ? (
            <text
              key={`label-${bar.bucket.start.toISOString()}`}
              x={bar.x + bar.width / 2}
              y={CHART_VIEWBOX.height - 12}
              textAnchor="middle"
              className="fill-muted-foreground text-[14px]"
            >
              {labelFor(bar.bucket, granularity)}
            </text>
          ) : null
        )}
      </svg>

      {/*
        The same numbers, in text. `sr-only` rather than omitted: this is what a
        screen reader reads instead of the picture, and what anyone who cannot
        distinguish the fill colour can still reach.
      */}
      <table className="sr-only">
        <caption>{COPY.statistics.incomeChartTableCaption}</caption>
        <thead>
          <tr>
            <th scope="col">{COPY.statistics.incomeChartBucketColumn}</th>
            <th scope="col">{COPY.statistics.incomeChartAmountColumn}</th>
          </tr>
        </thead>
        <tbody>
          {series.map((bucket) => (
            <tr key={bucket.start.toISOString()}>
              <th scope="row">{labelFor(bucket, granularity)}</th>
              <td>{formatCurrency(bucket.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
