import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PrismaBarberRepository, toDomain } from './PrismaBarberRepository';
import { Barber } from '@/server/domain/models/Barber';
import type { PrismaClient } from '@/generated/prisma/client';

const OWNER = 'owner-root';
const LOC_ID = 'loc-1';
const BARBER_ID = 'barber-1';

type BarberDelegate = {
  findMany: ReturnType<typeof vi.fn>;
  findFirst: ReturnType<typeof vi.fn>;
  count: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
};

function createDb(overrides: Partial<BarberDelegate> = {}): {
  db: PrismaClient;
  barber: BarberDelegate;
} {
  const barber: BarberDelegate = {
    findMany: vi.fn().mockResolvedValue([]),
    findFirst: vi.fn().mockResolvedValue(null),
    count: vi.fn().mockResolvedValue(0),
    create: vi.fn(),
    update: vi.fn(),
    ...overrides,
  };
  return { db: { barber } as unknown as PrismaClient, barber };
}

function barberRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: BARBER_ID,
    locationId: LOC_ID,
    displayName: 'Juan Pérez',
    bio: null,
    avatarUrl: null,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function barberWithLocationRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    ...barberRow(overrides),
    location: {
      name: 'Sucursal Centro',
      isActive: true,
    },
  };
}

function prismaError(code: string): Error & { code: string } {
  return Object.assign(new Error(`Prisma ${code}`), { code });
}

beforeEach(() => vi.clearAllMocks());

// ─── toDomain ────────────────────────────────────────────────────────────────

describe('toDomain', () => {
  it('should_map_a_row_to_the_domain_entity', () => {
    const row = barberRow({ bio: 'cortes clásicos' });
    expect(toDomain(row)).toEqual(
      new Barber(BARBER_ID, LOC_ID, 'Juan Pérez', 'cortes clásicos', true)
    );
  });

  it('should_preserve_a_null_bio', () => {
    expect(toDomain(barberRow({ bio: null })).bio).toBeNull();
  });

  it('should_not_expose_avatarUrl_on_the_domain_entity', () => {
    const entity = toDomain(barberRow({ avatarUrl: 'https://example.com/img.jpg' }));
    expect(Object.keys(entity)).not.toContain('avatarUrl');
  });
});

// ─── findAllByOwner ──────────────────────────────────────────────────────────

describe('PrismaBarberRepository - findAllByOwner', () => {
  it('should_scope_the_query_through_the_location_relation_not_by_owner_column', async () => {
    const { db, barber } = createDb({ findMany: vi.fn().mockResolvedValue([]) });
    const repo = new PrismaBarberRepository(db);
    await repo.findAllByOwner(OWNER);

    expect(barber.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ location: expect.objectContaining({ ownerId: OWNER }) }),
      })
    );
  });

  it('should_order_by_location_name_then_display_name', async () => {
    const { db, barber } = createDb();
    const repo = new PrismaBarberRepository(db);
    await repo.findAllByOwner(OWNER);

    expect(barber.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ location: { name: 'asc' } }, { displayName: 'asc' }],
      })
    );
  });

  it('should_use_a_single_query_with_include_not_N_plus_1', async () => {
    const { db, barber } = createDb({ findMany: vi.fn().mockResolvedValue([barberWithLocationRow()]) });
    const repo = new PrismaBarberRepository(db);
    await repo.findAllByOwner(OWNER);

    expect(barber.findMany).toHaveBeenCalledTimes(1);
    const args = barber.findMany.mock.calls[0][0];
    expect(args.include).toBeDefined();
  });

  it('should_return_BarberWithLocation_items_with_domain_entities', async () => {
    const row = barberWithLocationRow({ bio: 'degradé experto' });
    const { db } = createDb({ findMany: vi.fn().mockResolvedValue([row]) });
    const repo = new PrismaBarberRepository(db);

    const results = await repo.findAllByOwner(OWNER);
    expect(results).toHaveLength(1);
    expect(results[0].barber).toBeInstanceOf(Barber);
    expect(results[0].locationName).toBe('Sucursal Centro');
    expect(results[0].locationIsActive).toBe(true);
  });
});

// ─── findByIdForOwner ────────────────────────────────────────────────────────

describe('PrismaBarberRepository - findByIdForOwner', () => {
  it('should_carry_both_the_id_and_the_location_ownerId_in_the_predicate', async () => {
    const { db, barber } = createDb();
    const repo = new PrismaBarberRepository(db);
    await repo.findByIdForOwner(BARBER_ID, OWNER);

    expect(barber.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: BARBER_ID,
          location: expect.objectContaining({ ownerId: OWNER }),
        }),
      })
    );
  });

  it('should_return_null_for_an_unknown_or_foreign_barber', async () => {
    const { db } = createDb({ findFirst: vi.fn().mockResolvedValue(null) });
    const repo = new PrismaBarberRepository(db);
    expect(await repo.findByIdForOwner('unknown', OWNER)).toBeNull();
  });

  it('should_return_a_domain_entity_when_found', async () => {
    const { db } = createDb({ findFirst: vi.fn().mockResolvedValue(barberRow()) });
    const repo = new PrismaBarberRepository(db);
    const result = await repo.findByIdForOwner(BARBER_ID, OWNER);
    expect(result).toBeInstanceOf(Barber);
  });
});

// ─── countByLocation ─────────────────────────────────────────────────────────

describe('PrismaBarberRepository - countByLocation', () => {
  it('should_count_only_the_locations_barbers_scoped_through_the_relation', async () => {
    const { db, barber } = createDb({ count: vi.fn().mockResolvedValue(3) });
    const repo = new PrismaBarberRepository(db);
    const result = await repo.countByLocation(LOC_ID, OWNER);

    expect(result).toBe(3);
    expect(barber.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          locationId: LOC_ID,
          location: expect.objectContaining({ ownerId: OWNER }),
        }),
      })
    );
  });
});

// ─── existsByLocationAndName ──────────────────────────────────────────────────

describe('PrismaBarberRepository - existsByLocationAndName', () => {
  it('should_detect_an_exact_match', async () => {
    const { db } = createDb({
      findMany: vi.fn().mockResolvedValue([barberRow({ displayName: 'Juan Pérez' })]),
    });
    const repo = new PrismaBarberRepository(db);
    expect(await repo.existsByLocationAndName(LOC_ID, OWNER, 'Juan Pérez')).toBe(true);
  });

  it('should_detect_a_case_variant', async () => {
    const { db } = createDb({
      findMany: vi.fn().mockResolvedValue([barberRow({ displayName: 'Juan Pérez' })]),
    });
    const repo = new PrismaBarberRepository(db);
    expect(await repo.existsByLocationAndName(LOC_ID, OWNER, 'juan pérez')).toBe(true);
  });

  it('should_return_false_when_the_location_has_no_such_name', async () => {
    const { db } = createDb({ findMany: vi.fn().mockResolvedValue([]) });
    const repo = new PrismaBarberRepository(db);
    expect(await repo.existsByLocationAndName(LOC_ID, OWNER, 'Otro Nombre')).toBe(false);
  });

  it('should_treat_percent_and_underscore_as_literal_characters', async () => {
    const { db } = createDb({
      findMany: vi.fn().mockResolvedValue([barberRow({ displayName: 'Juan 500' })]),
    });
    const repo = new PrismaBarberRepository(db);
    // "Juan 50%" must NOT match "Juan 500"
    expect(await repo.existsByLocationAndName(LOC_ID, OWNER, 'Juan 50%')).toBe(false);
    // "Juan_500" must NOT match "Juan 500"
    expect(await repo.existsByLocationAndName(LOC_ID, OWNER, 'Juan_500')).toBe(false);
  });

  it('should_exclude_the_barber_being_edited', async () => {
    const { db, barber } = createDb({ findMany: vi.fn().mockResolvedValue([]) });
    const repo = new PrismaBarberRepository(db);
    await repo.existsByLocationAndName(LOC_ID, OWNER, 'Juan Pérez', BARBER_ID);

    const args = barber.findMany.mock.calls[0][0];
    expect(args.where).toMatchObject({ id: { not: BARBER_ID } });
  });

  it('should_scope_the_findMany_through_the_location_relation', async () => {
    const { db, barber } = createDb({ findMany: vi.fn().mockResolvedValue([]) });
    const repo = new PrismaBarberRepository(db);
    await repo.existsByLocationAndName(LOC_ID, OWNER, 'Juan');

    const args = barber.findMany.mock.calls[0][0];
    expect(args.where).toMatchObject({
      locationId: LOC_ID,
      location: { ownerId: OWNER },
    });
  });
});

// ─── create ──────────────────────────────────────────────────────────────────

describe('PrismaBarberRepository - create', () => {
  it('should_write_the_locationId_from_the_data_parameter', async () => {
    const { db, barber } = createDb({ create: vi.fn().mockResolvedValue(barberRow()) });
    const repo = new PrismaBarberRepository(db);
    await repo.create(OWNER, { locationId: LOC_ID, displayName: 'Juan', bio: null });

    expect(barber.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ locationId: LOC_ID, displayName: 'Juan', bio: null }),
      })
    );
  });

  it('should_let_a_unique_constraint_violation_reach_the_caller', async () => {
    const { db } = createDb({ create: vi.fn().mockRejectedValue(prismaError('P2002')) });
    const repo = new PrismaBarberRepository(db);
    await expect(
      repo.create(OWNER, { locationId: LOC_ID, displayName: 'Juan', bio: null })
    ).rejects.toMatchObject({ code: 'P2002' });
  });
});

// ─── update (scoped) ─────────────────────────────────────────────────────────

describe('PrismaBarberRepository - update', () => {
  it('should_carry_the_location_ownerId_in_the_where_predicate', async () => {
    const { db, barber } = createDb({ update: vi.fn().mockResolvedValue(barberRow()) });
    const repo = new PrismaBarberRepository(db);
    await repo.update(BARBER_ID, OWNER, { locationId: LOC_ID, displayName: 'Juan', bio: null });

    expect(barber.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: BARBER_ID,
          location: expect.objectContaining({ ownerId: OWNER }),
        }),
      })
    );
  });

  it('should_return_null_when_the_predicate_matches_no_row', async () => {
    const { db } = createDb({
      update: vi.fn().mockRejectedValue(prismaError('P2025')),
    });
    const repo = new PrismaBarberRepository(db);
    const result = await repo.update(BARBER_ID, OWNER, {
      locationId: LOC_ID,
      displayName: 'Juan',
      bio: null,
    });
    expect(result).toBeNull();
  });

  it('should_let_a_unique_constraint_violation_reach_the_caller', async () => {
    const { db } = createDb({ update: vi.fn().mockRejectedValue(prismaError('P2002')) });
    const repo = new PrismaBarberRepository(db);
    await expect(
      repo.update(BARBER_ID, OWNER, { locationId: LOC_ID, displayName: 'Juan', bio: null })
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('should_not_swallow_an_unrelated_failure', async () => {
    const { db } = createDb({ update: vi.fn().mockRejectedValue(new Error('timeout')) });
    const repo = new PrismaBarberRepository(db);
    await expect(
      repo.update(BARBER_ID, OWNER, { locationId: LOC_ID, displayName: 'Juan', bio: null })
    ).rejects.toThrow('timeout');
  });
});
