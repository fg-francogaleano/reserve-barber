import {
  businessToday,
  dayBoundsOf,
  weekdayOfLocalDate,
  type LocalDate,
} from '@/server/domain/models/bookingCalendar';
import { hasTimezoneSupport } from '@/server/domain/models/businessTime';
import { composeCalendarDay, type CalendarDay } from '@/server/domain/models/barberCalendarDay';
import type { IBarberCalendarRepository } from '@/server/domain/repositories/IBarberCalendarRepository';
import type { CalendarBarber } from '@/server/domain/repositories/IBarberCalendarRepository';
import type { IClock } from '@/server/domain/repositories/IClock';
import { TimezoneUnavailableError } from './PublicAvailabilityService';

/**
 * What the calendar page renders when the barber resolved.
 *
 * `today` travels with the day so the page can mark a past date and offer the
 * way back without asking the clock a second question — a second reading could
 * land on the other side of midnight from the first.
 */
export interface BarberCalendarView {
  readonly barber: CalendarBarber;
  readonly date: LocalDate;
  readonly today: LocalDate;
  readonly day: CalendarDay;
}

/**
 * Composes the calendar read with the pure day rules.
 *
 * The split is `PublicAvailabilityService`'s: everything deciding *what a day
 * looks like* is in `barberCalendarDay.ts` and `Booking.ts`, testable without a
 * database and without freezing a clock. What lives here is the part that cannot
 * be pure — reading rows, and knowing what day it is.
 */
export class BarberCalendarService {
  constructor(
    private readonly calendar: IBarberCalendarRepository,
    private readonly clock: IClock
  ) {}

  /** The business's current calendar day. Never the runtime's. */
  today(): LocalDate {
    return businessToday(this.now());
  }

  /**
   * One barber's day, or `null` when the id resolves to nothing within this
   * owner's scope.
   *
   * The `null` is passed straight through to `notFound()`. An unknown id and
   * another owner's id must produce the same response, and the cheapest way to
   * guarantee that is for neither this method nor the page to have a branch
   * that could tell them apart.
   *
   * `date` arrives already resolved and bounded — this layer never sees the raw
   * parameter — and is converted to a weekday and an instant range here, because
   * that conversion is a domain rule and the repository decides nothing.
   */
  async dayFor(input: {
    barberId: string;
    ownerId: string;
    date: LocalDate;
  }): Promise<BarberCalendarView | null> {
    const now = this.now();

    const inputs = await this.calendar.findDay({
      barberId: input.barberId,
      ownerId: input.ownerId,
      weekday: weekdayOfLocalDate(input.date),
      range: dayBoundsOf(input.date),
    });

    if (inputs === null) return null;

    return {
      barber: inputs.barber,
      date: input.date,
      today: businessToday(now),
      day: composeCalendarDay({
        date: input.date,
        windows: inputs.windows,
        absences: inputs.absences,
        appointments: inputs.appointments,
        now,
      }),
    };
  }

  /**
   * The current instant, refused if the runtime cannot place it in the
   * business's calendar.
   *
   * The composition root asserts the same thing before a repository is built —
   * that is the only place early enough that no wrong day can be computed. This
   * check is the class's own invariant: it makes the service safe for any future
   * caller that did not come through that root, without which the guarantee
   * would be a property of one call site rather than of the rule.
   *
   * A calendar that quietly shows the wrong date is worse than one that says it
   * cannot: the runtime is UTC and the business is at UTC−3, so a wrong answer
   * here is a plausible number, not a visible failure.
   */
  private now(): Date {
    if (!hasTimezoneSupport()) {
      throw new TimezoneUnavailableError();
    }
    return new Date(this.clock.now());
  }
}
