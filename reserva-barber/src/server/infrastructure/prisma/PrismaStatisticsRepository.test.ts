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

// ---------------------------------------------------------------------------
// D6 — the grouped chart read
// ---------------------------------------------------------------------------

/** Four edges: three hourly buckets across the range above. */
const EDGES = [
  new Date('2026-08-10T03:00:00.000Z'),
  new Date('2026-08-10T04:00:00.000Z'),
  new Date('2026-08-10T05:00:00.000Z'),
  new Date('2026-08-10T06:00:00.000Z'),
];

function createChartsDb(rows: Record<string, unknown>[], cash: unknown = '0') {
  const db = {
    $queryRaw: vi
      .fn()
      .mockResolvedValueOnce(rows)
      .mockResolvedValueOnce([{ cashCollected: cash }]),
    $transaction: vi.fn(),
  };
  return { db: db as unknown as PrismaClient, raw: db };
}

async function readCharts(rows: Record<string, unknown>[], cash: unknown = '0') {
  const { db, raw } = createChartsDb(rows, cash);
  const result = await new PrismaStatisticsRepository(db).readCharts({
    ownerId: OWNER,
    range: RANGE,
    edges: EDGES,
  });
  return { result, raw };
}

describe('PrismaStatisticsRepository - the chart read', () => {
  it('narrows the driver wide integers at this boundary', async () => {
    // A bigint reaching a React prop is `TypeError: Do not know how to
    // serialize a BigInt` at render — a blank page rather than a chart.
    const { result } = await readCharts([
      { bucket: BigInt(2), method: 'MERCADO_PAGO', total: '1500.5', payments: BigInt(3) },
    ]);

    expect(result.rows[0]?.bucket).toBe(2);
    expect(result.rows[0]?.payments).toBe(3);
    expect(Number.isInteger(result.rows[0]?.bucket)).toBe(true);
  });

  it('canonicalizes every amount, including the trailing zero the driver drops', async () => {
    const { result } = await readCharts(
      [{ bucket: BigInt(1), method: 'BANK_TRANSFER', total: '2000.5', payments: BigInt(1) }],
      '4000.5'
    );

    expect(result.rows[0]?.total).toBe('2000.50');
    expect(result.cashCollected).toBe('4000.50');
  });

  it('returns no rows rather than throwing when the period collected nothing', async () => {
    const { result } = await readCharts([]);

    expect(result.rows).toEqual([]);
    expect(result.cashCollected).toBe('0.00');
  });

  it('scopes both statements to the owner in their own right', async () => {
    // There is no row-level security on these tables, so this join *is* the
    // tenancy boundary. A leaked aggregate produces no row that can look wrong
    // — only a plausible bar.
    const { raw } = await readCharts([]);

    for (const call of raw.$queryRaw.mock.calls) {
      expect(call.slice(1)).toContain(OWNER);
    }
    expect(raw.$queryRaw.mock.calls).toHaveLength(2);
  });

  it('passes the bucket edges as values rather than building them in SQL', async () => {
    const { raw } = await readCharts([]);

    expect(raw.$queryRaw.mock.calls[0].slice(1)).toContainEqual(EDGES.map((e) => e.getTime() / 1000));
  });

  it('excludes rejected payment attempts from the method split', async () => {
    // `Payment_one_live_per_booking` is ON ("bookingId") WHERE status <>
    // 'REJECTED', so a booking carries any number of declined attempts on
    // purpose. Without this predicate a client who retried three times reads as
    // three Mercado Pago customers — wrong in the direction that flatters the
    // gateway the shop pays fees to.
    const { raw } = await readCharts([]);
    const sql = (raw.$queryRaw.mock.calls[0][0] as string[]).join('?');

    expect(sql).toContain("p.status = 'APPROVED'");
  });

  it('joins income through the booking status rather than counting approved payments', async () => {
    const { raw } = await readCharts([]);

    for (const call of raw.$queryRaw.mock.calls) {
      expect((call[0] as string[]).join('?')).toContain("pb.status = 'CONFIRMED'");
    }
  });

  it('bounds the buckets on the appointment and the cash figure on the approval', async () => {
    // The one deliberate divergence in this capability (T83). Both are right,
    // they will not agree, and each states its basis where it is rendered.
    const { raw } = await readCharts([]);
    const series = (raw.$queryRaw.mock.calls[0][0] as string[]).join('?');
    const cash = (raw.$queryRaw.mock.calls[1][0] as string[]).join('?');

    expect(series).toContain('pb."startTime"');
    expect(series).not.toContain('approvedAt');
    expect(cash).toContain('p."approvedAt"');
  });

  it('computes no date of its own in either statement', async () => {
    // `date_trunc`'s unit is an identifier position that parameterisation does
    // not cover, and it truncates in the session's timezone — UTC on Supavisor
    // and workerd — so a 21:30 appointment would land in the next day's bar.
    const { raw } = await readCharts([]);

    for (const call of raw.$queryRaw.mock.calls) {
      const sql = (call[0] as string[]).join('?');
      expect(sql).not.toMatch(/date_trunc/i);
      expect(sql).not.toMatch(/\binterval\b/i);
      expect(sql).not.toMatch(/\bnow\s*\(/i);
      expect(sql).not.toMatch(/current_(date|timestamp)/i);
    }
  });

  it('issues both reads outside any shared transaction', async () => {
    // Design D4, revised during implementation. An interactive transaction
    // holds a connection open across round trips against a transaction-mode
    // pooler, and the heavier read failing inside one would cost the owner the
    // five figures as well as the charts (T47, T68).
    const { raw } = await readCharts([]);

    expect(raw.$transaction).not.toHaveBeenCalled();
  });
});

function createBreakdownsDb(rows: Record<string, unknown>[]) {
  const db = {
    $queryRaw: vi.fn().mockResolvedValue(rows),
    $transaction: vi.fn(),
  };
  return { db: db as unknown as PrismaClient, raw: db };
}

async function readBreakdowns(rows: Record<string, unknown>[]) {
  const { db, raw } = createBreakdownsDb(rows);
  const result = await new PrismaStatisticsRepository(db).readBreakdowns({
    ownerId: OWNER,
    range: RANGE,
    edges: EDGES,
  });
  return { result, raw };
}

function breakdownSql(raw: { $queryRaw: ReturnType<typeof vi.fn> }): string {
  return (raw.$queryRaw.mock.calls[0][0] as string[]).join('?');
}

describe('PrismaStatisticsRepository - the breakdown read', () => {
  it('reads all three breakdowns in one statement', async () => {
    // Three statements answer from three instants, and three groupings that
    // cannot be added up against each other are worse than one.
    const { raw } = await readBreakdowns([]);

    expect(raw.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('groups one shared row set three ways', async () => {
    const sql = breakdownSql((await readBreakdowns([])).raw);

    expect(sql).toMatch(/WITH\s+confirmed\s+AS/i);
    expect((sql.match(/UNION ALL/gi) ?? []).length).toBe(2);
    expect((sql.match(/GROUP BY/gi) ?? []).length).toBe(3);
  });

  it('scopes every branch to the owner in its own right', async () => {
    // A union's branches are separate statements sharing a projection, so each
    // is its own opportunity to lose the tenancy join. There is no RLS on these
    // tables: the join is the entire boundary.
    const { raw } = await readBreakdowns([]);
    const sql = breakdownSql(raw);

    // The shared row set plus one per branch.
    expect((sql.match(/"ownerId"\s*=/g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect(raw.$queryRaw.mock.calls[0].slice(1).filter((value) => value === OWNER).length).toBe(4);
    expect(raw.$queryRaw.mock.calls[0].slice(1)).not.toContain(OTHER_OWNER);
  });

  it('reaches the owner through the booking barber and never through the service', async () => {
    // `Service.ownerId` is a real column and agrees today. A second path to the
    // owner is one edit away from being a second answer to a question that must
    // only ever have one.
    const sql = breakdownSql((await readBreakdowns([])).raw);

    expect(sql).not.toMatch(/s\."ownerId"/);
    expect(sql).toMatch(/JOIN "Barber"/);
    expect(sql).toMatch(/JOIN "Location"/);
  });

  it('never lets a payment row into the counted row set', async () => {
    // A booking carries any number of REJECTED attempts on purpose, so a join
    // here multiplies it once per declined card and inflates both its service
    // and its barber — and the totals still look like a busy month.
    const sql = breakdownSql((await readBreakdowns([])).raw);

    expect(sql).not.toContain('"Payment"');
  });

  it('counts confirmations and never an expiry or a cancellation', async () => {
    const sql = breakdownSql((await readBreakdowns([])).raw);

    expect(sql).toContain("b.status = 'CONFIRMED'");
    expect(sql).not.toContain('EXPIRED');
    expect(sql).not.toContain('CANCELLED');
  });

  it('bounds the row set on the appointment start and half-openly', async () => {
    const { raw } = await readBreakdowns([]);
    const sql = breakdownSql(raw);

    expect(sql).toContain('b."startTime" >=');
    expect(sql).toContain('b."startTime" <');
    expect(raw.$queryRaw.mock.calls[0].slice(1)).toContain(RANGE.start);
    expect(raw.$queryRaw.mock.calls[0].slice(1)).toContain(RANGE.end);
  });

  it('passes the hour edges as values rather than computing an hour', async () => {
    // Rule 15. `extract(hour …)` and `date_trunc` resolve in the session's
    // timezone — UTC on Supavisor and workerd — so every appointment from 21:00
    // local onward would be counted in the following day's hours.
    const { raw } = await readBreakdowns([]);
    const sql = breakdownSql(raw);

    expect(sql).toContain('width_bucket');
    expect(raw.$queryRaw.mock.calls[0].slice(1)).toContainEqual(
      EDGES.map((edge) => edge.getTime() / 1000)
    );
    expect(sql).not.toMatch(/date_trunc/i);
    expect(sql).not.toMatch(/extract\s*\(\s*hour/i);
    expect(sql).not.toMatch(/at time zone/i);
    expect(sql).not.toMatch(/America\//i);
    expect(sql).not.toMatch(/\bnow\s*\(/i);
    expect(sql).not.toMatch(/current_(date|timestamp)/i);
  });

  it('groups the hour branch by its output alias rather than by an ordinal', async () => {
    // `GROUP BY 2` reads the second column of that branch's select list, so
    // reordering the projection — a change that looks like formatting — would
    // silently group by something else. Repeating the expression instead would
    // put 745 thresholds on the wire twice for a month-sized range.
    const sql = breakdownSql((await readBreakdowns([])).raw);

    expect(sql).toMatch(/GROUP BY "key"/);
    expect(sql).not.toMatch(/GROUP BY\s+\d/);
  });

  it('neither orders, caps nor folds in the statement', async () => {
    // Rule 16. A LIMIT discards the rows past the cap, and a discarded
    // remainder is invisible: the ranking simply stops summing to the figure
    // above it.
    const sql = breakdownSql((await readBreakdowns([])).raw);

    expect(sql).not.toMatch(/\bLIMIT\b/i);
    expect(sql).not.toMatch(/\bORDER BY\b/i);
  });

  it('issues the read outside any transaction', async () => {
    const { raw } = await readBreakdowns([]);

    expect(raw.$transaction).not.toHaveBeenCalled();
  });

  it('narrows the driver wide integers at this boundary', async () => {
    // A bigint reaching a React prop is `TypeError: Do not know how to
    // serialize a BigInt` at render — a blank page rather than a ranking.
    const { result } = await readBreakdowns([
      { kind: 'service', key: 'svc-1', label: 'Corte', sublabel: null, count: BigInt(4) },
      { kind: 'barber', key: 'bar-1', label: 'Nico', sublabel: 'Centro', count: BigInt(3) },
      { kind: 'hour', key: '14', label: '', sublabel: null, count: BigInt(2) },
    ]);

    expect(result.services[0]).toEqual({
      key: 'svc-1',
      label: 'Corte',
      sublabel: null,
      count: 4,
    });
    expect(result.barbers[0]?.sublabel).toBe('Centro');
    expect(result.hours[0]).toEqual({ bucket: 14, count: 2 });
    expect(Number.isInteger(result.hours[0]?.bucket)).toBe(true);
  });

  it('discriminates the three branches and mixes none of them', async () => {
    const { result } = await readBreakdowns([
      { kind: 'hour', key: '3', label: '', sublabel: null, count: BigInt(1) },
      { kind: 'service', key: 'svc-1', label: 'Corte', sublabel: null, count: BigInt(4) },
      { kind: 'service', key: 'svc-2', label: 'Barba', sublabel: null, count: BigInt(1) },
      { kind: 'barber', key: 'bar-1', label: 'Nico', sublabel: 'Centro', count: BigInt(5) },
    ]);

    expect(result.services).toHaveLength(2);
    expect(result.barbers).toHaveLength(1);
    expect(result.hours).toHaveLength(1);
  });

  it('returns three empty breakdowns for a period with no appointments', async () => {
    // An empty period is an answer and renders as one. There is no row of zeros
    // to guard for here: every branch is grouped, so an empty period is no rows.
    const { result } = await readBreakdowns([]);

    expect(result).toEqual({ services: [], barbers: [], hours: [] });
  });
});
