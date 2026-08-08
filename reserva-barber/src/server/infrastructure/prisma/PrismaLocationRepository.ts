import { Location } from '@/server/domain/models/Location';
import type {
  ILocationRepository,
  LocationUpdateData,
  NewLocationData,
} from '@/server/domain/repositories/ILocationRepository';
import type { PrismaClient, Location as LocationRow } from '@/generated/prisma/client';

/** Prisma's code for "record to update not found". */
const RECORD_NOT_FOUND = 'P2025';

function hasCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === code
  );
}

/** Maps a Prisma row to the domain entity — domain never exposes Prisma types. */
export function toDomain(
  row: Pick<LocationRow, 'id' | 'ownerId' | 'name' | 'address' | 'isActive'>
): Location {
  return new Location(row.id, row.ownerId, row.name, row.address, row.isActive);
}

export class PrismaLocationRepository implements ILocationRepository {
  constructor(private readonly db: PrismaClient) {}

  async findAllByOwner(ownerId: string): Promise<Location[]> {
    const rows = await this.db.location.findMany({
      where: { ownerId },
      orderBy: { name: 'asc' },
    });
    return rows.map(toDomain);
  }

  async findByIdForOwner(id: string, ownerId: string): Promise<Location | null> {
    const row = await this.db.location.findFirst({ where: { id, ownerId } });
    return row ? toDomain(row) : null;
  }

  countByOwner(ownerId: string): Promise<number> {
    return this.db.location.count({ where: { ownerId } });
  }

  /**
   * Deliberately compares in memory instead of using Prisma's
   * `mode: 'insensitive'`, which is implemented with `ILIKE` on PostgreSQL and
   * would therefore treat `%` and `_` in a submitted name as wildcards —
   * reporting "Sucursal 50%" as a duplicate of "Sucursal 500" (design, first
   * risk). The row set is bounded by `MAX_LOCATIONS_PER_OWNER`, and this check
   * only produces an error message: the database constraint is the guarantee.
   */
  async existsByOwnerAndName(ownerId: string, name: string, excludeId?: string): Promise<boolean> {
    const rows = await this.db.location.findMany({
      where: excludeId ? { ownerId, id: { not: excludeId } } : { ownerId },
      select: { name: true },
    });

    const candidate = name.toLowerCase();
    return rows.some((existing) => existing.name.toLowerCase() === candidate);
  }

  async create(ownerId: string, data: NewLocationData): Promise<Location> {
    // `ownerId` comes from the session via the parameter, never from `data`.
    const row = await this.db.location.create({ data: { ownerId, ...data } });
    return toDomain(row);
  }

  /**
   * Scoped by owner in the predicate itself (design D7), so a mismatched owner
   * matches no row rather than depending on a prior read having checked. Prisma
   * raises `P2025` in that case, which is the caller's not-found signal (D8).
   */
  async update(id: string, ownerId: string, data: LocationUpdateData): Promise<Location | null> {
    try {
      const row = await this.db.location.update({ where: { id, ownerId }, data });
      return toDomain(row);
    } catch (error) {
      if (hasCode(error, RECORD_NOT_FOUND)) {
        return null;
      }
      throw error;
    }
  }
}
