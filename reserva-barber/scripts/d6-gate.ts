// GATE D6 — the income series and the payment-method split against the live database.
//
// What a mock cannot certify here, and why each one needs a real row:
//
//   1. **`width_bucket` over a `float8[]` survives the driver.** This is a new
//      shape for this capability and exactly what T58 warns about: `tsc` cannot
//      check a function name inside a template literal, and every unit test
//      asserts the SQL *text*. The bucket index also comes back as a wide
//      integer, and a `bigint` reaching a React prop is a blank page rather than
//      an error.
//
//   2. **`p.status = 'APPROVED'` is load-bearing on the method split.**
//      `Payment_one_live_per_booking` is `ON ("bookingId") WHERE status <>
//      'REJECTED'`, so a booking carries any number of declined attempts by
//      design. Section 4 seeds two REJECTED plus one APPROVED on one booking and
//      measures the **counterfactual** — the identical statement without the
//      predicate — because an assertion that merely reads "1 payment" would pass
//      for several wrong implementations.
//
//   3. **The bars sum to the deposits figure.** The two come from two
//      independent statements that deliberately share no transaction
//      (`IStatisticsRepository` rule 9), so this is the property that replaces
//      the snapshot guarantee and it has to be measured against real rows.
//
//   4. **An empty bucket in the middle of a period.** The read returns only
//      buckets with rows; a series that omits the quiet day draws a plausible
//      shape on a shorter axis. Section 5 seeds a hole and asserts the filled
//      series is full-length with a real zero in it.
//
//   5. **Cross-owner isolation, in both directions, on the money**, with the
//      owner predicate removed to prove it is doing work. There is no RLS on
//      these tables: the barber→location join is the whole tenancy boundary, and
//      a leaked aggregate produces no row that can look wrong — only a plausible
//      bar.
//
//   6. **The cash figure is on a different clock and must disagree.** Section 7
//      seeds a deposit approved inside the range for an appointment outside it.
//      That single row is the whole of T83, and if the two figures ever agree on
//      it, one of them has silently moved onto the other's column.
//
//   7. **Half-open boundaries of the first and last bucket.**
//
//   8. **The query plan**, captured rather than guessed (D1's rule, T81's
//      technique).
//
// Everything it creates is prefixed `__d6_gate__` and removed at the end in
// foreign-key order. Every booking FK is `Restrict`, so nothing cascades and the
// order is the guarantee rather than a convenience.
//
//   npx tsx scripts/d6-gate.ts
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma-cli/client';
import { PrismaStatisticsRepository } from '../src/server/infrastructure/prisma/PrismaStatisticsRepository';
import {
  fillIncomeSeries,
  paymentMethodSplit,
  sumIncomeSeries,
} from '../src/server/domain/models/statistics';
import { bucketEdgesFor } from '../src/server/application/dashboard/statisticsRangeParams';
import { intervalFor } from '../src/server/application/dashboard/statisticsRangeParams';

const MARK = '__d6_gate__';
const MINUTE = 60_000;

/**
 * A week in 2027, deliberately far from any real booking, and resolved through
 * the same functions the page uses.
 *
 * **The range and the edges come from `intervalFor` and `bucketEdgesFor`
 * rather than being written out here.** A gate that computed its own boundaries
 * would prove the statement works against *some* array and say nothing about the
 * one the page passes — which is where a bucketing defect would actually live.
 */
const TODAY = { year: 2027, month: 3, day: 3 } as const;
const RANGE = intervalFor('semana', TODAY);
const EDGES = bucketEdgesFor('semana', TODAY);

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

let failures = 0;
let skipped = 0;

function report(probe: string, passed: boolean, detail: string): void {
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${probe} — ${detail}`);
  if (!passed) failures += 1;
}

function observe(probe: string, detail: string): void {
  console.log(`OBSERVED  ${probe} — ${detail}`);
}

const PROBE_TIMEOUT_MS = 30_000;

/**
 * Fails a hung read instead of waiting on it forever.
 *
 * **T68**, and D5's hard-won lesson about it: the fault does not surface as an
 * error, it surfaces as a response that **never arrives**. On D5's first run the
 * `EXPLAIN` probe hung, `probeOrSkip` never got an exception to classify, and
 * the `finally` that removes the fixture never ran — leaving marked owners in
 * the database. A gate that cannot clean up after itself is a worse failure than
 * one that reports a skip.
 *
 * The fault is also **intermittent**: D5 saw it flip within one working day on
 * the same connection string. So a green gate is not evidence it is gone, and a
 * hanging gate is not evidence of a product defect.
 */
async function withTimeout<T>(operation: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Timed out after ${PROBE_TIMEOUT_MS} ms`)),
          PROBE_TIMEOUT_MS
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function probeOrSkip(probe: string, run: () => Promise<void>): Promise<void> {
  try {
    await withTimeout(run());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('timeout') || message.includes('Timed out')) {
      skipped += 1;
      observe(
        probe,
        `NOT RUN — the response never arrived (${message}). This is T68, the local network's ` +
          "path-MTU fault, not a result about the product. Confirm with `SELECT repeat('x', 1400)`."
      );
      return;
    }
    throw error;
  }
}

async function removeMarkedRows(prisma: PrismaClient): Promise<void> {
  await prisma.payment.deleteMany({
    where: { booking: { cancellationToken: { startsWith: MARK } } },
  });
  await prisma.booking.deleteMany({ where: { cancellationToken: { startsWith: MARK } } });
  await prisma.client.deleteMany({ where: { owner: { email: { startsWith: MARK } } } });
  await prisma.barber.deleteMany({
    where: { location: { owner: { email: { startsWith: MARK } } } },
  });
  await prisma.service.deleteMany({ where: { owner: { email: { startsWith: MARK } } } });
  await prisma.location.deleteMany({ where: { owner: { email: { startsWith: MARK } } } });
  await prisma.owner.deleteMany({ where: { email: { startsWith: MARK } } });
}

async function main(): Promise<void> {
  const adapter = new PrismaPg({ connectionString: requireEnv('DATABASE_URL') });
  const prisma = new PrismaClient({ adapter });

  const repository = new PrismaStatisticsRepository(prisma as never);

  await removeMarkedRows(prisma);

  try {
    // ─── 1. Fixture ──────────────────────────────────────────────────────────

    async function makeOwner(suffix: string) {
      const owner = await prisma.owner.create({
        data: { email: `${MARK}-${suffix}@e.com` },
        select: { id: true },
      });
      const location = await prisma.location.create({
        data: { ownerId: owner.id, name: `${MARK}${suffix}` },
        select: { id: true },
      });
      const barber = await prisma.barber.create({
        data: { locationId: location.id, displayName: `B${suffix}` },
        select: { id: true },
      });
      const service_ = await prisma.service.create({
        data: { ownerId: owner.id, name: `S${suffix}`, price: '10000.00', durationMinutes: 30 },
        select: { id: true },
      });
      return { owner, location, barber, service: service_ };
    }

    const a = await makeOwner('a');
    const b = await makeOwner('b');

    async function makeClient(fixture: typeof a, tag: string) {
      return prisma.client.create({
        data: {
          ownerId: fixture.owner.id,
          name: `N${tag}`,
          email: `${MARK}-${tag}@e.com`,
          phone: '+541100000000',
        },
        select: { id: true },
      });
    }

    let bookingSeq = 0;
    async function makeBooking(input: {
      fixture: typeof a;
      clientId: string;
      status: 'CONFIRMED' | 'CANCELLED' | 'EXPIRED' | 'PENDING_PAYMENT';
      startAt: Date;
    }): Promise<string> {
      bookingSeq += 1;
      const booking = await prisma.booking.create({
        data: {
          clientId: input.clientId,
          barberId: input.fixture.barber.id,
          serviceId: input.fixture.service.id,
          startTime: input.startAt,
          endTime: new Date(input.startAt.getTime() + 30 * MINUTE),
          status: input.status as never,
          priceAtBooking: '10000.00',
          depositAmount: '3000.00',
          cancellationToken: `${MARK}-${bookingSeq}`,
          holdExpiresAt:
            input.status === 'PENDING_PAYMENT' ? new Date(Date.now() + 30 * MINUTE) : null,
          cancelledAt: input.status === 'CANCELLED' ? new Date() : null,
        },
        select: { id: true },
      });
      return booking.id;
    }

    let paymentSeq = 0;
    async function makePayment(input: {
      bookingId: string;
      status: 'APPROVED' | 'REJECTED' | 'PENDING';
      amount: string;
      method?: 'MERCADO_PAGO' | 'BANK_TRANSFER';
      approvedAt?: Date;
    }): Promise<void> {
      paymentSeq += 1;
      await prisma.payment.create({
        data: {
          bookingId: input.bookingId,
          method: (input.method ?? 'MERCADO_PAGO') as never,
          amount: input.amount,
          status: input.status as never,
          mpPaymentId: `${MARK}-p${paymentSeq}`,
          approvedAt:
            input.status === 'APPROVED' ? (input.approvedAt ?? new Date(RANGE.start.getTime() + MINUTE)) : null,
        },
      });
    }

    /** Day `index` of the week, at 13:00 local — comfortably inside the bucket. */
    function dayAt(index: number): Date {
      return new Date((EDGES[index] as Date).getTime() + 13 * 60 * MINUTE);
    }

    const served = await makeClient(a, 'served');

    // Day 0 — Mercado Pago, and the trailing-zero amount so one row proves two
    // properties.
    const d0 = await makeBooking({ fixture: a, clientId: served.id, status: 'CONFIRMED', startAt: dayAt(0) });
    await makePayment({ bookingId: d0, status: 'APPROVED', amount: '2000.50' });

    // Day 2 — bank transfer, so the split has two parts to divide.
    const d2 = await makeBooking({ fixture: a, clientId: served.id, status: 'CONFIRMED', startAt: dayAt(2) });
    await makePayment({
      bookingId: d2,
      status: 'APPROVED',
      amount: '1000.00',
      method: 'BANK_TRANSFER',
    });

    // Day 4 — THE probe: two declined attempts and one approval on ONE booking.
    const retried = await makeClient(a, 'retried');
    const d4 = await makeBooking({ fixture: a, clientId: retried.id, status: 'CONFIRMED', startAt: dayAt(4) });
    await makePayment({ bookingId: d4, status: 'REJECTED', amount: '500.00' });
    await makePayment({ bookingId: d4, status: 'REJECTED', amount: '500.00' });
    await makePayment({ bookingId: d4, status: 'APPROVED', amount: '1500.00' });

    // Days 1, 3, 5, 6 are deliberately empty — the holes the series must fill.

    // The late-payment case: real money, on a booking that never confirmed. In
    // no bucket and in neither method.
    const lapsed = await makeClient(a, 'lapsed');
    const lapsedBooking = await makeBooking({
      fixture: a,
      clientId: lapsed.id,
      status: 'EXPIRED',
      startAt: dayAt(1),
    });
    await makePayment({ bookingId: lapsedBooking, status: 'APPROVED', amount: '9999.00' });

    // T83's row: approved INSIDE the range, for an appointment AFTER it. In the
    // cash figure, in no bucket, and in no deposits figure.
    const crossPeriod = await makeClient(a, 'cross');
    const crossBooking = await makeBooking({
      fixture: a,
      clientId: crossPeriod.id,
      status: 'CONFIRMED',
      startAt: new Date(RANGE.end.getTime() + 3 * 24 * 60 * MINUTE),
    });
    await makePayment({
      bookingId: crossBooking,
      status: 'APPROVED',
      amount: '777.00',
      approvedAt: new Date(RANGE.start.getTime() + 2 * MINUTE),
    });

    // The boundaries, half-open: the first instant is in, the last is out.
    const edge = await makeClient(a, 'edge');
    const firstInstant = await makeBooking({
      fixture: a,
      clientId: edge.id,
      status: 'CONFIRMED',
      startAt: RANGE.start,
    });
    await makePayment({ bookingId: firstInstant, status: 'APPROVED', amount: '11.00' });
    const lastInstant = await makeBooking({
      fixture: a,
      clientId: edge.id,
      status: 'CONFIRMED',
      startAt: RANGE.end,
    });
    // **Approved outside the range on purpose.** This booking exists to test the
    // half-open boundary on `startTime`; left with the default `approvedAt` it
    // also lands inside the cash figure — correctly, since the money did arrive
    // in the period — and section 7's assertion about T83's row would then be
    // measuring two facts at once. The first run of this gate failed exactly
    // there, and the fixture was wrong rather than the product.
    await makePayment({
      bookingId: lastInstant,
      status: 'APPROVED',
      amount: '22.00',
      approvedAt: new Date(RANGE.end.getTime() + MINUTE),
    });

    // Owner B, a large sum inside the same range: what a leak would look like.
    const theirs = await makeClient(b, 'theirs');
    const theirBooking = await makeBooking({
      fixture: b,
      clientId: theirs.id,
      status: 'CONFIRMED',
      startAt: dayAt(3),
    });
    await makePayment({ bookingId: theirBooking, status: 'APPROVED', amount: '500000.00' });

    // Expected for owner A, inside the range:
    //   day 0: 2000.50 (MP) + 11.00 (first instant, same day) = 2011.50
    //   day 2: 1000.00 (transfer)
    //   day 4: 1500.00 (MP)
    //   total 4511.50 — MP 3511.50 in 3 payments, transfer 1000.00 in 1

    // ─── 2. The statement runs and its types survive the driver ──────────────

    await probeOrSkip('2.x', async () => {
      const charts = await repository.readCharts({
        ownerId: a.owner.id,
        range: RANGE,
        edges: EDGES,
      });

      report(
        '2.1. The grouped statement executes through the driver adapter',
        Array.isArray(charts.rows) && charts.rows.length > 0,
        `${charts.rows.length} grouped row(s)`
      );
      report(
        '2.2. Bucket indexes and counts are narrowed to Number at the boundary',
        charts.rows.every(
          (row) => typeof row.bucket === 'number' && Number.isInteger(row.bucket) && typeof row.payments === 'number'
        ),
        `bucket types: ${[...new Set(charts.rows.map((r) => typeof r.bucket))].join(', ')}`
      );
      report(
        '2.3. Amounts cross as canonical decimals, trailing zero intact',
        charts.rows.every((row) => /^\d+\.\d{2}$/.test(row.total)),
        charts.rows.map((r) => r.total).join(', ')
      );
      report(
        '2.4. width_bucket answers inside the edge array',
        charts.rows.every((row) => row.bucket >= 1 && row.bucket <= EDGES.length - 1),
        `buckets: ${[...new Set(charts.rows.map((r) => r.bucket))].sort((x, y) => x - y).join(', ')}`
      );
    });

    // ─── 3. The series fills its holes and reconciles with the figure ────────

    await probeOrSkip('3.x', async () => {
      const charts = await repository.readCharts({
        ownerId: a.owner.id,
        range: RANGE,
        edges: EDGES,
      });
      const figures = await repository.readStatistics({ ownerId: a.owner.id, range: RANGE });
      const series = fillIncomeSeries(charts.rows, EDGES);

      report(
        '3.1. The series is as long as the period, not as long as the data',
        series.length === 7,
        `${series.length} buckets from ${charts.rows.length} grouped row(s)`
      );
      report(
        '3.2. The quiet days are present and read exactly zero',
        series.filter((bucket) => bucket.total === '0.00').length === 4,
        series.map((bucket) => bucket.total).join(' | ')
      );
      // The property that replaces the snapshot guarantee the shared
      // transaction would have given (IStatisticsRepository rule 9).
      report(
        '3.3. The bars sum to the deposits figure rendered above them',
        sumIncomeSeries(series) === figures.depositTotal,
        `bars ${sumIncomeSeries(series)} vs figure ${figures.depositTotal}`
      );
      report(
        '3.4. The boundary rows land half-open — first instant in, last instant out',
        series[0]?.total === '2011.50' && sumIncomeSeries(series) === '4511.50',
        `first bucket ${series[0]?.total}, total ${sumIncomeSeries(series)} (the 22.00 at the closing instant must be absent)`
      );
    });

    // ─── 4. Declined attempts do not become customers ────────────────────────

    await probeOrSkip('4.x', async () => {
      const charts = await repository.readCharts({
        ownerId: a.owner.id,
        range: RANGE,
        edges: EDGES,
      });
      const split = paymentMethodSplit(charts.rows);
      const mp = split.find((part) => part.method === 'MERCADO_PAGO');
      const transfer = split.find((part) => part.method === 'BANK_TRANSFER');

      report(
        '4.1. The retried booking contributes one Mercado Pago payment, not three',
        mp?.payments === 3,
        `${mp?.payments} MP payments across the period (3 bookings, one of which had two declined attempts)`
      );
      report(
        '4.2. The split sums to the deposits figure',
        mp !== undefined &&
          transfer !== undefined &&
          Number(mp.total) + Number(transfer.total) === 4511.5,
        `MP ${mp?.total} + transfer ${transfer?.total}`
      );

      // **The counterfactual.** An assertion that merely reads "3 payments"
      // would pass for several wrong implementations; this measures what the
      // predicate is actually doing by removing it. D5's adversarial pass found
      // three probes that could not fail for the reason they named, and this is
      // the shape of the fix.
      const withRejected = await prisma.$queryRawUnsafe<{ payments: bigint }[]>(
        `SELECT count(*) AS payments
         FROM "Payment" p
         JOIN "Booking" pb ON pb.id = p."bookingId"
         JOIN "Barber" pbr ON pbr.id = pb."barberId"
         JOIN "Location" pl ON pl.id = pbr."locationId"
         WHERE pl."ownerId" = $1
           AND pb.status = 'CONFIRMED'
           AND pb."startTime" >= $2
           AND pb."startTime" < $3`,
        a.owner.id,
        RANGE.start,
        RANGE.end
      );
      const unfiltered = Number(withRejected[0]?.payments ?? 0);

      report(
        "4.3. The APPROVED predicate is load-bearing, not decorative",
        unfiltered === 6 && (mp?.payments ?? 0) + (transfer?.payments ?? 0) === 4,
        `without it the same rows count ${unfiltered} payments; with it, ${(mp?.payments ?? 0) + (transfer?.payments ?? 0)}`
      );
    });

    // ─── 5. Money the owner owes back is in no chart ─────────────────────────

    await probeOrSkip('5.x', async () => {
      const charts = await repository.readCharts({
        ownerId: a.owner.id,
        range: RANGE,
        edges: EDGES,
      });
      const series = fillIncomeSeries(charts.rows, EDGES);
      const split = paymentMethodSplit(charts.rows);

      report(
        '5.1. The approved payment on the expired booking is in no bucket',
        !series.some((bucket) => bucket.total.startsWith('9999')) &&
          sumIncomeSeries(series) === '4511.50',
        `series totals ${sumIncomeSeries(series)} — 9999.00 sits on an EXPIRED booking and must be excluded`
      );
      report(
        '5.2. It is in neither method part either',
        split.every((part) => !part.total.startsWith('9999')),
        split.map((part) => `${part.method}=${part.total}`).join(', ')
      );
    });

    // ─── 6. Cross-owner isolation, both directions, on the money ─────────────

    await probeOrSkip('6.x', async () => {
      const mine = await repository.readCharts({ ownerId: a.owner.id, range: RANGE, edges: EDGES });
      const theirCharts = await repository.readCharts({
        ownerId: b.owner.id,
        range: RANGE,
        edges: EDGES,
      });

      report(
        "6.1. Owner A's buckets exclude owner B's payment",
        sumIncomeSeries(fillIncomeSeries(mine.rows, EDGES)) === '4511.50',
        `owner A totals ${sumIncomeSeries(fillIncomeSeries(mine.rows, EDGES))}`
      );
      report(
        "6.2. Owner B's buckets exclude owner A's entirely",
        sumIncomeSeries(fillIncomeSeries(theirCharts.rows, EDGES)) === '500000.00',
        `owner B totals ${sumIncomeSeries(fillIncomeSeries(theirCharts.rows, EDGES))}`
      );

      const leaked = await prisma.$queryRawUnsafe<{ total: unknown }[]>(
        `SELECT COALESCE(sum(p.amount), 0) AS total
         FROM "Payment" p
         JOIN "Booking" pb ON pb.id = p."bookingId"
         JOIN "Barber" pbr ON pbr.id = pb."barberId"
         JOIN "Location" pl ON pl.id = pbr."locationId"
         WHERE p.status = 'APPROVED'
           AND pb.status = 'CONFIRMED'
           AND pb."startTime" >= $1
           AND pb."startTime" < $2`,
        RANGE.start,
        RANGE.end
      );
      const withoutPredicate = Number(leaked[0]?.total ?? 0);

      report(
        '6.3. The chart read’s owner predicate is load-bearing, not decorative',
        withoutPredicate >= 504_000 && withoutPredicate > 4511.5,
        `the identical statement with its owner predicate removed sums ${withoutPredicate} across both owners; with it, owner A reads 4511.50`
      );
    });

    // ─── 7. T83: the cash figure is on a different clock and must disagree ───

    await probeOrSkip('7.x', async () => {
      const charts = await repository.readCharts({
        ownerId: a.owner.id,
        range: RANGE,
        edges: EDGES,
      });
      const figures = await repository.readStatistics({ ownerId: a.owner.id, range: RANGE });

      // Everything approved inside the range: the period's own deposits (4511.50
      // — the three inside plus the boundary row) plus 777.00 approved here for
      // an appointment three days after the range ends.
      report(
        '7.1. The cash figure counts a deposit approved inside the period for an appointment outside it',
        charts.cashCollected === '5288.50',
        `cash ${charts.cashCollected} against deposits ${figures.depositTotal}`
      );
      report(
        '7.2. The two income figures deliberately disagree, and the row that separates them is real',
        charts.cashCollected !== figures.depositTotal &&
          Number(charts.cashCollected) - Number(figures.depositTotal) === 777,
        `the difference is exactly the 777.00 cross-period deposit — if these ever agree, one figure has moved onto the other's column`
      );
      report(
        '7.3. That deposit is in the cash figure and in no bucket',
        !fillIncomeSeries(charts.rows, EDGES).some((bucket) => bucket.total.includes('777')),
        `series ${sumIncomeSeries(fillIncomeSeries(charts.rows, EDGES))} carries no 777.00`
      );
    });

    // ─── 8. Cost ─────────────────────────────────────────────────────────────

    await probeOrSkip('8.x', async () => {
      let queries = 0;
      const counting = new PrismaClient({ adapter }).$extends({
        query: {
          $allOperations({ args, query }) {
            queries += 1;
            return query(args);
          },
        },
      });
      const counted = new PrismaStatisticsRepository(counting as never);

      await counted.readCharts({ ownerId: a.owner.id, range: RANGE, edges: EDGES });
      report(
        '8.1. Both charts and the cash figure cost two statements',
        queries === 2,
        `${queries} — one grouped read serves both charts, plus the differently-bounded cash figure`
      );

      await (counting as unknown as PrismaClient).$disconnect();

      const started = Date.now();
      await repository.readCharts({ ownerId: a.owner.id, range: RANGE, edges: EDGES });
      observe('8.2. Wall-clock cost of the chart read', `${Date.now() - started} ms`);
    });

    // ─── 9. The query plan ───────────────────────────────────────────────────

    await probeOrSkip('9.x', async () => {
      // D1's rule: indexes come from measurement. T81 established that this
      // family of statement uses `Booking_barberId_startTime_idx`; this one
      // starts from `Payment` instead, which has no index on `bookingId` beyond
      // the partial unique one, so the answer does not transfer.
      //
      // **This is the probe most likely to skip.** A plan is many lines of text
      // and T68's ~1.4 KB ceiling is well under it. When it skips, capture the
      // plan over the Supabase SQL API instead — a different transport — and
      // paste it into the roadmap entry from there.
      const plan = await prisma.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(
        `EXPLAIN (ANALYZE, BUFFERS)
         SELECT width_bucket(extract(epoch FROM pb."startTime")::float8, $4::float8[]) AS bucket,
                p.method, sum(p.amount) AS total, count(*) AS payments
         FROM "Payment" p
         JOIN "Booking" pb ON pb.id = p."bookingId"
         JOIN "Barber" pbr ON pbr.id = pb."barberId"
         JOIN "Location" pl ON pl.id = pbr."locationId"
         WHERE pl."ownerId" = $1
           AND p.status = 'APPROVED'
           AND pb.status = 'CONFIRMED'
           AND pb."startTime" >= $2
           AND pb."startTime" < $3
         GROUP BY 1, 2`,
        a.owner.id,
        RANGE.start,
        RANGE.end,
        EDGES.map((edge) => edge.getTime() / 1000)
      );

      observe('9.1. Query plan', `\n${plan.map((line) => line['QUERY PLAN']).join('\n')}`);
      report(
        '9.2. The plan was captured for the roadmap entry',
        plan.length > 0,
        `${plan.length} line(s)`
      );
    });
  } finally {
    await removeMarkedRows(prisma);

    const leftover = await prisma.owner.count({ where: { email: { startsWith: MARK } } });
    report('10.1. The gate cleaned up after itself', leftover === 0, `${leftover} owners left behind`);

    await prisma.$disconnect();
  }

  if (skipped > 0) {
    console.log(
      `\n${skipped} probe group(s) NOT RUN — T68. They are not results about the product.`
    );
  }
  console.log(failures === 0 ? '\nGATE PASSED\n' : `\nGATE FAILED (${failures})\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
