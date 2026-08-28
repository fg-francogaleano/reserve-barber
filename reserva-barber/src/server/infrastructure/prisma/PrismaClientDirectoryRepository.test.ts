import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PrismaClientDirectoryRepository } from './PrismaClientDirectoryRepository';
import type { PrismaClient } from '@/generated/prisma/client';

const OWNER = 'own-1';

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cli-1',
    name: 'Ana',
    email: 'ana@example.com',
    phone: '+5491100000000',
    confirmedCount: BigInt(3),
    inactiveCount: BigInt(1),
    total: BigInt(7),
    ...overrides,
  };
}

function createDb(rows: unknown[] = [row()]) {
  const db = {
    $queryRaw: vi.fn().mockResolvedValue(rows),
    client: { count: vi.fn().mockResolvedValue(0) },
  };
  return { db: db as unknown as PrismaClient, raw: db };
}

/** The interpolated values of a tagged-template call, in order. */
function rawValues(mock: ReturnType<typeof vi.fn>): unknown[] {
  return mock.mock.calls[0]!.slice(1);
}

/** The SQL text of a tagged-template call. */
function rawSql(mock: ReturnType<typeof vi.fn>): string {
  return (mock.mock.calls[0]![0] as string[]).join('?');
}

function list(db: PrismaClient, skip = 0, take = 25) {
  return new PrismaClientDirectoryRepository(db).listForOwner({ ownerId: OWNER, skip, take });
}

beforeEach(() => vi.clearAllMocks());

describe('PrismaClientDirectoryRepository - scoping', () => {
  it('should_scope_on_the_clients_own_owner_column', async () => {
    const { db, raw } = createDb();

    await list(db);

    expect(rawSql(raw.$queryRaw)).toMatch(/WHERE\s+c\."ownerId"\s*=/);
    expect(rawValues(raw.$queryRaw)).toContain(OWNER);
  });

  it('should_never_concatenate_the_owner_into_the_statement', async () => {
    // Every interpolation is a tagged-template parameter. The owner id must
    // arrive as a value, not as text in the SQL.
    const { db, raw } = createDb();

    await list(db);

    expect(rawSql(raw.$queryRaw)).not.toContain(OWNER);
  });

  it('should_issue_exactly_one_statement_for_a_page_that_exists', async () => {
    const { db, raw } = createDb();

    await list(db);

    expect(raw.$queryRaw).toHaveBeenCalledTimes(1);
    expect(raw.client.count).not.toHaveBeenCalled();
  });
});

describe('PrismaClientDirectoryRepository - what it asks for', () => {
  it('should_count_confirmed_bookings_for_the_headline_figure', async () => {
    const { db, raw } = createDb();

    await list(db);

    expect(rawSql(raw.$queryRaw)).toMatch(
      /count\(b\.id\) FILTER \(WHERE b\.status = 'CONFIRMED'\)\s+AS "confirmedCount"/
    );
  });

  it('should_count_cancelled_and_expired_together_for_the_secondary_figure', async () => {
    const { db, raw } = createDb();

    await list(db);

    expect(rawSql(raw.$queryRaw)).toMatch(
      /FILTER \(WHERE b\.status IN \('CANCELLED', 'EXPIRED'\)\)/
    );
  });

  it('should_left_join_so_a_client_with_no_bookings_survives', async () => {
    // An inner join hides exactly the rows the spec requires to be visible.
    const { db, raw } = createDb();

    await list(db);

    expect(rawSql(raw.$queryRaw)).toMatch(/LEFT JOIN "Booking"/);
  });

  it('should_order_by_confirmed_count_then_by_a_unique_key', async () => {
    // The tiebreaker is what makes paging correct: ties are the ordinary case.
    const { db, raw } = createDb();

    await list(db);

    expect(rawSql(raw.$queryRaw)).toMatch(
      /ORDER BY count\(b\.id\) FILTER \(WHERE b\.status = 'CONFIRMED'\) DESC, c\.id ASC/
    );
  });

  it('should_take_the_total_from_a_window_rather_than_a_second_query', async () => {
    const { db, raw } = createDb();

    await list(db);

    expect(rawSql(raw.$queryRaw)).toMatch(/count\(\*\) OVER \(\)\s+AS "total"/);
  });

  it('should_pass_the_page_bounds_as_parameters', async () => {
    const { db, raw } = createDb();

    await list(db, 50, 25);

    expect(rawValues(raw.$queryRaw)).toEqual([OWNER, 25, 50]);
  });

  it('should_select_no_timestamp_no_booking_id_and_no_money', async () => {
    const { db, raw } = createDb();

    await list(db);

    const sql = rawSql(raw.$queryRaw);
    for (const forbidden of ['createdAt', 'updatedAt', 'priceAtBooking', 'depositAmount']) {
      expect(sql).not.toContain(forbidden);
    }
  });
});

describe('PrismaClientDirectoryRepository - what it returns', () => {
  it('should_map_a_row_and_narrow_its_counts_from_bigint', async () => {
    const { db } = createDb();

    const page = await list(db);

    expect(page.rows[0]).toEqual({
      id: 'cli-1',
      name: 'Ana',
      email: 'ana@example.com',
      phone: '+5491100000000',
      confirmedCount: 3,
      inactiveCount: 1,
    });
    expect(page.total).toBe(7);
  });

  it('should_not_leak_the_window_total_into_the_row', async () => {
    const { db } = createDb();

    const page = await list(db);

    expect(page.rows[0]).not.toHaveProperty('total');
  });

  it('should_report_an_empty_shop_without_a_second_query', async () => {
    const { db, raw } = createDb([]);

    const page = await list(db, 0);

    expect(page).toEqual({ rows: [], total: 0 });
    expect(raw.client.count).not.toHaveBeenCalled();
  });

  it('should_count_once_when_a_page_past_the_end_returns_nothing', async () => {
    // The only case the window cannot answer: no rows means no window.
    const { db, raw } = createDb([]);
    raw.client.count.mockResolvedValue(42);

    const page = await list(db, 500);

    expect(page).toEqual({ rows: [], total: 42 });
    expect(raw.client.count).toHaveBeenCalledWith({ where: { ownerId: OWNER } });
  });

  it('should_carry_a_client_with_no_bookings_through_as_zero', async () => {
    const { db } = createDb([
      row({ confirmedCount: BigInt(0), inactiveCount: BigInt(0), total: BigInt(1) }),
    ]);

    const page = await list(db);

    expect(page.rows[0]?.confirmedCount).toBe(0);
    expect(page.rows[0]?.inactiveCount).toBe(0);
  });
});
