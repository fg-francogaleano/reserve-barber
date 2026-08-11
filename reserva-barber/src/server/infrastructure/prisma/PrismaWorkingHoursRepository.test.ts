import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PrismaWorkingHoursRepository } from './PrismaWorkingHoursRepository';
import type { PrismaClient } from '@/generated/prisma/client';

const OWNER = 'owner-root';
const BARBER = 'barber-1';

function createDb(overrides: Record<string, ReturnType<typeof vi.fn>> = {}) {
  const workingHours = {
    findMany: vi.fn().mockResolvedValue([]),
    deleteMany: vi.fn().mockReturnValue({ statement: 'delete' }),
    createMany: vi.fn().mockReturnValue({ statement: 'create' }),
    groupBy: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
  const $transaction = vi.fn().mockResolvedValue([]);
  const db = { workingHours, $transaction } as unknown as PrismaClient;
  return { db, workingHours, $transaction };
}

beforeEach(() => vi.clearAllMocks());

describe('PrismaWorkingHoursRepository - reads are scoped through the location relation', () => {
  it('should_scope_the_week_read_by_owner_and_order_it_deterministically', async () => {
    const { db, workingHours } = createDb({
      findMany: vi
        .fn()
        .mockResolvedValue([{ id: 'wh-1', dayOfWeek: 1, startMinute: 540, endMinute: 1080 }]),
    });

    const week = await new PrismaWorkingHoursRepository(db).findForBarber(BARBER, OWNER);

    expect(week).toHaveLength(1);
    expect(week[0].startMinute).toBe(540);
    expect(workingHours.findMany).toHaveBeenCalledWith({
      where: { barberId: BARBER, barber: { location: { ownerId: OWNER } } },
      select: { id: true, dayOfWeek: true, startMinute: true, endMinute: true },
      orderBy: [{ dayOfWeek: 'asc' }, { startMinute: 'asc' }],
    });
  });
});

describe('PrismaWorkingHoursRepository - the week is replaced, never appended', () => {
  it('should_issue_delete_then_insert_in_one_batched_transaction', async () => {
    const { db, workingHours, $transaction } = createDb();

    await new PrismaWorkingHoursRepository(db).replaceForBarber(BARBER, OWNER, [
      { dayOfWeek: 1, startMinute: 540, endMinute: 1080 },
    ]);

    expect($transaction).toHaveBeenCalledTimes(1);
    const [statements] = $transaction.mock.calls[0];
    expect(statements).toHaveLength(2);
    expect(workingHours.deleteMany).toHaveBeenCalledTimes(1);
    expect(workingHours.createMany).toHaveBeenCalledTimes(1);
  });

  it('should_pass_an_array_not_a_callback_so_no_connection_is_held_across_round_trips', async () => {
    const { db, $transaction } = createDb();

    await new PrismaWorkingHoursRepository(db).replaceForBarber(BARBER, OWNER, [
      { dayOfWeek: 1, startMinute: 540, endMinute: 1080 },
    ]);

    expect(Array.isArray($transaction.mock.calls[0][0])).toBe(true);
  });

  it('should_scope_the_delete_by_owner', async () => {
    const { db, workingHours } = createDb();

    await new PrismaWorkingHoursRepository(db).replaceForBarber(BARBER, OWNER, []);

    expect(workingHours.deleteMany).toHaveBeenCalledWith({
      where: { barberId: BARBER, barber: { location: { ownerId: OWNER } } },
    });
  });

  it('should_still_delete_when_the_submitted_week_is_empty', async () => {
    const { db, workingHours, $transaction } = createDb();

    await new PrismaWorkingHoursRepository(db).replaceForBarber(BARBER, OWNER, []);

    // "This barber works no days" is a real save that must clear what is stored.
    expect(workingHours.deleteMany).toHaveBeenCalledTimes(1);
    expect(workingHours.createMany).not.toHaveBeenCalled();
    expect($transaction.mock.calls[0][0]).toHaveLength(1);
  });

  it('should_produce_the_same_statements_when_applied_twice', async () => {
    const { db, workingHours } = createDb();
    const repo = new PrismaWorkingHoursRepository(db);
    const week = [{ dayOfWeek: 1 as const, startMinute: 540, endMinute: 1080 }];

    await repo.replaceForBarber(BARBER, OWNER, week);
    await repo.replaceForBarber(BARBER, OWNER, week);

    // Replacement is what makes a retry after a committed-but-timed-out save
    // safe: an additive write would have doubled the week here.
    expect(workingHours.deleteMany).toHaveBeenCalledTimes(2);
    expect(workingHours.createMany).toHaveBeenNthCalledWith(2, {
      data: [{ barberId: BARBER, dayOfWeek: 1, startMinute: 540, endMinute: 1080 }],
    });
  });
});

describe('PrismaWorkingHoursRepository - the list indicator is one aggregate', () => {
  it('should_report_which_barbers_have_a_schedule_with_a_single_groupBy', async () => {
    const { db, workingHours } = createDb({
      groupBy: vi
        .fn()
        .mockResolvedValue([{ barberId: 'barber-1' }, { barberId: 'barber-2' }]),
    });

    const withSchedule = await new PrismaWorkingHoursRepository(db).findBarberIdsWithSchedule(OWNER);

    expect(workingHours.groupBy).toHaveBeenCalledTimes(1);
    expect(withSchedule.has('barber-1')).toBe(true);
    expect(withSchedule.has('barber-2')).toBe(true);
    expect(withSchedule.has('barber-3')).toBe(false);
  });

  it('should_scope_the_aggregate_by_owner', async () => {
    const { db, workingHours } = createDb();

    await new PrismaWorkingHoursRepository(db).findBarberIdsWithSchedule(OWNER);

    expect(workingHours.groupBy).toHaveBeenCalledWith({
      by: ['barberId'],
      where: { barber: { location: { ownerId: OWNER } } },
      _count: { _all: true },
    });
  });
});
