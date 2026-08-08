import type { Owner } from '@/server/domain/models/Owner';

/** Repository contract for the Owner aggregate. */
export interface IOwnerRepository {
  findByAuthUserId(authUserId: string): Promise<Owner | null>;
  findByEmail(email: string): Promise<Owner | null>;
}
