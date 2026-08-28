import type { Interval } from '@/server/domain/models/availability';
import type { CalendarAppointment } from '@/server/domain/models/barberCalendarDay';
import type { WorkingWindowMinutes } from './IBarberAvailabilityRepository';

/** Who the day belongs to, as the page's heading needs them. */
export interface CalendarBarber {
  readonly id: string;
  readonly displayName: string;
  readonly locationName: string;
}

/** Everything one barber's day is drawn from, from one round trip. */
export interface BarberCalendarDayInputs {
  readonly barber: CalendarBarber;
  readonly windows: readonly WorkingWindowMinutes[];
  readonly absences: readonly Interval[];
  readonly appointments: readonly CalendarAppointment[];
}

/**
 * The owner's per-barber calendar read (D3). One method, one round trip, no
 * writes.
 *
 * ---
 *
 * **Why this is not `IBarberAvailabilityRepository.findDayInputs`.**
 *
 * That method answers the same shape of question over the same three tables,
 * and its projection is deliberately four columns because it serves an
 * **anonymous** visitor choosing a time. A client's name has no business in it,
 * and widening it to carry one would put a guest's personal data into the read
 * the public booking flow performs on every slot request.
 *
 * It also filters bookings down to the statuses that could block. This read must
 * see cancelled and expired rows, because the calendar records them beside the
 * day rather than pretending they never existed.
 *
 * **Why it is not a method on `IBookingRepository`.** That contract reads and
 * writes booking aggregates; this returns a page's composed projection across
 * three tables. `IDashboardSummaryRepository` set the precedent and its header
 * gives the reason: the separation is about **shape**, not scoping.
 *
 * ---
 *
 * **What every implementation must hold.**
 *
 * 1. **Scope reaches the owner through `barber → location → ownerId`.** A
 *    booking's location is deliberately not duplicated onto the row
 *    (`data-model.md` §11), so this is the only path. There is no row-level
 *    security on these tables: the join **is** the tenancy boundary.
 * 2. **Unknown and foreign are the same answer.** A barber id that resolves to
 *    nothing within this owner's scope returns `null` — never empty lists,
 *    which would read as "this barber has a free day", and never a distinct
 *    error, which would tell any signed-in owner whether another shop's id
 *    exists.
 * 3. **One round trip.** B2 measured ~0.35–0.40 s per Supavisor round trip on
 *    this runtime, against a pool shared with the public booking flow
 *    (`docs/tech-debt.md` T47), on a page the owner reloads freely. Entering
 *    from `Barber` is what makes it one: the owner predicate, the weekday
 *    filter and both range filters all hang off a single row.
 * 4. **Ranges match by overlap at both ends**, `start < range.end AND end >
 *    range.start`. Selecting on the start instant alone erases an appointment
 *    that crosses midnight from the second of its two days, and a multi-day
 *    absence from every day between its first and its last.
 * 5. **SQL may narrow; it may not decide.** A statement here filters by owner,
 *    by barber, by weekday and by instant range. It SHALL NOT filter by booking
 *    status: `calendarPresence` is the only rule that says how a booking appears
 *    on a calendar, and a second copy in SQL would drift from it.
 * 6. **The projection carries no contact detail, no money, and no absence
 *    reason.** A field that is not selected cannot reach a log line or a
 *    serialized prop. Contact details are D4's, money is D5's, and `reason` is a
 *    field M5b confined structurally because it can hold medical information.
 * 7. **Cross-owner isolation is proven by a two-owner fixture, never by
 *    inspection.** A leaked calendar produces no row that looks wrong — only a
 *    plausible day.
 */
export interface IBarberCalendarRepository {
  /**
   * One barber's day, or `null` when the id resolves to nothing within this
   * owner's scope.
   *
   * `weekday` and `range` arrive already computed, because converting a
   * business-local calendar boundary into an instant is a domain rule and this
   * layer decides nothing.
   *
   * **An inactive barber is returned, deliberately.** Their appointments
   * happened, and a calendar that closed on deactivation would destroy the
   * history the owner deactivated them to preserve — the rule
   * `findFilterableBarbers` already applies to the dashboard's own filter.
   */
  findDay(input: {
    barberId: string;
    ownerId: string;
    weekday: number;
    range: Interval;
  }): Promise<BarberCalendarDayInputs | null>;
}
