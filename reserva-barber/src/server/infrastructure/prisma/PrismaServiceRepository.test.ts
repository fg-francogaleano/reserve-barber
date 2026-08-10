import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PrismaServiceRepository, toDomain, toCanonicalPrice } from './PrismaServiceRepository';
import { Service } from '@/server/domain/models/Service';
import { MAX_SERVICES_PER_OWNER } from '@/server/application/services/ServiceCatalogService';
import type { PrismaClient } from '@/generated/prisma/client';

const OWNER = 'owner-root';
const SERVICE_ID = 'svc-1';

type ServiceDelegate = {
  findMany: ReturnType<typeof vi.fn>;
  findFirst: ReturnType<typeof vi.fn>;
  count: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
};

/** Stands in for the driver's decimal: an object carrying `toFixed`. */
function fakeDecimal(value: number) {
  return { toFixed: (digits: number) => value.toFixed(digits) };
}

function createDb(overrides: Partial<ServiceDelegate> = {}): {
  db: PrismaClient;
  service: ServiceDelegate;
} {
  const service: ServiceDelegate = {
    findMany: vi.fn().mockResolvedValue([]),
    findFirst: vi.fn().mockResolvedValue(null),
    count: vi.fn().mockResolvedValue(0),
    create: vi.fn(),
    update: vi.fn(),
    ...overrides,
  };
  return { db: { service } as unknown as PrismaClient, service };
}

function serviceRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: SERVICE_ID,
    name: 'Corte Clásico',
    description: null,
    price: fakeDecimal(4500.5),
    durationMinutes: 30,
    isActive: true,
    ...overrides,
  };
}

function prismaError(code: string): Error & { code: string } {
  return Object.assign(new Error(`Prisma ${code}`), { code });
}

const newData = {
  name: 'Corte Clásico',
  description: null,
  price: '4500.50',
  durationMinutes: 30,
};

beforeEach(() => vi.clearAllMocks());

// ─── money boundary (design D3) ──────────────────────────────────────────────

describe('PrismaServiceRepository - the money boundary', () => {
  it('should_convert_the_driver_decimal_to_a_two_place_string', () => {
    // The gate measured this: a leaked decimal does NOT throw at the RSC
    // boundary — JSON.stringify yields "4500.5" and silently drops the second
    // decimal. This assertion is therefore the guard, not a runtime error.
    expect(toCanonicalPrice(fakeDecimal(4500.5))).toBe('4500.50');
  });

  it('should_always_produce_exactly_two_decimals', () => {
    expect(toCanonicalPrice(fakeDecimal(4500))).toBe('4500.00');
    expect(toCanonicalPrice(fakeDecimal(0))).toBe('0.00');
  });

  it('should_accept_a_string_from_the_driver_without_losing_precision', () => {
    // Some adapter configurations hand numerics back as strings. Coercing
    // through Number would reintroduce float error on a money value.
    expect(toCanonicalPrice('4500.5')).toBe('4500.50');
    expect(toCanonicalPrice('4500')).toBe('4500.00');
    expect(toCanonicalPrice('9999999.99')).toBe('9999999.99');
  });

  it('should_expose_a_string_on_the_domain_entity_never_the_driver_type', () => {
    const entity = toDomain(serviceRow());
    expect(entity).toBeInstanceOf(Service);
    expect(typeof entity.price).toBe('string');
    expect(entity.price).toBe('4500.50');
  });

  it('should_survive_a_json_round_trip_with_both_decimals_intact', () => {
    const entity = toDomain(serviceRow());
    expect(JSON.parse(JSON.stringify(entity)).price).toBe('4500.50');
  });

  it('should_map_a_null_description', () => {
    expect(toDomain(serviceRow()).description).toBeNull();
    expect(toDomain(serviceRow({ description: 'algo' })).description).toBe('algo');
  });
});

// ─── owner scoping ───────────────────────────────────────────────────────────

describe('PrismaServiceRepository - owner scoping', () => {
  it('should_filter_the_listing_on_the_owner_column', async () => {
    const { db, service } = createDb({ findMany: vi.fn().mockResolvedValue([serviceRow()]) });

    const result = await new PrismaServiceRepository(db).findAllByOwner(OWNER);

    expect(service.findMany).toHaveBeenCalledTimes(1);
    expect(service.findMany.mock.calls[0][0].where).toEqual({ ownerId: OWNER });
    expect(result[0]).toBeInstanceOf(Service);
  });

  it('should_order_the_listing_deterministically', async () => {
    const { db, service } = createDb();
    await new PrismaServiceRepository(db).findAllByOwner(OWNER);
    expect(service.findMany.mock.calls[0][0].orderBy).toBeDefined();
  });

  it('should_scope_a_single_lookup_to_the_owner', async () => {
    const { db, service } = createDb();
    await new PrismaServiceRepository(db).findByIdForOwner(SERVICE_ID, OWNER);
    expect(service.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: SERVICE_ID, ownerId: OWNER } })
    );
  });

  it('should_return_null_for_a_foreign_or_unknown_id', async () => {
    const { db } = createDb({ findFirst: vi.fn().mockResolvedValue(null) });
    expect(await new PrismaServiceRepository(db).findByIdForOwner(SERVICE_ID, OWNER)).toBeNull();
  });

  it('should_carry_the_owner_predicate_in_the_update_itself', async () => {
    const { db, service } = createDb({ update: vi.fn().mockResolvedValue(serviceRow()) });

    await new PrismaServiceRepository(db).update(SERVICE_ID, OWNER, newData);

    expect(service.update.mock.calls[0][0].where).toEqual({ id: SERVICE_ID, ownerId: OWNER });
  });

  it('should_map_a_zero_row_update_to_null_never_to_a_silent_success', async () => {
    const { db } = createDb({ update: vi.fn().mockRejectedValue(prismaError('P2025')) });
    expect(await new PrismaServiceRepository(db).update(SERVICE_ID, OWNER, newData)).toBeNull();
  });

  it('should_let_an_unrelated_update_error_propagate', async () => {
    const { db } = createDb({ update: vi.fn().mockRejectedValue(prismaError('P2002')) });
    await expect(
      new PrismaServiceRepository(db).update(SERVICE_ID, OWNER, newData)
    ).rejects.toThrow('Prisma P2002');
  });

  it('should_scope_the_create_to_the_owner', async () => {
    const { db, service } = createDb({ create: vi.fn().mockResolvedValue(serviceRow()) });

    await new PrismaServiceRepository(db).create(OWNER, newData);

    expect(service.create.mock.calls[0][0].data).toEqual(
      expect.objectContaining({ ownerId: OWNER, name: 'Corte Clásico', price: '4500.50' })
    );
  });
});

// ─── the cap counts active rows only (design D8) ─────────────────────────────

describe('PrismaServiceRepository - active-only count', () => {
  it('should_count_only_active_services', async () => {
    const { db, service } = createDb({ count: vi.fn().mockResolvedValue(7) });

    const result = await new PrismaServiceRepository(db).countActiveByOwner(OWNER);

    expect(result).toBe(7);
    expect(service.count).toHaveBeenCalledWith({ where: { ownerId: OWNER, isActive: true } });
  });
});

// ─── duplicate pre-check (design D9) ─────────────────────────────────────────

describe('PrismaServiceRepository - duplicate pre-check', () => {
  it('should_detect_a_duplicate_case_insensitively', async () => {
    const { db } = createDb({
      findMany: vi.fn().mockResolvedValue([{ name: 'Corte Clásico' }]),
    });
    expect(
      await new PrismaServiceRepository(db).existsByOwnerAndName(OWNER, 'CORTE CLÁSICO')
    ).toBe(true);
  });

  it.each([
    ['Corte 50%', 'Corte 500'],
    ['Corte_1', 'Corte 1'],
    ['Corte%', 'Corte cualquier cosa'],
  ])('should_compare_%s_literally_against_%s', async (candidate, stored) => {
    // The substantive proof for design D9: Prisma's `mode: 'insensitive'`
    // compiles to ILIKE, where `%` and `_` are wildcards. This comparison runs
    // in memory, so they are ordinary characters.
    const { db } = createDb({ findMany: vi.fn().mockResolvedValue([{ name: stored }]) });

    expect(await new PrismaServiceRepository(db).existsByOwnerAndName(OWNER, candidate)).toBe(false);
  });

  it('should_not_use_prisma_insensitive_mode', async () => {
    const { db, service } = createDb();
    await new PrismaServiceRepository(db).existsByOwnerAndName(OWNER, 'Corte');
    expect(JSON.stringify(service.findMany.mock.calls[0][0])).not.toContain('insensitive');
  });

  it('should_exclude_the_row_being_edited', async () => {
    const { db, service } = createDb();
    await new PrismaServiceRepository(db).existsByOwnerAndName(OWNER, 'Corte', SERVICE_ID);
    expect(service.findMany.mock.calls[0][0].where).toEqual({
      ownerId: OWNER,
      id: { not: SERVICE_ID },
    });
  });

  it('should_bound_the_scanned_row_set_by_the_cap', async () => {
    const { db, service } = createDb();
    await new PrismaServiceRepository(db).existsByOwnerAndName(OWNER, 'Corte');
    expect(service.findMany.mock.calls[0][0].take).toBe(MAX_SERVICES_PER_OWNER);
  });
});
