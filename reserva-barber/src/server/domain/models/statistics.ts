/**
 * What the statistics page reports, the vocabulary of periods it reports over,
 * and the one figure it computes rather than reads.
 *
 * The types here are the contract between the aggregate read and the page. Like
 * `dashboardSummary.ts`, they carry no rule about *what* goes into a figure —
 * every such rule lives in the predicate the repository issues — with the single
 * exception below, which is arithmetic rather than a predicate and therefore has
 * nowhere else to be.
 */

import { businessHourOf } from './bookingCalendar';
import { fromCents, toCents } from './money';
import { PAYMENT_METHODS, type PaymentMethod } from './Payment';

/**
 * The periods the page offers, in the order it offers them.
 *
 * **A closed set, and that is the design rather than a shortcut** (design D6 of
 * the D5 change). Each accepted value is an aggregate over the shop's whole
 * booking history against a connection pool the public booking flow shares
 * (`docs/tech-debt.md` T47); an arbitrary date range is an unbounded family of
 * them, and `project-context.md` §69 asks for buttons, not a date picker.
 *
 * `hoy` is first because it is the default, and because it is the one rendered
 * by the **unparameterised** URL — a link that spelled out the default would
 * make two URLs for one view (`clientPageHref`'s rule).
 *
 * Declared here rather than in the resolver for the same reason
 * `BOOKING_STATUSES` is declared in the domain: it is the product's vocabulary,
 * and both the resolver that matches against it and the control that renders it
 * need the same list.
 */
export const STATISTICS_RANGES = [
  'hoy',
  'ayer',
  'semana',
  'semana-anterior',
  'mes',
  'mes-anterior',
] as const;

export type StatisticsRange = (typeof STATISTICS_RANGES)[number];

/**
 * The figures, as one snapshot.
 *
 * They arrive together from a single statement, which is what makes them
 * comparable: separate reads answer from separate instants, and a booking
 * confirmed mid-render would be counted by one figure and not by another.
 *
 * **Every figure is bounded by the same instant range, on the booking's
 * `startTime`** (design D1). This diverges from `DashboardSummary`, whose income
 * is bounded on `Payment.approvedAt`, and the divergence is deliberate: the
 * average below divides one of these figures by another, and a quotient whose
 * numerator and denominator cover different populations means nothing. Both
 * surfaces state their basis in copy, because the two numbers will not agree.
 *
 * The projection carries no client name, email address, telephone number,
 * booking identifier or token — none is rendered, and a field that is not
 * selected cannot reach a log line or a serialized prop.
 */
export interface BusinessStatistics {
  /** `CONFIRMED` bookings whose appointment falls inside the period. */
  readonly confirmedCount: number;
  /**
   * Deposits belonging to those appointments, as a canonical decimal string.
   *
   * `APPROVED` payments on `CONFIRMED` bookings only. A payment may be approved
   * while its booking is not — the late-payment case, where the hold lapsed and
   * the slot was resold — and that is money the owner **owes back**, not
   * revenue.
   *
   * A string because the driver returns a stored `2000.50` as `2000.5`, and a
   * `SUM` carries the defect exactly as a column does (measured in PC3).
   *
   * It is deposits, not turnover: this product never records the balance a
   * client pays in the chair. Whatever renders it must say so.
   */
  readonly depositTotal: string;
  /**
   * `CANCELLED` bookings whose appointment falls inside the period.
   *
   * **Never an `EXPIRED` booking.** `EXPIRED` against `CANCELLED` is how this
   * product tells a deadline apart from a decision, and B7's sweep produces
   * expired rows continuously — counting them would report abandoned checkouts
   * as clients walking away.
   */
  readonly cancelledCount: number;
  /**
   * How many of those the owner ended, and how many the client did.
   *
   * **They do not have to sum to `cancelledCount`.** Rows written before
   * `cancelledBy` had a writer carry no value and are counted in the total and
   * in neither part.
   *
   * The split exists because "my clients cancelled three" and "I cancelled three
   * on them" are opposite facts about a business — the argument D4 used for its
   * own secondary count. It costs one extra clause in a statement that was being
   * issued anyway.
   */
  readonly cancelledByOwner: number;
  readonly cancelledByClient: number;
  /**
   * Distinct clients across the confirmed appointments of the period.
   *
   * A client with three confirmed bookings in range counts **once**. Never a
   * count of client rows: a row count is a count of checkout attempts.
   */
  readonly uniqueClients: number;
  /**
   * Whether this shop has ever had a booking at all, in any status, at any time.
   *
   * **Not a figure and never rendered as one.** It exists so the page can tell
   * two empty tables apart: a quiet period in a working shop, and a shop whose
   * public link nobody has ever used. Those are different facts and the page
   * says different things about them — the rule D4 applied to its own three
   * empty states.
   *
   * Any status counts, an abandoned hold included. A checkout that was started
   * and never finished still means the link has been reached, so the "nobody has
   * ever booked here" copy would be wrong. The conservative direction: that
   * state is reserved for a genuinely untouched shop.
   *
   * It is free — the statement's row set is already every booking this owner
   * has, with each figure narrowing it through a `FILTER`.
   */
  readonly hasAnyBookingEver: boolean;
}

/**
 * The average deposit per confirmed appointment, or **nothing**.
 *
 * ---
 *
 * **Why this is not `sum(p.amount) / count(*)` in the statement** (design D8).
 *
 * `toCanonicalDecimal` — the only place a driver decimal becomes a domain
 * string — has two branches that disagree. Its `Decimal` branch calls
 * `toFixed(2)`, which **rounds**; its string branch pads and slices, which
 * **truncates**. Over a `Decimal(12,2)` column and its `SUM` the two are
 * identical, which is why the disagreement has never mattered. A quotient
 * arrives with PostgreSQL's default division scale — many decimals — and would
 * be rounded down one path and rounded half-up the other, chosen by nothing more
 * than how the driver happened to represent the value.
 *
 * So the statement returns the sum and the count, and the division happens here,
 * over integer cents, with the rounding written down. It follows the precedent
 * `data-model.md` §533 sets for the deposit rule: a monetary rule lives in one
 * place and is never reimplemented per surface.
 *
 * ---
 *
 * **Why `null` rather than `"0.00"`.**
 *
 * D1's rule is that zero and failure never render alike. An average over no
 * appointments is a third state — not a failure, and not an answer — and a
 * formatted zero would state that appointments happened and earned nothing.
 * The union is what makes that unrepresentable rather than merely discouraged.
 *
 * Note the asymmetry it creates, which is deliberate: a period **with**
 * appointments and **no** approved deposits averages exactly zero and says so.
 * An empty numerator is an answer; an empty denominator is the absence of one.
 *
 * ---
 *
 * The rounding is **half-up**, expressed as `remainder × 2 >= divisor` rather
 * than as `Math.round(a / b)`. The comparison is exact integer arithmetic;
 * dividing first would reintroduce the float this whole convention exists to
 * avoid, at the one point where it decides a centavo.
 */
export function averageDepositPerBooking(
  depositTotal: string,
  confirmedCount: number
): string | null {
  if (confirmedCount <= 0) return null;

  const totalCents = toCents(depositTotal);
  const whole = Math.floor(totalCents / confirmedCount);
  const remainder = totalCents - whole * confirmedCount;

  return fromCents(remainder * 2 >= confirmedCount ? whole + 1 : whole);
}

// ---------------------------------------------------------------------------
// D6 — the income series over time, and the payment-method split
// ---------------------------------------------------------------------------

/**
 * How a period is partitioned for the income chart.
 *
 * **A property of the range, never of the data.** A day is drawn by hour and a
 * week or a month by day, whatever the rows happen to contain — granularity
 * chosen from the data would change the axis between two periods the owner is
 * comparing, which is the one thing this page exists to let them do.
 */
export type BucketGranularity = 'hour' | 'day';

/**
 * One grouped row as the repository returns it, before anything is filled.
 *
 * `bucket` is **1-based**, which is `width_bucket`'s own convention: it answers
 * `0` below the first threshold and `n` at or above the last. Both are
 * unreachable while the statement carries the range predicate, and
 * `fillIncomeSeries` drops them rather than trusting that to stay true.
 *
 * The row set is deliberately grouped by bucket **and** method, so one read
 * serves both charts: summed over methods it is the series, summed over buckets
 * it is the split. Two reads would answer from two instants and could not be
 * reconciled on screen.
 */
export interface IncomeByBucketAndMethod {
  readonly bucket: number;
  readonly method: PaymentMethod;
  /** Canonical decimal string, never a number. */
  readonly total: string;
  readonly payments: number;
}

/** One bar. `start` is the instant the bucket opens, in the business's calendar. */
export interface IncomeBucket {
  readonly start: Date;
  readonly total: string;
}

/** One part of the split. `payments` is a count of payments, never of bookings. */
export interface PaymentMethodShare {
  readonly method: PaymentMethod;
  readonly total: string;
  readonly payments: number;
}

/**
 * Everything the two charts need, as one snapshot.
 *
 * `cashCollected` rides along because it comes from the same read: it is the
 * **only** value in this capability bounded on `Payment.approvedAt` rather than
 * on the appointment, and it exists so an owner can ask "how much money arrived
 * in this period" — which, before D6, no surface answered (T83).
 *
 * It is carried beside the series and never inside it. Two series on one axis
 * invite a point-by-point reading, and the gap between them at any single
 * bucket is a deposit for an appointment in another period rather than a
 * shortfall. Nothing may divide it by an appointment-keyed figure.
 */
export interface BusinessCharts {
  readonly rows: readonly IncomeByBucketAndMethod[];
  readonly cashCollected: string;
}

/**
 * The sum of canonical decimal strings, over integer cents.
 *
 * Adding these as floats is how `1000.25 + 2000.25` becomes `3000.4999…`, and
 * the whole money convention in `data-model.md` exists to keep that arithmetic
 * away from the values a shop is told it earned.
 */
export function sumAmounts(amounts: readonly string[]): string {
  return fromCents(amounts.reduce((cents, amount) => cents + toCents(amount), 0));
}

/**
 * The grouped rows as one bar per bucket, **with the empty buckets present**.
 *
 * ---
 *
 * **The filling is the point, and the defect it prevents is invisible.** The
 * statement returns only buckets that have rows, so a week in which deposits
 * arrived on Monday and Friday comes back as two rows. Rendered as-is that is a
 * two-bar chart — a plausible shape, on an axis three fifths too short,
 * describing a week that did not happen. Nothing looks wrong, which is why this
 * lives in the domain with a test rather than in a component with a comment.
 *
 * Both methods of a bucket are added together: the series is income over time,
 * and the split is the other chart's question.
 *
 * `edges` has one more element than the series has buckets — bucket `i` spans
 * `[edges[i], edges[i + 1])`. A row whose index falls outside that span is
 * dropped rather than clamped: clamping would move real money into a bucket it
 * does not belong to, and the conservative direction for a guard that should be
 * unreachable is to draw nothing rather than to draw the wrong bar.
 */
export function fillIncomeSeries(
  rows: readonly IncomeByBucketAndMethod[],
  edges: readonly Date[]
): readonly IncomeBucket[] {
  const bucketCount = Math.max(edges.length - 1, 0);
  const cents = new Array<number>(bucketCount).fill(0);

  for (const row of rows) {
    const index = row.bucket - 1;
    if (index < 0 || index >= bucketCount) continue;
    cents[index] += toCents(row.total);
  }

  return cents.map((total, index) => ({
    start: edges[index] as Date,
    total: fromCents(total),
  }));
}

/** The period's total, from the filled series. */
export function sumIncomeSeries(series: readonly IncomeBucket[]): string {
  return sumAmounts(series.map((bucket) => bucket.total));
}

/**
 * The split between payment rails, over the whole period.
 *
 * **Only the methods actually used appear.** A part reading zero is not a share
 * of anything, and a two-part chart where one part is empty is the permanent
 * state of every owner who configured a single payment method — the surface has
 * to say that in words rather than draw it as a whole.
 *
 * The order comes from `PAYMENT_METHODS` rather than from the rows, so the two
 * parts do not swap places between two periods the owner is comparing.
 *
 * `payments` counts payments and only `APPROVED` ones reach here, which is what
 * keeps a client's declined retries from reading as three Mercado Pago
 * customers — the multiplicity the partial unique index admits on purpose.
 */
export function paymentMethodSplit(
  rows: readonly IncomeByBucketAndMethod[]
): readonly PaymentMethodShare[] {
  return PAYMENT_METHODS.flatMap((method) => {
    const own = rows.filter((row) => row.method === method);
    if (own.length === 0) return [];

    return [
      {
        method,
        total: sumAmounts(own.map((row) => row.total)),
        payments: own.reduce((count, row) => count + row.payments, 0),
      },
    ];
  });
}

// ---------------------------------------------------------------------------
// D7 — the service and barber rankings, and the hour-of-day distribution
// ---------------------------------------------------------------------------

/**
 * How many named entries a ranking shows before the rest are folded together.
 *
 * A number, not a principle. Nothing in the schema caps a shop's catalogue, so
 * without a cap a shop with forty services draws forty rows on a phone; with a
 * cap that *discarded* the remainder the ranking would quietly stop summing to
 * the appointments figure above it. Eight is the compromise, and the fold below
 * is what makes it safe.
 */
export const RANKING_LIMIT = 8;

/** The key the folded entry carries. Never a service or barber identifier. */
export const RANKING_AGGREGATE_KEY = 'aggregate';

/**
 * One group as the repository hands it over, before anything is ordered.
 *
 * `key` is the entity's identifier and is what the grouping was done on, so a
 * rename cannot merge two rows and two identical names cannot collapse into one.
 * `label` and `sublabel` are read live — see `RankedEntry` for what that costs.
 */
export interface BreakdownEntry {
  readonly key: string;
  readonly label: string;
  /** The barber's location, carried for `disambiguateLabels`. Null elsewhere. */
  readonly sublabel: string | null;
  readonly count: number;
}

/**
 * One row of a rendered ranking.
 *
 * **The labels are anachronistic on purpose.** `Booking` snapshots the price it
 * was made at and does not snapshot the service name, the barber name or the
 * location, so renaming a service relabels its history and a barber who changes
 * branch carries theirs to the new branch's label. Grouping is by `key`, so
 * nothing merges and nothing splits — only the name is the current one. Adding
 * label snapshots to `Booking` is a data-model change D7 does not justify, and
 * the alternative of hiding renamed rows would break the reconciliation
 * invariant.
 *
 * `share` is **display only**. Nothing reconstructs a count from it, nothing
 * divides one by another, and they need not sum to a hundred — they are rounded
 * independently. The counts are the figures.
 */
export interface RankedEntry {
  readonly key: string;
  /** Empty on the aggregated entry: it is not one service and has no name. */
  readonly label: string;
  readonly sublabel: string | null;
  readonly count: number;
  /** Percent of the ranking's own total, rounded. Display only. */
  readonly share: number;
  readonly isAggregate: boolean;
}

/** One hour of the business's day, and how many appointments started in it. */
export interface HourlyBucket {
  readonly hour: number;
  readonly count: number;
}

/**
 * One grouped bucket of the hour read, as the repository returns it.
 *
 * `bucket` is **1-based**, `width_bucket`'s own convention, and indexes the
 * *period's* hours rather than the day's: a week has 168 of them. Folding them
 * onto the twenty-four hours of a day is `fillHourlyDistribution`'s job, and it
 * needs the edges to do it, because the hour a bucket opens in is a
 * business-calendar fact.
 */
export interface HourBucketCount {
  readonly bucket: number;
  readonly count: number;
}

/**
 * The three breakdowns of one period, as one snapshot.
 *
 * They come from a single grouped read whose branches share one row set — the
 * confirmed appointments of the period — which is what makes them reconcilable
 * against each other and against the figure above them. Three reads would answer
 * from three instants and could not be.
 *
 * **No payment row is in that row set**, and none may be added: a booking
 * carries any number of rejected attempts by design, so the join multiplies a
 * retried booking and inflates its service and its barber
 * (`IStatisticsRepository` rule 4).
 */
export interface BusinessBreakdowns {
  readonly services: readonly BreakdownEntry[];
  readonly barbers: readonly BreakdownEntry[];
  readonly hours: readonly HourBucketCount[];
}

/**
 * A breakdown as a ranking: ordered, capped, and with the remainder folded into
 * a single entry that **preserves the total**.
 *
 * ---
 *
 * **Why the fold is here and not a `LIMIT` in the statement.** A `LIMIT`
 * discards the rows past the cap, and a discarded remainder is invisible: the
 * ranking simply stops summing to the appointments figure rendered above it,
 * with nothing on screen looking wrong. That is the exact family of defect the
 * reconciliation invariant exists to catch, so the operation that could break it
 * lives where a test can reach it without a database.
 *
 * **The tie-break is explicit and is not decoration.** Three services with four
 * appointments each would otherwise be ordered by whatever the statement
 * happened to return, which is free to differ between two renders of the same
 * period — the owner would watch a ranking change while nothing changed.
 *
 * `share` is computed over the ranking's **own** total rather than against the
 * separately-read appointments figure. The two agree by construction and can
 * disagree by one round trip of skew (`IStatisticsRepository` rule 9); deriving
 * the percentage from the rows in hand keeps this function pure and keeps a
 * transient skew from turning into a percentage that does not add up.
 */
export function rankTopN(
  entries: readonly BreakdownEntry[],
  limit: number = RANKING_LIMIT
): readonly RankedEntry[] {
  if (entries.length === 0) return [];

  const total = entries.reduce((sum, row) => sum + row.count, 0);
  const ordered = [...entries].sort(
    (left, right) => right.count - left.count || left.label.localeCompare(right.label)
  );

  const named = ordered.slice(0, Math.max(limit, 0));
  const rest = ordered.slice(Math.max(limit, 0));

  const ranked: RankedEntry[] = named.map((row) => ({
    key: row.key,
    label: row.label,
    sublabel: row.sublabel,
    count: row.count,
    share: shareOf(row.count, total),
    isAggregate: false,
  }));

  if (rest.length === 0) return ranked;

  // The remainder, summed rather than dropped. It carries no name: a bar whose
  // height aggregates unlike things invites being read as one thing, which is
  // also why whatever renders this does not draw it.
  const restCount = rest.reduce((sum, row) => sum + row.count, 0);

  return [
    ...ranked,
    {
      key: RANKING_AGGREGATE_KEY,
      label: '',
      sublabel: null,
      count: restCount,
      share: shareOf(restCount, total),
      isAggregate: true,
    },
  ];
}

/** Percent of a total, rounded half-up. Display only; see `RankedEntry`. */
function shareOf(count: number, total: number): number {
  return total <= 0 ? 0 : Math.round((count * 100) / total);
}

/**
 * A breakdown with each location kept only where the name beside it is
 * ambiguous.
 *
 * A barber's display name is unique **within a location** and not across the
 * business (`data-model.md` §5), so one owner may legitimately have two "Nico"
 * at two branches — two identically-labelled rows with different counts, and no
 * way to tell which is which. The location resolves it.
 *
 * It is applied only where it is needed, because qualifying every row would be
 * noise for the single-location shop that is the common case.
 *
 * ---
 *
 * **It runs before the ranking is cut, not after, and D7's second adversarial
 * pass is what moved it.** Applied to the rendered rows, a "Nico" whose twin
 * fell past the cap into the aggregated entry would lose his qualifier — the
 * name is unambiguous *in the list* and ambiguous *in the business*, and it is
 * the business the owner is reading about. Deciding it over the period's whole
 * set means the qualifier survives the fold, and a shop with one Nico still
 * shows none.
 *
 * It is generic over anything carrying a label and a location because it now has
 * two callers' worth of shape between them: the entries as read, and the ranking
 * they become.
 *
 * **The qualifier is returned as data, never as a joined string.** Composing
 * "Nico · Centro" here would put a user-facing separator in the domain, which
 * the copy scan on the statistics directory exists to prevent; whatever renders
 * this decides how the two parts sit together.
 */
export function disambiguateLabels<T extends { readonly label: string; readonly sublabel: string | null }>(
  entries: readonly T[]
): readonly T[] {
  const seen = new Map<string, number>();
  for (const row of entries) {
    seen.set(row.label, (seen.get(row.label) ?? 0) + 1);
  }

  return entries.map((row) => ((seen.get(row.label) ?? 0) > 1 ? row : { ...row, sublabel: null }));
}

/**
 * The period's buckets folded onto the twenty-four hours of the business's day.
 *
 * ---
 *
 * **The fold is where the hour is decided, and that is the point.** The
 * statement assigns a row to one of the period's hourly buckets and knows
 * nothing else about it; the hour that bucket *opens in* is read here, from the
 * edge, through the business calendar. `date_trunc` and `extract(hour …)` would
 * both answer in the session's timezone — UTC on Supavisor and on `workerd` —
 * putting every appointment from 21:00 local onward in the following day's
 * hours. Plausibly, silently, for three hours of every day.
 *
 * **Every hour is present, including the empty ones.** A distribution that
 * omitted a quiet hour would draw a plausible shape on an axis too short to be
 * the day it claims to describe, and nothing about it would look wrong.
 *
 * A bucket outside the span is **dropped rather than clamped**, the rule
 * `fillIncomeSeries` already states: `width_bucket` answers `0` below the first
 * threshold and `n` at or above the last, both unreachable while the statement
 * carries the range predicate, and clamping would move a real appointment into
 * an hour it did not happen in.
 *
 * An empty `edges` array yields no axis at all rather than twenty-four zeros —
 * a period with no hours is not a day in which nothing happened.
 */
export function fillHourlyDistribution(
  rows: readonly HourBucketCount[],
  edges: readonly Date[]
): readonly HourlyBucket[] {
  const bucketCount = Math.max(edges.length - 1, 0);
  if (bucketCount === 0) return [];

  const counts = new Array<number>(HOURS_PER_DAY).fill(0);

  for (const row of rows) {
    const index = row.bucket - 1;
    if (index < 0 || index >= bucketCount) continue;
    counts[businessHourOf(edges[index] as Date)] += row.count;
  }

  return counts.map((count, hour) => ({ hour, count }));
}

const HOURS_PER_DAY = 24;
