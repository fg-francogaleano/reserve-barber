import { generateSlots } from '@/server/domain/models/availability';
import { blocksAvailability } from '@/server/domain/models/Booking';
import {
  businessToday,
  dayBoundsOf,
  weekdayOfLocalDate,
  workingIntervalsFor,
  type LocalDate,
} from '@/server/domain/models/bookingCalendar';
import { MIN_BOOKING_LEAD_MINUTES } from '@/server/domain/models/bookingHorizon';
import { hasTimezoneSupport } from '@/server/domain/models/businessTime';
import type { IBarberAvailabilityRepository } from '@/server/domain/repositories/IBarberAvailabilityRepository';
import type { IWorkingHoursRepository } from '@/server/domain/repositories/IWorkingHoursRepository';
import type { IClock } from '@/server/domain/repositories/IClock';
import type { Weekday } from '@/server/domain/models/weekday';

/**
 * Raised when the runtime cannot tell the business's time from UTC.
 *
 * **The route asserts this at its composition root**, before any repository is
 * built — that is where the spec puts it, and it is the only place early enough
 * that no wrong time can be computed. This check is the service's own invariant:
 * it makes the class safe for any future caller that did not come through that
 * root, without which the guarantee would be a property of one call site rather
 * than of the rule.
 *
 * Two calls to `hasTimezoneSupport()` per request is a formatted date each. The
 * duplication is in the assertion, not in the definition of what "supported"
 * means, which lives in `businessTime`.
 */
export class TimezoneUnavailableError extends Error {
  constructor() {
    super('Business timezone data is unavailable on this runtime');
    this.name = 'TimezoneUnavailableError';
  }
}

/**
 * Composes the availability read with the pure slot rule.
 *
 * The split is the point: everything that decides *which times are free* is in
 * `availability.ts` and `Booking.ts`, testable without a database and without
 * freezing a clock. What lives here is the part that cannot be pure — reading
 * rows, and knowing what time it is.
 */
export class PublicAvailabilityService {
  constructor(
    private readonly availability: IBarberAvailabilityRepository,
    private readonly schedules: IWorkingHoursRepository,
    private readonly clock: IClock
  ) {}

  /** The business's current calendar day. Never the runtime's. */
  today(): LocalDate {
    return businessToday(this.now());
  }

  /**
   * The weekdays this barber works at all, for the date step.
   *
   * Cheap by construction: seven rows at most, no absences, no bookings. It
   * answers "does the barber work Sundays", which is the only thing the strip
   * needs to mark a day unavailable.
   *
   * It deliberately does **not** answer "is there anything free that day".
   * Doing so would mean one full availability computation per day in the
   * horizon — sixty of them — on the route with neither a cache nor a rate
   * limit (design D8). A day that is fully booked stays selectable and resolves
   * to the slot step's empty state.
   */
  async workingWeekdays(barberId: string, ownerId: string): Promise<Set<Weekday>> {
    const week = await this.schedules.findForBarber(barberId, ownerId);
    return new Set(week.map((window) => window.dayOfWeek));
  }

  /**
   * The start times a client may choose for one barber, one service and one day.
   *
   * One round trip, then pure computation. The blocking decision is made here
   * rather than in SQL so that `blocksAvailability` stays the single rule B4's
   * transaction also applies.
   */
  async slotsFor(input: {
    barberId: string;
    ownerId: string;
    date: LocalDate;
    durationMinutes: number;
  }): Promise<Date[]> {
    const now = this.now();
    const range = dayBoundsOf(input.date);

    const { windows, absences, bookings } = await this.availability.findDayInputs(
      input.barberId,
      input.ownerId,
      weekdayOfLocalDate(input.date),
      range
    );

    const blocked = bookings
      .filter((booking) => blocksAvailability(booking, now))
      .map((booking) => ({ start: booking.startTime, end: booking.endTime }));

    return generateSlots({
      windows: workingIntervalsFor(input.date, windows),
      blockers: [...absences, ...blocked],
      durationMinutes: input.durationMinutes,
      now,
      minLeadMinutes: MIN_BOOKING_LEAD_MINUTES,
    });
  }

  /**
   * The current instant, refused if the runtime cannot place it in the
   * business's calendar.
   *
   * The check is here rather than at module load because a composition root that
   * throws at import time takes down routes that never needed a timezone.
   */
  private now(): Date {
    if (!hasTimezoneSupport()) {
      throw new TimezoneUnavailableError();
    }
    return new Date(this.clock.now());
  }
}
