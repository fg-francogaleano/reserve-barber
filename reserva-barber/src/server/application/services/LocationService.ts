import type { Location } from '@/server/domain/models/Location';
import type { ILocationRepository } from '@/server/domain/repositories/ILocationRepository';

/** Application service orchestrating location read use cases. */
export class LocationService {
  constructor(private readonly locations: ILocationRepository) {}

  listActiveLocations(): Promise<Location[]> {
    return this.locations.findAllActive();
  }
}
