import type {
  BarberCalendarDayInputs,
  IBarberCalendarRepository,
} from '@/server/domain/repositories/IBarberCalendarRepository';
import type { Interval } from '@/server/domain/models/availability';
import { MAX_DURATION_MINUTES } from '@/server/domain/models/slotGranularity';
import { MAX_TIME_OFF_DAYS } from '@/server/application/timeOff/timeOffSchema';
import type { PrismaClient } from '@/generated/prisma/client';

/** Scoping predicate. `Barber` has no ownerId column (data-model.md §5). */
function ownedBy(ownerId: string) {
  return { location: { ownerId } };
}

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/**
 * How far back a row can start and still overlap a range.
 *
 * The same bound `PrismaBarberAvailabilityRepository` documents, and it is here
 * for the same measured reason: `startTime < rangeEnd AND endTime > rangeStart`
 * bounds the scan from above only, so PostgreSQL walks every earlier row of that
 * barber and discards it in a filter. It is safe because both entities have an
 * enforced maximum length — a row starting earlier than `rangeStart - maximum`
 * must already have ended before `rangeStart` — and the maxima come from the
 * validators that enforce them, so the bound cannot drift from the rule it
 * depends on.
 */
function earliestOverlappingStart(rangeStart: Date, maxLengthMs: number): Date {
  return new Date(rangeStart.getTime() - maxLengthMs);
}

export class PrismaBarberCalendarRepository implements IBarberCalendarRepository {
  constructor(private readonly db: PrismaClient) {}

  /**
   * One query, entered from `Barber`, with four nested projections.
   *
   * Entering from the barber is what makes it one trip: the owner predicate,
   * the weekday filter and both range filters all hang off a single row. It is
   * also what makes an unknown id and another owner's id the same answer —
   * `null` — rather than a distinguishable pair of results.
   *
   * **No `isActive` filter**, unlike the availability read. That one serves
   * clients choosing a bookable time; this one serves an owner looking at what
   * happened, and a deactivated barber's appointments happened.
   *
   * **No status filter**, unlike the availability read. Every booking
   * overlapping the day is returned whatever its status, and `calendarPresence`
   * decides how each appears — including the cancelled and expired rows the
   * recorded lane exists to show.
   */
  async findDay(input: {
    barberId: string;
    ownerId: string;
    weekday: number;
    range: Interval;
  }): Promise<BarberCalendarDayInputs | null> {
    const { barberId, ownerId, weekday, range } = input;

    const row = await this.db.barber.findFirst({
      where: { id: barberId, ...ownedBy(ownerId) },
      select: {
        id: true,
        displayName: true,
        location: { select: { name: true } },
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
          // No `reason`. The field can hold medical information and M5b
          // confined it structurally — the projection is the guarantee.
          select: { startsAt: true, endsAt: true },
        },
        bookings: {
          where: {
            startTime: {
              gte: earliestOverlappingStart(range.start, MAX_DURATION_MINUTES * MINUTE_MS),
              lt: range.end,
            },
            endTime: { gt: range.start },
          },
          // No price, no deposit, no cancellation token, no client id, and the
          // client narrowed to a display name. Contact details are D4's and
          // money is D5's; a field that is not selected cannot reach a log line
          // or a serialized prop.
          select: {
            id: true,
            startTime: true,
            endTime: true,
            status: true,
            holdExpiresAt: true,
            cancelledBy: true,
            client: { select: { name: true } },
            service: { select: { name: true } },
          },
          orderBy: [{ startTime: 'asc' }],
        },
      },
    });

    if (row === null) return null;

    return {
      barber: {
        id: row.id,
        displayName: row.displayName,
        locationName: row.location.name,
      },
      windows: row.workingHours,
      absences: row.timeOffs.map((absence) => ({
        start: absence.startsAt,
        end: absence.endsAt,
      })),
      appointments: row.bookings.map((booking) => ({
        id: booking.id,
        startTime: booking.startTime,
        endTime: booking.endTime,
        status: booking.status,
        holdExpiresAt: booking.holdExpiresAt,
        clientName: booking.client.name,
        serviceName: booking.service.name,
        cancelledBy: booking.cancelledBy,
      })),
    };
  }
}
