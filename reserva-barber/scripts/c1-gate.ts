// GATE C1 — client cancellation against the live database.
//
// What this proves that a mock cannot:
//
//   1. **The guarded update, under real concurrency.** This capability takes no
//      advisory lock, so its entire safety argument is that `updateMany` is
//      conditioned on the status the read observed. A unit test asserts the
//      argument shape; only the database can show two concurrent submissions
//      producing exactly one cancellation.
//
//   2. **An approved payment surviving.** The protection is a `where` clause,
//      not a branch, precisely so the database refuses it rather than the code
//      remembering to. Compared **whole-row** before and after, which is the
//      technique that falsified N1's own "one column and nothing else" claim.
//
//   3. **`cancelledBy` landing as `CLIENT`.** The column has existed since B3
//      and C1 is the first writer of this value. C2's story is the warning: a
//      status written without its companion columns produced a dashboard
//      counter that read zero for three stories, against rows every test had
//      seeded itself.
//
//   4. **The released slot reappearing in a real availability read**, through
//      the repository the booking flow actually uses rather than by re-deriving
//      the rule here.
//
//   5. **The eligibility bounds against real rows** — a started appointment and
//      a receipt under review, both refused, and refused with the reason the
//      client is shown.
//
//   6. **The log cardinality an anonymous caller can drive.** The endpoint is
//      public and unmetered; this counts what fifty forged tokens produce.
//
// Everything it creates is prefixed `__c1_gate__` and removed at the end, in
// foreign-key order — every booking FK is `Restrict`, so nothing cascades and
// the order is the guarantee rather than a convenience.
//
//   npx tsx scripts/c1-gate.ts
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma-cli/client';
import { PrismaBookingRepository } from '../src/server/infrastructure/prisma/PrismaBookingRepository';
import { PrismaBarberAvailabilityRepository } from '../src/server/infrastructure/prisma/PrismaBarberAvailabilityRepository';
import { ClientBookingCancellationService } from '../src/server/application/services/ClientBookingCancellationService';
import { blocksAvailability } from '../src/server/domain/models/Booking';
import { systemClock } from '../src/server/domain/repositories/IClock';

const MARK = '__c1_gate__';

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

function observe(probe: string, detail: string): void {
  console.log(`OBSERVED  ${probe} — ${detail}`);
}

/** Counts what the service logs, so the cardinality bound is measured. */
function countingLogger() {
  const lines: { level: string; context: unknown }[] = [];
  return {
    lines,
    logger: {
      debug: (_m: string, c?: unknown) => lines.push({ level: 'debug', context: c }),
      info: (_m: string, c?: unknown) => lines.push({ level: 'info', context: c }),
      warn: (_m: string, c?: unknown) => lines.push({ level: 'warn', context: c }),
      error: (_m: string, c?: unknown) => lines.push({ level: 'error', context: c }),
    },
  };
}

async function main(): Promise<void> {
  const adapter = new PrismaPg({ connectionString: requireEnv('DATABASE_URL'), maxUses: 1 });
  const prisma = new PrismaClient({ adapter });

  const ownerIds: string[] = [];

  try {
    console.log('\nGATE C1 — client cancellation\n');

    // ============================================================== fixtures
    async function makeOwner(suffix: string, withProfile = true) {
      const owner = await prisma.owner.create({
        data: { email: `${MARK}-${suffix}@example.com` },
        select: { id: true },
      });
      ownerIds.push(owner.id);

      if (withProfile) {
        await prisma.businessProfile.create({
          data: {
            ownerId: owner.id,
            businessName: `Barbería ${MARK} ${suffix}`,
            publicSlug: `${MARK}-${suffix}`,
          },
        });
      }

      const location = await prisma.location.create({
        data: { ownerId: owner.id, name: `Sucursal ${MARK} ${suffix}` },
        select: { id: true },
      });
      const barber = await prisma.barber.create({
        data: { locationId: location.id, displayName: `Barbero ${MARK} ${suffix}` },
        select: { id: true },
      });
      const service = await prisma.service.create({
        data: {
          ownerId: owner.id,
          name: `Corte ${MARK} ${suffix}`,
          price: '9000.00',
          durationMinutes: 30,
        },
        select: { id: true },
      });
      const client = await prisma.client.create({
        data: {
          ownerId: owner.id,
          name: `Cliente ${MARK} ${suffix}`,
          email: `${MARK}-${suffix}-client@example.com`,
          phone: '+5491133334444',
        },
        select: { id: true },
      });

      return { owner, barber, service, client };
    }

    const a = await makeOwner('a');
    const noProfile = await makeOwner('sinperfil', false);

    /** Each booking gets its own hour — B6's fixture lesson, kept. */
    let slot = 0;

    async function makeBooking(
      fixture: Awaited<ReturnType<typeof makeOwner>>,
      token: string,
      row: { status?: string; startTime?: Date; holdExpiresAt?: Date | null } = {}
    ): Promise<{ id: string; token: string; startTime: Date }> {
      slot += 1;
      const startTime = row.startTime ?? new Date(Date.now() + (48 + slot) * 60 * 60_000);
      const status = row.status ?? 'CONFIRMED';
      const full = `${MARK}-${token}`;
      const booking = await prisma.booking.create({
        data: {
          clientId: fixture.client.id,
          barberId: fixture.barber.id,
          serviceId: fixture.service.id,
          startTime,
          endTime: new Date(startTime.getTime() + 30 * 60_000),
          status: status as never,
          priceAtBooking: '9000.00',
          depositAmount: '2000.50',
          cancellationToken: full,
          holdExpiresAt:
            row.holdExpiresAt === undefined
              ? status === 'PENDING_PAYMENT'
                ? new Date(Date.now() + 15 * 60_000)
                : null
              : row.holdExpiresAt,
        },
        select: { id: true },
      });
      return { id: booking.id, token: full, startTime };
    }

    async function makePayment(
      bookingId: string,
      status: 'PENDING' | 'APPROVED',
      approvedAt: Date | null = null
    ): Promise<string> {
      const payment = await prisma.payment.create({
        data: { bookingId, method: 'BANK_TRANSFER', status, amount: '2000.50', approvedAt },
        select: { id: true },
      });
      return payment.id;
    }

    const counting = countingLogger();
    const repository = new PrismaBookingRepository(prisma as never);
    const service = new ClientBookingCancellationService(
      repository,
      systemClock,
      counting.logger as never
    );

    // ============================================ 1. what a stranger reaches
    const forged = await service.cancel(`${MARK}-does-not-exist`);

    report(
      '1.1. A forged token resolves nothing',
      forged.outcome === 'notFound',
      `outcome=${forged.outcome}`
    );

    report(
      '1.2. And carries no destination that would disclose a shop',
      !('slug' in forged),
      `keys=[${Object.keys(forged).join(', ')}]`
    );

    const orphan = await makeBooking(noProfile, 'sin-perfil');
    const orphanResult = await service.cancel(orphan.token);

    report(
      '1.3. A booking whose shop has no public profile answers identically',
      orphanResult.outcome === 'notFound',
      `outcome=${orphanResult.outcome}`
    );

    const orphanRow = await prisma.booking.findUnique({ where: { id: orphan.id } });
    report(
      '1.4. And is left completely alone',
      orphanRow?.status === 'CONFIRMED' && orphanRow?.cancelledAt === null,
      `status=${orphanRow?.status} cancelledAt=${orphanRow?.cancelledAt}`
    );

    // ================================================== 2. the eligibility bounds
    const started = await makeBooking(a, 'empezado', {
      startTime: new Date(Date.now() - 60 * 60_000),
    });
    const startedResult = await service.cancel(started.token);

    report(
      '2.1. An appointment that already started is refused',
      startedResult.outcome === 'notCancellable',
      `outcome=${startedResult.outcome}`
    );

    report(
      '2.2. And refused with the reason the client can act on',
      startedResult.outcome === 'notCancellable' && startedResult.reason === 'alreadyStarted',
      `reason=${startedResult.outcome === 'notCancellable' ? startedResult.reason : 'n/a'}`
    );

    const underReview = await makeBooking(a, 'en-revision', { status: 'PENDING_APPROVAL' });
    const reviewPayment = await makePayment(underReview.id, 'PENDING');
    const reviewReceipt = await prisma.transferReceipt.create({
      data: { paymentId: reviewPayment, filePath: `${MARK}/receipt.pdf`, status: 'PENDING' },
      select: { id: true },
    });
    const reviewResult = await service.cancel(underReview.token);

    report(
      '2.3. A comprobante under review is not the client s to cancel',
      reviewResult.outcome === 'notCancellable',
      `outcome=${reviewResult.outcome}`
    );

    const reviewRow = await prisma.booking.findUnique({ where: { id: underReview.id } });
    const receiptRow = await prisma.transferReceipt.findUnique({ where: { id: reviewReceipt.id } });
    report(
      '2.4. Its booking and its receipt are both untouched',
      reviewRow?.status === 'PENDING_APPROVAL' && receiptRow?.status === 'PENDING',
      `booking=${reviewRow?.status} receipt=${receiptRow?.status}`
    );

    const lapsed = await makeBooking(a, 'vencido', {
      status: 'PENDING_PAYMENT',
      holdExpiresAt: new Date(Date.now() - 60 * 60_000),
    });
    const lapsedResult = await service.cancel(lapsed.token);

    report(
      '2.5. A booking that is no longer holding its time is refused',
      lapsedResult.outcome === 'notCancellable',
      `outcome=${lapsedResult.outcome}`
    );

    // ========================================================= 3. the write
    const plain = await makeBooking(a, 'simple');
    const before = await prisma.booking.findUnique({ where: { id: plain.id } });

    const applied = await service.cancel(plain.token);
    const after = await prisma.booking.findUnique({ where: { id: plain.id } });

    report(
      '3.1. A confirmed future appointment is cancelled',
      applied.outcome === 'cancelled',
      `outcome=${applied.outcome}`
    );

    report(
      '3.2. The client is recorded as the canceller',
      after?.cancelledBy === 'CLIENT' && after?.cancelledAt !== null,
      `cancelledBy=${after?.cancelledBy} cancelledAt=${after?.cancelledAt?.toISOString()}`
    );

    report(
      '3.3. Its hold deadline is cleared',
      after?.holdExpiresAt === null,
      `holdExpiresAt=${after?.holdExpiresAt}`
    );

    report(
      '3.4. The caller is given the slug to return the client to',
      applied.outcome === 'cancelled' && applied.slug === `${MARK}-a`,
      `slug=${applied.outcome === 'cancelled' ? applied.slug : 'n/a'}`
    );

    /**
     * The whole-row comparison. N1's gate used exactly this to falsify a claim
     * four documents made — that a write touched "one column and nothing else"
     * — by finding Prisma's `@updatedAt` moving alongside.
     */
    const changed = Object.keys(before ?? {}).filter(
      (key) =>
        JSON.stringify((before as Record<string, unknown>)[key]) !==
        JSON.stringify((after as Record<string, unknown>)[key])
    );

    report(
      '3.5. Only the cancellation columns and the ORM own updatedAt moved',
      changed.every((key) =>
        ['status', 'cancelledAt', 'cancelledBy', 'holdExpiresAt', 'updatedAt'].includes(key)
      ),
      `changed=[${changed.join(', ')}]`
    );

    // =============================================== 4. the guard, concurrently
    const raced = await makeBooking(a, 'carrera');
    const [first, second] = await Promise.all([
      service.cancel(raced.token),
      service.cancel(raced.token),
    ]);
    const racedRow = await prisma.booking.findUnique({ where: { id: raced.id } });
    const applieds = [first, second].filter((r) => r.outcome === 'cancelled').length;

    report(
      '4.1. Two concurrent submissions produce exactly one cancellation',
      applieds === 1,
      `applied=${applieds} outcomes=[${first.outcome}, ${second.outcome}]`
    );

    report(
      '4.2. And the other is reported rather than treated as a failure',
      [first, second].some((r) => r.outcome === 'notCancellable'),
      `outcomes=[${first.outcome}, ${second.outcome}]`
    );

    report(
      '4.3. The row is cancelled exactly once, by the client',
      racedRow?.status === 'CANCELLED' && racedRow?.cancelledBy === 'CLIENT',
      `status=${racedRow?.status} cancelledBy=${racedRow?.cancelledBy}`
    );

    const again = await service.cancel(raced.token);
    report(
      '4.4. A later submission changes nothing',
      again.outcome === 'notCancellable',
      `outcome=${again.outcome}`
    );

    // ============================================================ 5. the money
    const paid = await makeBooking(a, 'pagado');
    const approvedAt = new Date('2026-08-20T12:00:00.000Z');
    const approvedPayment = await makePayment(paid.id, 'APPROVED', approvedAt);
    const paymentBefore = await prisma.payment.findUnique({ where: { id: approvedPayment } });

    const paidResult = await service.cancel(paid.token);
    const paymentAfter = await prisma.payment.findUnique({ where: { id: approvedPayment } });

    report(
      '5.1. The cancellation applies over an approved deposit',
      paidResult.outcome === 'cancelled',
      `outcome=${paidResult.outcome}`
    );

    const paymentChanged = Object.keys(paymentBefore ?? {}).filter(
      (key) =>
        JSON.stringify((paymentBefore as Record<string, unknown>)[key]) !==
        JSON.stringify((paymentAfter as Record<string, unknown>)[key])
    );

    report(
      '5.2. And the approved payment is untouched, whole-row',
      paymentChanged.length === 0,
      `changed=[${paymentChanged.join(', ')}]`
    );

    const pending = await makeBooking(a, 'pendiente', { status: 'PENDING_PAYMENT' });
    const pendingPayment = await makePayment(pending.id, 'PENDING');
    await service.cancel(pending.token);
    const pendingAfter = await prisma.payment.findUnique({ where: { id: pendingPayment } });

    report(
      '5.3. A pending payment is refused rather than left counted as live',
      pendingAfter?.status === 'REJECTED',
      `status=${pendingAfter?.status}`
    );

    report(
      '5.4. Nothing records a refund, because nothing performs one',
      pendingAfter?.approvedAt === null,
      `approvedAt=${pendingAfter?.approvedAt}`
    );

    // ================================================ 6. the slot came back
    const availability = new PrismaBarberAvailabilityRepository(prisma as never);
    const released = await makeBooking(a, 'liberado');
    const dayStart = new Date(released.startTime);
    dayStart.setUTCHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60_000);

    const inputsBefore = await availability.findDayInputs(
      a.barber.id,
      a.owner.id,
      released.startTime.getUTCDay(),
      { start: dayStart, end: dayEnd }
    );
    const blockedBefore = inputsBefore.bookings.filter((b) => blocksAvailability(b, new Date()));

    await service.cancel(released.token);

    const inputsAfter = await availability.findDayInputs(
      a.barber.id,
      a.owner.id,
      released.startTime.getUTCDay(),
      { start: dayStart, end: dayEnd }
    );
    const blockedAfter = inputsAfter.bookings.filter((b) => blocksAvailability(b, new Date()));

    const stillBlocking = blockedAfter.some(
      (b) => b.startTime.getTime() === released.startTime.getTime()
    );

    report(
      '6.1. The released time no longer blocks in a real availability read',
      !stillBlocking && blockedAfter.length < blockedBefore.length,
      `blocking before=${blockedBefore.length} after=${blockedAfter.length}`
    );

    // ============================================== 7. what a stranger costs
    counting.lines.length = 0;
    for (let i = 0; i < 50; i += 1) {
      await service.cancel(`${MARK}-forged-${i}`);
    }

    report(
      '7.1. Fifty forged submissions produce zero log entries',
      counting.lines.length === 0,
      `lines=${counting.lines.length}`
    );

    counting.lines.length = 0;
    const logged = await makeBooking(a, 'registrado');
    await service.cancel(logged.token);

    report(
      '7.2. A real cancellation produces exactly one',
      counting.lines.length === 1,
      `lines=${counting.lines.length}`
    );

    const loggedText = JSON.stringify(counting.lines);
    report(
      '7.3. And it carries no token, name, address or slug',
      !loggedText.includes(MARK) &&
        !loggedText.includes('@example.com') &&
        !loggedText.includes('+5491133334444'),
      `context=${loggedText.slice(0, 160)}`
    );

    observe(
      '8.1. The confirmation step',
      'NOT under test here — it is a render, proven by the page tests and by ' +
        'the runtime pass over HTTP. What this gate owns is the write.'
    );
  } finally {
    // Foreign-key order. Every booking FK is Restrict, so nothing cascades.
    await prisma.transferReceipt.deleteMany({
      where: { payment: { booking: { cancellationToken: { startsWith: MARK } } } },
    });
    await prisma.payment.deleteMany({
      where: { booking: { cancellationToken: { startsWith: MARK } } },
    });
    await prisma.booking.deleteMany({ where: { cancellationToken: { startsWith: MARK } } });
    await prisma.client.deleteMany({ where: { ownerId: { in: ownerIds } } });
    await prisma.barber.deleteMany({ where: { location: { ownerId: { in: ownerIds } } } });
    await prisma.service.deleteMany({ where: { ownerId: { in: ownerIds } } });
    await prisma.location.deleteMany({ where: { ownerId: { in: ownerIds } } });
    await prisma.businessProfile.deleteMany({ where: { ownerId: { in: ownerIds } } });
    await prisma.owner.deleteMany({ where: { id: { in: ownerIds } } });

    const leftover = await prisma.booking.count({
      where: { cancellationToken: { startsWith: MARK } },
    });
    report('9.1. The gate cleaned up after itself', leftover === 0, `${leftover} rows left behind`);

    await prisma.$disconnect();
  }

  console.log(failures === 0 ? '\nGATE PASSED\n' : `\nGATE FAILED (${failures})\n`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
