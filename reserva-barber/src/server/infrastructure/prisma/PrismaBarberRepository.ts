import { Barber } from '@/server/domain/models/Barber';
import type {
  IBarberRepository,
  BarberWithLocation,
  NewBarberData,
  BarberUpdateData,
} from '@/server/domain/repositories/IBarberRepository';
import type { PrismaClient } from '@/generated/prisma/client';
import { MAX_BARBERS_PER_LOCATION } from '@/server/application/services/BarberCatalogService';

const RECORD_NOT_FOUND = 'P2025';

function hasCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === code
  );
}

/** Maps a Prisma row to the domain entity — no Prisma types on the entity (design D10). */
export function toDomain(
  row: Pick<
    { id: string; locationId: string; displayName: string; bio: string | null; isActive: boolean },
    'id' | 'locationId' | 'displayName' | 'bio' | 'isActive'
  >
): Barber {
  return new Barber(row.id, row.locationId, row.displayName, row.bio, row.isActive);
}

export class PrismaBarberRepository implements IBarberRepository {
  constructor(private readonly db: PrismaClient) {}

  async findAllByOwner(ownerId: string): Promise<BarberWithLocation[]> {
    const rows = await this.db.barber.findMany({
      where: { location: { ownerId } },
      include: { location: { select: { name: true, isActive: true } } },
      orderBy: [{ location: { name: 'asc' } }, { displayName: 'asc' }],
    });
    return rows.map((row) => ({
      barber: toDomain(row),
      locationName: row.location.name,
      locationIsActive: row.location.isActive,
    }));
  }

  async findByIdForOwner(id: string, ownerId: string): Promise<Barber | null> {
    const row = await this.db.barber.findFirst({
      where: { id, location: { ownerId } },
    });
    return row ? toDomain(row) : null;
  }

  countByLocation(locationId: string, ownerId: string): Promise<number> {
    return this.db.barber.count({
      where: { locationId, location: { ownerId } },
    });
  }

  /**
   * In-memory comparison instead of ILIKE to avoid treating `%` and `_` in
   * a submitted name as wildcards (design D9). The row set is bounded by
   * MAX_BARBERS_PER_LOCATION so this never scans an unbounded table.
   */
  async existsByLocationAndName(
    locationId: string,
    ownerId: string,
    displayName: string,
    excludeId?: string
  ): Promise<boolean> {
    const rows = await this.db.barber.findMany({
      where: excludeId
        ? { locationId, location: { ownerId }, id: { not: excludeId } }
        : { locationId, location: { ownerId } },
      select: { displayName: true },
      take: MAX_BARBERS_PER_LOCATION,
    });
    const candidate = displayName.toLowerCase();
    return rows.some((r) => r.displayName.toLowerCase() === candidate);
  }

  async create(ownerId: string, data: NewBarberData): Promise<Barber> {
    const row = await this.db.barber.create({
      data: {
        locationId: data.locationId,
        displayName: data.displayName,
        bio: data.bio,
      },
    });
    return toDomain(row);
  }

  /**
   * Owner-scoped update via relation filter (gate D3 confirmed this works in
   * Prisma 7). A mismatched owner yields P2025 (no row found), which maps to
   * null — never a successful update.
   */
  async update(id: string, ownerId: string, data: BarberUpdateData): Promise<Barber | null> {
    try {
      const row = await this.db.barber.update({
        where: { id, location: { ownerId } },
        data: {
          locationId: data.locationId,
          displayName: data.displayName,
          bio: data.bio,
        },
      });
      return toDomain(row);
    } catch (error) {
      if (hasCode(error, RECORD_NOT_FOUND)) {
        return null;
      }
      throw error;
    }
  }
}
