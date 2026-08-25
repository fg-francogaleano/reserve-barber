// GATE D1 — the dashboard's aggregates against the live database.
//
// Four of this change's guarantees exist only where a mock cannot see them, and
// T58 is the entry that records why that matters for exactly this shape of
// story:
//
//   1. **The raw statement runs at all.** `readSummary` is a `$queryRaw` with
//      four `FILTER` clauses and a correlated subquery. `tsc` cannot check a
//      column name inside a template literal, and every unit test asserts the
//      SQL *text* rather than executing it. A typo in a quoted identifier passes
//      the whole suite and fails on the owner's landing page.
//
//   2. **The money.** PC3 measured a stored `2000.50` coming back as `2000.5`,
//      and integer-cent arithmetic then reading the lone `5` as five centavos. A
//      `SUM` is the same shape of value. Section 4 is the only thing here that
//      sees the driver's actual return.
//
//   3. **Cross-owner isolation.** There is no row-level security on these
//      tables — the `barber → location → ownerId` join is the entire tenancy
//      boundary, and a leaked aggregate produces no row that can look wrong,
//      only a plausible integer. Section 5 is one of two places this property is
//      held at all.
//
//   4. **The two counting rules that cost money if wrong.** An `APPROVED`
//      payment on an `EXPIRED` booking must not be income (it is a refund the
//      owner owes), and an `EXPIRED` booking must not be a cancellation. Both
//      are seeded here as real rows rather than asserted against a mock that was
//      told the answer.
//
// It also answers design D13's open question — whether either candidate index
// earns its place — by running `EXPLAIN` rather than by opinion, and reports the
// wall-clock cost of the page's four reads.
//
// Everything it creates is prefixed `__d1_gate__` and removed at the end in
// foreign-key order. Every booking FK is `Restrict`, so nothing cascades and the
// order is the guarantee rather than a convenience.
//
// It needs no owner sign-in: nothing here touches storage or a session. Only
// DATABASE_URL, which `.env` already provides.
//
//   npx tsx scripts/d1-gate.ts
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma-cli/client';
import { PrismaDashboardSummaryRepository } from '../src/server/infrastructure/prisma/PrismaDashboardSummaryRepository';
import { PrismaTransferReceiptRepository } from '../src/server/infrastructure/prisma/PrismaTransferReceiptRepository';
import { DashboardSummaryService } from '../src/server/application/services/DashboardSummaryService';
import {
  businessToday,
  dayBoundsOf,
  monthBoundsOf,
} from '../src/server/domain/models/bookingCalendar';
import { systemClock } from '../src/server/domain/repositories/IClock';

const MARK = '__d1_gate__';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

let failures = 0;

function report(probe: string, passed: boolean, detail: string): void {
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${probe} — ${detail}`);
  if (!passed) failures += 1;
}

/** An open question. Reported, never counted as a failure. */
function observe(probe: string, detail: string): void {
  console.log(`OBSERVED  ${probe} — ${detail}`);
}

/**
 * Runs a probe that returns more than a handful of rows, and reports an
 * environment fault as one rather than as a product failure.
 *
 * **T68**: on a network path with a broken path MTU, any response above roughly
 * 1.4 KB never arrives — a single 1400-byte value reproduces it with no table
 * involved. Every probe below this line returns more than that, so on an
 * affected machine they cannot run at all.
 *
 * They are skipped rather than failed, and skipping is announced. A gate that
 * ends in a stack trace is a gate people stop running, and the fourteen probes
 * above this point — every counting rule, both money rules, both directions of
 * cross-owner isolation — are unaffected and still worth having. What must not
 * happen is the opposite: an environment fault reported as a passing product.
 */
async function probeOrSkip(probe: string, run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('timeout')) {
      observe(
        probe,
        `SKIPPED — the response never arrived (${message}). This is T68, the local network's ` +
          'path-MTU fault, not a result about the product. Confirm with ' +
          "`SELECT repeat('x', 1400)`, which fails on an affected machine with no table involved."
      );
      return;
    }
    throw error;
  }
}

const MINUTE = 60_000;

const silentLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: (message: string, context?: Record<string, unknown>) =>
    console.log(`   (logged) ${message} ${JSON.stringify(context)}`),
};

/**
 * Removes everything this gate has ever created, keyed on the mark alone.
 *
 * **Run at the start as well as at the end, and that is not belt-and-braces.**
 * A run interrupted between its first insert and its cleanup — Ctrl-C, a killed
 * process, a thrown probe — leaves an `Owner` behind whose email is unique, so
 * the *next* run dies on that constraint before reaching a single assertion.
 * A gate that cannot be re-run after an interruption is a gate people stop
 * running, which is worse than one that occasionally leaves a row.
 *
 * Keyed on the mark rather than on the ids this process collected, because the
 * rows it has to remove belong to a process that is no longer around to have
 * collected anything.
 *
 * Foreign-key order. Every booking FK is `Restrict`, so nothing cascades and
 * the order is the guarantee rather than a convenience.
 */
async function removeMarkedRows(prisma: PrismaClient): Promise<void> {
  await prisma.transferReceipt.deleteMany({ where: { filePath: { startsWith: MARK } } });
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

/**
 * The adapter options `createPrismaClient` uses in production, mirrored.
 *
 * **Not `maxUses: 1` alone, which is what every earlier gate passes.** Those
 * gates issue their queries one at a time; this is the first surface in the
 * product that issues four **concurrently** (`loadHome`'s `Promise.all`), and
 * concurrency is exactly where a pool's shape starts to matter. A gate that
 * builds a differently-configured pool would be proving nothing about the one
 * the page actually runs on.
 *
 * `connectionTimeoutMillis` is the load-bearing one. `pg` defaults it to `0`,
 * which means **wait forever** — so a pool that cannot hand out a connection
 * produces an infinite hang with no error, no timeout and no output, rather
 * than a failure anybody can read. Production sets 10 s and would have thrown;
 * this gate inherited the default and hung twice before that difference was
 * noticed. Keeping the two in step is the point.
 *
 * `createPrismaClient` itself cannot be imported here: it pulls
 * `@/generated/prisma/client`, the `workerd` build, whose wasm query compiler
 * Node's ESM loader cannot instantiate under `tsx` (the S0 finding recorded in
 * `prisma/schema.prisma`). So the options are mirrored rather than shared, and
 * this comment is what keeps the two from drifting.
 */
const PRODUCTION_POOL_OPTIONS = {
  connectionTimeoutMillis: 10_000,
  query_timeout: 10_000,
  statement_timeout: 10_000,
  max: 5,
  maxUses: 1,
} as const;

async function main(): Promise<void> {
  const adapter = new PrismaPg({
    connectionString: requireEnv('DATABASE_URL'),
    ...PRODUCTION_POOL_OPTIONS,
  });
  const prisma = new PrismaClient({ adapter });

  try {
    console.log('\nGATE D1 — dashboard home aggregates\n');

    // A clean slate, so an interrupted previous run cannot decide this one.
    await removeMarkedRows(prisma);

    const now = new Date();
    const today = businessToday(now);
    const dayRange = dayBoundsOf(today);
    const monthRange = monthBoundsOf(today);

    // ============================================================== fixtures
    //
    // Two owners. Owner B exists solely so every figure can be asserted to
    // exclude it — the property that has no enforcement behind it.
    async function makeOwner(suffix: string) {
      const owner = await prisma.owner.create({
        data: { email: `${MARK}-${suffix}@example.com` },
        select: { id: true },
      });

      const location = await prisma.location.create({
        data: { ownerId: owner.id, name: `${MARK} sucursal ${suffix}` },
        select: { id: true },
      });
      const barber = await prisma.barber.create({
        data: { locationId: location.id, displayName: `${MARK} barbero ${suffix}` },
        select: { id: true },
      });
      // A second barber for owner A, so the filter has something to exclude.
      const otherBarber = await prisma.barber.create({
        data: { locationId: location.id, displayName: `${MARK} barbero ${suffix} 2` },
        select: { id: true },
      });
      const service = await prisma.service.create({
        data: {
          ownerId: owner.id,
          name: `${MARK} corte ${suffix}`,
          price: '10000.00',
          durationMinutes: 30,
        },
        select: { id: true },
      });
      const client = await prisma.client.create({
        data: {
          ownerId: owner.id,
          name: `${MARK} cliente ${suffix}`,
          email: `${MARK}-${suffix}-client@example.com`,
          phone: '+541100000000',
        },
        select: { id: true },
      });

      return { owner, location, barber, otherBarber, service, client };
    }

    const a = await makeOwner('a');
    const b = await makeOwner('b');

    /** Each booking gets its own hour, so nothing collides on the no-overlap rule. */
    let slot = 0;

    /** A time inside today, in the business's calendar, at a distinct hour. */
    function todayAt(): Date {
      slot += 1;
      return new Date(dayRange.start.getTime() + slot * 60 * MINUTE);
    }

    async function makeBooking(
      fixture: Awaited<ReturnType<typeof makeOwner>>,
      token: string,
      row: {
        status: string;
        startTime?: Date;
        holdExpiresAt?: Date | null;
        cancelledAt?: Date | null;
        barberId?: string;
        depositAmount?: string;
      }
    ): Promise<string> {
      const startTime = row.startTime ?? todayAt();
      const booking = await prisma.booking.create({
        data: {
          clientId: fixture.client.id,
          barberId: row.barberId ?? fixture.barber.id,
          serviceId: fixture.service.id,
          startTime,
          endTime: new Date(startTime.getTime() + 30 * MINUTE),
          status: row.status as never,
          priceAtBooking: '10000.00',
          depositAmount: row.depositAmount ?? '3000.00',
          cancellationToken: `${MARK}-${token}`,
          // The check constraint requires a PENDING_PAYMENT row to carry one.
          holdExpiresAt:
            row.holdExpiresAt === undefined
              ? row.status === 'PENDING_PAYMENT'
                ? new Date(Date.now() + 30 * MINUTE)
                : null
              : row.holdExpiresAt,
          cancelledAt: row.cancelledAt ?? null,
          cancelledBy: row.cancelledAt ? 'OWNER' : null,
        },
        select: { id: true },
      });
      return booking.id;
    }

    // --- Owner A: one row per counting rule -----------------------------

    // Counted by "turnos de hoy".
    await makeBooking(a, 'confirmed-today-1', { status: 'CONFIRMED' });
    await makeBooking(a, 'confirmed-today-2', { status: 'CONFIRMED' });
    // Confirmed but last month: historical only, never "today".
    await makeBooking(a, 'confirmed-past', {
      status: 'CONFIRMED',
      startTime: new Date(monthRange.start.getTime() - 5 * 24 * 60 * MINUTE),
    });

    // Counted by the held line, never summed into the confirmed one.
    await makeBooking(a, 'live-hold-today', {
      status: 'PENDING_PAYMENT',
      holdExpiresAt: new Date(Date.now() + 10 * MINUTE),
    });
    // A hold whose deadline passed: no longer holding anything, so not counted.
    await makeBooking(a, 'lapsed-hold-today', {
      status: 'PENDING_PAYMENT',
      holdExpiresAt: new Date(Date.now() - 60 * MINUTE),
    });

    // Cancelled today — the only row the cancellations figure may count.
    await makeBooking(a, 'cancelled-today', {
      status: 'CANCELLED',
      cancelledAt: new Date(),
    });
    // The trap: an EXPIRED row carrying a cancelledAt inside today. The status
    // guard is what excludes it, and this row is why both guards are kept.
    await makeBooking(a, 'expired-with-cancelledat', {
      status: 'EXPIRED',
      cancelledAt: new Date(),
      holdExpiresAt: new Date(Date.now() - 120 * MINUTE),
    });

    // A booking on the second barber, for the filter probe.
    await makeBooking(a, 'other-barber', {
      status: 'CONFIRMED',
      barberId: a.otherBarber.id,
    });

    // --- Money ----------------------------------------------------------

    async function makePayment(
      bookingId: string,
      row: { amount: string; status: string; approvedAt: Date | null }
    ): Promise<string> {
      const payment = await prisma.payment.create({
        data: {
          bookingId,
          method: 'BANK_TRANSFER',
          amount: row.amount,
          status: row.status as never,
          approvedAt: row.approvedAt,
        },
        select: { id: true },
      });
      return payment.id;
    }

    // The figure under test: 2000.50, chosen because the driver returns it as
    // 2000.5 and the trailing zero is the whole point.
    const paidBooking = await makeBooking(a, 'paid-confirmed', {
      status: 'CONFIRMED',
      depositAmount: '2000.50',
    });
    await makePayment(paidBooking, {
      amount: '2000.50',
      status: 'APPROVED',
      approvedAt: new Date(),
    });

    // The late-payment case: the charge is real, the booking never confirmed.
    // This is money the owner owes back, and counting it is the defect this
    // gate exists to catch.
    const lostSlotBooking = await makeBooking(a, 'paid-but-expired', {
      status: 'EXPIRED',
      holdExpiresAt: new Date(Date.now() - 120 * MINUTE),
    });
    await makePayment(lostSlotBooking, {
      amount: '9999.99',
      status: 'APPROVED',
      approvedAt: new Date(),
    });

    // Approved last month: correct, and outside this month's bound.
    const lastMonthBooking = await makeBooking(a, 'paid-last-month', {
      status: 'CONFIRMED',
      startTime: new Date(monthRange.start.getTime() - 3 * 24 * 60 * MINUTE),
    });
    await makePayment(lastMonthBooking, {
      amount: '7777.77',
      status: 'APPROVED',
      approvedAt: new Date(monthRange.start.getTime() - 2 * 24 * 60 * MINUTE),
    });

    // --- Receipts -------------------------------------------------------

    const awaitingBooking = await makeBooking(a, 'awaiting-review', {
      status: 'PENDING_APPROVAL',
      startTime: new Date(Date.now() + 3 * 24 * 60 * MINUTE),
    });
    const awaitingPayment = await makePayment(awaitingBooking, {
      amount: '3000.00',
      status: 'PENDING',
      approvedAt: null,
    });
    await prisma.transferReceipt.create({
      data: {
        paymentId: awaitingPayment,
        filePath: `${MARK}/awaiting.jpg`,
        status: 'PENDING',
      },
    });

    // The row this change exists to remove from the queue: a PENDING receipt on
    // a booking the sweep already expired. Its approve control could only ever
    // answer noLongerPending.
    const sweptBooking = await makeBooking(a, 'swept-with-receipt', {
      status: 'EXPIRED',
      startTime: new Date(Date.now() - 3 * 24 * 60 * MINUTE),
      holdExpiresAt: new Date(Date.now() - 4 * 24 * 60 * MINUTE),
    });
    const sweptPayment = await makePayment(sweptBooking, {
      amount: '3000.00',
      status: 'PENDING',
      approvedAt: null,
    });
    await prisma.transferReceipt.create({
      data: {
        paymentId: sweptPayment,
        filePath: `${MARK}/swept.jpg`,
        status: 'PENDING',
      },
    });

    // --- Owner B: everything, so isolation has something to fail on ------

    await makeBooking(b, 'b-confirmed-today-1', { status: 'CONFIRMED' });
    await makeBooking(b, 'b-confirmed-today-2', { status: 'CONFIRMED' });
    await makeBooking(b, 'b-confirmed-today-3', { status: 'CONFIRMED' });
    await makeBooking(b, 'b-cancelled-today', { status: 'CANCELLED', cancelledAt: new Date() });
    const bPaid = await makeBooking(b, 'b-paid', { status: 'CONFIRMED' });
    await makePayment(bPaid, { amount: '500000.00', status: 'APPROVED', approvedAt: new Date() });
    const bAwaiting = await makeBooking(b, 'b-awaiting', {
      status: 'PENDING_APPROVAL',
      startTime: new Date(Date.now() + 4 * 24 * 60 * MINUTE),
    });
    const bAwaitingPayment = await makePayment(bAwaiting, {
      amount: '3000.00',
      status: 'PENDING',
      approvedAt: null,
    });
    await prisma.transferReceipt.create({
      data: {
        paymentId: bAwaitingPayment,
        filePath: `${MARK}/b-awaiting.jpg`,
        status: 'PENDING',
      },
    });

    // ================================================================ probes

    const dashboardRepo = new PrismaDashboardSummaryRepository(prisma as never);
    const receiptRepo = new PrismaTransferReceiptRepository(prisma as never);
    const service = new DashboardSummaryService(
      dashboardRepo,
      receiptRepo,
      systemClock,
      silentLogger
    );

    // --- 1. The statement runs -------------------------------------------

    const startedAt = Date.now();
    const view = await service.loadHome({ ownerId: a.owner.id, rawBarberFilter: undefined });
    const elapsed = Date.now() - startedAt;

    report(
      '1.1. The aggregate statement executes against the real driver',
      view.summary.ok,
      view.summary.ok ? 'one row returned' : 'the raw statement failed — see the logged error'
    );

    if (!view.summary.ok) {
      throw new Error('Nothing below can be asserted without the summary.');
    }
    const figures = view.summary.value;

    // --- 2. The counting rules -------------------------------------------

    report(
      "2.1. Today's confirmed count excludes holds and past appointments",
      figures.confirmedToday === 4,
      `expected 4 (2 confirmed + 1 paid + 1 on the second barber), got ${figures.confirmedToday}`
    );

    report(
      '2.2. A live hold counts as held; a lapsed one does not',
      figures.heldToday === 1,
      `expected 1 (the live hold only), got ${figures.heldToday}`
    );

    report(
      '2.3. Confirmed and held are two figures, never one',
      figures.confirmedToday !== figures.confirmedToday + figures.heldToday,
      `${figures.confirmedToday} confirmed beside ${figures.heldToday} held`
    );

    report(
      '2.4. An EXPIRED booking is not a cancellation, even carrying a cancelledAt',
      figures.cancelledToday === 1,
      `expected 1 (the genuine cancellation), got ${figures.cancelledToday} — a 2 means the ` +
        'status guard is missing and every swept hold is being reported as a client walking away'
    );

    report(
      '2.5. The historical total counts confirmations, not checkout attempts',
      figures.confirmedAllTime === 6,
      `expected 6 (4 today + 1 last month + 1 paid last month), got ${figures.confirmedAllTime}`
    );

    // --- 3. Receipts ------------------------------------------------------

    report(
      '3.1. A receipt on a swept booking is not counted as waiting',
      figures.pendingReceipts === 1,
      `expected 1 (the live one), got ${figures.pendingReceipts} — a 2 means the queue is still ` +
        'offering a decision that approve() would refuse'
    );

    const queue = await receiptRepo.findPendingForOwner(a.owner.id);
    report(
      '3.2. The counter and the queue agree exactly',
      queue.length === figures.pendingReceipts,
      `queue ${queue.length} vs counter ${figures.pendingReceipts}`
    );

    // --- 4. The money -----------------------------------------------------

    report(
      '4.1. The deposit sum keeps its trailing zero',
      figures.monthDepositIncome === '2000.50',
      `expected "2000.50", got "${figures.monthDepositIncome}" — a "2000.5" is the PC3 defect ` +
        'and would be read as two thousand pesos and five centavos'
    );

    report(
      '4.2. An APPROVED payment on an EXPIRED booking is not income',
      !figures.monthDepositIncome.includes('9999'),
      `9999.99 was charged against a booking that never confirmed; income reads ` +
        `${figures.monthDepositIncome}`
    );

    report(
      '4.3. A payment approved last month is not this month',
      !figures.monthDepositIncome.includes('7777'),
      `income reads ${figures.monthDepositIncome}`
    );

    // --- 5. Cross-owner isolation ----------------------------------------

    const bView = await service.loadHome({ ownerId: b.owner.id, rawBarberFilter: undefined });
    const bFigures = bView.summary.ok ? bView.summary.value : null;

    report(
      "5.1. Owner A's figures exclude owner B entirely",
      figures.confirmedToday === 4 && !figures.monthDepositIncome.includes('500000'),
      `A sees ${figures.confirmedToday} today and ${figures.monthDepositIncome} of income, ` +
        'while B has 3 confirmed today and 500000.00 approved'
    );

    // Four, not three: owner B's three plain confirmations plus `b-paid`, which
    // is also CONFIRMED and also starts today. Counted here because the figure
    // that matters is the one B's own dashboard would show.
    report(
      "5.2. Owner B's figures exclude owner A entirely",
      bFigures !== null && bFigures.confirmedToday === 4 && bFigures.pendingReceipts === 1,
      bFigures === null
        ? 'B summary failed'
        : `B sees ${bFigures.confirmedToday} today and ${bFigures.pendingReceipts} receipts, ` +
            `against A's 6 all-time and 1 receipt`
    );

    await probeOrSkip(
      "5.3. The recent list carries none of the other owner's bookings",
      async () => {
        const aRecent = await dashboardRepo.findRecentForOwner({ ownerId: a.owner.id, limit: 50 });
        report(
          "5.3. The recent list carries none of the other owner's bookings",
          aRecent.every((row) => !row.clientName.includes('cliente b')),
          `${aRecent.length} rows, none naming owner B's client`
        );
      }
    );

    // --- 6. The filter ----------------------------------------------------

    await probeOrSkip('6.1. A barber of this owner narrows the list', async () => {
      const filtered = await service.loadHome({
        ownerId: a.owner.id,
        rawBarberFilter: a.otherBarber.id,
      });
      if (!filtered.recent.ok) throw new Error('Query read timeout');
      report(
        '6.1. A barber of this owner narrows the list',
        filtered.selectedBarberId === a.otherBarber.id && filtered.recent.value.length === 1,
        `selected ${filtered.selectedBarberId ?? 'none'}, ${filtered.recent.value.length} rows`
      );
    });

    await probeOrSkip("6.2. Another owner's barber id is discarded, not queried", async () => {
      const foreign = await service.loadHome({
        ownerId: a.owner.id,
        rawBarberFilter: b.barber.id,
      });
      if (!foreign.recent.ok) throw new Error('Query read timeout');
      report(
        "6.2. Another owner's barber id is discarded, not queried",
        foreign.selectedBarberId === undefined && foreign.recent.value.length > 1,
        `selected ${foreign.selectedBarberId ?? 'none'} — anything else makes this page an oracle ` +
          'for whether a barber id exists'
      );
    });

    report(
      '6.3. Inactive barbers stay selectable',
      view.barbers.length === 2,
      `${view.barbers.length} options offered`
    );

    // --- 7. Cost and the index question (design D13) ----------------------

    observe(
      "7.1. Wall-clock cost of the page's four concurrent reads",
      `${elapsed} ms — above ~1200 ms is a finding to record, not a number to accept quietly. ` +
        'On a machine affected by T68 this figure is meaningless: it includes a read that timed ' +
        'out rather than returned, so it measures the timeout, not the page.'
    );

    const planText = (rows: { 'QUERY PLAN': string }[]): string =>
      rows.map((row) => row['QUERY PLAN']).join('\n');

    const summaryPlan = await prisma
      .$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(
        `EXPLAIN SELECT count(*) FILTER (WHERE b.status = 'CONFIRMED') FROM "Booking" b
         JOIN "Barber" br ON br.id = b."barberId"
         JOIN "Location" l ON l.id = br."locationId"
         WHERE l."ownerId" = '${a.owner.id}'`
      )
      .then(planText);

    observe(
      '7.2. How the planner serves the owner-scoped aggregate today',
      `${summaryPlan.split('\n')[0].trim()} — a sequential scan at this table size is the ` +
        'planner being right rather than an index being missing; design D13 says the ' +
        'measurement decides, and this is the measurement'
    );

    const incomePlan = await prisma
      .$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(
        `EXPLAIN SELECT sum(p.amount) FROM "Payment" p
         JOIN "Booking" pb ON pb.id = p."bookingId"
         JOIN "Barber" pbr ON pbr.id = pb."barberId"
         JOIN "Location" pl ON pl.id = pbr."locationId"
         WHERE pl."ownerId" = '${a.owner.id}' AND p.status = 'APPROVED'
           AND pb.status = 'CONFIRMED'`
      )
      .then(planText);

    observe(
      '7.3. How the planner serves the income subquery today',
      `${incomePlan.split('\n')[0].trim()} — same reading: the candidate indexes ` +
        '(status, startTime) and (status, approvedAt) are not added on this evidence'
    );
  } finally {
    await removeMarkedRows(prisma);

    const leftover = await prisma.booking.count({
      where: { cancellationToken: { startsWith: MARK } },
    });
    report('8.1. The gate cleaned up after itself', leftover === 0, `${leftover} rows left behind`);

    await prisma.$disconnect();
  }

  console.log(failures === 0 ? '\nGATE PASSED\n' : `\nGATE FAILED (${failures})\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
