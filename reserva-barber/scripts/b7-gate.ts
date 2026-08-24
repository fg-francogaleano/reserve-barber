// GATE B7 — the scheduled sweep against the live database.
//
// Three of this change's guarantees exist only where a mock cannot see them,
// and T58 is the entry that records why that matters here in particular:
//
//   1. **The two partial indexes.** `Booking_lapsed_hold_sweep` and
//      `Booking_unanswered_receipt_sweep` are raw SQL in a migration; Prisma
//      neither declares them nor reports their absence as drift. If they are
//      missing, every probe below still passes and the job simply walks the
//      whole table every five minutes forever. Section 7 is the only thing in
//      this repository that would ever notice.
//
//   2. **The guarded update.** The sweep takes no lock, so its entire safety
//      argument is that `updateMany` is conditioned on the status it expects. A
//      unit test asserts the argument shape; only the database can confirm the
//      write actually matches zero rows when a row moved underneath it.
//
//   3. **Cross-owner isolation.** This is the product's first query that is not
//      owner-scoped. Nothing in the type system, the schema or a policy
//      constrains it — the property is held by this probe and by one unit test,
//      and by nothing else.
//
// **This gate runs the real sweep, which sweeps the whole database.** On the
// shared development database that means genuinely abandoned holds left over
// from earlier stories will be expired for real. That is the job working as
// designed — every one of those rows stopped blocking its slot when its hold
// lapsed, long before this ran — but it is worth knowing before you run it.
// Every assertion below is about a row this gate created, never about a total.
//
// Everything it creates is prefixed `__b7_gate__` and removed at the end, in
// foreign-key order — every booking FK is `Restrict`, so nothing cascades and
// the order is the guarantee rather than a convenience.
//
// It needs no owner sign-in: nothing here touches storage or a session. Only
// DATABASE_URL, which `.env` already provides.
//
//   npx tsx scripts/b7-gate.ts
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma-cli/client';
import { PrismaExpiredHoldRepository } from '../src/server/infrastructure/prisma/PrismaExpiredHoldRepository';
import { ExpiredHoldSweepService } from '../src/server/application/services/ExpiredHoldSweepService';
import { EXPIRY_GRACE_MINUTES } from '../src/server/domain/models/bookingHorizon';
import { systemClock } from '../src/server/domain/repositories/IClock';

const MARK = '__b7_gate__';

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

const MINUTE = 60_000;
const minutesAgo = (n: number): Date => new Date(Date.now() - n * MINUTE);
const minutesAhead = (n: number): Date => new Date(Date.now() + n * MINUTE);

/** A logger that keeps what it was told, so the error path can be asserted. */
function recordingLogger() {
  const errors: { message: string; context?: Record<string, unknown> }[] = [];
  const infos: { message: string; context?: Record<string, unknown> }[] = [];
  return {
    errors,
    infos,
    logger: {
      debug: () => {},
      info: (message: string, context?: Record<string, unknown>) =>
        infos.push({ message, context }),
      warn: () => {},
      error: (message: string, context?: Record<string, unknown>) =>
        errors.push({ message, context }),
    },
  };
}

async function main(): Promise<void> {
  const adapter = new PrismaPg({ connectionString: requireEnv('DATABASE_URL'), maxUses: 1 });
  const prisma = new PrismaClient({ adapter });

  const ownerIds: string[] = [];

  try {
    console.log('\nGATE B7 — automatic expiration of provisional holds\n');

    // ============================================================== fixtures
    //
    // Two owners, because cross-owner isolation is the property with no
    // enforcement behind it. Owner B is created here rather than reused: the
    // provisioned owner is linked to a real auth user, and a second one with no
    // `authUserId` is both legitimate (the column is nullable) and disposable.
    async function makeOwner(suffix: string) {
      const owner = await prisma.owner.create({
        data: { email: `${MARK}-${suffix}@example.com` },
        select: { id: true },
      });
      ownerIds.push(owner.id);

      const location = await prisma.location.create({
        data: { ownerId: owner.id, name: `${MARK} sucursal ${suffix}` },
        select: { id: true },
      });
      const barber = await prisma.barber.create({
        data: { locationId: location.id, displayName: `${MARK} barbero ${suffix}` },
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

      return { owner, location, barber, service, client };
    }

    const a = await makeOwner('a');
    const b = await makeOwner('b');

    /** Each booking gets its own hour — B6's fixture lesson, kept. */
    let slot = 0;

    async function makeBooking(
      fixture: Awaited<ReturnType<typeof makeOwner>>,
      token: string,
      row: { status: string; startTime?: Date; holdExpiresAt?: Date | null }
    ): Promise<string> {
      slot += 1;
      const startTime = row.startTime ?? minutesAhead(24 * 60 + slot * 60);
      const booking = await prisma.booking.create({
        data: {
          clientId: fixture.client.id,
          barberId: fixture.barber.id,
          serviceId: fixture.service.id,
          startTime,
          endTime: new Date(startTime.getTime() + 30 * MINUTE),
          status: row.status as never,
          priceAtBooking: '10000.00',
          depositAmount: '3000.00',
          cancellationToken: `${MARK}-${token}`,
          holdExpiresAt: row.holdExpiresAt === undefined ? minutesAgo(1) : row.holdExpiresAt,
        },
        select: { id: true },
      });
      return booking.id;
    }

    const insideGrace = await makeBooking(a, 'inside-grace', {
      status: 'PENDING_PAYMENT',
      holdExpiresAt: minutesAgo(EXPIRY_GRACE_MINUTES - 7),
    });
    const pastGrace = await makeBooking(a, 'past-grace', {
      status: 'PENDING_PAYMENT',
      holdExpiresAt: minutesAgo(EXPIRY_GRACE_MINUTES + 5),
    });
    const receiptFuture = await makeBooking(a, 'receipt-future', {
      status: 'PENDING_APPROVAL',
      startTime: minutesAhead(180),
      holdExpiresAt: minutesAgo(500),
    });
    const receiptPast = await makeBooking(a, 'receipt-past', {
      status: 'PENDING_APPROVAL',
      startTime: minutesAgo(180),
      holdExpiresAt: minutesAgo(500),
    });
    const confirmedPast = await makeBooking(a, 'confirmed-past', {
      status: 'CONFIRMED',
      startTime: minutesAgo(600),
      holdExpiresAt: null,
    });
    const cancelled = await makeBooking(a, 'cancelled', {
      status: 'CANCELLED',
      holdExpiresAt: null,
    });
    const paidButLost = await makeBooking(a, 'paid-but-lost', {
      status: 'PENDING_PAYMENT',
      holdExpiresAt: minutesAgo(EXPIRY_GRACE_MINUTES + 30),
    });

    const bLive = await makeBooking(b, 'b-live', {
      status: 'PENDING_PAYMENT',
      holdExpiresAt: minutesAhead(10),
    });
    const bLapsed = await makeBooking(b, 'b-lapsed', {
      status: 'PENDING_PAYMENT',
      holdExpiresAt: minutesAgo(EXPIRY_GRACE_MINUTES + 5),
    });

    // The slot-lost ending: the charge went through, the slot was gone, and the
    // booking was left "for the sweeper" by `confirmIfSlotFree`.
    const lostPayment = await prisma.payment.create({
      data: {
        bookingId: paidButLost,
        method: 'MERCADO_PAGO',
        amount: '3000.00',
        status: 'APPROVED',
        approvedAt: minutesAgo(20),
      },
      select: { id: true },
    });

    // A payment on a booking that is NOT swept, to prove the report is keyed on
    // what actually expired rather than on what was attempted.
    await prisma.payment.create({
      data: {
        bookingId: confirmedPast,
        method: 'MERCADO_PAGO',
        amount: '3000.00',
        status: 'APPROVED',
        approvedAt: minutesAgo(600),
      },
    });

    // A live pending payment on the row about to be expired, to prove the sweep
    // leaves the money alone.
    const pendingPayment = await prisma.payment.create({
      data: {
        bookingId: pastGrace,
        method: 'BANK_TRANSFER',
        amount: '3000.00',
        status: 'PENDING',
      },
      select: { id: true },
    });

    const statusOf = async (id: string): Promise<string> => {
      const row = await prisma.booking.findUnique({ where: { id }, select: { status: true } });
      return row?.status ?? 'MISSING';
    };

    // ============================================================== the run
    const repository = new PrismaExpiredHoldRepository(prisma as never);
    const first = recordingLogger();
    const summary = await new ExpiredHoldSweepService(
      repository,
      systemClock,
      first.logger
    ).sweep();

    observe(
      '0. What the run did',
      `scanned ${summary.candidatesScanned}, expired ${summary.expiredPendingPayment} holds and ` +
        `${summary.expiredPendingApproval} receipts in ${summary.batches} batches, ${summary.durationMs} ms`
    );

    // ================================================= 1. the two rules
    report(
      '1.1. A hold that lapsed inside the grace window survives',
      (await statusOf(insideGrace)) === 'PENDING_PAYMENT',
      `status is ${await statusOf(insideGrace)}`
    );
    report(
      '1.2. A hold that lapsed before the cutoff is expired',
      (await statusOf(pastGrace)) === 'EXPIRED',
      `status is ${await statusOf(pastGrace)}`
    );
    report(
      '1.3. A receipt whose appointment is still ahead survives',
      (await statusOf(receiptFuture)) === 'PENDING_APPROVAL',
      `status is ${await statusOf(receiptFuture)} (its holdExpiresAt lapsed hours ago)`
    );
    report(
      '1.4. A receipt whose appointment has passed is expired',
      (await statusOf(receiptPast)) === 'EXPIRED',
      `status is ${await statusOf(receiptPast)}`
    );

    // ================================================= 2. what it never touches
    report(
      '2.1. A past CONFIRMED appointment is untouched',
      (await statusOf(confirmedPast)) === 'CONFIRMED',
      `status is ${await statusOf(confirmedPast)}`
    );
    report(
      '2.2. A CANCELLED booking is untouched',
      (await statusOf(cancelled)) === 'CANCELLED',
      `status is ${await statusOf(cancelled)}`
    );

    const expiredRow = await prisma.booking.findUnique({
      where: { id: pastGrace },
      select: { holdExpiresAt: true, cancelledAt: true, cancelledBy: true },
    });
    report(
      '2.3. The expired row keeps the deadline that ended it',
      expiredRow?.holdExpiresAt !== null,
      `holdExpiresAt is ${expiredRow?.holdExpiresAt?.toISOString() ?? 'null'}`
    );
    report(
      '2.4. An expiry is not a cancellation',
      expiredRow?.cancelledAt === null && expiredRow?.cancelledBy === null,
      `cancelledAt=${expiredRow?.cancelledAt}, cancelledBy=${expiredRow?.cancelledBy}`
    );

    const untouchedPayment = await prisma.payment.findUnique({
      where: { id: pendingPayment.id },
      select: { status: true },
    });
    report(
      '2.5. The money keeps its own history',
      untouchedPayment?.status === 'PENDING',
      `the live payment on the expired booking is ${untouchedPayment?.status}`
    );

    // ================================================= 3. cross-owner isolation
    report(
      "3.1. Another owner's live hold is untouched",
      (await statusOf(bLive)) === 'PENDING_PAYMENT',
      `status is ${await statusOf(bLive)}`
    );
    report(
      '3.2. Another owner IS swept by the same run, because the job is not owner-scoped',
      (await statusOf(bLapsed)) === 'EXPIRED',
      `status is ${await statusOf(bLapsed)} — this is the documented exception working, not a leak`
    );

    // ================================================= 4. idempotence
    const second = recordingLogger();
    await new ExpiredHoldSweepService(repository, systemClock, second.logger).sweep();

    const unchanged =
      (await statusOf(pastGrace)) === 'EXPIRED' &&
      (await statusOf(receiptPast)) === 'EXPIRED' &&
      (await statusOf(insideGrace)) === 'PENDING_PAYMENT' &&
      (await statusOf(receiptFuture)) === 'PENDING_APPROVAL';
    report(
      '4.1. A second run changes none of this gate’s rows',
      unchanged,
      'every fixture holds the status the first run left it in'
    );
    report(
      '4.2. Every run reports, including one with nothing to do',
      second.infos.length === 1,
      `${second.infos.length} summary line(s): ${JSON.stringify(second.infos[0]?.context ?? {})}`
    );

    // ================================================= 5. the guarded write
    //
    // The concurrency this cannot stage directly: a row that moved between the
    // candidate read and the update. Staged by moving it first and then handing
    // the repository the id the sweep would have handed it.
    const raced = await makeBooking(a, 'raced', {
      status: 'PENDING_APPROVAL',
      startTime: minutesAhead(300),
      holdExpiresAt: minutesAgo(600),
    });
    const matched = await repository.expire({
      ids: [raced],
      expectedStatus: 'PENDING_PAYMENT',
    });
    report(
      '5.1. A row that moved underneath the run matches zero rows',
      matched === 0 && (await statusOf(raced)) === 'PENDING_APPROVAL',
      `updateMany matched ${matched}, status is ${await statusOf(raced)}`
    );

    // ================================================= 6. the refund signal
    const paid = await repository.findApprovedPaymentsFor([paidButLost, confirmedPast]);
    report(
      '6.1. An expired booking that was already paid is reported',
      paid.length === 1 && paid[0].bookingId === paidButLost,
      `${paid.length} row(s): ${JSON.stringify(paid)}`
    );
    report(
      '6.2. A CONFIRMED booking in the same set is not reported',
      !paid.some((row) => row.bookingId === confirmedPast),
      'a booking that raced to CONFIRMED owes nobody a refund'
    );
    report(
      '6.3. The amount crosses as a canonical decimal string',
      paid[0]?.amount === '3000.00',
      `amount is ${JSON.stringify(paid[0]?.amount)}`
    );

    const refundLine = first.errors.find(
      (entry) => (entry.context?.bookingId as string) === paidButLost
    );
    report(
      '6.4. The run logged the refund at error level',
      refundLine !== undefined && refundLine.context?.paymentId === lostPayment.id,
      refundLine ? JSON.stringify(refundLine.context) : 'no error line named that booking'
    );

    // ================================================= 7. the indexes
    //
    // The only probe in the repository that would ever notice their absence.
    // Prisma neither declares them nor reports them as drift.
    //
    // **This asks two questions, and the first version of it asked neither.**
    // It ran a bare EXPLAIN and asserted the plan named the index. On this
    // table that failed for the lapsed-hold sweep — `Limit → Sort → Seq Scan`,
    // total cost 3.14 — which is the planner being *right*: with a few dozen
    // rows, reading the table and sorting it beats descending an index. The
    // probe was asserting a cost decision rather than the thing under test, so
    // it went red while everything it was meant to protect was fine. That is
    // the same class of defect as a probe that goes green for the wrong reason
    // (b6-gate.ts, run 1), and it is worth no less care.
    //
    // What is actually knowable, and what each part proves:
    //
    //   7.1  the indexes EXIST — the drift Prisma will never report.
    //   7.2  the planner CAN use each one for this exact predicate and
    //        ordering, asked with seq scans disabled so table size cannot
    //        answer for it. This is what catches an index that exists but is
    //        shaped wrong: a missing WHERE clause, the wrong column, an
    //        ordering it cannot serve.
    //   7.3  what the planner actually chooses today, reported and not judged.

    const LAPSED_INDEX = 'Booking_lapsed_hold_sweep';
    const RECEIPT_INDEX = 'Booking_unanswered_receipt_sweep';

    const LAPSED_QUERY = `SELECT id FROM "Booking" WHERE status = 'PENDING_PAYMENT' AND "holdExpiresAt" < now() ORDER BY "holdExpiresAt" ASC LIMIT 200`;
    const RECEIPT_QUERY = `SELECT id FROM "Booking" WHERE status = 'PENDING_APPROVAL' AND "startTime" < now() ORDER BY "startTime" ASC LIMIT 200`;

    const present = await prisma.$queryRawUnsafe<{ indexname: string }[]>(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'Booking' AND indexname IN ('${LAPSED_INDEX}', '${RECEIPT_INDEX}')`
    );
    const names = present.map((row) => row.indexname);

    report(
      '7.1. Both partial indexes exist',
      names.includes(LAPSED_INDEX) && names.includes(RECEIPT_INDEX),
      names.length === 0 ? 'neither is present — did the migration run?' : names.join(', ')
    );

    const planText = (rows: { 'QUERY PLAN': string }[]): string =>
      rows.map((row) => row['QUERY PLAN']).join('\n');

    /**
     * The plan with sequential scans disabled.
     *
     * `SET LOCAL` needs a transaction, and it must survive to the next
     * statement — through a transaction-mode pooler that is only true inside
     * one. `$executeRawUnsafe`, never `$queryRawUnsafe`: `SET` returns no rows,
     * and the driver adapter cannot deserialize that (B4, T58).
     */
    const forcedPlan = async (query: string): Promise<string> =>
      prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe('SET LOCAL enable_seqscan = off');
        return planText(await tx.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(`EXPLAIN ${query}`));
      });

    const forcedLapsed = await forcedPlan(LAPSED_QUERY);
    const forcedReceipt = await forcedPlan(RECEIPT_QUERY);

    report(
      '7.2a. The lapsed-hold predicate can be served by its index',
      forcedLapsed.includes(LAPSED_INDEX),
      forcedLapsed.split('\n').join(' | ')
    );
    report(
      '7.2b. The unanswered-receipt predicate can be served by its index',
      forcedReceipt.includes(RECEIPT_INDEX),
      forcedReceipt.split('\n').join(' | ')
    );

    const [naturalLapsed, naturalReceipt] = await Promise.all([
      prisma.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(`EXPLAIN ${LAPSED_QUERY}`).then(planText),
      prisma.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(`EXPLAIN ${RECEIPT_QUERY}`).then(planText),
    ]);

    observe(
      '7.3. What the planner chooses at this table size',
      `lapsed holds: ${naturalLapsed.split('\n')[0].trim()} · unanswered receipts: ` +
        `${naturalReceipt.split('\n')[0].trim()} — a sequential scan here is the planner being ` +
        'right, not the index being wrong; it flips on its own once the table is large enough ' +
        'for the index to be worth descending, which is the only condition under which this ' +
        'job is expensive in the first place'
    );
  } finally {
    // Foreign-key order. Every booking FK is Restrict, so nothing cascades.
    await prisma.payment.deleteMany({
      where: { booking: { cancellationToken: { startsWith: MARK } } },
    });
    await prisma.booking.deleteMany({ where: { cancellationToken: { startsWith: MARK } } });
    await prisma.client.deleteMany({ where: { ownerId: { in: ownerIds } } });
    await prisma.barber.deleteMany({ where: { location: { ownerId: { in: ownerIds } } } });
    await prisma.service.deleteMany({ where: { ownerId: { in: ownerIds } } });
    await prisma.location.deleteMany({ where: { ownerId: { in: ownerIds } } });
    await prisma.owner.deleteMany({ where: { id: { in: ownerIds } } });

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
