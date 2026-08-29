import type { PrismaClient } from '@/generated/prisma/client';
import type { IStatisticsRepository } from '@/server/domain/repositories/IStatisticsRepository';
import type {
  BreakdownEntry,
  BusinessBreakdowns,
  BusinessCharts,
  BusinessStatistics,
  HourBucketCount,
  IncomeByBucketAndMethod,
} from '@/server/domain/models/statistics';
import type { PaymentMethod } from '@/server/domain/models/Payment';
import type { Interval } from '@/server/domain/models/availability';
import { toCanonicalDecimal } from './canonicalDecimal';

/**
 * The statistics page's read.
 *
 * Every predicate here reaches the owner through `barber → location → ownerId`.
 * A booking's location is deliberately not duplicated onto the row
 * (`data-model.md` §11), so this is the only path — and since there is no
 * row-level security on these tables, that join **is** the tenancy boundary. An
 * aggregate is the worst place to forget it: a leaked figure produces no row
 * that can look wrong, only a plausible integer.
 */

/** One grouped row of the chart read. Counts and bucket indexes arrive as `bigint`. */
interface ChartRow {
  bucket: bigint;
  method: PaymentMethod;
  total: unknown;
  payments: bigint;
}

/** The single-row companion carrying the cash-collected figure. */
interface CashRow {
  cashCollected: unknown;
}

/**
 * One row of the breakdown read, in the union's single projection.
 *
 * Deliberately narrow in type: `text` and `bigint` are already proven across
 * this driver adapter on `workerd`, and a mocked test certifies a projection
 * whether or not the adapter can read it (T58). The hour bucket therefore
 * travels in `key` as text rather than as a column of its own.
 */
interface BreakdownRow {
  kind: 'service' | 'barber' | 'hour';
  key: string;
  label: string;
  sublabel: string | null;
  count: bigint;
}

/** The one row the aggregate returns. Counts arrive as `bigint`. */
interface StatisticsRow {
  confirmedCount: bigint;
  depositTotal: unknown;
  cancelledCount: bigint;
  cancelledByOwner: bigint;
  cancelledByClient: bigint;
  uniqueClients: bigint;
  bookingsEver: bigint;
}

export class PrismaStatisticsRepository implements IStatisticsRepository {
  constructor(private readonly db: PrismaClient) {}

  /**
   * Every figure for one period, in **one statement**.
   *
   * ---
   *
   * **The row set is every booking this owner has, and each figure narrows it.**
   * That is what makes `bookingsEver` free: it is the same `count(*)` with no
   * `FILTER` at all. It is also what makes the range a `FILTER` clause rather
   * than a `WHERE` clause — a `WHERE` would make the all-time flag impossible
   * without a second query, and the flag is what tells a quiet week apart from a
   * shop nobody has ever booked with.
   *
   * **`Payment` is not in that row set, and must never be.** A booking may carry
   * many payment rows — `Payment_one_live_per_booking` is
   * `ON ("bookingId") WHERE status <> 'REJECTED'`, so any number of declined
   * attempts coexist with one live payment, deliberately, because *a declined
   * card is exactly the client who will try again*. Joining them here would
   * multiply that booking's row once per attempt and inflate every
   * `count(*) FILTER`, while `count(DISTINCT b."clientId")` absorbed the
   * duplication entirely — leaving two figures wrong, one right, and the
   * discrepancy reading as a rounding quirk. The sum is therefore a sub-query
   * with its own `FROM`, as D1's is.
   *
   * **The sub-query keeps its own owner predicate.** Redundant today, and no
   * longer redundant the first time somebody edits the outer statement. This is
   * the one read in the product where the failure is a plausible number rather
   * than a visible row.
   *
   * **This statement narrows; it does not decide.** It filters by owner, by
   * status and by an instant range, and nothing else. **No figure asks whether a
   * hold is live**, so nothing here reads `holdExpiresAt` — and any refinement
   * of that rule belongs in `blocksAvailability`, which this file would then
   * follow rather than restate.
   *
   * **It performs no date arithmetic.** `date_trunc` is refused twice over: its
   * unit is an identifier position, which parameterisation does not cover, and
   * it truncates in the **session's** timezone — UTC on Supavisor and `workerd`
   * — so a 21:30 appointment would land in the next day. The two boundaries
   * arrive as instants from the domain.
   *
   * `count(*)` returns `bigint`, which has no place above this layer: these
   * figures are small by construction and `Number` is exact well past any
   * plausible booking volume. The money is the opposite case and goes through
   * `toCanonicalDecimal` — the driver returns a stored `2000.50` as `2000.5`,
   * and a `SUM` carries that defect exactly as a column does (measured in PC3).
   *
   * The **average is deliberately absent** from this projection. The domain
   * divides the sum by the count over integer cents, because
   * `toCanonicalDecimal`'s two branches disagree about a value with more than
   * two decimals and a quotient is exactly that (design D8).
   */
  async readStatistics(input: { ownerId: string; range: Interval }): Promise<BusinessStatistics> {
    const { ownerId, range } = input;

    const rows = await this.db.$queryRaw<StatisticsRow[]>`
      SELECT
        count(*) FILTER (
          WHERE b.status = 'CONFIRMED'
            AND b."startTime" >= ${range.start}
            AND b."startTime" < ${range.end}
        ) AS "confirmedCount",

        -- Cancellations, keyed on the appointment like everything else, so the
        -- owner can read them as a rate against the figure above. EXPIRED is
        -- absent from this whole statement: it is how a lapsed deadline is told
        -- apart from a decision, and the sweep produces those rows constantly.
        count(*) FILTER (
          WHERE b.status = 'CANCELLED'
            AND b."startTime" >= ${range.start}
            AND b."startTime" < ${range.end}
        ) AS "cancelledCount",

        -- The two parts need not sum to the total: a row written before the
        -- cancelledBy column had a writer carries no value and belongs to
        -- neither. Backticks are avoided in this block on purpose — it is a
        -- template literal, and one would end the statement here.
        count(*) FILTER (
          WHERE b.status = 'CANCELLED'
            AND b."cancelledBy" = 'OWNER'
            AND b."startTime" >= ${range.start}
            AND b."startTime" < ${range.end}
        ) AS "cancelledByOwner",

        count(*) FILTER (
          WHERE b.status = 'CANCELLED'
            AND b."cancelledBy" = 'CLIENT'
            AND b."startTime" >= ${range.start}
            AND b."startTime" < ${range.end}
        ) AS "cancelledByClient",

        -- Distinct people, not distinct bookings: somebody with three confirmed
        -- appointments this week is one client, and a count of client rows
        -- would be a count of checkout attempts.
        count(DISTINCT b."clientId") FILTER (
          WHERE b.status = 'CONFIRMED'
            AND b."startTime" >= ${range.start}
            AND b."startTime" < ${range.end}
        ) AS "uniqueClients",

        -- Not a figure and never rendered as one. It exists so the page can
        -- tell a quiet period in a working shop apart from a shop whose link
        -- nobody has ever used, and any status counts: a started checkout still
        -- means the link was reached.
        count(*) AS "bookingsEver",

        -- Deposits belonging to this period's appointments. The join through
        -- the booking's status is the whole rule: an APPROVED payment may
        -- belong to a booking that never confirmed (the late-payment case), and
        -- that is money the owner owes back, not revenue. Bounded on the
        -- BOOKING's startTime, not on approvedAt — every figure here shares one
        -- clock so that the average of two of them means something (design D1).
        COALESCE((
          SELECT sum(p.amount)
          FROM "Payment" p
          JOIN "Booking" pb ON pb.id = p."bookingId"
          JOIN "Barber" pbr ON pbr.id = pb."barberId"
          JOIN "Location" pl ON pl.id = pbr."locationId"
          WHERE pl."ownerId" = ${ownerId}
            AND p.status = 'APPROVED'
            AND pb.status = 'CONFIRMED'
            AND pb."startTime" >= ${range.start}
            AND pb."startTime" < ${range.end}
        ), 0) AS "depositTotal"

      FROM "Booking" b
      JOIN "Barber" br ON br.id = b."barberId"
      JOIN "Location" l ON l.id = br."locationId"
      WHERE l."ownerId" = ${ownerId}
    `;

    const row = rows[0];

    // An owner with no bookings at all produces one row of zeros rather than no
    // row, because the aggregate has no GROUP BY. This guard is for the shape
    // being wrong, **not** for an empty shop — a reading that would turn it into
    // a failure state for exactly the owner it is meant to serve.
    if (row === undefined) {
      return {
        confirmedCount: 0,
        depositTotal: '0.00',
        cancelledCount: 0,
        cancelledByOwner: 0,
        cancelledByClient: 0,
        uniqueClients: 0,
        hasAnyBookingEver: false,
      };
    }

    return {
      confirmedCount: Number(row.confirmedCount),
      depositTotal: toCanonicalDecimal(row.depositTotal),
      cancelledCount: Number(row.cancelledCount),
      cancelledByOwner: Number(row.cancelledByOwner),
      cancelledByClient: Number(row.cancelledByClient),
      uniqueClients: Number(row.uniqueClients),
      hasAnyBookingEver: Number(row.bookingsEver) > 0,
    };
  }

  /**
   * Both charts and the cash-collected figure (D6).
   *
   * ---
   *
   * **One grouped read serves two charts.** The row set is grouped by bucket
   * *and* by method: summed over methods it is the income series, summed over
   * buckets it is the payment-method split. Two reads would answer from two
   * instants and put two charts on one screen that cannot be reconciled against
   * each other.
   *
   * **`p.status = 'APPROVED'` is not optional and is the likeliest thing to be
   * dropped here.** Rule 4 keeps `Payment` out of the *counted* row set; this
   * read *is* a payment read, so it has to exclude the declined attempts in its
   * own right. `Payment_one_live_per_booking` is
   * `ON ("bookingId") WHERE status <> 'REJECTED'` — a booking carries any number
   * of rejected rows deliberately, because a declined card is exactly the client
   * who will try again — so without this predicate a client who retried three
   * times becomes three Mercado Pago payments in the split. Wrong in the
   * direction that flatters the gateway the shop pays fees to, and it reads as a
   * busy month.
   *
   * **The join through `pb.status = 'CONFIRMED'` is the same rule the income
   * figure follows**: an approved payment on a booking that never confirmed is
   * money the owner owes back, not revenue, and it belongs to neither method.
   *
   * **This statement computes no date.** The bucket edges arrive as instants
   * from the domain and become an epoch-second array; `width_bucket` only
   * compares against them. `date_trunc` is refused twice over — its unit is an
   * identifier position that parameterisation does not cover, and it truncates
   * in the *session's* timezone, UTC here, so a 21:30 appointment would land in
   * the next day's bar.
   *
   * **The two reads are issued independently and share no transaction.** An
   * interactive transaction holds a connection open across round trips against a
   * transaction-mode pooler — the thing every other repository here avoids — on
   * the pool the public booking flow shares (T47); and this is the heavier read
   * against a pooler on record hanging rather than raising (T68), so a shared
   * transaction would cost the owner the five figures too. The skew that admits
   * is one round trip wide and self-correcting; see `IStatisticsRepository`
   * rule 9.
   *
   * **`cashCollected` is bounded on `p."approvedAt"`** — the one value in this
   * capability that is not keyed on the appointment, and required to be (T83).
   * It rides on this call because it is a payment read like the rest of it, not
   * because it belongs to a chart.
   */
  async readCharts(input: {
    ownerId: string;
    range: Interval;
    edges: readonly Date[];
  }): Promise<BusinessCharts> {
    const { ownerId, range, edges } = input;

    // `width_bucket(operand, thresholds[])` takes the boundaries as a value,
    // which is what keeps every calendar decision in the domain. Epoch seconds
    // rather than timestamps because the array form of `width_bucket` is defined
    // over `double precision`, and a second's resolution is far finer than any
    // boundary this product places.
    const thresholds = edges.map((edge) => edge.getTime() / 1000);

    const rows = await this.db.$queryRaw<ChartRow[]>`
      SELECT
        width_bucket(
          extract(epoch FROM pb."startTime")::float8,
          ${thresholds}::float8[]
        ) AS "bucket",
        p.method AS "method",
        sum(p.amount) AS "total",
        count(*) AS "payments"

      FROM "Payment" p
      JOIN "Booking" pb ON pb.id = p."bookingId"
      JOIN "Barber" pbr ON pbr.id = pb."barberId"
      JOIN "Location" pl ON pl.id = pbr."locationId"
      WHERE pl."ownerId" = ${ownerId}
        AND p.status = 'APPROVED'
        AND pb.status = 'CONFIRMED'
        AND pb."startTime" >= ${range.start}
        AND pb."startTime" < ${range.end}
      GROUP BY 1, 2
    `;

    // Deliberately a second statement rather than a sixth column on the first:
    // it is bounded on a different instant, so folding it in would need its own
    // FILTER over a different predicate and would silently inherit this
    // statement's GROUP BY.
    const cash = await this.db.$queryRaw<CashRow[]>`
      SELECT COALESCE(sum(p.amount), 0) AS "cashCollected"
      FROM "Payment" p
      JOIN "Booking" pb ON pb.id = p."bookingId"
      JOIN "Barber" pbr ON pbr.id = pb."barberId"
      JOIN "Location" pl ON pl.id = pbr."locationId"
      WHERE pl."ownerId" = ${ownerId}
        AND p.status = 'APPROVED'
        AND pb.status = 'CONFIRMED'
        AND p."approvedAt" >= ${range.start}
        AND p."approvedAt" < ${range.end}
    `;

    return {
      rows: rows.map(
        (row): IncomeByBucketAndMethod => ({
          bucket: Number(row.bucket),
          method: row.method,
          total: toCanonicalDecimal(row.total),
          payments: Number(row.payments),
        })
      ),
      // An owner with no payments still yields one row, because the aggregate
      // has no GROUP BY. The guard is for a wrong shape, never for an empty
      // period — which is a real answer and renders as one.
      cashCollected: toCanonicalDecimal(cash[0]?.cashCollected ?? 0),
    };
  }

  /**
   * The three breakdowns of one period, in **one grouped read** (D7).
   *
   * ---
   *
   * **One statement, three groupings of one row set.** The `confirmed` CTE is
   * the population `confirmedCount` counts — this owner's confirmed
   * appointments in this period — and the three branches group it by service,
   * by barber and by hourly bucket. That shared row set is what makes each
   * branch required to sum back to that figure, and the invariant is the only
   * cheap defence this read has: every way it can go wrong produces a believable
   * integer rather than a row that looks wrong.
   *
   * Three separate statements were the alternative. They would answer from three
   * instants, so the three sections on screen could not be added up against each
   * other — the same defect `readCharts` avoids by serving two charts from one
   * read.
   *
   * **The projection is `text` and `bigint`, and that is a decision.** A
   * `json_agg` of three arrays would be a tidier shape and would need a
   * driver-deserialization probe on `workerd` before it could be trusted, while
   * a mocked repository test would certify it either way. That is exactly T58:
   * `pg_advisory_xact_lock` returns `void`, the adapter could not read it, and
   * twenty-four green tests certified the one call that failed every booking
   * write in the runtime. `text` and `bigint` are already proven across this
   * adapter, so the hour bucket travels as text in `key` and is narrowed here.
   *
   * **Every branch carries its own owner predicate.** A union's branches are
   * separate statements sharing a projection, so each is its own chance to lose
   * the tenancy join. The CTE carries `ownerId` forward precisely so a branch can
   * re-apply it without re-joining — redundant while the CTE is correct, and no
   * longer redundant the first time somebody edits it.
   *
   * **The service join is taken for the name and for nothing else.** Scoping
   * through `Service."ownerId"` — a real column, and correct today — would be a
   * second path to the owner, which is one edit away from being a second answer
   * to a question that must only ever have one. It also cannot multiply a row:
   * `Booking.serviceId` is a single foreign key.
   *
   * **This statement computes no hour.** The edges arrive as instants from the
   * domain and become an epoch-second array that `width_bucket` only compares
   * against; the fold onto the twenty-four hours of a day happens in
   * `fillHourlyDistribution`, where the business calendar lives. `date_trunc`,
   * `extract(hour …)` and `AT TIME ZONE` are all refused: the first two resolve
   * in the *session's* timezone, UTC on Supavisor and `workerd`, and the third
   * would work — which is the problem, because it moves the decision.
   *
   * **It neither orders, caps nor folds.** A `LIMIT` here discards the rows past
   * the cap, and a discarded remainder is invisible: the ranking simply stops
   * summing to the figure above it. Ordering without an explicit tie-break is no
   * better — equal counts come back in whatever order the plan produced, and the
   * owner watches a ranking change between two renders of the same period. Both
   * belong to `rankTopN`, in the domain, where a test reaches them without a
   * database.
   */
  async readBreakdowns(input: {
    ownerId: string;
    range: Interval;
    edges: readonly Date[];
  }): Promise<BusinessBreakdowns> {
    const { ownerId, range, edges } = input;

    // Epoch seconds rather than timestamps because the array form of
    // `width_bucket` is defined over `double precision`, and a second's
    // resolution is far finer than any boundary this product places.
    const thresholds = edges.map((edge) => edge.getTime() / 1000);

    const rows = await this.db.$queryRaw<BreakdownRow[]>`
      WITH confirmed AS (
        SELECT
          b."serviceId"   AS "serviceId",
          s.name::text    AS "serviceName",
          b."barberId"    AS "barberId",
          br."displayName"::text AS "barberName",
          l.name::text    AS "locationName",
          l."ownerId"     AS "ownerId",
          b."startTime"   AS "startTime"
        FROM "Booking" b
        JOIN "Barber" br ON br.id = b."barberId"
        JOIN "Location" l ON l.id = br."locationId"
        JOIN "Service" s ON s.id = b."serviceId"
        WHERE l."ownerId" = ${ownerId}
          AND b.status = 'CONFIRMED'
          AND b."startTime" >= ${range.start}
          AND b."startTime" < ${range.end}
      )

      SELECT
        'service'::text AS "kind",
        c."serviceId"::text AS "key",
        c."serviceName" AS "label",
        NULL::text AS "sublabel",
        count(*) AS "count"
      FROM confirmed c
      WHERE c."ownerId" = ${ownerId}
      GROUP BY c."serviceId", c."serviceName"

      UNION ALL

      -- The location rides along because a display name is unique per location
      -- and not across the business: one owner may legitimately have two
      -- barbers called the same thing. Which rows actually need qualifying is
      -- decided in the domain, over the rendered set.
      SELECT
        'barber'::text AS "kind",
        c."barberId"::text AS "key",
        c."barberName" AS "label",
        c."locationName" AS "sublabel",
        count(*) AS "count"
      FROM confirmed c
      WHERE c."ownerId" = ${ownerId}
      GROUP BY c."barberId", c."barberName", c."locationName"

      UNION ALL

      -- The bucket index travels in "key" as text so the union keeps one
      -- projection of types this adapter is already proven to deserialize. It
      -- indexes the PERIOD's hours, not the day's; folding a week's 168 buckets
      -- onto 24 hours is the domain's job, because the hour a bucket opens in is
      -- a business-calendar fact.
      SELECT
        'hour'::text AS "kind",
        width_bucket(
          extract(epoch FROM c."startTime")::float8,
          ${thresholds}::float8[]
        )::text AS "key",
        ''::text AS "label",
        NULL::text AS "sublabel",
        count(*) AS "count"
      FROM confirmed c
      WHERE c."ownerId" = ${ownerId}
      GROUP BY 2
    `;

    const services: BreakdownEntry[] = [];
    const barbers: BreakdownEntry[] = [];
    const hours: HourBucketCount[] = [];

    for (const row of rows) {
      const count = Number(row.count);

      if (row.kind === 'hour') {
        hours.push({ bucket: Number(row.key), count });
        continue;
      }

      const entry: BreakdownEntry = {
        key: row.key,
        label: row.label,
        sublabel: row.sublabel,
        count,
      };

      if (row.kind === 'service') services.push(entry);
      else barbers.push(entry);
    }

    return { services, barbers, hours };
  }
}
