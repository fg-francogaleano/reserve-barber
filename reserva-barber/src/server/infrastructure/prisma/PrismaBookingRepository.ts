import type {
  BookingByToken,
  HeldBooking,
  IBookingRepository,
  ProvisionalBookingInput,
  ProvisionalBookingResult,
} from '@/server/domain/repositories/IBookingRepository';
import type { Interval } from '@/server/domain/models/availability';
import { overlaps } from '@/server/domain/models/availability';
import { blocksAvailability, type BookingStatus } from '@/server/domain/models/Booking';
import { workingIntervalsFor } from '@/server/domain/models/bookingCalendar';
import { MAX_DURATION_MINUTES } from '@/server/domain/models/slotGranularity';
import { MAX_TIME_OFF_DAYS } from '@/server/application/timeOff/timeOffSchema';
import { toCanonicalDecimal } from './canonicalDecimal';
import type { PrismaClient } from '@/generated/prisma/client';

/**
 * Statuses that can matter, as a **read** filter — the same list the
 * availability read uses, and wider than the blocking rule on purpose.
 * `blocksAvailability` decides; encoding the expired-hold clause as SQL here
 * would be the second copy that drifts.
 */
const POSSIBLY_BLOCKING: BookingStatus[] = ['PENDING_PAYMENT', 'PENDING_APPROVAL', 'CONFIRMED'];

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/**
 * How long the transaction may wait for a connection, and how long it may hold
 * one (B4 design D3).
 *
 * Explicit rather than inherited. The transaction pins a pooled connection for
 * its duration and the pool is shared with the owner's dashboard, so an
 * unbounded one under contention degrades a surface that has nothing to do
 * with this flow. Four statements at the ~350–400 ms round trips B2 measured
 * fit comfortably inside the execution budget; the wait budget is what queues
 * a burst on one barber rather than failing it.
 */
const TRANSACTION_OPTIONS = { maxWait: 5_000, timeout: 15_000 } as const;

/**
 * The same lower bound the availability read uses, and for the same measured
 * reason: `startTime < end AND endTime > start` bounds the scan from above
 * only, leaving `endTime` in Filter while PostgreSQL walks every earlier row
 * of that barber. Safe because both entities have an enforced maximum length.
 */
function earliestOverlappingStart(rangeStart: Date, maxLengthMs: number): Date {
  return new Date(rangeStart.getTime() - maxLengthMs);
}

/** Scoping predicate. `Barber` has no ownerId column (`data-model.md` §5). */
function ownedBy(ownerId: string) {
  return { location: { ownerId } };
}

function containsWholly(outer: Interval, inner: Interval): boolean {
  return outer.start.getTime() <= inner.start.getTime() && outer.end.getTime() >= inner.end.getTime();
}

export class PrismaBookingRepository implements IBookingRepository {
  constructor(private readonly db: PrismaClient) {}

  /**
   * The no-overlap invariant, enforced inside one transaction.
   *
   * The order of the five steps is the rule, not an implementation detail:
   *
   * 1. **The advisory lock is the first statement.** Taken before any read, so
   *    two requests for the same barber serialize rather than both reading a
   *    free slot and both inserting. It is transaction-scoped, so it releases
   *    on commit or rollback with nothing to clean up.
   * 2. **Re-read the day** — windows, absences and candidate bookings — under
   *    the lock. Reading before the lock would be reading a state the lock was
   *    supposed to freeze.
   * 3. **`blocksAvailability` decides**, the same function the availability
   *    read calls. Never a SQL predicate: the rule reads a deadline, and a
   *    copy would drift the first time B7 refines it, offering a client a time
   *    and then refusing them while they pay.
   * 4. **Re-assert the schedule.** An owner can narrow a window or record an
   *    absence between the moment the times were offered and the moment one is
   *    submitted (`tech-debt.md` T29). This is the only place where the answer
   *    is still current.
   * 5. **Insert.**
   *
   * **Why not an exclusion constraint.** `btree_gist` over
   * `(barberId, tsrange(startTime, endTime))` would be stronger than anything
   * application code can do — but its predicate cannot include the
   * expired-hold clause, because `holdExpiresAt > now()` is not immutable and
   * cannot appear in a partial index predicate. It could only cover the three
   * blocking statuses, so it would refuse a write over a slot availability
   * correctly reports as free: the read/write divergence this story exists to
   * prevent, arriving from the direction nobody would watch.
   *
   * **Why not serializable isolation.** Also correct, and it turns every
   * collision into a 40001 needing retry orchestration on an endpoint with no
   * rate limit. The advisory lock has the granularity the domain actually has:
   * one barber's calendar.
   *
   * **The lock binds only code that takes it.** This is the sole writer of
   * `Booking` today; B7's sweeper and D2's approval must take the same lock
   * when they arrive.
   */
  async createProvisional(input: ProvisionalBookingInput): Promise<ProvisionalBookingResult> {
    const requested: Interval = { start: input.startTime, end: input.endTime };

    return this.db.$transaction(async (tx) => {
      // 1. Serialize on the barber, before reading anything.
      //
      // `hashtextextended` is a PostgreSQL built-in (11+) needing no
      // extension. The zero seed is arbitrary and fixed: every caller must
      // hash the same way or they would take different locks for one barber.
      //
      // **`$executeRaw`, never `$queryRaw`.** `pg_advisory_xact_lock` returns
      // `void`, and the pg driver adapter cannot deserialize a void column —
      // it raises `UnsupportedNativeDataType`, which surfaces as a generic
      // P2010 and aborts the transaction. This statement is run for its
      // effect, not its result, and `$executeRaw` is the call that does not
      // try to read columns back. Measured against the live database: with
      // `$queryRaw` every booking write failed.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${input.barberId}, 0))`;

      // 2. Re-read the day under the lock. Entered from `Barber` so the owner
      // predicate, the weekday filter and both range filters hang off one row
      // — and so a barber belonging to another owner returns null here rather
      // than empty lists that would read as "free all day".
      const barber = await tx.barber.findFirst({
        where: { id: input.barberId, isActive: true, ...ownedBy(input.ownerId) },
        select: {
          workingHours: {
            where: { dayOfWeek: input.weekday },
            select: { startMinute: true, endMinute: true },
            orderBy: [{ startMinute: 'asc' }],
          },
          timeOffs: {
            where: {
              startsAt: {
                gte: earliestOverlappingStart(input.dayRange.start, MAX_TIME_OFF_DAYS * DAY_MS),
                lt: input.dayRange.end,
              },
              endsAt: { gt: input.dayRange.start },
            },
            // No `reason`: it can hold medical information (M5b design D6).
            select: { startsAt: true, endsAt: true },
          },
          bookings: {
            where: {
              status: { in: POSSIBLY_BLOCKING },
              startTime: {
                gte: earliestOverlappingStart(
                  input.dayRange.start,
                  MAX_DURATION_MINUTES * MINUTE_MS
                ),
                lt: input.dayRange.end,
              },
              endTime: { gt: input.dayRange.start },
            },
            // `clientId` is selected here and nowhere else in a public read:
            // it is what distinguishes this client's own hold from a stranger's
            // (design D7), and without it a double tap reports a conflict to
            // the person who just succeeded.
            select: {
              id: true,
              clientId: true,
              startTime: true,
              endTime: true,
              status: true,
              holdExpiresAt: true,
              cancellationToken: true,
              depositAmount: true,
            },
          },
        },
      });

      if (barber === null) {
        return { outcome: 'slotTaken' as const };
      }

      // 3. The shared predicate decides which of them block.
      const blocking = barber.bookings.filter((booking) =>
        blocksAvailability(booking, input.now)
      );
      const conflicting = blocking.filter((booking) =>
        overlaps({ start: booking.startTime, end: booking.endTime }, requested)
      );

      if (conflicting.length > 0) {
        // The same client's own hold for this exact start is not a conflict —
        // it is a repeat submission (design D7). Returned rather than refused,
        // which makes a double tap, a retried POST and a back-button
        // re-submission all resolve to the one appointment.
        const own = conflicting.find(
          (booking) =>
            booking.clientId === input.clientId &&
            booking.startTime.getTime() === input.startTime.getTime()
        );

        if (own !== undefined && conflicting.length === 1) {
          return {
            outcome: 'alreadyHeld' as const,
            booking: {
              id: own.id,
              cancellationToken: own.cancellationToken,
              startTime: own.startTime,
              endTime: own.endTime,
              holdExpiresAt: own.holdExpiresAt,
              depositAmount: toCanonicalDecimal(own.depositAmount),
            },
          };
        }

        return { outcome: 'slotTaken' as const };
      }

      // 4. The schedule may have changed since the times were offered (T29).
      const windows = workingIntervalsFor(input.localDate, barber.workingHours);
      const fitsAWindow = windows.some((window) => containsWholly(window, requested));
      const hitsAnAbsence = barber.timeOffs.some((absence) =>
        overlaps({ start: absence.startsAt, end: absence.endsAt }, requested)
      );

      if (!fitsAWindow || hitsAnAbsence) {
        return { outcome: 'slotTaken' as const };
      }

      // 5. Only now.
      const created = await tx.booking.create({
        data: {
          clientId: input.clientId,
          barberId: input.barberId,
          serviceId: input.serviceId,
          startTime: input.startTime,
          endTime: input.endTime,
          status: 'PENDING_PAYMENT',
          priceAtBooking: input.priceAtBooking,
          depositAmount: input.depositAmount,
          cancellationToken: input.cancellationToken,
          holdExpiresAt: input.holdExpiresAt,
        },
        select: {
          id: true,
          cancellationToken: true,
          startTime: true,
          endTime: true,
          holdExpiresAt: true,
          depositAmount: true,
        },
      });

      return {
        outcome: 'created' as const,
        booking: this.toHeldBooking(created),
      };
    }, TRANSACTION_OPTIONS);
  }

  /**
   * Live holds for one client (FR11's cap).
   *
   * "Live" asks the same question `blocksAvailability` does, expressed here as
   * the SQL that can be counted without loading rows: a `PENDING_PAYMENT` row
   * past its deadline is not holding anything. `PENDING_APPROVAL` counts
   * regardless of age — a receipt is uploaded and a human owes an answer.
   */
  async countLiveHoldsForClient(clientId: string, now: Date): Promise<number> {
    return this.db.booking.count({
      where: {
        clientId,
        OR: [
          { status: 'PENDING_APPROVAL' },
          { status: 'PENDING_PAYMENT', holdExpiresAt: null },
          { status: 'PENDING_PAYMENT', holdExpiresAt: { gt: now } },
        ],
      },
    });
  }

  /**
   * This client's live holds with one barber on one day (design D7's second
   * half).
   *
   * The `blocksAvailability` question, expressed as the SQL that can be
   * answered without loading the day: a `PENDING_PAYMENT` row past its
   * deadline is not holding anything.
   */
  async findLiveHoldsForClientOnDay(input: {
    clientId: string;
    barberId: string;
    dayRange: Interval;
    now: Date;
  }): Promise<HeldBooking[]> {
    const rows = await this.db.booking.findMany({
      where: {
        clientId: input.clientId,
        barberId: input.barberId,
        startTime: { gte: input.dayRange.start, lt: input.dayRange.end },
        OR: [
          { status: 'PENDING_APPROVAL' },
          { status: 'CONFIRMED' },
          { status: 'PENDING_PAYMENT', holdExpiresAt: null },
          { status: 'PENDING_PAYMENT', holdExpiresAt: { gt: input.now } },
        ],
      },
      select: {
        id: true,
        cancellationToken: true,
        startTime: true,
        endTime: true,
        holdExpiresAt: true,
        depositAmount: true,
      },
    });

    return rows.map((row) => this.toHeldBooking(row));
  }

  /**
   * The confirmation page's read, as a named projection.
   *
   * The client's email and phone are **not selected**. The page is addressed
   * by a token that can be shared or opened on a shared device, so the columns
   * it cannot select are the columns it cannot render.
   */
  async findByCancellationToken(token: string): Promise<BookingByToken | null> {
    const row = await this.db.booking.findUnique({
      where: { cancellationToken: token },
      select: {
        id: true,
        status: true,
        startTime: true,
        endTime: true,
        holdExpiresAt: true,
        depositAmount: true,
        client: { select: { name: true } },
        service: { select: { name: true } },
        barber: { select: { displayName: true, location: { select: { name: true } } } },
      },
    });

    if (row === null) return null;

    return {
      id: row.id,
      status: row.status,
      startTime: row.startTime,
      endTime: row.endTime,
      holdExpiresAt: row.holdExpiresAt,
      depositAmount: toCanonicalDecimal(row.depositAmount),
      clientName: row.client.name,
      barberDisplayName: row.barber.displayName,
      serviceName: row.service.name,
      locationName: row.barber.location.name,
    };
  }

  private toHeldBooking(row: {
    id: string;
    cancellationToken: string;
    startTime: Date;
    endTime: Date;
    holdExpiresAt: Date | null;
    depositAmount: unknown;
  }): HeldBooking {
    return {
      id: row.id,
      cancellationToken: row.cancellationToken,
      startTime: row.startTime,
      endTime: row.endTime,
      holdExpiresAt: row.holdExpiresAt,
      depositAmount: toCanonicalDecimal(row.depositAmount),
    };
  }
}
