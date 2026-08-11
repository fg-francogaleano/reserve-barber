import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PrismaTimeOffRepository } from './PrismaTimeOffRepository';
import type { PrismaClient } from '@/generated/prisma/client';

const OWNER = 'owner-root';
const BARBER = 'barber-1';
const OWNED = { location: { ownerId: OWNER } };

function createDb(overrides: Record<string, ReturnType<typeof vi.fn>> = {}) {
  const timeOff = {
    findMany: vi.fn().mockResolvedValue([]),
    count: vi.fn().mockResolvedValue(0),
    createMany: vi.fn().mockResolvedValue({ count: 1 }),
    deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    ...overrides,
  };
  return { db: { timeOff } as unknown as PrismaClient, timeOff };
}

beforeEach(() => vi.clearAllMocks());

describe('PrismaTimeOffRepository - the editor read', () => {
  it('should_scope_by_owner_order_newest_first_and_select_only_what_the_editor_needs', async () => {
    const { db, timeOff } = createDb({
      findMany: vi.fn().mockResolvedValue([
        {
          id: 'to-1',
          startsAt: new Date('2026-08-11T03:00:00.000Z'),
          endsAt: new Date('2026-08-12T03:00:00.000Z'),
          reason: 'Vacaciones',
        },
      ]),
    });

    const absences = await new PrismaTimeOffRepository(db).findForBarber(BARBER, OWNER);

    expect(absences[0].reason).toBe('Vacaciones');
    expect(timeOff.findMany).toHaveBeenCalledWith({
      where: { barberId: BARBER, barber: OWNED },
      select: { id: true, startsAt: true, endsAt: true, reason: true },
      orderBy: [{ startsAt: 'desc' }],
    });
  });
});

describe('PrismaTimeOffRepository - the availability projection omits the reason', () => {
  it('should_not_select_reason_for_consumers_other_than_the_editor', async () => {
    const { db, timeOff } = createDb();

    await new PrismaTimeOffRepository(db).findPeriodsForBarber(BARBER, OWNER);

    const [args] = timeOff.findMany.mock.calls[0] as [{ select: Record<string, boolean> }];
    // The note can hold medical information. A projection that does not carry
    // the field cannot leak it, which is stronger than remembering not to.
    expect(args.select).toEqual({ startsAt: true, endsAt: true });
    expect(args.select).not.toHaveProperty('reason');
  });
});

describe('PrismaTimeOffRepository - the create is idempotent', () => {
  it('should_request_skip_on_duplicate_so_a_retry_is_a_no_op', async () => {
    const { db, timeOff } = createDb();
    const startsAt = new Date('2026-08-11T03:00:00.000Z');
    const endsAt = new Date('2026-08-12T03:00:00.000Z');

    await new PrismaTimeOffRepository(db).create(BARBER, OWNER, {
      startsAt,
      endsAt,
      reason: null,
    });

    expect(timeOff.createMany).toHaveBeenCalledWith({
      data: [{ barberId: BARBER, startsAt, endsAt, reason: null }],
      skipDuplicates: true,
    });
  });
});

describe('PrismaTimeOffRepository - the delete', () => {
  it('should_carry_the_owner_predicate', async () => {
    const { db, timeOff } = createDb();

    await new PrismaTimeOffRepository(db).remove('to-1', OWNER);

    expect(timeOff.deleteMany).toHaveBeenCalledWith({ where: { id: 'to-1', barber: OWNED } });
  });

  it('should_use_deleteMany_so_matching_nothing_is_not_an_error', async () => {
    const { db, timeOff } = createDb({ deleteMany: vi.fn().mockResolvedValue({ count: 0 }) });

    // `delete` would raise P2025 here. Two tabs removing the same absence must
    // both report success.
    await expect(new PrismaTimeOffRepository(db).remove('gone', OWNER)).resolves.toBeUndefined();
    expect(timeOff.deleteMany).toHaveBeenCalledTimes(1);
  });
});

describe('PrismaTimeOffRepository - the count', () => {
  it('should_scope_by_owner', async () => {
    const { db, timeOff } = createDb();

    await new PrismaTimeOffRepository(db).countForBarber(BARBER, OWNER);

    expect(timeOff.count).toHaveBeenCalledWith({ where: { barberId: BARBER, barber: OWNED } });
  });
});
