import type { PublicBookingCatalog } from '@/server/domain/models/BookingCatalog';

/**
 * Repository contract for the public booking catalogue.
 *
 * `ownerId` is required, so an unscoped catalogue query is inexpressible through
 * this contract — the same property `ILocationRepository`, `IServiceRepository`,
 * `IBarberRepository` and `IBarberServiceRepository` all hold. That it applies
 * here too is the point of B2 design D3: the public route resolves the owner
 * from the slug **once**, through the documented exception on
 * `IBusinessProfileRepository`, and everything downstream is scoped normally.
 *
 * The alternative — slug-scoped methods on each of the four aggregates above —
 * would have taken the number of unscoped reads in this project from one to
 * five, and put "forgot to filter by owner" back within reach in four places
 * that currently make it impossible.
 */
export interface IPublicCatalogRepository {
  /**
   * Everything the owner can actually be booked for, as one read.
   *
   * Returns only bookable rows: the four terms of the availability rule
   * (`docs/data-model.md` §6) are already applied, so an empty result means the
   * shop has nothing bookable — an ordinary state with a designed page, not an
   * error and not a reason to look further.
   *
   * One round trip by contract, not by luck. This is the busiest public route in
   * the product and it has neither a cache nor a rate limit in front of it
   * (`docs/tech-debt.md` T47); the pool it draws from is shared with the owner's
   * dashboard, so a per-step query would put the admin surface behind the
   * public one under load.
   */
  findBookableCatalog(ownerId: string): Promise<PublicBookingCatalog>;
}
