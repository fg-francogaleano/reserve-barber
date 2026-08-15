import { Service } from '@/server/domain/models/Service';
import type {
  IServiceRepository,
  NewServiceData,
  ServiceUpdateData,
} from '@/server/domain/repositories/IServiceRepository';
import type { PrismaClient } from '@/generated/prisma/client';
import { MAX_SERVICES_PER_OWNER } from '@/server/application/services/ServiceCatalogService';
import { toCanonicalDecimal } from './canonicalDecimal';

const RECORD_NOT_FOUND = 'P2025';

/** Only the fields the domain entity carries — never `SELECT *`. */
const SERVICE_FIELDS = {
  id: true,
  name: true,
  description: true,
  price: true,
  durationMinutes: true,
  isActive: true,
} as const;

function hasCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === code
  );
}

/**
 * The price conversion (design D3), now shared.
 *
 * Moved to `canonicalDecimal.ts` when PC3 became its second caller and hit the
 * identical failure on `depositValue`. Re-exported here so existing importers
 * and the M3 tests that pin its behaviour keep their import site.
 */
export { toCanonicalDecimal as toCanonicalPrice };

/** Maps a Prisma row to the domain entity — no Prisma types on the entity. */
export function toDomain(row: {
  id: string;
  name: string;
  description: string | null;
  price: unknown;
  durationMinutes: number;
  isActive: boolean;
}): Service {
  return new Service(
    row.id,
    row.name,
    row.description,
    toCanonicalDecimal(row.price),
    row.durationMinutes,
    row.isActive
  );
}

export class PrismaServiceRepository implements IServiceRepository {
  constructor(private readonly db: PrismaClient) {}

  async findAllByOwner(ownerId: string): Promise<Service[]> {
    const rows = await this.db.service.findMany({
      where: { ownerId },
      select: SERVICE_FIELDS,
      orderBy: [{ name: 'asc' }],
    });
    return rows.map(toDomain);
  }

  async findByIdForOwner(id: string, ownerId: string): Promise<Service | null> {
    const row = await this.db.service.findFirst({
      where: { id, ownerId },
      select: SERVICE_FIELDS,
    });
    return row ? toDomain(row) : null;
  }

  /**
   * Counts **active** services only (design D8). Counting every row would mean
   * that once M6 introduces deactivation, an owner who deactivated the maximum
   * would be permanently unable to create another.
   */
  countActiveByOwner(ownerId: string): Promise<number> {
    return this.db.service.count({ where: { ownerId, isActive: true } });
  }

  /**
   * In-memory comparison instead of `mode: 'insensitive'`, which compiles to
   * `ILIKE` and would treat `%` and `_` in a submitted name as wildcards —
   * "Corte 50%" would collide with "Corte 500" (design D9). The row set is
   * bounded by the cap, so this never scans an unbounded table.
   */
  async existsByOwnerAndName(ownerId: string, name: string, excludeId?: string): Promise<boolean> {
    const rows = await this.db.service.findMany({
      where: excludeId ? { ownerId, id: { not: excludeId } } : { ownerId },
      select: { name: true },
      take: MAX_SERVICES_PER_OWNER,
    });
    const candidate = name.toLowerCase();
    return rows.some((row) => row.name.toLowerCase() === candidate);
  }

  async create(ownerId: string, data: NewServiceData): Promise<Service> {
    const row = await this.db.service.create({
      data: {
        ownerId,
        name: data.name,
        description: data.description,
        price: data.price,
        durationMinutes: data.durationMinutes,
      },
      select: SERVICE_FIELDS,
    });
    return toDomain(row);
  }

  /**
   * Owner-scoped update via the extended `where`-unique with a scalar filter.
   * A mismatched owner yields `P2025` (no row found), which maps to `null` —
   * never a successful update.
   */
  async update(id: string, ownerId: string, data: ServiceUpdateData): Promise<Service | null> {
    try {
      const row = await this.db.service.update({
        where: { id, ownerId },
        data: {
          name: data.name,
          description: data.description,
          price: data.price,
          durationMinutes: data.durationMinutes,
        },
        select: SERVICE_FIELDS,
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
