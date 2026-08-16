import { describe, it, expect, vi } from 'vitest';
import { PrismaPublicCatalogRepository } from './PrismaPublicCatalogRepository';
import type { PrismaClient } from '@/generated/prisma/client';

const ROW = {
  id: 'loc-centro',
  name: 'Centro',
  address: 'Av. Siempreviva 742',
  barbers: [
    {
      id: 'bar-1',
      displayName: 'Ana',
      bio: null,
      avatarUrl: null,
      services: [
        {
          service: {
            id: 'svc-corte',
            name: 'Corte',
            description: null,
            price: '10000.00',
            durationMinutes: 30,
          },
        },
      ],
    },
  ],
};

function createDb(findMany: ReturnType<typeof vi.fn>) {
  return { location: { findMany } } as unknown as PrismaClient;
}

describe('PrismaPublicCatalogRepository', () => {
  it('should_read_the_whole_catalog_in_one_round_trip', () => {
    const findMany = vi.fn().mockResolvedValue([ROW]);

    return new PrismaPublicCatalogRepository(createDb(findMany))
      .findBookableCatalog('owner-1')
      .then(() => {
        expect(findMany).toHaveBeenCalledTimes(1);
      });
  });

  it('should_scope_the_read_by_owner_and_require_an_active_location', async () => {
    const findMany = vi.fn().mockResolvedValue([ROW]);

    await new PrismaPublicCatalogRepository(createDb(findMany)).findBookableCatalog('owner-1');

    const [args] = findMany.mock.calls[0]!;
    expect(args.where).toEqual({ ownerId: 'owner-1', isActive: true });
  });

  it('should_require_an_active_barber_and_an_active_service_in_the_query', async () => {
    // The three terms a row filter can express. The fourth — that the group is
    // non-empty — belongs to `buildBookingCatalog` and is tested there.
    const findMany = vi.fn().mockResolvedValue([ROW]);

    await new PrismaPublicCatalogRepository(createDb(findMany)).findBookableCatalog('owner-1');

    const [args] = findMany.mock.calls[0]!;
    expect(args.select.barbers.where).toEqual({ isActive: true });
    expect(args.select.barbers.select.services.where).toEqual({ service: { isActive: true } });
  });

  it('should_select_only_the_publishable_columns', async () => {
    const findMany = vi.fn().mockResolvedValue([ROW]);

    await new PrismaPublicCatalogRepository(createDb(findMany)).findBookableCatalog('owner-1');

    const [args] = findMany.mock.calls[0]!;
    expect(Object.keys(args.select).sort()).toEqual(['address', 'barbers', 'id', 'name']);
    expect(Object.keys(args.select.barbers.select).sort()).toEqual([
      'avatarUrl',
      'bio',
      'displayName',
      'id',
      'services',
    ]);
    expect(Object.keys(args.select.barbers.select.services.select.service.select).sort()).toEqual([
      'description',
      'durationMinutes',
      'id',
      'name',
      'price',
    ]);
  });

  it('should_not_select_any_owner_id_activity_flag_or_timestamp', async () => {
    const findMany = vi.fn().mockResolvedValue([ROW]);

    await new PrismaPublicCatalogRepository(createDb(findMany)).findBookableCatalog('owner-1');

    const [args] = findMany.mock.calls[0]!;
    const selection = JSON.stringify(args.select);
    expect(selection).not.toContain('ownerId');
    expect(selection).not.toContain('createdAt');
    expect(selection).not.toContain('updatedAt');
    // `isActive` appears only inside `where` clauses, never inside a `select`.
    expect(selection).not.toContain('"isActive":true,"select"');
  });

  it('should_not_return_any_excluded_column_to_the_caller', async () => {
    // The driver may hand back more than was asked for; the projection is what
    // the caller sees, and it must be narrow regardless.
    const findMany = vi.fn().mockResolvedValue([
      {
        ...ROW,
        ownerId: 'owner-leaked',
        isActive: true,
        createdAt: new Date(),
        barbers: [{ ...ROW.barbers[0]!, isActive: true }],
      },
    ]);

    const catalog = await new PrismaPublicCatalogRepository(createDb(findMany)).findBookableCatalog(
      'owner-1'
    );

    const serialized = JSON.stringify(catalog);
    expect(serialized).not.toContain('owner-leaked');
    expect(serialized).not.toContain('isActive');
    expect(serialized).not.toContain('createdAt');
  });

  it('should_convert_a_driver_decimal_price_to_a_canonical_two_decimal_string', async () => {
    // The failure M3 documented and PC3 measured against the live database: a
    // stored `2000.50` arrives as `2000.5`. B2 is the first surface that shows a
    // price to a paying client, so it is caught here rather than in a checkout.
    const findMany = vi.fn().mockResolvedValue([
      {
        ...ROW,
        barbers: [
          {
            ...ROW.barbers[0]!,
            services: [
              {
                service: { ...ROW.barbers[0]!.services[0]!.service, price: '2000.5' },
              },
            ],
          },
        ],
      },
    ]);

    const catalog = await new PrismaPublicCatalogRepository(createDb(findMany)).findBookableCatalog(
      'owner-1'
    );

    expect(catalog[0]!.services[0]!.service.price).toBe('2000.50');
  });

  it('should_return_an_empty_catalog_when_the_owner_has_nothing_bookable', async () => {
    const findMany = vi.fn().mockResolvedValue([]);

    await expect(
      new PrismaPublicCatalogRepository(createDb(findMany)).findBookableCatalog('owner-1')
    ).resolves.toEqual([]);
  });
});
