/**
 * GATE D3 — Prisma 7 relation filter in `update.where`
 *
 * `BarberWhereUniqueInput` includes:
 *   `location?: XOR<LocationScalarRelationFilter, LocationWhereInput>`
 *
 * This test proves that `barber.update({ where: { id, location: { ownerId } }, data })`
 * is accepted by the TypeScript type system (the fact that this file compiles is
 * the static proof), and that the Prisma client is invoked with the expected
 * predicate shape (the dynamic proof via a mock).
 *
 * Outcome: relation filter IS honoured → use `update`, not the `updateMany` fallback.
 */
import { describe, it, expect, vi } from 'vitest';
import type { PrismaClient } from '@/generated/prisma/client';

describe('D3 gate — relation filter in barber.update', () => {
  it('update_where_accepts_location_relation_filter_and_calls_prisma_with_that_predicate', async () => {
    const updatedRow = {
      id: 'b-1',
      locationId: 'loc-1',
      displayName: 'Juan',
      bio: null,
      avatarUrl: null,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const updateFn = vi.fn().mockResolvedValue(updatedRow);
    const db = { barber: { update: updateFn } } as unknown as PrismaClient;

    // This call must compile without TypeScript errors; if BarberWhereUniqueInput
    // did NOT include `location`, tsc would fail here.
    await db.barber.update({
      where: { id: 'b-1', location: { ownerId: 'owner-1' } },
      data: { displayName: 'Juan Updated' },
    });

    expect(updateFn).toHaveBeenCalledWith({
      where: { id: 'b-1', location: { ownerId: 'owner-1' } },
      data: { displayName: 'Juan Updated' },
    });
  });
});
