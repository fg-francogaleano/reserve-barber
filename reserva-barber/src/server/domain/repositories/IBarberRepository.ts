import type { Barber } from '@/server/domain/models/Barber';

export interface NewBarberData {
  locationId: string;
  displayName: string;
  bio: string | null;
}

export interface BarberUpdateData {
  locationId: string;
  displayName: string;
  bio: string | null;
}

/** Projection used by the listing page — entity stays free of joined data (design D10). */
export interface BarberWithLocation {
  barber: Barber;
  locationName: string;
  locationIsActive: boolean;
}

/**
 * Repository contract for the Barber aggregate.
 *
 * Every method takes `ownerId` as a required parameter (design D1): a `Barber`
 * has no `ownerId` column, so the interface enforces the join through
 * `location.ownerId`. An unscoped barber query is inexpressible through this
 * contract — "forgot to filter by owner" is not a mistake a caller can make.
 */
export interface IBarberRepository {
  /** All barbers owned through any of the owner's locations, ordered by location name then display name. */
  findAllByOwner(ownerId: string): Promise<BarberWithLocation[]>;

  /** A single barber scoped to the owner, or `null` when the id is unknown or belongs to someone else. */
  findByIdForOwner(id: string, ownerId: string): Promise<Barber | null>;

  /** Count of barbers at a specific location — backs the per-location cap check. */
  countByLocation(locationId: string, ownerId: string): Promise<number>;

  /**
   * Whether the location already has a barber with this normalized display name,
   * compared case-insensitively (in-memory, not ILIKE — design D9).
   * `excludeId` lets an edit skip the row being updated so it is not reported
   * as a duplicate of itself.
   */
  existsByLocationAndName(
    locationId: string,
    ownerId: string,
    displayName: string,
    excludeId?: string
  ): Promise<boolean>;

  create(ownerId: string, data: NewBarberData): Promise<Barber>;

  /**
   * Updates the barber, scoped by owner through the location relation. Returns
   * `null` when the predicate matched no row — unknown id or different owner.
   */
  update(id: string, ownerId: string, data: BarberUpdateData): Promise<Barber | null>;
}
