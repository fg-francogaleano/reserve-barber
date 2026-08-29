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

import { fromCents, toCents } from './money';

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
