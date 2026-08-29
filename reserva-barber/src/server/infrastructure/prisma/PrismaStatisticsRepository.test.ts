import { describe, it, expect, vi } from 'vitest';
import { PrismaStatisticsRepository } from './PrismaStatisticsRepository';
import type { PrismaClient } from '@/generated/prisma/client';

/**
 * **What these tests prove, and what they cannot.**
 *
 * They pin the statement's shape: that one query is issued, that the owner
 * predicate is present in both the outer statement and the income sub-query,
 * that `Payment` never enters the counted row set, and that the returned values
 * are narrowed and canonicalized at this boundary.
 *
 * They prove **nothing** about whether PostgreSQL and the pg driver adapter
 * would accept the result. `docs/tech-debt.md` **T58** is the record of that
 * distinction being fatal: B4's advisory lock was mocked, asserted, and green,
 * while every booking write failed in the runtime because the adapter could not
 * deserialize a `void` column. The entry names **D5** in its trigger and warns
 * that `GROUP BY` aggregates are where the driver's type mapping is easiest to
 * get wrong — `count(DISTINCT …)` and `COALESCE(sum(…), 0)` are exactly that.
 *
 * The proof for those lives in `scripts/d5-gate.ts`, against the live database,
 * on both runtimes. These tests are the cheap half.
 */

const OWNER = 'own-1';
const OTHER_OWNER = 'own-2';
const RANGE = {
  start: new Date('2026-08-10T03:00:00.000Z'),
  end: new Date('2026-08-17T03:00:00.000Z'),
};

const ZERO_ROW = {
  confirmedCount: BigInt(0),
  depositTotal: '0',
  cancelledCount: BigInt(0),
  cancelledByOwner: BigInt(0),
  cancelledByClient: BigInt(0),
  uniqueClients: BigInt(0),
  bookingsEver: BigInt(0),
};

function createDb(row: Record<string, unknown> | undefined = ZERO_ROW) {
  const db = {
    $queryRaw: vi.fn().mockResolvedValue(row === undefined ? [] : [row]),
  };
  return { db: db as unknown as PrismaClient, raw: db };
}

/** The interpolated values of a tagged-template call, in order. */
function rawValues(mock: ReturnType<typeof vi.fn>): unknown[] {
  return mock.mock.calls[0].slice(1);
}

/** The SQL text of a tagged-template call. */
function rawSql(mock: ReturnType<typeof vi.fn>): string {
  return (mock.mock.calls[0][0] as string[]).join('?');
}

async function read(row?: Record<string, unknown> | undefined) {
  const { db, raw } = createDb(row);
  const result = await new PrismaStatisticsRepository(db).readStatistics({
    ownerId: OWNER,
    range: RANGE,
  });
  return { result, raw };
}

describe('PrismaStatisticsRepository - the statement', () => {
  it('reads every figure in one statement', async () => {
    const { raw } = await read();

    // Separate queries answer from separate instants: a booking confirmed
    // mid-render would be counted by one figure and not another, and the owner
    // would be shown two numbers that cannot both be true.
    expect(raw.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('scopes through barber and location to the owner', async () => {
    const { raw } = await read();
    const sql = rawSql(raw.$queryRaw);

    expect(sql).toContain('JOIN "Barber"');
    expect(sql).toContain('JOIN "Location"');
    expect(sql).toContain('"ownerId"');
    // There is no RLS on these tables; the join is the entire tenancy boundary.
    expect(rawValues(raw.$queryRaw)).toContain(OWNER);
    expect(rawValues(raw.$queryRaw)).not.toContain(OTHER_OWNER);
  });

  it('scopes the income sub-query to the owner in its own right', async () => {
    const { raw } = await read();
    const sql = rawSql(raw.$queryRaw);

    // Redundant while the outer query is correct, and no longer redundant the
    // first time somebody edits it. Two owner predicates, two parameters.
    const ownerPredicates = sql.match(/"ownerId"\s*=/g) ?? [];
    expect(ownerPredicates.length).toBeGreaterThanOrEqual(2);
    expect(rawValues(raw.$queryRaw).filter((value) => value === OWNER).length).toBeGreaterThanOrEqual(
      2
    );
  });

  it('never joins Payment into the row set the counts are computed over', async () => {
    const { raw } = await read();
    const sql = rawSql(raw.$queryRaw);

    // A booking may carry many payment rows — the live-payment constraint
    // admits any number of REJECTED attempts. Joining them here multiplies the
    // booking's row and inflates every count(*) FILTER, while the DISTINCT
    // client count absorbs it, so the result reads as a rounding quirk.
    const outerFrom = sql.slice(sql.lastIndexOf('FROM "Booking"'));
    expect(outerFrom).not.toContain('"Payment"');
    expect(sql).toContain('SELECT');
    // The sum lives in a sub-query with its own FROM.
    expect(sql).toContain('FROM "Payment"');
  });

  it('joins income through the booking status rather than counting approved payments', async () => {
    const { raw } = await read();
    const sql = rawSql(raw.$queryRaw);

    // A payment may be APPROVED while its booking is not: the late-payment
    // case. That is money the owner owes back, not revenue.
    expect(sql).toContain("'APPROVED'");
    expect(sql).toContain("'CONFIRMED'");
  });

  it('bounds every figure on the booking start rather than on the payment approval', async () => {
    const { raw } = await read();
    const sql = rawSql(raw.$queryRaw);

    expect(sql).toContain('"startTime"');
    // Design D1: the whole set shares one clock so the average means something.
    expect(sql).not.toContain('"approvedAt"');
    expect(sql).not.toContain('"cancelledAt"');
    expect(sql).not.toContain('"createdAt"');
  });

  it('passes two instants and computes no dates of its own', async () => {
    const { raw } = await read();
    const sql = rawSql(raw.$queryRaw);
    const values = rawValues(raw.$queryRaw);

    expect(values).toContain(RANGE.start);
    expect(values).toContain(RANGE.end);
    // date_trunc would be an identifier position if its unit came from the
    // parameter, and truncates in the session's timezone — UTC here — even
    // when it does not.
    expect(sql).not.toContain('date_trunc');
    expect(sql).not.toContain('now()');
    expect(sql).not.toContain('CURRENT_DATE');
    expect(sql).not.toContain('interval');
  });

  it('never reads the hold deadline, because no figure asks whether a hold is live', async () => {
    const { raw } = await read();

    expect(rawSql(raw.$queryRaw)).not.toContain('holdExpiresAt');
  });

  it('counts expired bookings in no figure at all', async () => {
    const { raw } = await read();
    const sql = rawSql(raw.$queryRaw);

    // EXPIRED against CANCELLED is how a deadline is told apart from a
    // decision, and the sweep produces expired rows continuously. It appears
    // in no FILTER; the all-time flag is the only clause with no status at all.
    expect(sql).not.toContain("'EXPIRED'");
  });
});

describe('PrismaStatisticsRepository - the mapping', () => {
  it('narrows the driver bigint counts to numbers', async () => {
    const { result } = await read({
      ...ZERO_ROW,
      confirmedCount: BigInt(12),
      cancelledCount: BigInt(3),
      cancelledByOwner: BigInt(1),
      cancelledByClient: BigInt(1),
      uniqueClients: BigInt(9),
    });

    // bigint has no place above this layer: it does not serialize across the
    // RSC boundary, and these figures are small by construction.
    expect(result.confirmedCount).toBe(12);
    expect(result.cancelledCount).toBe(3);
    expect(result.cancelledByOwner).toBe(1);
    expect(result.cancelledByClient).toBe(1);
    expect(result.uniqueClients).toBe(9);
    for (const value of Object.values(result)) {
      expect(typeof value).not.toBe('bigint');
    }
  });

  it('canonicalizes the sum so a trailing zero survives', async () => {
    const { result } = await read({ ...ZERO_ROW, depositTotal: '2000.5' });

    // The driver returns a stored 2000.50 as 2000.5, and integer-cent
    // arithmetic then reads the lone 5 as five centavos (measured in PC3).
    expect(result.depositTotal).toBe('2000.50');
  });

  it('reports whether the shop has ever had a booking as a flag, not a figure', async () => {
    const quiet = await read({ ...ZERO_ROW, bookingsEver: BigInt(0) });
    const busy = await read({ ...ZERO_ROW, bookingsEver: BigInt(4) });

    expect(quiet.result.hasAnyBookingEver).toBe(false);
    expect(busy.result.hasAnyBookingEver).toBe(true);
    expect(busy.result.confirmedCount).toBe(0);
  });

  it('carries no personal field and no identifier', async () => {
    const { result } = await read();

    expect(Object.keys(result).sort()).toEqual([
      'cancelledByClient',
      'cancelledByOwner',
      'cancelledCount',
      'confirmedCount',
      'depositTotal',
      'hasAnyBookingEver',
      'uniqueClients',
    ]);
  });

  it('guards a missing row for shape and not for an empty shop', async () => {
    // An owner with no bookings at all still produces one row of zeros — the
    // aggregate has no GROUP BY. This guard is for the shape being wrong.
    const { result } = await read(undefined);

    expect(result.confirmedCount).toBe(0);
    expect(result.depositTotal).toBe('0.00');
    expect(result.hasAnyBookingEver).toBe(false);
  });
});
