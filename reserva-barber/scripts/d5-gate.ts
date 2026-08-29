// GATE D5 — the business statistics against the live database.
//
// What a mock cannot certify here, and why each one needs a real row:
//
//   1. **The statement's result types survive the driver.** T58 names this
//      story: *"B5's webhook and D5's aggregate statistics will add more, and
//      GROUP BY aggregates are exactly where the driver's type mapping is
//      easiest to get wrong."* B4's advisory lock returned `void`, the pg
//      adapter raised `UnsupportedNativeDataType`, and every booking write
//      failed in the runtime while twenty-four mocked tests stayed green. This
//      statement carries `count(*) FILTER`, `count(DISTINCT …) FILTER` and
//      `COALESCE(sum(numeric), 0)`. `tsc` cannot check a column name inside a
//      template literal, and every unit test asserts the SQL *text*.
//
//   2. **Income joins through the booking's status.** Section 3 seeds an
//      APPROVED payment on an EXPIRED booking and another on a CANCELLED one —
//      the late-payment case, which is money the owner owes back. A mock can
//      only be told these are excluded.
//
//   3. **A booking with retried payments is counted once.** Section 4 seeds two
//      REJECTED payments and one APPROVED on a single confirmed booking. If
//      Payment were ever joined into the counted row set, that booking would
//      contribute three to `confirmedCount` while `count(DISTINCT clientId)`
//      absorbed the duplication — two figures wrong, one right, reading as a
//      rounding quirk rather than a join defect. This is the change's most
//      likely silent failure and the single most valuable probe in the file.
//
//   4. **Cross-owner isolation, in both directions, on the money.** There is no
//      RLS on these tables: the barber→location join is the whole tenancy
//      boundary, and a leaked aggregate produces no row that can look wrong —
//      only a plausible integer.
//
//   5. **Half-open boundaries.** Section 6 seeds a booking at exactly the
//      range's first instant and another at exactly its last.
//
//   6. **One round trip**, measured through a query extension rather than
//      claimed (D4's technique).
//
//   7. **The query plan**, captured for the roadmap entry. D1's rule is that
//      indexes come from measurement; T81 is the entry that got that right by
//      running EXPLAIN instead of guessing, and this re-runs it on a different
//      statement rather than inheriting its answer.
//
// Everything it creates is prefixed `__d5_gate__` and removed at the end in
// foreign-key order. Every booking FK is `Restrict`, so nothing cascades and the
// order is the guarantee rather than a convenience.
//
//   npx tsx scripts/d5-gate.ts
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma-cli/client';
import { PrismaStatisticsRepository } from '../src/server/infrastructure/prisma/PrismaStatisticsRepository';
import { averageDepositPerBooking } from '../src/server/domain/models/statistics';
import { weekBoundsOf } from '../src/server/domain/models/bookingCalendar';

const MARK = '__d5_gate__';
const MINUTE = 60_000;

/**
 * A week in 2027, deliberately far from any real booking.
 *
 * The statement's row set is every booking the owner has, with each figure
 * narrowing it by a `FILTER` — so a range overlapping real data would make the
 * expected figures depend on the shop's actual history. The gate's owners are
 * created fresh, but the range is put out of reach anyway: `hasAnyBookingEver`
 * is the one figure with no range at all, and it should be true because of the
 * gate's own rows rather than by accident.
 */
const RANGE = weekBoundsOf({ year: 2027, month: 3, day: 3 });

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

/**
 * Runs a probe and reports an environment fault as one rather than as a product
 * result.
 *
 * **T68**, and D4's hard-won correction to it: the fault is **intermittent**.
 * `repeat('x', 1400)` never returned at 11:30 one day and two megabytes came
 * back in 347 ms at 17:40 the same day, on the same connection string from the
 * same machine, with none of the entry's listed fixes applied. So a green gate
 * is not evidence the fault is gone, and a hanging gate is not evidence of a
 * product defect.
 *
 * The check was run before this file was written, as the tasks require. On
 * 2026-08-28 at ~15:05 ART the fault was **present**: 1000 bytes returned in
 * 926 ms and 1400 never returned at all. This gate's payload is small by
 * construction — six integers, a decimal and a boolean, no personal column and
 * no free text — so it is expected to fit under the ceiling. That is a
 * prediction, and the skip path below is what happens when it is wrong.
 *
 * A probe that cannot complete is announced as **NOT RUN**, never as passed.
 */
const PROBE_TIMEOUT_MS = 30_000;

/**
 * Fails a hung read instead of waiting on it forever.
 *
 * The first run of this gate discovered why that matters: T68 does not surface
 * as an error, it surfaces as a response that **never arrives**. The `EXPLAIN`
 * probe hung, `probeOrSkip` never got an exception to classify, and — worse —
 * the `finally` that removes the fixture never ran either, leaving two marked
 * owners in the database. A gate that cannot clean up after itself is a worse
 * failure than a gate that reports a skip.
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
      /** Minutes past the range's start. May be negative or past the end. */
      offsetMinutes?: number;
      startAt?: Date;
      cancelledBy?: 'OWNER' | 'CLIENT' | null;
    }): Promise<string> {
      bookingSeq += 1;
      const start =
        input.startAt ?? new Date(RANGE.start.getTime() + (input.offsetMinutes ?? 60) * MINUTE);

      const booking = await prisma.booking.create({
        data: {
          clientId: input.clientId,
          barberId: input.fixture.barber.id,
          serviceId: input.fixture.service.id,
          startTime: start,
          endTime: new Date(start.getTime() + 30 * MINUTE),
          status: input.status as never,
          priceAtBooking: '10000.00',
          depositAmount: '3000.00',
          cancellationToken: `${MARK}-${bookingSeq}`,
          holdExpiresAt:
            input.status === 'PENDING_PAYMENT' ? new Date(Date.now() + 30 * MINUTE) : null,
          cancelledAt: input.status === 'CANCELLED' ? new Date() : null,
          cancelledBy: (input.cancelledBy ?? null) as never,
        },
        select: { id: true },
      });
      return booking.id;
    }

    let paymentSeq = 0;
    async function makePayment(
      bookingId: string,
      status: 'APPROVED' | 'REJECTED' | 'PENDING',
      amount: string
    ): Promise<void> {
      paymentSeq += 1;
      await prisma.payment.create({
        data: {
          bookingId,
          method: 'MERCADO_PAGO' as never,
          amount,
          status: status as never,
          mpPaymentId: `${MARK}-p${paymentSeq}`,
          approvedAt: status === 'APPROVED' ? new Date() : null,
        },
      });
    }

    // Owner A, inside the range.

    // Three confirmed appointments for one person: 3 to the count, 1 to unique.
    const served = await makeClient(a, 'served');
    for (const offset of [60, 120, 180]) {
      const id = await makeBooking({ fixture: a, clientId: served.id, status: 'CONFIRMED', offsetMinutes: offset });
      await makePayment(id, 'APPROVED', '1000.00');
    }

    // THE probe: two declined attempts and one approval on ONE booking. Also
    // carries the trailing-zero amount, so one row proves two properties.
    const retried = await makeClient(a, 'retried');
    const retriedBooking = await makeBooking({
      fixture: a,
      clientId: retried.id,
      status: 'CONFIRMED',
      offsetMinutes: 240,
    });
    await makePayment(retriedBooking, 'REJECTED', '500.00');
    await makePayment(retriedBooking, 'REJECTED', '500.00');
    await makePayment(retriedBooking, 'APPROVED', '2000.50');

    // The late-payment case: real money, on a booking that never confirmed.
    const lapsed = await makeClient(a, 'lapsed');
    const lapsedBooking = await makeBooking({
      fixture: a,
      clientId: lapsed.id,
      status: 'EXPIRED',
      offsetMinutes: 300,
    });
    await makePayment(lapsedBooking, 'APPROVED', '9999.00');

    // An approved payment on a booking the owner then cancelled.
    const refunded = await makeClient(a, 'refunded');
    const refundedBooking = await makeBooking({
      fixture: a,
      clientId: refunded.id,
      status: 'CANCELLED',
      offsetMinutes: 360,
      cancelledBy: 'OWNER',
    });
    await makePayment(refundedBooking, 'APPROVED', '8888.00');

    // The other two cancellation shapes.
    const walkedAway = await makeClient(a, 'walked');
    await makeBooking({
      fixture: a,
      clientId: walkedAway.id,
      status: 'CANCELLED',
      offsetMinutes: 420,
      cancelledBy: 'CLIENT',
    });
    // Written before `cancelledBy` had a writer: in the total, in neither part.
    await makeBooking({
      fixture: a,
      clientId: walkedAway.id,
      status: 'CANCELLED',
      offsetMinutes: 480,
      cancelledBy: null,
    });

    // A live hold: counted nowhere.
    const holding = await makeClient(a, 'holding');
    await makeBooking({
      fixture: a,
      clientId: holding.id,
      status: 'PENDING_PAYMENT',
      offsetMinutes: 540,
    });

    // The boundaries, half-open: the first instant is in, the last is out.
    const atStart = await makeClient(a, 'atstart');
    const atStartBooking = await makeBooking({
      fixture: a,
      clientId: atStart.id,
      status: 'CONFIRMED',
      startAt: RANGE.start,
    });
    await makePayment(atStartBooking, 'APPROVED', '100.00');

    const atEnd = await makeClient(a, 'atend');
    const atEndBooking = await makeBooking({
      fixture: a,
      clientId: atEnd.id,
      status: 'CONFIRMED',
      startAt: RANGE.end,
    });
    await makePayment(atEndBooking, 'APPROVED', '7777.00');

    // Owner B: the other side of the isolation probe, with a large sum so a
    // leak would be unmistakable rather than plausible.
    const theirs = await makeClient(b, 'theirs');
    const theirsBooking = await makeBooking({
      fixture: b,
      clientId: theirs.id,
      status: 'CONFIRMED',
      offsetMinutes: 90,
    });
    await makePayment(theirsBooking, 'APPROVED', '500000.00');

    // ─── 2. The statement runs, and its types survive the driver ─────────────

    await probeOrSkip('2.x', async () => {
      const stats = await repository.readStatistics({ ownerId: a.owner.id, range: RANGE });

      report(
        '2.1. The aggregate executes through the driver adapter',
        typeof stats.confirmedCount === 'number',
        `confirmedCount is ${typeof stats.confirmedCount}`
      );
      report(
        '2.2. count(DISTINCT …) FILTER deserializes to a number (T58)',
        typeof stats.uniqueClients === 'number' && Number.isInteger(stats.uniqueClients),
        `uniqueClients = ${stats.uniqueClients} (${typeof stats.uniqueClients})`
      );
      report(
        '2.3. COALESCE(sum(numeric), 0) deserializes to a canonical string',
        typeof stats.depositTotal === 'string' && /^\d+\.\d{2}$/.test(stats.depositTotal),
        `depositTotal = ${stats.depositTotal} (${typeof stats.depositTotal})`
      );
      report(
        '2.4. No bigint escapes the repository boundary',
        Object.values(stats).every((value) => typeof value !== 'bigint'),
        Object.entries(stats)
          .map(([key, value]) => `${key}:${typeof value}`)
          .join(' ')
      );
    });

    // ─── 3. Income joins through the booking's status ────────────────────────

    await probeOrSkip('3.x', async () => {
      const stats = await repository.readStatistics({ ownerId: a.owner.id, range: RANGE });

      // 1000×3 + 2000.50 (retried) + 100 (at the range's first instant).
      report(
        '3.1. Income is the deposits of confirmed appointments only',
        stats.depositTotal === '5100.50',
        `${stats.depositTotal} — expected 5100.50`
      );
      // 3.2 and 3.3 assert **equality against the total that would result** if
      // each exclusion failed, rather than `!startsWith(...)`. A negative string
      // check passes for every wrong answer except one specific one, which makes
      // it green under roughly any breakage — the failure mode 7.4 was rewritten
      // for. Stating the counterfactual total names what is being excluded and
      // by how much.
      report(
        '3.2. An APPROVED payment on an EXPIRED booking is excluded',
        stats.depositTotal === '5100.50',
        `including it would read 15099.50; total is ${stats.depositTotal}`
      );
      report(
        '3.3. An APPROVED payment on a CANCELLED booking is excluded',
        stats.depositTotal === '5100.50',
        `including it would read 13988.50; total is ${stats.depositTotal}`
      );
      report(
        '3.4. A trailing zero survives the aggregate',
        stats.depositTotal.endsWith('.50'),
        `${stats.depositTotal} — 2000.5 read as five centavos would end .00`
      );
    });

    // ─── 4. A booking with retried payments is counted once ──────────────────

    await probeOrSkip('4.x', async () => {
      const stats = await repository.readStatistics({ ownerId: a.owner.id, range: RANGE });

      // 3 (served) + 1 (retried) + 1 (at the first instant).
      report(
        '4.1. Two REJECTED payments do not multiply their booking',
        stats.confirmedCount === 5,
        `confirmedCount = ${stats.confirmedCount} — expected 5, a join would give 7`
      );
      report(
        '4.2. The retried booking contributes its approved amount once',
        stats.depositTotal === '5100.50',
        `${stats.depositTotal} — expected 5100.50`
      );
      report(
        '4.3. A returning client counts once among unique clients',
        stats.uniqueClients === 3,
        `uniqueClients = ${stats.uniqueClients} — served, retried and the boundary row`
      );
    });

    // ─── 5. Cancellations, expiries and holds ────────────────────────────────

    await probeOrSkip('5.x', async () => {
      const stats = await repository.readStatistics({ ownerId: a.owner.id, range: RANGE });

      report(
        '5.1. Cancellations count the cancelled and nothing else',
        stats.cancelledCount === 3,
        `${stats.cancelledCount} — expected 3 (owner, client, and one with no actor)`
      );
      report(
        '5.2. An EXPIRED booking is counted in no figure at all',
        stats.cancelledCount === 3 && stats.confirmedCount === 5,
        'a deadline is not a decision, and the sweep produces expired rows constantly'
      );
      report(
        '5.3. A live hold is counted in no figure at all',
        stats.confirmedCount === 5 && stats.cancelledCount === 3,
        'PENDING_PAYMENT is neither an appointment nor a cancellation'
      );
      report(
        '5.4. The breakdown separates who ended the appointment',
        stats.cancelledByOwner === 1 && stats.cancelledByClient === 1,
        `owner ${stats.cancelledByOwner}, client ${stats.cancelledByClient}`
      );
      report(
        '5.5. A cancellation with no recorded actor is in the total and in neither part',
        stats.cancelledCount - stats.cancelledByOwner - stats.cancelledByClient === 1,
        `${stats.cancelledCount} total, ${stats.cancelledByOwner + stats.cancelledByClient} attributed`
      );
    });

    // ─── 6. Half-open boundaries ─────────────────────────────────────────────

    await probeOrSkip('6.x', async () => {
      const stats = await repository.readStatistics({ ownerId: a.owner.id, range: RANGE });

      report(
        '6.1. A booking at the range\'s first instant is included',
        stats.depositTotal.startsWith('5100'),
        `100.00 is in the total (${stats.depositTotal})`
      );
      report(
        '6.2. A booking at the range\'s last instant is excluded',
        !stats.depositTotal.startsWith('12877'),
        `7777.00 would have shown; total is ${stats.depositTotal}`
      );

      // The same rows read one week later: the boundary row that was out is now
      // in, which proves the exclusion was the boundary and not the fixture.
      const nextWeek = weekBoundsOf({ year: 2027, month: 3, day: 10 });
      const after = await repository.readStatistics({ ownerId: a.owner.id, range: nextWeek });
      report(
        '6.3. The excluded booking belongs to the next range, not to none',
        after.confirmedCount === 1 && after.depositTotal === '7777.00',
        `${after.confirmedCount} appointment(s), ${after.depositTotal}`
      );
    });

    // ─── 7. Cross-owner isolation, in both directions ────────────────────────

    await probeOrSkip('7.x', async () => {
      const mine = await repository.readStatistics({ ownerId: a.owner.id, range: RANGE });
      const theirStats = await repository.readStatistics({ ownerId: b.owner.id, range: RANGE });

      report(
        "7.1. Owner A's figures exclude owner B's appointment",
        mine.confirmedCount === 5 && !mine.depositTotal.startsWith('505100'),
        `${mine.confirmedCount} appointments, ${mine.depositTotal}`
      );
      report(
        "7.2. Owner B's figures exclude owner A's entirely",
        theirStats.confirmedCount === 1 && theirStats.depositTotal === '500000.00',
        `${theirStats.confirmedCount} appointment(s), ${theirStats.depositTotal}`
      );
      report(
        "7.3. Owner B sees none of owner A's cancellations",
        theirStats.cancelledCount === 0,
        `${theirStats.cancelledCount} cancellations`
      );
      // 7.4 used to assert `theirStats.depositTotal === '500000.00'` under the
      // name "the income sub-query is scoped in its own right", and its own
      // detail string admitted that a sub-query relying on the outer scope
      // alone would pass it too. **A probe that cannot fail for the reason it
      // names is worse than no probe** — it is T58's shape, a green assertion
      // over a mechanism it never exercised. Replaced with one that measures the
      // predicate's effect by removing it.
      const leaked = await prisma.$queryRawUnsafe<{ total: unknown }[]>(
        `SELECT COALESCE((
           SELECT sum(p.amount)
           FROM "Payment" p
           JOIN "Booking" pb ON pb.id = p."bookingId"
           JOIN "Barber" pbr ON pbr.id = pb."barberId"
           JOIN "Location" pl ON pl.id = pbr."locationId"
           WHERE p.status = 'APPROVED'
             AND pb.status = 'CONFIRMED'
             AND pb."startTime" >= $1
             AND pb."startTime" < $2
         ), 0) AS total`,
        RANGE.start,
        RANGE.end
      );
      const withoutPredicate = String(leaked[0]?.total ?? '0');

      report(
        "7.4. The income sub-query's own owner predicate is load-bearing, not decorative",
        Number(withoutPredicate) > Number(mine.depositTotal) &&
          Number(withoutPredicate) >= 500_000 &&
          mine.depositTotal === '5100.50',
        `the identical sub-query with its owner predicate removed sums ${withoutPredicate} across both owners; ` +
          `with it, owner A reads ${mine.depositTotal}`
      );
    });

    // ─── 8. The derived average, over real figures ───────────────────────────

    await probeOrSkip('8.x', async () => {
      const stats = await repository.readStatistics({ ownerId: a.owner.id, range: RANGE });
      const average = averageDepositPerBooking(stats.depositTotal, stats.confirmedCount);

      // 5100.50 over 5 appointments is exactly 1020.10.
      report(
        '8.1. The average divides the period by its own appointments',
        average === '1020.10',
        `${average} — expected 1020.10`
      );

      const quiet = weekBoundsOf({ year: 2027, month: 6, day: 2 });
      const empty = await repository.readStatistics({ ownerId: a.owner.id, range: quiet });
      report(
        '8.2. A period with no appointments has no average, not a zero',
        averageDepositPerBooking(empty.depositTotal, empty.confirmedCount) === null,
        `confirmedCount ${empty.confirmedCount}, total ${empty.depositTotal}`
      );
      report(
        '8.3. A quiet period is still distinguishable from an untouched shop',
        empty.hasAnyBookingEver,
        'hasAnyBookingEver is true even where every figure is zero'
      );
    });

    // ─── 9. Cost ─────────────────────────────────────────────────────────────

    await probeOrSkip('9.x', async () => {
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

      await counted.readStatistics({ ownerId: a.owner.id, range: RANGE });
      report(
        '9.1. Every figure costs one statement',
        queries === 1,
        `${queries} — separate queries would answer from separate instants`
      );

      await (counting as unknown as PrismaClient).$disconnect();

      const started = Date.now();
      await repository.readStatistics({ ownerId: a.owner.id, range: RANGE });
      observe('9.2. Wall-clock cost of the page read', `${Date.now() - started} ms`);
    });

    // ─── 10. The query plan ──────────────────────────────────────────────────

    await probeOrSkip('10.x', async () => {
      // D1's rule: indexes come from measurement. T81 got D4's diagnosis right
      // only by running this instead of guessing, and this statement is not
      // that one — count(DISTINCT …) forces a sort or hash over the matched
      // set, and Booking has no index on clientId.
      //
      // **This probe is the one expected to be skipped from an affected path.**
      // A plan is many lines of text; the ~1.4 KB ceiling T68 describes is well
      // under it, and unlike every figure above there is no way to narrow the
      // payload. When it skips, capture the plan over a different transport —
      // the Supabase SQL API rather than the pooler's wire protocol — and paste
      // it into the roadmap entry from there.
      const plan = await prisma.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(
        `EXPLAIN (ANALYZE, BUFFERS)
         SELECT
           count(*) FILTER (WHERE b.status = 'CONFIRMED' AND b."startTime" >= $2 AND b."startTime" < $3) AS c,
           count(DISTINCT b."clientId") FILTER (WHERE b.status = 'CONFIRMED' AND b."startTime" >= $2 AND b."startTime" < $3) AS u,
           count(*) AS ever
         FROM "Booking" b
         JOIN "Barber" br ON br.id = b."barberId"
         JOIN "Location" l ON l.id = br."locationId"
         WHERE l."ownerId" = $1`,
        a.owner.id,
        RANGE.start,
        RANGE.end
      );

      observe('10.1. Query plan', `\n${plan.map((line) => line['QUERY PLAN']).join('\n')}`);
      report(
        '10.2. The plan was captured for the roadmap entry',
        plan.length > 0,
        `${plan.length} line(s)`
      );
    });
  } finally {
    await removeMarkedRows(prisma);

    const leftover = await prisma.owner.count({ where: { email: { startsWith: MARK } } });
    report('11.1. The gate cleaned up after itself', leftover === 0, `${leftover} owners left behind`);

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
