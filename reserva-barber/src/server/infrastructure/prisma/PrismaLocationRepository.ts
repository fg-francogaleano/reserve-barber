import { Location } from '@/server/domain/models/Location';
import type { ILocationRepository } from '@/server/domain/repositories/ILocationRepository';
import type { PrismaClient, Location as LocationRow } from '@/generated/prisma/client';

/** Maps a Prisma row to the domain entity — domain never exposes Prisma types. */
export function toDomain(row: Pick<LocationRow, 'id' | 'ownerId' | 'name' | 'address' | 'isActive'>): Location {
  return new Location(row.id, row.ownerId, row.name, row.address, row.isActive);
}

export class PrismaLocationRepository implements ILocationRepository {
  constructor(private readonly db: PrismaClient) {}

  async findAllActive(): Promise<Location[]> {
    const rows = await this.db.location.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });
    return rows.map(toDomain);
  }
}
