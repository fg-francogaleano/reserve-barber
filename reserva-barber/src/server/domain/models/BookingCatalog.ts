/**
 * What a client choosing a booking may see.
 *
 * Three projections and the shape that relates them. Every field here is
 * published to an anonymous visitor, so the list is written from that direction:
 * a column added to `Location`, `Service` or `Barber` reaches nobody until
 * someone adds it here on purpose. This is the same rule B1 applied to
 * `PublicBusinessProfile`, and the reason is the same — the protection has to be
 * structural rather than a coincidence of which fields happen to exist today.
 *
 * Three absences are deliberate:
 *
 * - **No `ownerId`.** The booking flow resolves it to scope its queries and
 *   drops it (B2 design D3). It is a predicate, never a value.
 * - **No `isActive`.** It has already been applied as a filter. Publishing it
 *   would tell a stranger that the shop *has* deactivated rows, which is
 *   business information nobody asked to share.
 * - **No timestamps.**
 */

export interface PublicLocation {
  readonly id: string;
  readonly name: string;
  readonly address: string | null;
}

export interface PublicService {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  /**
   * Canonical two-decimal string, never a number and never a driver decimal —
   * see `canonicalDecimal.ts`. This is the first surface in the product that
   * shows a price to a paying client.
   */
  readonly price: string;
  /**
   * Carried although B2 renders nothing with it: B3 sizes slots by it, and the
   * alternative is B3 re-issuing this whole query.
   */
  readonly durationMinutes: number;
}

export interface PublicBarber {
  readonly id: string;
  readonly displayName: string;
  readonly bio: string | null;
  readonly avatarUrl: string | null;
}

/**
 * A service bookable **at one specific location**, with the barbers who perform
 * it there.
 *
 * `barbers` is non-empty by construction. That is the whole point of the type:
 * a service with no barber at this branch is not a `BookableService` with an
 * empty list, it is absent. `docs/tech-debt.md` T23 records that the honest unit
 * of bookability is the (service, location) pair rather than the service, and
 * this is that unit expressed in a type.
 */
export interface BookableService {
  readonly service: PublicService;
  readonly barbers: readonly PublicBarber[];
}

/** A location with at least one bookable service. Also non-empty by construction. */
export interface BookableLocation {
  readonly location: PublicLocation;
  readonly services: readonly BookableService[];
}

/**
 * Only what can actually be booked, in the order the client meets it.
 *
 * An empty catalogue means the shop has nothing bookable — a real state with a
 * designed page, not an error.
 */
export type PublicBookingCatalog = readonly BookableLocation[];

/**
 * The rows a catalogue is built from: locations, their active barbers, and each
 * barber's assignments to active services.
 *
 * Barber-first because that is the direction the join runs — `BarberService`
 * hangs off the barber, which hangs off the location. The catalogue needs the
 * opposite orientation, and inverting it is what `buildBookingCatalog` is for.
 */
export interface CatalogSourceLocation {
  readonly id: string;
  readonly name: string;
  readonly address: string | null;
  readonly barbers: readonly CatalogSourceBarber[];
}

export interface CatalogSourceBarber {
  readonly id: string;
  readonly displayName: string;
  readonly bio: string | null;
  readonly avatarUrl: string | null;
  readonly services: readonly PublicService[];
}

function byName(a: string, b: string): number {
  return a.localeCompare(b, 'es-AR');
}

/**
 * Inverts barber→service into service→barbers, and prunes everything empty.
 *
 * **This is the structural half of the bookability predicate** (design D4). The
 * other half — that the service, the location and the barber are each active —
 * is applied by the query, because filtering rows the database can exclude is
 * the database's job. What cannot be expressed as a row filter is the emptiness:
 * a service is bookable at a branch only if *some* barber there performs it, and
 * a branch is offerable only if *some* service is bookable at it. Both are
 * facts about a group, so they are decided here, after grouping.
 *
 * Pure, so the four terms of the predicate can be tested failing one at a time
 * without a database. Reaching them through a rendered page would mean asserting
 * a heading to learn whether a join filter is right.
 */
export function buildBookingCatalog(
  locations: readonly CatalogSourceLocation[]
): PublicBookingCatalog {
  const catalog: BookableLocation[] = [];

  for (const location of locations) {
    const barbersByService = new Map<string, { service: PublicService; barbers: PublicBarber[] }>();

    for (const barber of location.barbers) {
      const publicBarber: PublicBarber = {
        id: barber.id,
        displayName: barber.displayName,
        bio: barber.bio,
        avatarUrl: barber.avatarUrl,
      };

      for (const service of barber.services) {
        const entry = barbersByService.get(service.id);
        if (entry === undefined) {
          barbersByService.set(service.id, { service, barbers: [publicBarber] });
        } else {
          entry.barbers.push(publicBarber);
        }
      }
    }

    // A branch whose every service lost its last barber is not offered at all —
    // it is not offered with an empty list.
    if (barbersByService.size === 0) continue;

    const services = [...barbersByService.values()]
      .map(({ service, barbers }) => ({
        service,
        barbers: [...barbers].sort((a, b) => byName(a.displayName, b.displayName)),
      }))
      .sort((a, b) => byName(a.service.name, b.service.name));

    catalog.push({
      location: { id: location.id, name: location.name, address: location.address },
      services,
    });
  }

  return catalog.sort((a, b) => byName(a.location.name, b.location.name));
}

/** The chosen branch, or `undefined` when the id names nothing bookable. */
export function findLocation(
  catalog: PublicBookingCatalog,
  locationId: string
): BookableLocation | undefined {
  return catalog.find((entry) => entry.location.id === locationId);
}

/** The chosen service **at that branch**, or `undefined`. */
export function findService(
  location: BookableLocation,
  serviceId: string
): BookableService | undefined {
  return location.services.find((entry) => entry.service.id === serviceId);
}

/** The chosen barber **for that service at that branch**, or `undefined`. */
export function findBarber(service: BookableService, barberId: string): PublicBarber | undefined {
  return service.barbers.find((barber) => barber.id === barberId);
}
