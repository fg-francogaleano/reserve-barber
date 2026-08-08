import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PrismaLocationRepository, toDomain } from './PrismaLocationRepository';
import { Location } from '@/server/domain/models/Location';
import type { PrismaClient } from '@/generated/prisma/client';

type LocationRow = {
  id: string;
  ownerId: string;
  name: string;
  address: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

function buildRow(overrides: Partial<LocationRow> = {}): LocationRow {
  return {
    id: 'loc-1',
    ownerId: 'owner-1',
    name: 'Sucursal Centro',
    address: 'Av. Corrientes 1234, CABA',
    isActive: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('toDomain', () => {
  it('should_map_prisma_row_to_domain_entity', () => {
    // Arrange
    const row = buildRow();

    // Act
    const entity = toDomain(row);

    // Assert
    expect(entity).toBeInstanceOf(Location);
    expect(entity.id).toBe('loc-1');
    expect(entity.ownerId).toBe('owner-1');
    expect(entity.name).toBe('Sucursal Centro');
    expect(entity.address).toBe('Av. Corrientes 1234, CABA');
    expect(entity.isActive).toBe(true);
  });

  it('should_map_null_address', () => {
    // Arrange
    const row = buildRow({ address: null });

    // Act
    const entity = toDomain(row);

    // Assert
    expect(entity.address).toBeNull();
  });
});

describe('PrismaLocationRepository - findAllActive', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should_query_only_active_locations_and_return_domain_entities', async () => {
    // Arrange
    const rows = [buildRow(), buildRow({ id: 'loc-2', name: 'Sucursal Norte', address: null })];
    const findMany = vi.fn().mockResolvedValue(rows);
    const prisma = { location: { findMany } } as unknown as PrismaClient;
    const repository = new PrismaLocationRepository(prisma);

    // Act
    const result = await repository.findAllActive();

    // Assert
    expect(findMany).toHaveBeenCalledWith({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });
    expect(result).toHaveLength(2);
    expect(result[0]).toBeInstanceOf(Location);
  });

  it('should_return_empty_array_when_no_rows', async () => {
    // Arrange
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = { location: { findMany } } as unknown as PrismaClient;
    const repository = new PrismaLocationRepository(prisma);

    // Act
    const result = await repository.findAllActive();

    // Assert
    expect(result).toEqual([]);
  });
});
