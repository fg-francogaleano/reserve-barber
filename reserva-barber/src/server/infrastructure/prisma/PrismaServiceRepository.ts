import { Service } from '@/server/domain/models/Service';
import type {
  IServiceRepository,
  NewServiceData,
  ServiceUpdateData,
} from '@/server/domain/repositories/IServiceRepository';
import type { PrismaClient } from '@/generated/prisma/client';
import { MAX_SERVICES_PER_OWNER } from '@/server/application/services/ServiceCatalogService';

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
 * The **only** place a driver decimal is read (design D3).
 *
 * The M3 gate measured what happens when one escapes: it does not throw at the
 * RSC boundary — `JSON.stringify` yields `"4500.5"`, silently dropping the
 * second decimal. So this conversion is not a convenience, it is the thing that
 * keeps a price from rendering two different ways in two different places.
 *
 * Never routes through `Number`: coercing a money value to a float and back
 * reintroduces exactly the representation error the `Decimal` column exists to
 * avoid. A string from the driver is padded textually instead.
 */
export function toCanonicalPrice(value: unknown): string {
  if (typeof value === 'object' && value !== null && 'toFixed' in value) {
    return (value as { toFixed(digits: number): string }).toFixed(2);
  }
  const [integerPart = '0', fractionPart = ''] = String(value).split('.');
  return `${integerPart}.${(fractionPart + '00').slice(0, 2)}`;
}

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
    toCanonicalPrice(row.price),
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
