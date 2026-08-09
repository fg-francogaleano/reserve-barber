import type { Barber } from '@/server/domain/models/Barber';
import type { IBarberRepository, BarberWithLocation } from '@/server/domain/repositories/IBarberRepository';
import type { ILocationRepository } from '@/server/domain/repositories/ILocationRepository';
import type { CreateBarberInput, UpdateBarberInput } from '@/server/application/barbers/barberSchema';
import {
  BarberNotFoundError,
  DuplicateBarberNameError,
  LocationNotAvailableError,
  BarberLimitReachedError,
} from '@/server/domain/errors/BarberErrors';

/** Advisory per-location cap (design D8). Not a guarantee — race condition documented. */
export const MAX_BARBERS_PER_LOCATION = 50;

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';
const FOREIGN_KEY_VIOLATION = 'P2003';

function hasCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === code
  );
}

export class BarberService {
  constructor(
    private readonly barbers: IBarberRepository,
    private readonly locations: ILocationRepository
  ) {}

  listBarbers(ownerId: string): Promise<BarberWithLocation[]> {
    return this.barbers.findAllByOwner(ownerId);
  }

  findBarber(ownerId: string, id: string): Promise<Barber | null> {
    return this.barbers.findByIdForOwner(id, ownerId);
  }

  async createBarber(ownerId: string, input: CreateBarberInput): Promise<Barber> {
    const location = await this.locations.findByIdForOwner(input.locationId, ownerId);
    if (!location || !location.isActive) {
      throw new LocationNotAvailableError();
    }

    const count = await this.barbers.countByLocation(input.locationId, ownerId);
    if (count >= MAX_BARBERS_PER_LOCATION) {
      throw new BarberLimitReachedError();
    }

    await this.assertNameIsFreeAtLocation(input.locationId, ownerId, input.displayName, undefined, location.name);

    return this.writeOrTranslate(() => this.barbers.create(ownerId, input));
  }

  async updateBarber(ownerId: string, input: UpdateBarberInput): Promise<Barber> {
    // Load the stored barber to resolve the "unchanged location" exemption
    // server-side (design D4). The stored locationId is the operand of the
    // inactive-location check — no form field may supply it.
    const stored = await this.barbers.findByIdForOwner(input.id, ownerId);
    if (!stored) {
      throw new BarberNotFoundError();
    }

    const destination = await this.locations.findByIdForOwner(input.locationId, ownerId);

    const isUnchangedLocation = stored.locationId === input.locationId;

    if (!destination || (!destination.isActive && !isUnchangedLocation)) {
      throw new LocationNotAvailableError();
    }

    await this.assertNameIsFreeAtLocation(
      input.locationId,
      ownerId,
      input.displayName,
      input.id,
      destination.name
    );

    const updated = await this.writeOrTranslate(() =>
      this.barbers.update(input.id, ownerId, {
        locationId: input.locationId,
        displayName: input.displayName,
        bio: input.bio,
      })
    );

    if (updated === null) {
      throw new BarberNotFoundError();
    }
    return updated;
  }

  private async assertNameIsFreeAtLocation(
    locationId: string,
    ownerId: string,
    displayName: string,
    excludeId?: string,
    locationName?: string
  ): Promise<void> {
    const exists = await this.barbers.existsByLocationAndName(
      locationId,
      ownerId,
      displayName,
      excludeId
    );
    if (exists) {
      throw new DuplicateBarberNameError(locationName ?? locationId);
    }
  }

  private async writeOrTranslate<T>(write: () => Promise<T>): Promise<T> {
    try {
      return await write();
    } catch (error) {
      if (hasCode(error, UNIQUE_CONSTRAINT_VIOLATION)) {
        throw new DuplicateBarberNameError('');
      }
      if (hasCode(error, FOREIGN_KEY_VIOLATION)) {
        throw new LocationNotAvailableError();
      }
      throw error;
    }
  }
}
