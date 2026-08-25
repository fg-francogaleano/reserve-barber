import { describe, it, expect, vi } from 'vitest';
import { PrismaDashboardSummaryRepository } from './PrismaDashboardSummaryRepository';
import type { PrismaClient } from '@/generated/prisma/client';

const OWNER = 'own-1';
const OTHER_OWNER = 'own-2';
const NOW = new Date('2026-08-31T23:30:00.000Z');
const DAY = {
  start: new Date('2026-08-31T03:00:00.000Z'),
  end: new Date('2026-09-01T03:00:00.000Z'),
};
const MONTH = {
  start: new Date('2026-08-01T03:00:00.000Z'),
  end: new Date('2026-09-01T03:00:00.000Z'),
};

const ZERO_ROW = {
  confirmedToday: BigInt(0),
  heldToday: BigInt(0),
  cancelledToday: BigInt(0),
  confirmedAllTime: BigInt(0),
  monthDepositIncome: '0',
};

function createDb() {
  const db = {
    $queryRaw: vi.fn().mockResolvedValue([ZERO_ROW]),
    booking: { findMany: vi.fn().mockResolvedValue([]) },
    barber: { findMany: vi.fn().mockResolvedValue([]) },
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

describe('PrismaDashboardSummaryRepository - readSummary', () => {
  it('reads every figure in one statement', async () => {
    const { db, raw } = createDb();

    await new PrismaDashboardSummaryRepository(db).readSummary({
      ownerId: OWNER,
      dayRange: DAY,
      monthRange: MONTH,
      now: NOW,
    });

    // Five figures from five queries would answer from five instants, and a
    // booking confirmed mid-render would be counted by one and not another.
    expect(raw.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('scopes through barber and location to the owner', async () => {
    const { db, raw } = createDb();

    await new PrismaDashboardSummaryRepository(db).readSummary({
      ownerId: OWNER,
      dayRange: DAY,
      monthRange: MONTH,
      now: NOW,
    });

    const sql = rawSql(raw.$queryRaw);
    expect(sql).toContain('JOIN "Barber"');
    expect(sql).toContain('JOIN "Location"');
    expect(sql).toContain('"ownerId"');
    // There is no RLS on these tables; the join is the entire tenancy boundary.
    expect(rawValues(raw.$queryRaw)).toContain(OWNER);
    expect(rawValues(raw.$queryRaw)).not.toContain(OTHER_OWNER);
  });

  it('joins income through the booking status rather than counting approved payments', async () => {
    const { db, raw } = createDb();

    await new PrismaDashboardSummaryRepository(db).readSummary({
      ownerId: OWNER,
      dayRange: DAY,
      monthRange: MONTH,
      now: NOW,
    });

    const sql = rawSql(raw.$queryRaw);
    // The late-payment case: an APPROVED payment on a booking that never
    // confirmed is money owed back, not revenue.
    expect(sql).toMatch(/p\.status = 'APPROVED'/);
    expect(sql).toMatch(/pb\.status = 'CONFIRMED'/);
  });

  it('bounds income on approvedAt and never on createdAt or the appointment', async () => {
    const { db, raw } = createDb();

    await new PrismaDashboardSummaryRepository(db).readSummary({
      ownerId: OWNER,
      dayRange: DAY,
      monthRange: MONTH,
      now: NOW,
    });

    const sql = rawSql(raw.$queryRaw);
    expect(sql).toContain('p."approvedAt"');
    expect(sql).not.toContain('p."createdAt"');
  });

  it('guards the cancellation count on both the status and cancelledAt', async () => {
    const { db, raw } = createDb();

    await new PrismaDashboardSummaryRepository(db).readSummary({
      ownerId: OWNER,
      dayRange: DAY,
      monthRange: MONTH,
      now: NOW,
    });

    const sql = rawSql(raw.$queryRaw);
    expect(sql).toMatch(/b\.status = 'CANCELLED'/);
    expect(sql).toContain('b."cancelledAt"');
    // EXPIRED is a deadline, not a decision, and the sweep produces those rows
    // continuously. It must never appear as a cancellation.
    expect(sql).not.toMatch(/status = 'EXPIRED'/);
  });

  it('counts confirmations for the all-time figure, never every row', async () => {
    const { db, raw } = createDb();

    await new PrismaDashboardSummaryRepository(db).readSummary({
      ownerId: OWNER,
      dayRange: DAY,
      monthRange: MONTH,
      now: NOW,
    });

    // A bare count(*) with no FILTER would be a count of checkout attempts.
    expect(rawSql(raw.$queryRaw)).toMatch(
      /count\(\*\) FILTER \(WHERE b\.status = 'CONFIRMED'\) AS "confirmedAllTime"/
    );
  });

  it('contains no predicate over transfer receipts', async () => {
    const { db, raw } = createDb();

    await new PrismaDashboardSummaryRepository(db).readSummary({
      ownerId: OWNER,
      dayRange: DAY,
      monthRange: MONTH,
      now: NOW,
    });

    // The queue's predicate has one home, in the receipt repository. A copy
    // here would desynchronise the counter from its queue on the next change.
    expect(rawSql(raw.$queryRaw)).not.toContain('TransferReceipt');
  });

  it('passes the ranges and the instant it was given', async () => {
    const { db, raw } = createDb();

    await new PrismaDashboardSummaryRepository(db).readSummary({
      ownerId: OWNER,
      dayRange: DAY,
      monthRange: MONTH,
      now: NOW,
    });

    const values = rawValues(raw.$queryRaw);
    expect(values).toContain(DAY.start);
    expect(values).toContain(MONTH.start);
    expect(values).toContain(NOW);
  });

  it('returns the sum as a canonical two-decimal string', async () => {
    const { db, raw } = createDb();
    // The driver returns a stored 2000.50 as 2000.5, and a SUM is the same
    // shape of value (measured in PC3).
    raw.$queryRaw.mockResolvedValue([{ ...ZERO_ROW, monthDepositIncome: '2000.5' }]);

    const summary = await new PrismaDashboardSummaryRepository(db).readSummary({
      ownerId: OWNER,
      dayRange: DAY,
      monthRange: MONTH,
      now: NOW,
    });

    expect(summary.monthDepositIncome).toBe('2000.50');
  });

  it('reports a month with no income as a canonical zero', async () => {
    const { db, raw } = createDb();
    raw.$queryRaw.mockResolvedValue([{ ...ZERO_ROW, monthDepositIncome: 0 }]);

    const summary = await new PrismaDashboardSummaryRepository(db).readSummary({
      ownerId: OWNER,
      dayRange: DAY,
      monthRange: MONTH,
      now: NOW,
    });

    // Zero income is a fact. A null would make the caller decide what a missing
    // sum means.
    expect(summary.monthDepositIncome).toBe('0.00');
  });

  it('converts bigint counts into numbers', async () => {
    const { db, raw } = createDb();
    raw.$queryRaw.mockResolvedValue([
      {
        ...ZERO_ROW,
        confirmedToday: BigInt(3),
        heldToday: BigInt(2),
        cancelledToday: BigInt(1),
        confirmedAllTime: BigInt(41),
      },
    ]);

    const summary = await new PrismaDashboardSummaryRepository(db).readSummary({
      ownerId: OWNER,
      dayRange: DAY,
      monthRange: MONTH,
      now: NOW,
    });

    expect(summary).toMatchObject({
      confirmedToday: 3,
      heldToday: 2,
      cancelledToday: 1,
      confirmedAllTime: 41,
    });
  });
});

describe('PrismaDashboardSummaryRepository - findRecentForOwner', () => {
  it('applies the limit it was given', async () => {
    const { db, raw } = createDb();

    await new PrismaDashboardSummaryRepository(db).findRecentForOwner({
      ownerId: OWNER,
      limit: 10,
    });

    expect(vi.mocked(raw.booking.findMany).mock.calls[0][0]).toMatchObject({
      take: 10,
      orderBy: { createdAt: 'desc' },
    });
  });

  it('scopes to the owner even when no barber filter is applied', async () => {
    const { db, raw } = createDb();

    await new PrismaDashboardSummaryRepository(db).findRecentForOwner({
      ownerId: OWNER,
      limit: 10,
    });

    const { where } = vi.mocked(raw.booking.findMany).mock.calls[0][0];
    expect(where.barber.location).toEqual({ ownerId: OWNER });
    expect(where.barber.id).toBeUndefined();
  });

  it('narrows by barber in addition to the owner scope, never instead of it', async () => {
    const { db, raw } = createDb();

    await new PrismaDashboardSummaryRepository(db).findRecentForOwner({
      ownerId: OWNER,
      barberId: 'bar-1',
      limit: 10,
    });

    const { where } = vi.mocked(raw.booking.findMany).mock.calls[0][0];
    expect(where.barber.id).toBe('bar-1');
    expect(where.barber.location).toEqual({ ownerId: OWNER });
  });

  it('selects no client email and no telephone', async () => {
    const { db, raw } = createDb();

    await new PrismaDashboardSummaryRepository(db).findRecentForOwner({
      ownerId: OWNER,
      limit: 10,
    });

    const { select } = vi.mocked(raw.booking.findMany).mock.calls[0][0];
    // A field that is not selected cannot reach a log line or a prop.
    expect(select.client.select).toEqual({ name: true });
    expect(select.client.select.email).toBeUndefined();
    expect(select.client.select.phone).toBeUndefined();
  });

  it('returns the deposit as a canonical two-decimal string', async () => {
    const { db, raw } = createDb();
    raw.booking.findMany.mockResolvedValue([
      {
        id: 'bkg-1',
        startTime: NOW,
        status: 'EXPIRED',
        depositAmount: '2000.5',
        client: { name: 'Ana' },
        service: { name: 'Corte' },
        barber: { displayName: 'Nico' },
      },
    ]);

    const [row] = await new PrismaDashboardSummaryRepository(db).findRecentForOwner({
      ownerId: OWNER,
      limit: 10,
    });

    expect(row.depositAmount).toBe('2000.50');
    expect(row.clientName).toBe('Ana');
    // Every status is listed. This is the first surface in the product that
    // shows an owner an abandoned checkout at all.
    expect(row.status).toBe('EXPIRED');
  });
});

describe('PrismaDashboardSummaryRepository - findFilterableBarbers', () => {
  it('scopes to the owner and keeps inactive barbers', async () => {
    const { db, raw } = createDb();

    await new PrismaDashboardSummaryRepository(db).findFilterableBarbers(OWNER);

    const call = vi.mocked(raw.barber.findMany).mock.calls[0][0];
    expect(call.where).toEqual({ location: { ownerId: OWNER } });
    // Filtering on isActive would make a deactivated barber's history
    // unreachable while their rows still appear in the unfiltered list.
    expect(call.where.isActive).toBeUndefined();
  });
});
