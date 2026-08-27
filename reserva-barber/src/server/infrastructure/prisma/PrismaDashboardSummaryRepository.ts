import type { PrismaClient } from '@/generated/prisma/client';
import type { IDashboardSummaryRepository } from '@/server/domain/repositories/IDashboardSummaryRepository';
import type {
  DashboardSummary,
  FilterableBarber,
  RecentBooking,
} from '@/server/domain/models/dashboardSummary';
import type { BookingStatus } from '@/server/domain/models/Booking';
import type { Interval } from '@/server/domain/models/availability';
import { toCanonicalDecimal } from './canonicalDecimal';

/**
 * The dashboard home's reads.
 *
 * Every predicate here reaches the owner through `barber → location → ownerId`.
 * A booking's location is deliberately not duplicated onto the row
 * (`data-model.md` §11), so this is the only path — and since there is no
 * row-level security on these tables, that join **is** the tenancy boundary.
 * An aggregate is the worst place to forget it: a leaked figure produces no row
 * that can look wrong, only a plausible integer.
 */

/** The one row the aggregate statement returns. Counts arrive as `bigint`. */
interface SummaryRow {
  confirmedToday: bigint;
  heldToday: bigint;
  cancelledToday: bigint;
  confirmedAllTime: bigint;
  monthDepositIncome: unknown;
}

export class PrismaDashboardSummaryRepository implements IDashboardSummaryRepository {
  constructor(private readonly db: PrismaClient) {}

  /**
   * The five booking-and-payment figures, in **one statement**.
   *
   * One rather than five for two reasons, and the second is not about speed. A
   * round trip to the pooler costs ~0.35–0.40 s from this deployment, so five
   * serial reads would make the owner's landing page the slowest in the product.
   * But more importantly **five queries answer from five instants**: a booking
   * confirmed mid-render would be counted by `confirmedToday` and not by
   * `confirmedAllTime`, and the owner would be shown two numbers that cannot
   * both be true. One statement makes the set a snapshot.
   *
   * **This statement narrows; it does not decide.** It filters by owner, by
   * status and by an instant range, and nothing else. The one figure that asks
   * whether a hold is still live expresses that as `"holdExpiresAt" > now`,
   * which is not a second copy of `blocksAvailability` but the single clause
   * that predicate applies to `PENDING_PAYMENT` — the other statuses are
   * enumerated here rather than derived. Any refinement of the rule itself
   * belongs in the domain, and this query must follow it rather than diverge.
   *
   * **The receipt count is deliberately absent.** Its predicate belongs to the
   * review queue, which requires it to be expressed once and shared by the
   * listing and the count; a raw statement cannot share a Prisma query fragment,
   * so folding it in would re-create exactly the drift D1 exists to remove.
   *
   * `count(*)` returns `bigint`, which has no place above this layer — the
   * figures are small by construction and `Number` is exact well past any
   * plausible booking volume. The money is the opposite case and goes through
   * `toCanonicalDecimal`: the driver returns a stored `2000.50` as `2000.5`, and
   * a `SUM` carries that defect exactly as a column does (measured in PC3).
   */
  async readSummary(input: {
    ownerId: string;
    dayRange: Interval;
    monthRange: Interval;
    now: Date;
  }): Promise<DashboardSummary> {
    const { ownerId, dayRange, monthRange, now } = input;

    const rows = await this.db.$queryRaw<SummaryRow[]>`
      SELECT
        count(*) FILTER (
          WHERE b.status = 'CONFIRMED'
            AND b."startTime" >= ${dayRange.start}
            AND b."startTime" < ${dayRange.end}
        ) AS "confirmedToday",

        -- Still holding a slot today without being confirmed. The three
        -- clauses are the blocking rule's own, per status: a live hold, an
        -- uploaded receipt whose appointment has not passed, and nothing else.
        count(*) FILTER (
          WHERE b."startTime" >= ${dayRange.start}
            AND b."startTime" < ${dayRange.end}
            AND (
              (b.status = 'PENDING_PAYMENT'
                AND (b."holdExpiresAt" IS NULL OR b."holdExpiresAt" > ${now}))
              OR (b.status = 'PENDING_APPROVAL' AND b."startTime" >= ${now})
            )
        ) AS "heldToday",

        -- Guarded twice, deliberately. The sweep leaves cancelledAt null, so
        -- either clause alone excludes an EXPIRED row today; both are kept
        -- because "correct by accident" is the failure this project keeps
        -- naming. EXPIRED against CANCELLED is how a deadline is told apart
        -- from a decision, and the sweep produces expired rows continuously.
        count(*) FILTER (
          WHERE b.status = 'CANCELLED'
            AND b."cancelledAt" >= ${dayRange.start}
            AND b."cancelledAt" < ${dayRange.end}
        ) AS "cancelledToday",

        -- Confirmations, not rows. An all-time count of every booking is a
        -- count of checkout attempts, and abandoned holds accumulate without
        -- bound relative to real business.
        count(*) FILTER (WHERE b.status = 'CONFIRMED') AS "confirmedAllTime",

        -- Deposits collected this month. The join through the booking's status
        -- is the whole rule: an APPROVED payment may belong to a booking that
        -- never confirmed (the late-payment case), and that is money the owner
        -- owes back, not revenue. Bounded on approvedAt, because income is when
        -- the money moved.
        COALESCE((
          SELECT sum(p.amount)
          FROM "Payment" p
          JOIN "Booking" pb ON pb.id = p."bookingId"
          JOIN "Barber" pbr ON pbr.id = pb."barberId"
          JOIN "Location" pl ON pl.id = pbr."locationId"
          WHERE pl."ownerId" = ${ownerId}
            AND p.status = 'APPROVED'
            AND pb.status = 'CONFIRMED'
            AND p."approvedAt" >= ${monthRange.start}
            AND p."approvedAt" < ${monthRange.end}
        ), 0) AS "monthDepositIncome"

      FROM "Booking" b
      JOIN "Barber" br ON br.id = b."barberId"
      JOIN "Location" l ON l.id = br."locationId"
      WHERE l."ownerId" = ${ownerId}
    `;

    const row = rows[0];

    // An owner with no bookings at all produces one row of zeros rather than no
    // row, because the aggregate has no GROUP BY. The guard is for the shape
    // being wrong, not for an empty shop.
    if (row === undefined) {
      return {
        confirmedToday: 0,
        heldToday: 0,
        cancelledToday: 0,
        confirmedAllTime: 0,
        pendingReceipts: 0,
        monthDepositIncome: '0.00',
      };
    }

    return {
      confirmedToday: Number(row.confirmedToday),
      heldToday: Number(row.heldToday),
      cancelledToday: Number(row.cancelledToday),
      confirmedAllTime: Number(row.confirmedAllTime),
      // Filled by the caller from the receipt repository, which owns the
      // predicate. Zero here is a placeholder, never a reported figure.
      pendingReceipts: 0,
      monthDepositIncome: toCanonicalDecimal(row.monthDepositIncome),
    };
  }

  /**
   * The most recently created bookings, newest first, in every status.
   *
   * `EXPIRED` and `CANCELLED` are included on purpose: this is the first
   * surface in the product where an owner can see that a checkout was
   * abandoned at all.
   *
   * The projection carries **no client email and no telephone**. A field that is
   * not selected cannot reach a log line or a serialized prop, and contact
   * details belong to D4.
   *
   * `barberId` narrows **in addition to** the owner scope, never instead of it.
   * It has already been matched against this owner's own barbers before it got
   * here; the owner clause below is what makes that belt-and-braces rather than
   * load-bearing.
   *
   * ---
   *
   * **A `findMany` with an explicit projection, like every other row read in
   * this project** — deliberately not the raw SQL the summary above uses. The
   * summary is raw because it is an aggregate of five figures that must share
   * one snapshot; this is an ordinary list, and the client's own projection
   * keeps the column names type-checked, which a template literal cannot.
   *
   * A rewrite to raw SQL was written and reverted during D1. It was justified
   * by a misdiagnosis: this read appeared to hang against the live database,
   * and the cause turned out to be the developer's network path rather than
   * anything about the query (**T68** — responses above roughly 1.4 KB never
   * arrive from that machine, which a single 1400-byte value reproduces with no
   * table involved). The note is left here because the query looks like a
   * plausible suspect and should not be re-accused: it is four joins over an
   * indexed foreign key, bounded by `limit`.
   */
  async findRecentForOwner(input: {
    ownerId: string;
    barberId?: string | undefined;
    limit: number;
  }): Promise<readonly RecentBooking[]> {
    const rows = await this.db.booking.findMany({
      where: {
        barber: {
          ...(input.barberId === undefined ? {} : { id: input.barberId }),
          location: { ownerId: input.ownerId },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: input.limit,
      select: {
        id: true,
        startTime: true,
        status: true,
        depositAmount: true,
        cancelledBy: true,
        client: { select: { name: true } },
        service: { select: { name: true } },
        barber: { select: { displayName: true } },
      },
    });

    return rows.map((row) => ({
      id: row.id,
      startTime: row.startTime,
      status: row.status as BookingStatus,
      cancelledBy: row.cancelledBy,
      clientName: row.client.name,
      serviceName: row.service.name,
      barberDisplayName: row.barber.displayName,
      depositAmount: toCanonicalDecimal(row.depositAmount),
    }));
  }

  /**
   * The owner's barbers, for the filter control and for the matching it does.
   *
   * **Inactive barbers included**, deliberately: filtering them out would make
   * a deactivated barber's history unreachable while their bookings still
   * appear in the unfiltered list — a filter that cannot select something the
   * page is already showing.
   */
  async findFilterableBarbers(ownerId: string): Promise<readonly FilterableBarber[]> {
    return this.db.barber.findMany({
      where: { location: { ownerId } },
      orderBy: { displayName: 'asc' },
      select: { id: true, displayName: true },
    });
  }
}
