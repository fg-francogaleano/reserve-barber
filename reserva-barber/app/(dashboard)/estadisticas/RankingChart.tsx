import { COPY } from '@/lib/copy';
import type { RankedEntry } from '@/server/domain/models/statistics';
import { RANKING_VIEWBOX, rankingBarsFor, rankingHeightFor } from './chartGeometry';

/**
 * A ranking of services or of barbers, as horizontal bars (D7).
 *
 * **One component for both**, because they are one picture with two vocabularies
 * — and two components would be two places the aggregated row's rule has to be
 * remembered. Everything that differs between them arrives as copy.
 *
 * **A Server Component drawing inline SVG.** No charting library and nothing to
 * hydrate; `chartGeometry.ts` carries the argument for why that was the choice.
 *
 * **The aggregated remainder is tabulated and never drawn.** A bar whose height
 * sums unlike things invites being read as one thing, and in a shop with a wide
 * catalogue it is frequently the longest bar on the screen. It stays in the
 * table, where the number is the whole content and cannot be read as a shape.
 *
 * **Every element id is namespaced from `idPrefix`.** The page carries five
 * inline drawings; a shared `clipPath` id is a duplicate in the document, and an
 * id derived from a random value or a render counter is a hydration mismatch in
 * waiting.
 */
export function RankingChart({
  entries,
  idPrefix,
  heading,
  help,
  chartLabel,
  tableCaption,
  nameColumn,
  singleSentence,
}: {
  entries: readonly RankedEntry[];
  /** Stable, unique per chart on the page. Never random, never a counter. */
  idPrefix: string;
  heading: string;
  help: string;
  chartLabel: string;
  tableCaption: string;
  nameColumn: string;
  /** How this ranking states itself when it has exactly one named entry. */
  singleSentence: (label: string, count: number) => string;
}) {
  if (entries.length === 0) return null;

  const named = entries.filter((entry) => entry.isAggregate === false);
  const aggregate = entries.find((entry) => entry.isAggregate);

  // A ranking of one is not a ranking, and a bar at a hundred percent is not
  // information. It is stated in a sentence — the treatment a single payment
  // method already receives. The aggregate cannot exist here: it only appears
  // once the cap has been exceeded.
  const only = named.length === 1 && aggregate === undefined ? named[0] : undefined;

  const bars = rankingBarsFor(named);
  const height = rankingHeightFor(named.length);

  return (
    <section className="flex flex-col gap-2" aria-labelledby={`${idPrefix}-heading`}>
      <h2 id={`${idPrefix}-heading`} className="text-lg font-medium">
        {heading}
      </h2>
      <p className="text-muted-foreground text-sm">{help}</p>

      {only === undefined ? (
        <>
          {/*
            **`aria-hidden`, and the table below is why.** This list is the same
            numbers a screen reader already gets from the table, in the same
            order; announced as well it reads the whole ranking twice. The SVG is
            `role="img"` and opaque, so what a screen reader hears is the chart's
            label and then one complete table. Found by D7's second adversarial
            pass.
          */}
          <div className="flex flex-col gap-1" aria-hidden="true">
            {/*
              **Every entry, including the aggregate — it is listed, just not
              drawn.** Excluding it from the list entirely was this change's
              worst defect: the visible shares summed to 84% of a period and
              nothing on screen accounted for the rest, so an owner reading it
              concludes a number is missing. What the aggregate must not be is a
              *bar*, because a length that sums unlike things gets read as one
              thing — so it renders with the row and without the geometry.
            */}
            {entries.map((entry) => (
              <div key={entry.key} className="flex items-center gap-3 text-sm">
                <span
                  className={
                    entry.isAggregate
                      ? 'text-muted-foreground min-w-0 flex-1 break-words italic'
                      : 'min-w-0 flex-1 break-words'
                  }
                >
                  {entry.isAggregate ? COPY.statistics.rankingOthers : entry.label}
                  {/*
                    The location, and only where the display name repeats — the
                    domain decides that, over the period's barbers, because a
                    name is unique per location and not across the business.
                  */}
                  {entry.sublabel === null ? null : (
                    <span className="text-muted-foreground"> · {entry.sublabel}</span>
                  )}
                </span>

                {/*
                  The bar and the number sit in the same row rather than inside
                  one SVG, so a long name wraps into its own line instead of
                  being clipped by a viewBox. The SVG below carries the same
                  shape for anyone reading the chart as an image.
                */}
                <span className="text-muted-foreground shrink-0 tabular-nums">
                  {entry.count} · {entry.share}%
                </span>
              </div>
            ))}
          </div>

          <svg
            viewBox={`0 0 ${RANKING_VIEWBOX.width} ${height}`}
            className="h-auto w-full"
            role="img"
            aria-label={chartLabel}
          >
            {bars.map((bar) => (
              <rect
                key={`${idPrefix}-${bar.entry.key}`}
                x={bar.x}
                y={bar.y}
                width={bar.width}
                height={bar.height}
                rx={2}
                className="fill-primary"
              >
                {/*
                  The one piece of interactivity available without scripting:
                  the browser draws the tooltip itself.
                */}
                <title>{`${bar.entry.label}: ${bar.entry.count}`}</title>
              </rect>
            ))}
          </svg>
        </>
      ) : (
        <p className="text-sm">{singleSentence(only.label, only.count)}</p>
      )}

      {/*
        The same numbers, in text, including the aggregated row the chart above
        deliberately omits. `sr-only` rather than absent: this is what a screen
        reader reads instead of the picture, and what anyone who cannot resolve
        the fill colour can still reach.
      */}
      <table className="sr-only">
        <caption>{tableCaption}</caption>
        <thead>
          <tr>
            <th scope="col">{nameColumn}</th>
            <th scope="col">{COPY.statistics.rankingCountColumn}</th>
            <th scope="col">{COPY.statistics.rankingShareColumn}</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.key}>
              <th scope="row">
                {entry.isAggregate ? COPY.statistics.rankingOthers : entry.label}
                {entry.sublabel === null ? '' : ` · ${entry.sublabel}`}
              </th>
              <td>{entry.count}</td>
              <td>{entry.share}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
