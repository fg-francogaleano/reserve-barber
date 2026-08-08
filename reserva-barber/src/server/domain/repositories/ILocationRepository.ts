import type { Location } from '@/server/domain/models/Location';

/** Fields a caller may set when creating a location. `ownerId` is separate and mandatory. */
export interface NewLocationData {
  name: string;
  address: string | null;
}

/** Fields a caller may change on an existing location. `isActive` is not one of them (story M6). */
export interface LocationUpdateData {
  name: string;
  address: string | null;
}

/**
 * Repository contract for the Location aggregate.
 *
 * Every method takes `ownerId` as a required parameter by design (design D7):
 * an unscoped location query is not expressible through this interface, so
 * "forgot to filter by owner" is not a mistake a caller can make. The update
 * carries `ownerId` in its own predicate rather than trusting that someone
 * read the row and checked it first — a read-then-write pair is two decisions
 * and only one of them is enforced.
 */
export interface ILocationRepository {
  /**
   * Every location owned by `ownerId`, ordered by name ascending. Includes
   * inactive locations: this backs a management screen, and hiding an inactive
   * location would make it uneditable.
   */
  findAllByOwner(ownerId: string): Promise<Location[]>;

  /** A single location, or `null` when the id is unknown *or* owned by someone else. */
  findByIdForOwner(id: string, ownerId: string): Promise<Location | null>;

  /** How many locations the owner already has — backs the per-owner cap. */
  countByOwner(ownerId: string): Promise<number>;

  /**
   * Whether the owner already has a location with this exact normalized name,
   * compared case-insensitively. `excludeId` lets an edit skip the row being
   * edited so it is not reported as a duplicate of itself.
   */
  existsByOwnerAndName(ownerId: string, name: string, excludeId?: string): Promise<boolean>;

  create(ownerId: string, data: NewLocationData): Promise<Location>;

  /**
   * Updates the location, scoped by owner. Resolves to `null` when the
   * predicate matched no row — which can only mean an unknown id or a
   * different owner, since PostgreSQL reports an affected row even when the
   * new values equal the old ones (design D8).
   */
  update(id: string, ownerId: string, data: LocationUpdateData): Promise<Location | null>;
}
