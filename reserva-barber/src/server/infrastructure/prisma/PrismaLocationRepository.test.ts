import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PrismaLocationRepository, toDomain } from './PrismaLocationRepository';
import { Location } from '@/server/domain/models/Location';
import type { PrismaClient } from '@/generated/prisma/client';

const OWNER = 'owner-root';

type LocationDelegate = {
  findMany: ReturnType<typeof vi.fn>;
  findFirst: ReturnType<typeof vi.fn>;
  count: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
};

function createDb(overrides: Partial<LocationDelegate> = {}): {
  db: PrismaClient;
  location: LocationDelegate;
} {
  const location: LocationDelegate = {
    findMany: vi.fn().mockResolvedValue([]),
    findFirst: vi.fn().mockResolvedValue(null),
    count: vi.fn().mockResolvedValue(0),
    create: vi.fn(),
    update: vi.fn(),
    ...overrides,
  };
  return { db: { location } as unknown as PrismaClient, location };
}

function row(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'loc-1',
    ownerId: OWNER,
    name: 'Sucursal Centro',
    address: 'Av. Corrientes 1234',
    isActive: true,
    ...overrides,
  };
}

/** Shaped like a Prisma known-request error, without importing Prisma. */
function prismaError(code: string): Error & { code: string } {
  return Object.assign(new Error(`Prisma error ${code}`), { code });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('toDomain', () => {
  it('should_map_a_row_to_the_domain_entity', () => {
    expect(toDomain(row())).toEqual(
      new Location('loc-1', OWNER, 'Sucursal Centro', 'Av. Corrientes 1234', true)
    );
  });

  it('should_preserve_a_null_address', () => {
    expect(toDomain(row({ address: null })).address).toBeNull();
  });
});

describe('PrismaLocationRepository - findAllByOwner', () => {
  it('should_scope_the_query_to_the_owner_and_order_by_name', async () => {
    const { db, location } = createDb();
    await new PrismaLocationRepository(db).findAllByOwner(OWNER);

    expect(location.findMany).toHaveBeenCalledWith({
      where: { ownerId: OWNER },
      orderBy: { name: 'asc' },
    });
  });

  it('should_include_inactive_locations', async () => {
    // A management list that hides inactive rows makes them uneditable.
    const { db } = createDb({
      findMany: vi.fn().mockResolvedValue([row({ isActive: false })]),
    });

    const result = await new PrismaLocationRepository(db).findAllByOwner(OWNER);

    expect(result).toHaveLength(1);
    expect(result[0].isActive).toBe(false);
  });

  it('should_return_domain_entities', async () => {
    const { db } = createDb({ findMany: vi.fn().mockResolvedValue([row()]) });

    const result = await new PrismaLocationRepository(db).findAllByOwner(OWNER);

    expect(result[0]).toBeInstanceOf(Location);
  });
});

describe('PrismaLocationRepository - findByIdForOwner', () => {
  it('should_carry_both_the_id_and_the_owner_in_the_predicate', async () => {
    const { db, location } = createDb({ findFirst: vi.fn().mockResolvedValue(row()) });

    await new PrismaLocationRepository(db).findByIdForOwner('loc-1', OWNER);

    expect(location.findFirst).toHaveBeenCalledWith({ where: { id: 'loc-1', ownerId: OWNER } });
  });

  it('should_return_null_for_an_unknown_or_foreign_location', async () => {
    const { db } = createDb();

    await expect(
      new PrismaLocationRepository(db).findByIdForOwner('loc-1', OWNER)
    ).resolves.toBeNull();
  });
});

describe('PrismaLocationRepository - countByOwner', () => {
  it('should_count_only_the_owners_locations', async () => {
    const { db, location } = createDb({ count: vi.fn().mockResolvedValue(3) });

    await expect(new PrismaLocationRepository(db).countByOwner(OWNER)).resolves.toBe(3);
    expect(location.count).toHaveBeenCalledWith({ where: { ownerId: OWNER } });
  });
});

describe('PrismaLocationRepository - existsByOwnerAndName', () => {
  function repositoryWithNames(names: string[]) {
    const { db, location } = createDb({
      findMany: vi.fn().mockResolvedValue(names.map((name) => ({ name }))),
    });
    return { repository: new PrismaLocationRepository(db), location };
  }

  it('should_detect_an_exact_match', async () => {
    const { repository } = repositoryWithNames(['Sucursal Centro']);

    await expect(repository.existsByOwnerAndName(OWNER, 'Sucursal Centro')).resolves.toBe(true);
  });

  it('should_detect_a_case_variant', async () => {
    const { repository } = repositoryWithNames(['Sucursal Centro']);

    await expect(repository.existsByOwnerAndName(OWNER, 'sucursal centro')).resolves.toBe(true);
    await expect(repository.existsByOwnerAndName(OWNER, 'SUCURSAL CENTRO')).resolves.toBe(true);
  });

  it('should_return_false_when_the_owner_has_no_such_name', async () => {
    const { repository } = repositoryWithNames(['Sucursal Norte']);

    await expect(repository.existsByOwnerAndName(OWNER, 'Sucursal Centro')).resolves.toBe(false);
  });

  it('should_treat_percent_and_underscore_as_literal_characters', async () => {
    // The hazard this test exists for: a pattern-based comparison (ILIKE) would
    // make "%" and "_" wildcards, so "Sucursal 50%" would collide with
    // "Sucursal 500" and "Sucursal_1" with "Sucursal 1" (design, first risk).
    const { repository } = repositoryWithNames(['Sucursal 500', 'Sucursal 1']);

    await expect(repository.existsByOwnerAndName(OWNER, 'Sucursal 50%')).resolves.toBe(false);
    await expect(repository.existsByOwnerAndName(OWNER, 'Sucursal_1')).resolves.toBe(false);
  });

  it('should_still_match_a_name_that_genuinely_contains_a_metacharacter', async () => {
    const { repository } = repositoryWithNames(['Sucursal 50%']);

    await expect(repository.existsByOwnerAndName(OWNER, 'sucursal 50%')).resolves.toBe(true);
  });

  it('should_exclude_the_location_being_edited', async () => {
    const { repository, location } = repositoryWithNames([]);

    await repository.existsByOwnerAndName(OWNER, 'Sucursal Centro', 'loc-1');

    expect(location.findMany).toHaveBeenCalledWith({
      where: { ownerId: OWNER, id: { not: 'loc-1' } },
      select: { name: true },
    });
  });

  it('should_not_add_an_exclusion_when_none_is_given', async () => {
    const { repository, location } = repositoryWithNames([]);

    await repository.existsByOwnerAndName(OWNER, 'Sucursal Centro');

    expect(location.findMany).toHaveBeenCalledWith({
      where: { ownerId: OWNER },
      select: { name: true },
    });
  });
});

describe('PrismaLocationRepository - create', () => {
  it('should_write_the_owner_from_the_parameter_not_from_the_data', async () => {
    const { db, location } = createDb({ create: vi.fn().mockResolvedValue(row()) });

    await new PrismaLocationRepository(db).create(OWNER, {
      name: 'Sucursal Centro',
      address: 'Av. Corrientes 1234',
    });

    expect(location.create).toHaveBeenCalledWith({
      data: { ownerId: OWNER, name: 'Sucursal Centro', address: 'Av. Corrientes 1234' },
    });
  });

  it('should_let_a_unique_constraint_violation_reach_the_caller', async () => {
    const { db } = createDb({ create: vi.fn().mockRejectedValue(prismaError('P2002')) });

    await expect(
      new PrismaLocationRepository(db).create(OWNER, { name: 'Sucursal Centro', address: null })
    ).rejects.toMatchObject({ code: 'P2002' });
  });
});

describe('PrismaLocationRepository - update', () => {
  const data = { name: 'Sucursal Centro', address: null };

  it('should_carry_the_owner_in_the_predicate', async () => {
    const { db, location } = createDb({ update: vi.fn().mockResolvedValue(row()) });

    await new PrismaLocationRepository(db).update('loc-1', OWNER, data);

    expect(location.update).toHaveBeenCalledWith({ where: { id: 'loc-1', ownerId: OWNER }, data });
  });

  it('should_return_null_when_the_predicate_matches_no_row', async () => {
    // P2025 is how Prisma reports "record to update not found" — which, with
    // ownerId in the predicate, also covers a location owned by someone else.
    const { db } = createDb({ update: vi.fn().mockRejectedValue(prismaError('P2025')) });

    await expect(
      new PrismaLocationRepository(db).update('loc-1', OWNER, data)
    ).resolves.toBeNull();
  });

  it('should_let_a_unique_constraint_violation_reach_the_caller', async () => {
    const { db } = createDb({ update: vi.fn().mockRejectedValue(prismaError('P2002')) });

    await expect(new PrismaLocationRepository(db).update('loc-1', OWNER, data)).rejects.toMatchObject(
      { code: 'P2002' }
    );
  });

  it('should_not_swallow_an_unrelated_failure', async () => {
    const { db } = createDb({
      update: vi.fn().mockRejectedValue(new Error('Connection terminated')),
    });

    await expect(new PrismaLocationRepository(db).update('loc-1', OWNER, data)).rejects.toThrow(
      'Connection terminated'
    );
  });
});
