import type {
  DayAvailabilityInputs,
  IBarberAvailabilityRepository,
} from '@/server/domain/repositories/IBarberAvailabilityRepository';
import type { Interval } from '@/server/domain/models/availability';
import type { BookingStatus } from '@/server/domain/models/Booking';
import { MAX_DURATION_MINUTES } from '@/server/domain/models/slotGranularity';
import { MAX_TIME_OFF_DAYS } from '@/server/application/timeOff/timeOffSchema';
import type { PrismaClient } from '@/generated/prisma/client';

/**
 * Statuses that can matter to availability, as a **read** filter.
 *
 * Wider than the blocking rule on purpose: `PENDING_PAYMENT` rows are fetched
 * whether or not their hold has lapsed, and `blocksAvailability` decides. The
 * expired-hold clause is a domain rule B4's transaction must share, and encoding
 * it here as SQL as well would be a second copy that drifts from the first.
 *
 * `CANCELLED` and `EXPIRED` are excluded here rather than in the domain, because
 * they can never block under any rule and there is no reason to carry them
 * across the wire.
 */
const POSSIBLY_BLOCKING: BookingStatus[] = ['PENDING_PAYMENT', 'PENDING_APPROVAL', 'CONFIRMED'];

/** Scoping predicate. `Barber` has no ownerId column (data-model.md §5). */
function ownedBy(ownerId: string) {
  return { location: { ownerId } };
}

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/**
 * How far back a row can start and still overlap a range.
 *
 * **The half-open overlap predicate alone is not enough to use the index.**
 * `startTime < rangeEnd AND endTime > rangeStart` bounds the scan from above
 * only, so PostgreSQL walks every earlier row of that barber and discards it in
 * a filter. Measured with `EXPLAIN` against the live database: `endTime` lands
 * in `Filter`, not in `Index Cond`. With an empty table that is free; with two
 * years of history it is thousands of rows read to return a handful, once per
 * distinct `?fecha`, on the public route that has neither a cache nor a rate
 * limit.
 *
 * The lower bound is safe because both entities have an enforced maximum length:
 * a row that starts earlier than `rangeStart - maximum` must already have ended
 * before `rangeStart`, so it cannot overlap. The `endTime`/`endsAt` condition
 * still decides correctness — this only tells the planner where to stop looking.
 *
 * The two maxima come from the validators that enforce them, so the bound cannot
 * drift from the rule it depends on.
 */
function earliestOverlappingStart(rangeStart: Date, maxLengthMs: number): Date {
  return new Date(rangeStart.getTime() - maxLengthMs);
}

export class PrismaBarberAvailabilityRepository implements IBarberAvailabilityRepository {
  constructor(private readonly db: PrismaClient) {}

  /**
   * One query, entered from `Barber`, with three nested projections.
   *
   * Entering from the barber is what makes it one trip: the owner predicate,
   * the weekday filter and both range filters all hang off a single row. It also
   * means a barber belonging to another owner returns `null` here rather than
   * returning empty lists that would read as "this barber is free all day" —
   * the difference between refusing to answer and answering wrongly.
   *
   * The overlap predicate is the half-open one every other consumer uses:
   * `startsAt < rangeEnd AND endsAt > rangeStart`. An absence or a booking that
   * begins before the day and ends inside it overlaps, and is returned.
   */
  async findDayInputs(
    barberId: string,
    ownerId: string,
    weekday: number,
    range: Interval
  ): Promise<DayAvailabilityInputs> {
    const row = await this.db.barber.findFirst({
      where: { id: barberId, isActive: true, ...ownedBy(ownerId) },
      select: {
        workingHours: {
          where: { dayOfWeek: weekday },
          select: { startMinute: true, endMinute: true },
          orderBy: [{ startMinute: 'asc' }],
        },
        timeOffs: {
          where: {
            startsAt: {
              gte: earliestOverlappingStart(range.start, MAX_TIME_OFF_DAYS * DAY_MS),
              lt: range.end,
            },
            endsAt: { gt: range.start },
          },
          // No `reason`. The field can hold medical information and this is a
          // public read (M5b design D6) — the projection is the guarantee.
          select: { startsAt: true, endsAt: true },
        },
        bookings: {
          where: {
            status: { in: POSSIBLY_BLOCKING },
            startTime: {
              gte: earliestOverlappingStart(range.start, MAX_DURATION_MINUTES * MINUTE_MS),
              lt: range.end,
            },
            endTime: { gt: range.start },
          },
          // Four columns. No client id, no cancellation token, no price, no
          // deposit: none of them decides whether a time is free, and this read
          // serves an anonymous visitor.
          select: { startTime: true, endTime: true, status: true, holdExpiresAt: true },
        },
      },
    });

    if (row === null) {
      return { windows: [], absences: [], bookings: [] };
    }

    return {
      windows: row.workingHours,
      absences: row.timeOffs.map((absence) => ({
        start: absence.startsAt,
        end: absence.endsAt,
      })),
      bookings: row.bookings,
    };
  }
}
