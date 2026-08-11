import type { WorkingHours } from '@/server/domain/models/WorkingHours';
import type { Weekday } from '@/server/domain/models/weekday';

export interface NewWorkingWindow {
  dayOfWeek: Weekday;
  startMinute: number;
  endMinute: number;
}

/**
 * Repository contract for a barber's recurring schedule.
 *
 * Every method takes `ownerId`, so an unscoped schedule query is inexpressible —
 * the same rule the barber, location, service and assignment contracts follow.
 * `Barber` has no `ownerId` column, so scoping is a predicate through
 * `barber.location.ownerId`.
 */
export interface IWorkingHoursRepository {
  /** The barber's whole week, scoped to the owner. */
  findForBarber(barberId: string, ownerId: string): Promise<WorkingHours[]>;

  /**
   * Replaces the barber's entire week with `windows`, atomically.
   *
   * Deliberately a replacement and not an append or a diff: a working window has
   * no natural business key, so an additive write would insert a second copy of
   * the whole week on a retry after a committed-but-timed-out save. Replacement
   * makes the end state depend on the submission rather than on how many times
   * it was applied (design D4).
   */
  replaceForBarber(barberId: string, ownerId: string, windows: NewWorkingWindow[]): Promise<void>;

  /**
   * Barber ids that have at least one window, for the whole owner, as one
   * aggregate. Backs the list indicator; counting per rendered row is forbidden.
   */
  findBarberIdsWithSchedule(ownerId: string): Promise<Set<string>>;
}
