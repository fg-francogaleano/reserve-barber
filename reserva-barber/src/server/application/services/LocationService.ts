import type { Location } from '@/server/domain/models/Location';
import type { ILocationRepository } from '@/server/domain/repositories/ILocationRepository';
import type {
  CreateLocationInput,
  UpdateLocationInput,
} from '@/server/application/locations/locationSchema';
import {
  DuplicateLocationNameError,
  LocationLimitReachedError,
  LocationNotFoundError,
} from '@/server/domain/errors/LocationErrors';

/**
 * Maximum locations one owner may hold (design D6). M1 ships create and edit
 * but neither delete nor deactivation, so without a ceiling a runaway client
 * leaves rows the owner cannot remove from the application. Set well above any
 * real barbershop chain: it bounds accidents, it does not shape the product.
 */
export const MAX_LOCATIONS_PER_OWNER = 50;

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

/**
 * Recognises a unique-constraint failure structurally rather than by importing
 * Prisma: the application layer must not depend on infrastructure
 * (`project-scaffold` — dependency direction).
 */
function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === UNIQUE_CONSTRAINT_VIOLATION
  );
}

/** Application service orchestrating the owner's location use cases. */
export class LocationService {
  constructor(private readonly locations: ILocationRepository) {}

  listOwnerLocations(ownerId: string): Promise<Location[]> {
    return this.locations.findAllByOwner(ownerId);
  }

  findLocationForOwner(ownerId: string, id: string): Promise<Location | null> {
    return this.locations.findByIdForOwner(id, ownerId);
  }

  async createLocation(ownerId: string, input: CreateLocationInput): Promise<Location> {
    const existing = await this.locations.countByOwner(ownerId);
    if (existing >= MAX_LOCATIONS_PER_OWNER) {
      throw new LocationLimitReachedError();
    }

    await this.assertNameIsFree(ownerId, input.name);

    return this.createOrTranslate(() => this.locations.create(ownerId, input));
  }

  async updateLocation(ownerId: string, input: UpdateLocationInput): Promise<Location> {
    // `excludeId` keeps a location from being reported as a duplicate of itself
    // when the owner saves the form without renaming it.
    await this.assertNameIsFree(ownerId, input.name, input.id);

    const updated = await this.createOrTranslate(() =>
      this.locations.update(input.id, ownerId, { name: input.name, address: input.address })
    );

    if (updated === null) {
      // The predicate carries ownerId, so no match means an unknown id or a
      // different owner — never "the values happened to be identical" (D8).
      throw new LocationNotFoundError();
    }
    return updated;
  }

  /**
   * The pre-check exists for the error message, not for correctness: it and the
   * write are separate round trips against a transaction-mode pooler, so a race
   * can still slip through to the database constraint (design D2). That is why
   * every write also goes through `createOrTranslate`.
   */
  private async assertNameIsFree(ownerId: string, name: string, excludeId?: string): Promise<void> {
    if (await this.locations.existsByOwnerAndName(ownerId, name, excludeId)) {
      throw new DuplicateLocationNameError();
    }
  }

  private async createOrTranslate<T>(write: () => Promise<T>): Promise<T> {
    try {
      return await write();
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        // Prisma's message names the constraint and its columns; the specs
        // forbid that reaching a response body.
        throw new DuplicateLocationNameError();
      }
      throw error;
    }
  }
}
