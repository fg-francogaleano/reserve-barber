import type { Location } from '@/server/domain/models/Location';

/** Repository contract for the Location aggregate. */
export interface ILocationRepository {
  findAllActive(): Promise<Location[]>;
}
