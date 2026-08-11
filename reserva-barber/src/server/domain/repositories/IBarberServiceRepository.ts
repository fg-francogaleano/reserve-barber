/**
 * The unit of change for an assignment set.
 *
 * The contract takes a *diff*, never a replacement set. A method accepting
 * "the services this barber should have" would put the removal decision inside
 * the repository, where the rendered baseline is not available — and removals
 * confined to what the form actually displayed is the whole point of design D3.
 * Expressing the diff in the type makes the unsafe call unwritable.
 */
export interface AssignmentDiff {
  /** Assignments to create. Already verified to belong to the owner. */
  toAdd: string[];
  /** Assignments to delete. Already intersected with what is stored. */
  toRemove: string[];
}

/**
 * Repository contract for the BarberService join.
 *
 * Every method takes `ownerId` as a required parameter, so an unscoped
 * assignment query is inexpressible through this contract — the same rule the
 * barber, location and service contracts follow. Here it carries more weight
 * than usual: the same-owner rule has no database backing (data-model.md §7),
 * so the interface is one of the few places the constraint is visible at all.
 */
export interface IBarberServiceRepository {
  /** Service ids currently assigned to the barber, scoped to the owner. */
  findServiceIdsForBarber(barberId: string, ownerId: string): Promise<string[]>;

  /**
   * Applies the diff in a single batched transaction — atomic, or nothing.
   * Re-adding an existing assignment is absorbed, not reported (design D5).
   */
  setForBarber(barberId: string, ownerId: string, diff: AssignmentDiff): Promise<void>;

  /**
   * Assigned-service count per barber, for the whole owner, as one aggregate.
   * Keyed by barber id; a barber with no assignments is absent from the map.
   */
  countServicesByBarber(ownerId: string): Promise<Map<string, number>>;

  /**
   * Count of **active** barbers per service, for the whole owner, as one
   * aggregate. Backs the bookability read, which is why inactive barbers are
   * excluded here rather than by the caller — a service assigned exclusively to
   * inactive barbers is not bookable (data-model.md §6).
   */
  countActiveBarbersByService(ownerId: string): Promise<Map<string, number>>;
}
