import type { PrismaClient } from '@/generated/prisma/client';
import type { IStatisticsRepository } from '@/server/domain/repositories/IStatisticsRepository';
import type { BusinessStatistics } from '@/server/domain/models/statistics';
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
}
