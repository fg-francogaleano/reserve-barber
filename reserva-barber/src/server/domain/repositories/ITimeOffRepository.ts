import type { TimeOff, TimeOffPeriod } from '@/server/domain/models/TimeOff';

export interface NewTimeOff {
  startsAt: Date;
  endsAt: Date;
  reason: string | null;
}

/**
 * Repository contract for a barber's absences.
 *
 * Every method takes `ownerId`, so an unscoped absence query is inexpressible.
 * `Barber` has no `ownerId` column, so scoping is a predicate through
 * `barber.location.ownerId`.
 */
export interface ITimeOffRepository {
  /** The barber's absences for the editor, newest first. Carries `reason`. */
  findForBarber(barberId: string, ownerId: string): Promise<TimeOff[]>;

  /**
   * The same absences for availability, **without** `reason` (design D6).
   * Kept separate so a consumer that has no business seeing the note cannot.
   */
  findPeriodsForBarber(barberId: string, ownerId: string): Promise<TimeOffPeriod[]>;

  countForBarber(barberId: string, ownerId: string): Promise<number>;

  /**
   * Records an absence. Re-recording an identical range is a no-op rather than
   * a violation, which is what makes a retried create safe — this write has no
   * replacement semantics to fall back on.
   */
  create(barberId: string, ownerId: string, data: NewTimeOff): Promise<void>;

  /**
   * Removes an absence, scoped by owner. Matching no row is **not** an error:
   * from the owner's point of view the absence is gone either way, and two open
   * tabs must not produce a failure.
   */
  remove(id: string, ownerId: string): Promise<void>;
}
