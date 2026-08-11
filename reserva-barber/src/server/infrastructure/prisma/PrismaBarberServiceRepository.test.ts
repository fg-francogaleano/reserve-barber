import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PrismaBarberServiceRepository } from './PrismaBarberServiceRepository';
import type { PrismaClient } from '@/generated/prisma/client';

const OWNER = 'owner-root';
const BARBER = 'barber-1';

type Delegate = {
  findMany: ReturnType<typeof vi.fn>;
  deleteMany: ReturnType<typeof vi.fn>;
  createMany: ReturnType<typeof vi.fn>;
  groupBy: ReturnType<typeof vi.fn>;
};

function createDb(overrides: Partial<Delegate> = {}) {
  const barberService: Delegate = {
    findMany: vi.fn().mockResolvedValue([]),
    deleteMany: vi.fn().mockReturnValue({ statement: 'delete' }),
    createMany: vi.fn().mockReturnValue({ statement: 'create' }),
    groupBy: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
  const $transaction = vi.fn().mockResolvedValue([]);
  const db = { barberService, $transaction } as unknown as PrismaClient;
  return { db, barberService, $transaction };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PrismaBarberServiceRepository - reads are scoped through the location relation', () => {
  it('should_scope_the_assigned_ids_query_by_owner', async () => {
    const { db, barberService } = createDb({
      findMany: vi.fn().mockResolvedValue([{ serviceId: 'svc-1' }, { serviceId: 'svc-2' }]),
    });

    const ids = await new PrismaBarberServiceRepository(db).findServiceIdsForBarber(BARBER, OWNER);

    expect(ids).toEqual(['svc-1', 'svc-2']);
    expect(barberService.findMany).toHaveBeenCalledWith({
      where: { barberId: BARBER, barber: { location: { ownerId: OWNER } } },
      select: { serviceId: true },
    });
  });
});

describe('PrismaBarberServiceRepository - the set write', () => {
  it('should_issue_exactly_two_statements_in_one_batched_transaction', async () => {
    const { db, barberService, $transaction } = createDb();

    await new PrismaBarberServiceRepository(db).setForBarber(BARBER, OWNER, {
      toAdd: ['svc-2'],
      toRemove: ['svc-1'],
    });

    expect($transaction).toHaveBeenCalledTimes(1);
    const [statements] = $transaction.mock.calls[0];
    expect(statements).toHaveLength(2);
    expect(barberService.deleteMany).toHaveBeenCalledTimes(1);
    expect(barberService.createMany).toHaveBeenCalledTimes(1);
  });

  it('should_pass_an_array_not_a_callback_so_no_connection_is_held_across_round_trips', async () => {
    const { db, $transaction } = createDb();

    await new PrismaBarberServiceRepository(db).setForBarber(BARBER, OWNER, {
      toAdd: ['svc-2'],
      toRemove: ['svc-1'],
    });

    expect(Array.isArray($transaction.mock.calls[0][0])).toBe(true);
  });

  it('should_scope_the_removal_by_owner_and_bound_it_to_the_listed_ids', async () => {
    const { db, barberService } = createDb();

    await new PrismaBarberServiceRepository(db).setForBarber(BARBER, OWNER, {
      toAdd: [],
      toRemove: ['svc-1', 'svc-3'],
    });

    expect(barberService.deleteMany).toHaveBeenCalledWith({
      where: {
        barberId: BARBER,
        serviceId: { in: ['svc-1', 'svc-3'] },
        barber: { location: { ownerId: OWNER } },
      },
    });
  });

  it('should_request_skipDuplicates_on_the_insert', async () => {
    const { db, barberService } = createDb();

    await new PrismaBarberServiceRepository(db).setForBarber(BARBER, OWNER, {
      toAdd: ['svc-1', 'svc-2'],
      toRemove: [],
    });

    expect(barberService.createMany).toHaveBeenCalledWith({
      data: [
        { barberId: BARBER, serviceId: 'svc-1' },
        { barberId: BARBER, serviceId: 'svc-2' },
      ],
      skipDuplicates: true,
    });
  });

  it('should_omit_the_delete_statement_when_there_is_nothing_to_remove', async () => {
    const { db, barberService, $transaction } = createDb();

    await new PrismaBarberServiceRepository(db).setForBarber(BARBER, OWNER, {
      toAdd: ['svc-1'],
      toRemove: [],
    });

    expect(barberService.deleteMany).not.toHaveBeenCalled();
    expect($transaction.mock.calls[0][0]).toHaveLength(1);
  });

  it('should_omit_the_insert_statement_when_there_is_nothing_to_add', async () => {
    const { db, barberService, $transaction } = createDb();

    await new PrismaBarberServiceRepository(db).setForBarber(BARBER, OWNER, {
      toAdd: [],
      toRemove: ['svc-1'],
    });

    expect(barberService.createMany).not.toHaveBeenCalled();
    expect($transaction.mock.calls[0][0]).toHaveLength(1);
  });

  it('should_issue_no_transaction_for_an_empty_diff', async () => {
    const { db, $transaction } = createDb();

    await new PrismaBarberServiceRepository(db).setForBarber(BARBER, OWNER, {
      toAdd: [],
      toRemove: [],
    });

    expect($transaction).not.toHaveBeenCalled();
  });
});

describe('PrismaBarberServiceRepository - counts are one aggregate each', () => {
  it('should_count_services_per_barber_with_a_single_groupBy', async () => {
    const { db, barberService } = createDb({
      groupBy: vi.fn().mockResolvedValue([
        { barberId: 'barber-1', _count: { _all: 3 } },
        { barberId: 'barber-2', _count: { _all: 1 } },
      ]),
    });

    const counts = await new PrismaBarberServiceRepository(db).countServicesByBarber(OWNER);

    expect(barberService.groupBy).toHaveBeenCalledTimes(1);
    expect(counts.get('barber-1')).toBe(3);
    expect(counts.get('barber-2')).toBe(1);
    expect(counts.get('barber-absent')).toBeUndefined();
  });

  it('should_scope_the_per_barber_count_by_owner', async () => {
    const { db, barberService } = createDb();

    await new PrismaBarberServiceRepository(db).countServicesByBarber(OWNER);

    expect(barberService.groupBy).toHaveBeenCalledWith({
      by: ['barberId'],
      where: { barber: { location: { ownerId: OWNER } } },
      _count: { _all: true },
    });
  });

  it('should_count_only_active_barbers_per_service_with_a_single_groupBy', async () => {
    const { db, barberService } = createDb({
      groupBy: vi.fn().mockResolvedValue([{ serviceId: 'svc-1', _count: { _all: 2 } }]),
    });

    const counts = await new PrismaBarberServiceRepository(db).countActiveBarbersByService(OWNER);

    expect(barberService.groupBy).toHaveBeenCalledTimes(1);
    expect(counts.get('svc-1')).toBe(2);
    expect(barberService.groupBy).toHaveBeenCalledWith({
      by: ['serviceId'],
      where: {
        service: { ownerId: OWNER },
        barber: { isActive: true, location: { ownerId: OWNER } },
      },
      _count: { _all: true },
    });
  });

  it('should_report_an_unassigned_service_as_absent_rather_than_zero', async () => {
    const { db } = createDb({ groupBy: vi.fn().mockResolvedValue([]) });

    const counts = await new PrismaBarberServiceRepository(db).countActiveBarbersByService(OWNER);

    expect(counts.size).toBe(0);
  });
});
