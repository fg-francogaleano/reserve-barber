import { Owner } from '@/server/domain/models/Owner';
import type { IOwnerRepository } from '@/server/domain/repositories/IOwnerRepository';
import type { PrismaClient, Owner as OwnerRow } from '@/generated/prisma/client';

/** Maps a Prisma row to the domain entity — domain never exposes Prisma types. */
export function toDomain(row: Pick<OwnerRow, 'id' | 'email' | 'authUserId'>): Owner {
  return new Owner(row.id, row.email, row.authUserId);
}

export class PrismaOwnerRepository implements IOwnerRepository {
  constructor(private readonly db: PrismaClient) {}

  async findByAuthUserId(authUserId: string): Promise<Owner | null> {
    const row = await this.db.owner.findUnique({ where: { authUserId } });
    return row ? toDomain(row) : null;
  }

  async findByEmail(email: string): Promise<Owner | null> {
    const row = await this.db.owner.findUnique({ where: { email } });
    return row ? toDomain(row) : null;
  }
}
