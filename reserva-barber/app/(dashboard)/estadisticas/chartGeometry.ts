import { toCents } from '@/server/domain/models/money';
import type { IncomeBucket, PaymentMethodShare } from '@/server/domain/models/statistics';

/**
 * Values to geometry, and nothing else (D6).
 *
 * ---
 *
 * **Why this file exists at all.** The stack decision named Recharts, and the
 * statistics page carries a tested requirement that it depend on no client
 * JavaScript. Every browser-measuring chart library is disqualified by the same
 * mechanism — it computes its layout from the DOM, so it renders nothing on the
 * server and different markup on hydration, on a surface displaying money. The
 * charts are therefore drawn as inline SVG by Server Components, and this module
 * is the arithmetic that makes that possible.
 *
 * **Pure by construction.** No `window`, no `document`, no measurement, no
 * clock, no React. That is what makes the one genuinely fallible part of a
 * hand-rolled chart cheap to test — and testing it is the trade that justified
 * writing it rather than installing something.
 *
 * **Money arrives as canonical decimal strings and is compared as integer
 * cents.** Float arithmetic has no business deciding a pixel that represents
 * pesos: `0.1 + 0.2` is the reason this project's money convention exists, and a
 * chart is not an exemption from it.
 */

/**
 * The coordinate space every chart is drawn in.
 *
 * The SVG scales to its container through this `viewBox` rather than through any
 * measured width, which is both what keeps it server-renderable and what keeps
 * it inside its card at a 360 px phone width (the T18 family of defect).
 *
 * `plotHeight` is short of `height` by the strip the axis labels occupy.
 */
export const CHART_VIEWBOX = {
  width: 720,
  height: 240,
  plotHeight: 200,
} as const;

/** The gap between bars, as a fraction of the slot each bar is given. */
const BAR_GAP_RATIO = 0.2;

export interface Bar {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly bucket: IncomeBucket;
}

/**
 * One bar per bucket, scaled so the largest fills the plot.
 *
 * **The scale is relative to the period, not absolute**, which is the honest
 * choice for a chart whose whole purpose is showing shape: a shop taking 4 500
 * a day and a shop taking 450 000 both get a readable chart. The consequence —
 * that bar heights are not comparable *between* periods — is why the figures
 * above the chart carry the absolute numbers and why every bucket's amount is
 * also in the data table.
 *
 * **A period that earned nothing yields bars of height zero, not NaN.** That
 * state is reachable by design: `fillIncomeSeries` returns a full-length series
 * of `"0.00"` for a quiet period, and the page draws it rather than hiding it,
 * because appointments that collected nothing is an answer. Dividing by a zero
 * maximum would turn that answer into an invisible chart.
 */
export function barsFor(series: readonly IncomeBucket[]): readonly Bar[] {
  if (series.length === 0) return [];

  const cents = series.map((bucket) => toCents(bucket.total));
  const peak = Math.max(...cents);

  const slot = CHART_VIEWBOX.width / series.length;
  const width = slot * (1 - BAR_GAP_RATIO);

  return series.map((bucket, index) => {
    // `peak === 0` is the quiet period, and the guard is what keeps its bars at
    // zero rather than at NaN.
    const height = peak === 0 ? 0 : ((cents[index] as number) / peak) * CHART_VIEWBOX.plotHeight;

    return {
      x: index * slot + (slot - width) / 2,
      y: CHART_VIEWBOX.plotHeight - height,
      width,
      height,
      bucket,
    };
  });
}

/**
 * Label every nth bucket, so a month's axis stays readable.
 *
 * Thirty-one labels across this viewBox collide into a smear at a phone width.
 * Rotating them was the alternative and costs vertical space the card does not
 * have; thinning them keeps the axis honest — the first bucket is always
 * labelled, so the reader always has an anchor, and every value remains in the
 * data table regardless.
 */
export function labelStrideFor(bucketCount: number): number {
  if (bucketCount <= 8) return 1;
  if (bucketCount <= 16) return 2;
  if (bucketCount <= 24) return 3;
  return 5;
}

export interface Share {
  readonly method: PaymentMethodShare['method'];
  /** This part's proportion of the period, in `[0, 1]`. */
  readonly fraction: number;
  /** Where this part begins, so the parts lie end to end. */
  readonly offset: number;
  readonly share: PaymentMethodShare;
}

/**
 * The method split as proportions of one bar, laid end to end.
 *
 * A stacked bar rather than a pie, and the reason is legibility rather than
 * taste: two proportions are read more accurately from lengths than from
 * angles, and a bar degrades gracefully to a single labelled block when only one
 * method was used — which is the permanent state of every owner who configured
 * one payment method.
 *
 * A total of zero yields fractions of zero rather than NaN, for the reason
 * `barsFor` gives about its own guard.
 */
export function sharesFor(split: readonly PaymentMethodShare[]): readonly Share[] {
  if (split.length === 0) return [];

  const cents = split.map((part) => toCents(part.total));
  const total = cents.reduce((sum, value) => sum + value, 0);

  let offset = 0;
  return split.map((share, index) => {
    const fraction = total === 0 ? 0 : (cents[index] as number) / total;
    const part = { method: share.method, fraction, offset, share };
    offset += fraction;
    return part;
  });
}
