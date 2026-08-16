import {
  buildBookingCatalog,
  type CatalogSourceLocation,
  type PublicBookingCatalog,
} from '@/server/domain/models/BookingCatalog';
import type { IPublicCatalogRepository } from '@/server/domain/repositories/IPublicCatalogRepository';
import type { PrismaClient } from '@/generated/prisma/client';
import { toCanonicalDecimal } from './canonicalDecimal';

/**
 * The publishable columns, written from the direction of what may be seen.
 *
 * Note what is absent from all three levels: `ownerId`, `isActive`, and every
 * timestamp. The activity flags are applied as predicates below and deliberately
 * not returned — publishing one would tell an anonymous visitor that the shop
 * has deactivated rows.
 */
const CATALOG_FIELDS = {
  id: true,
  name: true,
  address: true,
  barbers: {
    // Term 4 of the availability rule: the barber must be active. Applied here
    // rather than after the read so an inactive barber's name never leaves the
    // database.
    where: { isActive: true },
    select: {
      id: true,
      displayName: true,
      bio: true,
      avatarUrl: true,
      services: {
        // Term 1: the service must be active. The join row itself carries no
        // state to filter on — its presence is the assignment (data-model §7).
        where: { service: { isActive: true } },
        select: {
          service: {
            select: {
              id: true,
              name: true,
              description: true,
              price: true,
              durationMinutes: true,
            },
          },
        },
      },
    },
  },
} as const;

interface CatalogRow {
  id: string;
  name: string;
  address: string | null;
  barbers: {
    id: string;
    displayName: string;
    bio: string | null;
    avatarUrl: string | null;
    services: {
      service: {
        id: string;
        name: string;
        description: string | null;
        price: unknown;
        durationMinutes: number;
      };
    }[];
  }[];
}

/**
 * Maps rows to the source shape, converting the one value that cannot survive
 * the trip untouched.
 *
 * `price` arrives as a driver decimal. `toCanonicalDecimal` is the only place in
 * the project that converts one, and it exists because both M3 and PC3 measured
 * what happens otherwise: a stored `2000.50` reads back as `2000.5`, and the
 * lone `5` is then taken for five centavos. B2 is the first surface that shows
 * a price to a paying client, so this is the call site that makes it visible.
 */
function toSource(rows: CatalogRow[]): CatalogSourceLocation[] {
  return rows.map((location) => ({
    id: location.id,
    name: location.name,
    address: location.address,
    barbers: location.barbers.map((barber) => ({
      id: barber.id,
      displayName: barber.displayName,
      bio: barber.bio,
      avatarUrl: barber.avatarUrl,
      services: barber.services.map(({ service }) => ({
        id: service.id,
        name: service.name,
        description: service.description,
        price: toCanonicalDecimal(service.price),
        durationMinutes: service.durationMinutes,
      })),
    })),
  }));
}

export class PrismaPublicCatalogRepository implements IPublicCatalogRepository {
  constructor(private readonly db: PrismaClient) {}

  /**
   * One round trip, scoped by owner (design D5).
   *
   * The query applies the three activity terms of the availability rule that a
   * row filter can express — location, barber and service. The fourth condition
   * is not a row filter at all: "at least one barber performs this service here"
   * and "at least one service is bookable at this branch" are facts about a
   * group, so they are decided by `buildBookingCatalog` after the grouping
   * exists. Splitting it this way is what lets the predicate be tested one
   * failing term at a time without a database.
   *
   * Locations are entered through `ownerId`, which is `Location`'s own column —
   * `Barber` has none (data-model §5), so entering from the barber side would
   * have meant scoping through a relation for no gain.
   */
  async findBookableCatalog(ownerId: string): Promise<PublicBookingCatalog> {
    const rows = await this.db.location.findMany({
      // Term 2: the branch must be active. A barber may legally remain at a
      // deactivated branch (data-model §5), and M4a settled that nothing behind
      // a closed branch is bookable.
      where: { ownerId, isActive: true },
      select: CATALOG_FIELDS,
    });

    return buildBookingCatalog(toSource(rows));
  }
}
