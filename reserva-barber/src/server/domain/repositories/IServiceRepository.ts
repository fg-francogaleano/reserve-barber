import type { Service } from '@/server/domain/models/Service';

export interface NewServiceData {
  name: string;
  description: string | null;
  /** Canonical two-decimal string — never a number, never a driver decimal. */
  price: string;
  durationMinutes: number;
}

export type ServiceUpdateData = NewServiceData;

/**
 * Repository contract for the Service aggregate.
 *
 * Every method takes `ownerId` as a required parameter so an unscoped service
 * query is inexpressible through this contract — "forgot to filter by owner" is
 * not a mistake a caller can make. Unlike `Barber`, `Service` carries a real
 * `ownerId` column, so scoping is a predicate on that column rather than a join
 * through a parent relation (design D2). The property that matters is the same;
 * only the expression differs.
 */
export interface IServiceRepository {
  /** All of the owner's services, in a deterministic order. */
  findAllByOwner(ownerId: string): Promise<Service[]>;

  /** A single service scoped to the owner, or `null` when the id is unknown or belongs to someone else. */
  findByIdForOwner(id: string, ownerId: string): Promise<Service | null>;

  /**
   * Count of the owner's **active** services — backs the cap.
   *
   * Inactive rows are excluded deliberately (design D8): counting every row
   * would mean that once M6 introduces deactivation, an owner who deactivated
   * the maximum would be permanently unable to create another, with no remedy
   * anywhere in the application.
   */
  countActiveByOwner(ownerId: string): Promise<number>;

  /**
   * Whether the owner already has a service with this normalized name, compared
   * case-insensitively (in-memory, not ILIKE — design D9). `excludeId` lets an
   * edit skip the row being updated so it is not reported a duplicate of itself.
   */
  existsByOwnerAndName(ownerId: string, name: string, excludeId?: string): Promise<boolean>;

  create(ownerId: string, data: NewServiceData): Promise<Service>;

  /**
   * Updates the service, scoped by owner. Returns `null` when the predicate
   * matched no row — unknown id or different owner.
   */
  update(id: string, ownerId: string, data: ServiceUpdateData): Promise<Service | null>;
}
