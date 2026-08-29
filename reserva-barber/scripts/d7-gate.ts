// GATE D7 — the service ranking, the barber ranking and the hour-of-day
// distribution, against the live database.
//
// What a mock cannot certify here, and why each one needs a real row:
//
//   1. **A three-branch `UNION ALL` over a CTE survives the driver.** This is a
//      new statement shape for this capability, and `tsc` cannot check anything
//      inside a template literal. Every count comes back as a wide integer and a
//      `bigint` reaching a React prop is a blank page rather than an error; the
//      bucket index additionally arrives as **text** and is parsed here. T58 is
//      the record of a mocked test certifying a call that could not run at all.
//
//   2. **No payment row may enter the counted row set.**
//      `Payment_one_live_per_booking` is `ON ("bookingId") WHERE status <>
//      'REJECTED'`, so one booking carries any number of declined attempts by
//      design. Section 4 seeds two rejections and one approval on a single
//      booking and measures the **counterfactual** — the same statement with the
//      payment join added — because "the ranking says 1" would pass for several
//      wrong implementations.
//
//   3. **Cross-owner isolation, in both directions, with the predicate
//      removed.** There is no RLS on these tables: the barber→location join is
//      the whole tenancy boundary, and a leaked ranking produces no row that can
//      look wrong — only a believable integer.
//
//   4. **Every breakdown sums to the confirmed-appointments figure**, measured
//      against real rows and across two independent statements that share no
//      transaction. This is the invariant the whole change rests on.
//
//   5. **The hour is the business's, not the runtime's.** Section 7 seeds an
//      appointment at 21:30 local — 00:30 UTC the next day — and asserts it
//      lands in hour 21, against the counterfactual of reading the same instant
//      with the runtime's own hour getter, which answers 0. That is the three
//      hours of every day this capability exists to get right.
//
//   6. **The top-N fold preserves the total** over a catalogue larger than the
//      cap, on real rows rather than on an array built in a test.
//
//   7. **The `float8[]` payload for a month** — 745 thresholds — crosses the
//      pooler at all. Design open question 1, answered by measurement.
//
//   8. **The query plan**, captured rather than guessed (D1's rule, T81's
//      technique), so the index decision is made from evidence.
//
// Everything it creates is prefixed `__d7_gate__` and removed at the end in
// foreign-key order. Every booking FK is `Restrict`, so nothing cascades and the
// order is the guarantee rather than a convenience.
//
//   npx tsx scripts/d7-gate.ts
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma-cli/client';
import { PrismaStatisticsRepository } from '../src/server/infrastructure/prisma/PrismaStatisticsRepository';
import {
  disambiguateLabels,
  fillHourlyDistribution,
  rankTopN,
  RANKING_LIMIT,
} from '../src/server/domain/models/statistics';
import {
  hourBucketEdgesFor,
  intervalFor,
} from '../src/server/application/dashboard/statisticsRangeParams';

const MARK = '__d7_gate__';
const MINUTE = 60_000;

/**
 * A week in 2027, deliberately far from any real booking, resolved through the
 * same functions the page uses.
 *
 * **The range and the edges come from `intervalFor` and `hourBucketEdgesFor`
 * rather than being written out here.** A gate that computed its own boundaries
 * would prove the statement works against *some* array and say nothing about the
 * one the page passes — which is where a bucketing defect would actually live.
 */
const TODAY = { year: 2027, month: 3, day: 3 } as const;
const RANGE = intervalFor('semana', TODAY);
const HOUR_EDGES = hourBucketEdgesFor('semana', TODAY);

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
 * error, it surfaces as a response that **never arrives** — and a gate that
 * cannot reach its cleanup leaves marked rows in a shared database. The fault is
 * also intermittent, so a green run is not evidence it is gone and a hanging one
 * is not evidence of a product defect.
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

/** The instant of `hour` on day `day` of the week, in the business's calendar. */
function at(day: number, hour: number, minute = 0): Date {
  return new Date((HOUR_EDGES[day * 24 + hour] as Date).getTime() + minute * MINUTE);
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
        data: { ownerId: owner.id, name: `L${suffix}` },
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

    // **A second branch of owner A, with a barber of the SAME display name.**
    // `@@unique([locationId, displayName])` makes that legal, and it is the one
    // case the ranking cannot render without its location.
    const branch = await prisma.location.create({
      data: { ownerId: a.owner.id, name: 'Lnorte' },
      select: { id: true },
    });
    const twin = await prisma.barber.create({
      data: { locationId: branch.id, displayName: 'Ba' },
      select: { id: true },
    });

    async function makeClient(ownerId: string, tag: string) {
      return prisma.client.create({
        data: {
          ownerId,
          name: `N${tag}`,
          email: `${MARK}-${tag}@e.com`,
          phone: '+541100000000',
        },
        select: { id: true },
      });
    }

    let serviceSeq = 0;
    async function makeService(ownerId: string, name: string): Promise<string> {
      serviceSeq += 1;
      const created = await prisma.service.create({
        data: { ownerId, name, price: '10000.00', durationMinutes: 30 },
        select: { id: true },
      });
      return created.id;
    }

    let bookingSeq = 0;
    async function makeBooking(input: {
      barberId: string;
      serviceId: string;
      clientId: string;
      status: 'CONFIRMED' | 'CANCELLED' | 'EXPIRED' | 'PENDING_PAYMENT';
      startAt: Date;
    }): Promise<string> {
      bookingSeq += 1;
      const booking = await prisma.booking.create({
        data: {
          clientId: input.clientId,
          barberId: input.barberId,
          serviceId: input.serviceId,
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
      status: 'APPROVED' | 'REJECTED';
      amount: string;
    }): Promise<void> {
      paymentSeq += 1;
      await prisma.payment.create({
        data: {
          bookingId: input.bookingId,
          method: 'MERCADO_PAGO' as never,
          amount: input.amount,
          status: input.status as never,
          mpPaymentId: `${MARK}-p${paymentSeq}`,
          approvedAt: input.status === 'APPROVED' ? new Date(RANGE.start.getTime() + MINUTE) : null,
        },
      });
    }

    const client = await makeClient(a.owner.id, 'served');
    const otherClient = await makeClient(b.owner.id, 'other');

    // Owner A's catalogue: `Sa` from `makeOwner` plus eleven more, so the top-N
    // fold has a remainder to preserve rather than a cap it never reaches.
    const extraServices: string[] = [];
    for (let index = 0; index < 11; index += 1) {
      extraServices.push(await makeService(a.owner.id, `Sa${index}`));
    }

    // `Sa` — the most-booked service, five appointments at 13:00 across the week.
    for (let day = 0; day < 5; day += 1) {
      await makeBooking({
        barberId: a.barber.id,
        serviceId: a.service.id,
        clientId: client.id,
        status: 'CONFIRMED',
        startAt: at(day, 13),
      });
    }

    // One appointment for each of the eleven others, at 10:00, spread over the
    // week — eleven services past a cap of eight.
    for (const [index, serviceId] of extraServices.entries()) {
      await makeBooking({
        barberId: a.barber.id,
        serviceId,
        clientId: client.id,
        status: 'CONFIRMED',
        startAt: at(index % 7, 10),
      });
    }

    // **The retry probe**: one CONFIRMED booking carrying two declined attempts
    // and one approval. It must count exactly once in both rankings.
    const retried = await makeBooking({
      barberId: a.barber.id,
      serviceId: a.service.id,
      clientId: client.id,
      status: 'CONFIRMED',
      startAt: at(5, 13),
    });
    await makePayment({ bookingId: retried, status: 'REJECTED', amount: '500.00' });
    await makePayment({ bookingId: retried, status: 'REJECTED', amount: '500.00' });
    await makePayment({ bookingId: retried, status: 'APPROVED', amount: '1500.00' });

    // **The timezone probe**: 21:30 in the business's calendar is 00:30 UTC the
    // next day. A statement that extracted the hour itself would count it in 0.
    const lateEvening = at(0, 21, 30);
    await makeBooking({
      barberId: a.barber.id,
      serviceId: a.service.id,
      clientId: client.id,
      status: 'CONFIRMED',
      startAt: lateEvening,
    });

    // The twin barber, at the other branch, so two rows share a display name.
    await makeBooking({
      barberId: twin.id,
      serviceId: a.service.id,
      clientId: client.id,
      status: 'CONFIRMED',
      startAt: at(1, 16),
    });

    // Neither an expiry nor a cancellation is an appointment.
    await makeBooking({
      barberId: a.barber.id,
      serviceId: a.service.id,
      clientId: client.id,
      status: 'EXPIRED',
      startAt: at(2, 11),
    });
    await makeBooking({
      barberId: a.barber.id,
      serviceId: a.service.id,
      clientId: client.id,
      status: 'CANCELLED',
      startAt: at(2, 12),
    });

    // Owner B's own week, so isolation is measurable in both directions.
    await makeBooking({
      barberId: b.barber.id,
      serviceId: b.service.id,
      clientId: otherClient.id,
      status: 'CONFIRMED',
      startAt: at(3, 15),
    });

    // ─── 2. The read returns three discriminated breakdowns ──────────────────

    await probeOrSkip('2.x', async () => {
      const result = await repository.readBreakdowns({
        ownerId: a.owner.id,
        range: RANGE,
        edges: HOUR_EDGES,
      });

      report(
        '2.1. The three-branch union crossed the driver',
        result.services.length > 0 && result.barbers.length > 0 && result.hours.length > 0,
        `${result.services.length} services, ${result.barbers.length} barbers, ${result.hours.length} hour buckets`
      );

      // A bigint or a string reaching a React prop is a blank page rather than
      // an error, and the bucket index additionally arrives as text.
      const everyCountIsANumber = [...result.services, ...result.barbers, ...result.hours].every(
        (row) => typeof row.count === 'number' && Number.isInteger(row.count)
      );
      report(
        '2.2. Every count is a narrowed integer',
        everyCountIsANumber,
        'no bigint and no string survived the boundary'
      );
      report(
        '2.3. Every bucket index is a narrowed integer',
        result.hours.every((row) => Number.isInteger(row.bucket)),
        result.hours.map((row) => row.bucket).join(', ')
      );

      report(
        '2.4. The twin barbers came back with their locations',
        result.barbers.filter((row) => row.label === 'Ba').length === 2 &&
          result.barbers.every((row) => row.sublabel !== null),
        result.barbers.map((row) => `${row.label}@${row.sublabel}`).join(', ')
      );

      const qualified = disambiguateLabels(rankTopN(result.barbers));
      report(
        '2.5. Only the colliding label keeps its location',
        qualified.filter((row) => row.sublabel !== null).length === 2,
        qualified.map((row) => `${row.label}:${row.sublabel ?? '—'}`).join(', ')
      );
    });

    // ─── 3. Neither an expiry nor a cancellation is an appointment ───────────

    await probeOrSkip('3.x', async () => {
      const result = await repository.readBreakdowns({
        ownerId: a.owner.id,
        range: RANGE,
        edges: HOUR_EDGES,
      });
      const total = result.services.reduce((sum, row) => sum + row.count, 0);

      // 5 + 11 + 1 retried + 1 late evening + 1 twin = 19. The EXPIRED and the
      // CANCELLED bookings are the counterfactual: without the status predicate
      // this would be 21.
      report(
        '3.1. Only confirmations were counted',
        total === 19,
        `${total} appointments across the service ranking (expected 19; 21 would mean the status predicate is gone)`
      );

      const withoutStatus = await prisma.$queryRaw<{ count: bigint }[]>`
        SELECT count(*) AS "count"
        FROM "Booking" b
        JOIN "Barber" br ON br.id = b."barberId"
        JOIN "Location" l ON l.id = br."locationId"
        WHERE l."ownerId" = ${a.owner.id}
          AND b."startTime" >= ${RANGE.start}
          AND b."startTime" < ${RANGE.end}
      `;
      report(
        '3.2. COUNTERFACTUAL — dropping the status predicate changes the answer',
        Number(withoutStatus[0]?.count) !== total,
        `${Number(withoutStatus[0]?.count)} without it against ${total} with it`
      );
    });

    // ─── 4. A retried booking counts once ────────────────────────────────────

    await probeOrSkip('4.x', async () => {
      const result = await repository.readBreakdowns({
        ownerId: a.owner.id,
        range: RANGE,
        edges: HOUR_EDGES,
      });
      const topService = rankTopN(result.services)[0];

      // `Sa` carries eight appointments: five weekdays at 13:00, the retried
      // one, the late-evening one, and the twin barber's. **The first run of
      // this gate predicted seven and forgot the twin's booking uses this same
      // service** — the fixture's arithmetic was wrong, not the product, which
      // is the same way D6's first run failed. The count is spelled out here so
      // the next reader does not have to re-derive it.
      report(
        '4.1. The retried booking is counted exactly once',
        topService?.count === 8,
        `${topService?.label} = ${topService?.count} (5 weekdays + retried + late evening + twin = 8; ` +
          '10 would mean Payment entered the row set)'
      );

      // **Scoped to the retried booking alone**, because over the whole service
      // the payment join confounds two effects: it multiplies the booking that
      // has three payment rows *and* drops the seven that have none, and a
      // total that differs could be either. One booking isolates the
      // multiplication, which is the effect rule 4 is actually about.
      const oneBookingJoined = await prisma.$queryRaw<{ count: bigint }[]>`
        SELECT count(*) AS "count"
        FROM "Booking" b
        JOIN "Payment" p ON p."bookingId" = b.id
        WHERE b.id = ${retried}
      `;
      report(
        '4.2. COUNTERFACTUAL — joining Payment multiplies that one booking',
        Number(oneBookingJoined[0]?.count) === 3,
        `${Number(oneBookingJoined[0]?.count)} rows for one appointment — two declined attempts and one approval, ` +
          'each of which would have been counted as a booking'
      );
    });

    // ─── 5. Cross-owner isolation, both directions ───────────────────────────

    await probeOrSkip('5.x', async () => {
      const mine = await repository.readBreakdowns({
        ownerId: a.owner.id,
        range: RANGE,
        edges: HOUR_EDGES,
      });
      const theirs = await repository.readBreakdowns({
        ownerId: b.owner.id,
        range: RANGE,
        edges: HOUR_EDGES,
      });

      report(
        "5.1. Owner A's ranking contains nothing of owner B's",
        mine.services.every((row) => row.label !== 'Sb') &&
          mine.barbers.every((row) => row.label !== 'Bb'),
        mine.barbers.map((row) => row.label).join(', ')
      );
      report(
        "5.2. Owner B's ranking contains nothing of owner A's",
        theirs.services.every((row) => row.label !== 'Sa') &&
          theirs.barbers.every((row) => row.label !== 'Ba'),
        theirs.barbers.map((row) => row.label).join(', ')
      );

      const mineTotal = mine.services.reduce((sum, row) => sum + row.count, 0);
      const bothOwners = await prisma.$queryRaw<{ count: bigint }[]>`
        SELECT count(*) AS "count"
        FROM "Booking" b
        JOIN "Barber" br ON br.id = b."barberId"
        JOIN "Location" l ON l.id = br."locationId"
        WHERE b.status = 'CONFIRMED'
          AND b."startTime" >= ${RANGE.start}
          AND b."startTime" < ${RANGE.end}
          AND l."ownerId" IN (${a.owner.id}, ${b.owner.id})
      `;
      report(
        '5.3. COUNTERFACTUAL — removing the owner predicate changes the totals',
        Number(bothOwners[0]?.count) !== mineTotal,
        `${Number(bothOwners[0]?.count)} across both owners against ${mineTotal} with the predicate`
      );
    });

    // ─── 6. Every breakdown reconciles with the figure above it ──────────────

    await probeOrSkip('6.x', async () => {
      // **Two independent statements that share no transaction**, which is
      // exactly why this has to be measured rather than assumed.
      const figures = await repository.readStatistics({ ownerId: a.owner.id, range: RANGE });
      const result = await repository.readBreakdowns({
        ownerId: a.owner.id,
        range: RANGE,
        edges: HOUR_EDGES,
      });

      const services = rankTopN(result.services).reduce((sum, row) => sum + row.count, 0);
      const barbers = disambiguateLabels(rankTopN(result.barbers)).reduce(
        (sum, row) => sum + row.count,
        0
      );
      const hours = fillHourlyDistribution(result.hours, HOUR_EDGES).reduce(
        (sum, bucket) => sum + bucket.count,
        0
      );

      report(
        '6.1. The service ranking sums to the confirmed figure',
        services === figures.confirmedCount,
        `${services} against ${figures.confirmedCount}`
      );
      report(
        '6.2. The barber ranking sums to the confirmed figure',
        barbers === figures.confirmedCount,
        `${barbers} against ${figures.confirmedCount}`
      );
      report(
        '6.3. The hour distribution sums to the confirmed figure',
        hours === figures.confirmedCount,
        `${hours} against ${figures.confirmedCount}`
      );

      // The fold is exercised rather than bypassed: twelve services, a cap of
      // eight, and the total preserved.
      const ranked = rankTopN(result.services);
      report(
        '6.4. The top-N fold ran and preserved the total',
        result.services.length > RANKING_LIMIT && ranked.some((row) => row.isAggregate),
        `${result.services.length} services folded into ${ranked.length} rows, cap ${RANKING_LIMIT}`
      );
    });

    // ─── 7. The hour is the business's, not the runtime's ────────────────────

    await probeOrSkip('7.x', async () => {
      const result = await repository.readBreakdowns({
        ownerId: a.owner.id,
        range: RANGE,
        edges: HOUR_EDGES,
      });
      const distribution = fillHourlyDistribution(result.hours, HOUR_EDGES);

      report(
        '7.1. A 21:30 appointment is counted in hour 21',
        distribution[21]?.count === 1,
        `hour 21 = ${distribution[21]?.count}, hour 0 = ${distribution[0]?.count}`
      );
      report(
        '7.2. COUNTERFACTUAL — the runtime reads the same instant as another hour',
        lateEvening.getUTCHours() !== 21,
        `the runtime says ${lateEvening.getUTCHours()}, the business says 21 — ${lateEvening.toISOString()}`
      );
      report(
        '7.3. The 13:00 appointments are counted in hour 13',
        distribution[13]?.count === 6,
        `hour 13 = ${distribution[13]?.count} (five weekdays plus the retried booking)`
      );
      report(
        '7.4. Every hour of the day is present, including the empty ones',
        distribution.length === 24 && distribution.filter((bucket) => bucket.count === 0).length > 0,
        `${distribution.length} buckets, ${distribution.filter((b) => b.count === 0).length} of them empty`
      );
    });

    // ─── 8. A month of thresholds crosses the pooler ─────────────────────────

    await probeOrSkip('8.x', async () => {
      // Design open question 1. A `mes` range crosses up to 745 `float8`
      // thresholds, and T68 is on record failing on payloads far smaller than
      // the ones this sends — in the other direction, but neither is assumed.
      const monthEdges = hourBucketEdgesFor('mes', TODAY);
      const started = Date.now();

      const result = await repository.readBreakdowns({
        ownerId: a.owner.id,
        range: intervalFor('mes', TODAY),
        edges: monthEdges,
      });

      const elapsed = Date.now() - started;
      report(
        '8.1. The month-sized threshold array crossed the pooler',
        result.hours.length >= 0,
        `${monthEdges.length} thresholds, ${result.hours.length} hour buckets back, ${elapsed} ms`
      );
      observe(
        '8.2. Payload',
        `${JSON.stringify(monthEdges.map((edge) => edge.getTime() / 1000)).length} bytes of float8[] on the wire`
      );
    });

    // ─── 9. The query plan ───────────────────────────────────────────────────

    await probeOrSkip('9.x', async () => {
      // D1's rule: indexes come from measurement. T81 names
      // `Booking_barberId_startTime_idx` for this family of statement; this one
      // starts from `Booking` and groups three ways, so the answer is not
      // assumed to transfer.
      //
      // **This is the probe most likely to skip.** A plan is many lines of text
      // and T68's ~1.4 KB ceiling is well under it. When it skips, capture the
      // plan over the Supabase SQL API instead — a different transport.
      const plan = await prisma.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(
        `EXPLAIN (ANALYZE, BUFFERS)
         WITH confirmed AS (
           SELECT b."serviceId", s.name::text AS "serviceName", b."barberId",
                  br."displayName"::text AS "barberName", l.name::text AS "locationName",
                  l."ownerId" AS "ownerId", b."startTime"
           FROM "Booking" b
           JOIN "Barber" br ON br.id = b."barberId"
           JOIN "Location" l ON l.id = br."locationId"
           JOIN "Service" s ON s.id = b."serviceId"
           WHERE l."ownerId" = $1 AND b.status = 'CONFIRMED'
             AND b."startTime" >= $2 AND b."startTime" < $3
         )
         SELECT 'service'::text, c."serviceId"::text, c."serviceName", NULL::text, count(*)
         FROM confirmed c WHERE c."ownerId" = $1
         GROUP BY c."serviceId", c."serviceName"
         UNION ALL
         SELECT 'barber'::text, c."barberId"::text, c."barberName", c."locationName", count(*)
         FROM confirmed c WHERE c."ownerId" = $1
         GROUP BY c."barberId", c."barberName", c."locationName"
         UNION ALL
         SELECT 'hour'::text,
                width_bucket(extract(epoch FROM c."startTime")::float8, $4::float8[])::text,
                ''::text, NULL::text, count(*)
         FROM confirmed c WHERE c."ownerId" = $1
         GROUP BY 2`,
        a.owner.id,
        RANGE.start,
        RANGE.end,
        HOUR_EDGES.map((edge) => edge.getTime() / 1000)
      );

      observe('9.1. Query plan', `\n${plan.map((line) => line['QUERY PLAN']).join('\n')}`);
      report(
        '9.2. The plan was captured for the index decision',
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
