import { COPY } from '@/lib/copy';
import type { HourlyBucket } from '@/server/domain/models/statistics';
import { CHART_VIEWBOX, hourColumnsFor, labelStrideFor } from './chartGeometry';

/**
 * When the period's appointments start, across the hours of the business's day
 * (D7).
 *
 * **The hour is already decided before this component sees it.** The buckets
 * arrive folded by `fillHourlyDistribution`, which reads each bucket's opening
 * instant through the business calendar. Nothing here formats an instant, which
 * is what keeps a runtime whose clock is UTC from labelling the 21:00 column as
 * "00" — the same three hours of wrong answers `bookingCalendar` exists to
 * prevent, printed on an axis.
 *
 * That is also why this component takes no `Intl` formatter at all: an hour is a
 * number here, and `hoursChartHourLabel` pads it. The income chart formats
 * instants and needs one; this one would only be able to get it wrong.
 *
 * **All twenty-four hours are drawn, including the empty ones.** An axis that
 * skipped a quiet hour would be a plausible shape describing a day that did not
 * happen.
 *
 * **A single-day period says so.** It is one day's shape on a 24-hour axis,
 * which is correct and easy to misread as a trend; the help text is the whole
 * mitigation, and it is why the chart is still drawn for every range rather than
 * suppressed for two of six — a page whose shape depends on the selection is the
 * one thing an owner comparing periods cannot use.
 */
export function HourlyChart({
  buckets,
  singleDay,
  chartLabel,
}: {
  buckets: readonly HourlyBucket[];
  singleDay: boolean;
  chartLabel: string;
}) {
  if (buckets.length === 0) return null;

  const columns = hourColumnsFor(buckets);
  const stride = labelStrideFor(buckets.length);

  return (
    <section className="flex flex-col gap-2" aria-labelledby="hours-chart-heading">
      <h2 id="hours-chart-heading" className="text-lg font-medium">
        {COPY.statistics.hoursChartHeading}
      </h2>
      <p className="text-muted-foreground text-sm">
        {singleDay ? COPY.statistics.hoursChartHelpSingleDay : COPY.statistics.hoursChartHelp}
      </p>

      <svg
        viewBox={`0 0 ${CHART_VIEWBOX.width} ${CHART_VIEWBOX.height}`}
        // `w-full` with no height: the viewBox scales it to whatever the card
        // gives it, which is what keeps twenty-four columns inside a 360 px
        // phone without measuring anything.
        className="h-auto w-full"
        role="img"
        aria-label={chartLabel}
      >
        {/* The baseline, so a day with no appointments still reads as an axis. */}
        <line
          x1={0}
          y1={CHART_VIEWBOX.plotHeight}
          x2={CHART_VIEWBOX.width}
          y2={CHART_VIEWBOX.plotHeight}
          className="stroke-border"
          strokeWidth={1}
        />

        {columns.map((column) => (
          <rect
            key={`hour-${column.bucket.hour}`}
            x={column.x}
            y={column.y}
            width={column.width}
            height={column.height}
            rx={2}
            className="fill-primary"
          >
            <title>{`${COPY.statistics.hoursChartHourLabel(column.bucket.hour)}: ${column.bucket.count}`}</title>
          </rect>
        ))}

        {columns.map((column, index) =>
          index % stride === 0 ? (
            <text
              key={`hour-label-${column.bucket.hour}`}
              x={column.x + column.width / 2}
              y={CHART_VIEWBOX.height - 12}
              textAnchor="middle"
              className="fill-muted-foreground text-[14px]"
            >
              {COPY.statistics.hoursChartHourLabel(column.bucket.hour)}
            </text>
          ) : null
        )}
      </svg>

      {/*
        The same numbers, in text, all twenty-four of them. `sr-only` rather
        than omitted: this is what a screen reader reads instead of the picture.
      */}
      <table className="sr-only">
        <caption>{COPY.statistics.hoursChartTableCaption}</caption>
        <thead>
          <tr>
            <th scope="col">{COPY.statistics.hoursChartHourColumn}</th>
            <th scope="col">{COPY.statistics.hoursChartCountColumn}</th>
          </tr>
        </thead>
        <tbody>
          {buckets.map((bucket) => (
            <tr key={bucket.hour}>
              <th scope="row">{COPY.statistics.hoursChartHourLabel(bucket.hour)}</th>
              <td>{bucket.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
