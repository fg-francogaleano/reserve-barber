import type { Interval } from '@/server/domain/models/availability';
import type { BlockingCandidate } from '@/server/domain/models/Booking';

/** A working window as stored: wall-clock minutes, never an instant. */
export interface WorkingWindowMinutes {
  readonly startMinute: number;
  readonly endMinute: number;
}

/**
 * Everything slot generation needs for one barber on one day.
 *
 * A **list** of windows, not one. `docs/tech-debt.md` T27: the editor writes one
 * window per weekday today, and the schema permits a split shift without a
 * migration. A contract shaped around the editor's current behaviour would be
 * the reason the generator could not fix it later.
 *
 * `absences` are plain intervals — the projection that carries no `reason`.
 * M5b confined that field structurally because it can hold medical information,
 * and a public availability read is the consumer it was confined against.
 */
export interface DayAvailabilityInputs {
  readonly windows: readonly WorkingWindowMinutes[];
  readonly absences: readonly Interval[];
  readonly bookings: readonly BlockingCandidate[];
}

/**
 * Repository contract for what decides a barber's free time.
 *
 * `ownerId` is required, so an unscoped availability query is inexpressible
 * through this contract — the same property every other repository in this
 * project holds. `Barber` has no `ownerId` column (data-model.md §5), so
 * scoping is a predicate through `barber.location.ownerId`.
 *
 * **This contract is read-only, and B3 writes no booking anywhere.** The write
 * path, the provisional hold and the transactional no-overlap check are B4's.
 */
export interface IBarberAvailabilityRepository {
  /**
   * One round trip returning the windows for a weekday, the absences
   * overlapping a range, and the bookings that may block inside it.
   *
   * **One trip by contract, not by luck.** B2 measured ~0.35–0.40 s per
   * Supavisor round trip on this runtime; three separate reads would put the
   * slot step at five trips including the slug and catalogue reads, on the route
   * that earns the business money, against a pool shared with the owner's
   * dashboard (`docs/tech-debt.md` T47).
   *
   * The booking filter is deliberately **wider than the blocking rule**: it
   * returns every booking overlapping the range whose status could matter, and
   * `blocksAvailability` decides. Encoding the expired-hold clause as SQL would
   * be a second copy of a rule B4 must share, and the two would drift.
   */
  findDayInputs(
    barberId: string,
    ownerId: string,
    weekday: number,
    range: Interval
  ): Promise<DayAvailabilityInputs>;
}
