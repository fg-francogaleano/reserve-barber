import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PrismaOwnerRepository, toDomain } from './PrismaOwnerRepository';
import { Owner } from '@/server/domain/models/Owner';
import type { PrismaClient } from '@/generated/prisma/client';

type OwnerRow = {
  id: string;
  email: string;
  authUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function buildRow(overrides: Partial<OwnerRow> = {}): OwnerRow {
  return {
    id: 'owner-1',
    email: 'owner@example.com',
    authUserId: 'auth-user-1',
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
    expect(entity).toBeInstanceOf(Owner);
    expect(entity.id).toBe('owner-1');
    expect(entity.email).toBe('owner@example.com');
    expect(entity.authUserId).toBe('auth-user-1');
  });

  it('should_map_null_authUserId', () => {
    // Arrange
    const row = buildRow({ authUserId: null });

    // Act
    const entity = toDomain(row);

    // Assert
    expect(entity.authUserId).toBeNull();
  });
});

describe('PrismaOwnerRepository - findByAuthUserId', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should_return_domain_entity_when_found', async () => {
    // Arrange
    const row = buildRow();
    const findUnique = vi.fn().mockResolvedValue(row);
    const prisma = { owner: { findUnique } } as unknown as PrismaClient;
    const repository = new PrismaOwnerRepository(prisma);

    // Act
    const result = await repository.findByAuthUserId('auth-user-1');

    // Assert
    expect(findUnique).toHaveBeenCalledWith({ where: { authUserId: 'auth-user-1' } });
    expect(result).toBeInstanceOf(Owner);
    expect(result?.id).toBe('owner-1');
  });

  it('should_return_null_when_not_found', async () => {
    // Arrange
    const findUnique = vi.fn().mockResolvedValue(null);
    const prisma = { owner: { findUnique } } as unknown as PrismaClient;
    const repository = new PrismaOwnerRepository(prisma);

    // Act
    const result = await repository.findByAuthUserId('unknown');

    // Assert
    expect(result).toBeNull();
  });
});

describe('PrismaOwnerRepository - findByEmail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should_return_domain_entity_when_found', async () => {
    // Arrange
    const row = buildRow();
    const findUnique = vi.fn().mockResolvedValue(row);
    const prisma = { owner: { findUnique } } as unknown as PrismaClient;
    const repository = new PrismaOwnerRepository(prisma);

    // Act
    const result = await repository.findByEmail('owner@example.com');

    // Assert
    expect(findUnique).toHaveBeenCalledWith({ where: { email: 'owner@example.com' } });
    expect(result).toBeInstanceOf(Owner);
  });

  it('should_return_null_when_not_found', async () => {
    // Arrange
    const findUnique = vi.fn().mockResolvedValue(null);
    const prisma = { owner: { findUnique } } as unknown as PrismaClient;
    const repository = new PrismaOwnerRepository(prisma);

    // Act
    const result = await repository.findByEmail('ghost@example.com');

    // Assert
    expect(result).toBeNull();
  });
});
