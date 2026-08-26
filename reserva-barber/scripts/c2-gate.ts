// GATE C2 — owner cancellation against the live database.
//
// Four of this change's guarantees exist only where a mock cannot see them, and
// two of them are corrections to code that shipped:
//
//   1. **The guarded update.** This capability takes no advisory lock, so its
//      entire safety argument is that `updateMany` is conditioned on the
//      statuses it admits. Unit tests assert the argument shape; only the
//      database can confirm the write actually matches zero rows when a booking
//      moved underneath it — which is the difference between reporting a
//      confirmed booking and stamping `CANCELLED` over one.
//
//   2. **An approved payment surviving.** The protection is a `where` clause,
//      not a branch, precisely so the database refuses it rather than the code
//      remembering to. That is only true if the clause is what it looks like.
//
//   3. **`cancelledAt` and `cancelledBy` actually landing.** B6's rejection
//      wrote `CANCELLED` and neither of these for three stories, and nothing
//      noticed because the dashboard counter that depends on them was tested
//      against rows its own tests had seeded. The live check is the one that
//      would have caught it — so this gate checks the rejection path too.
//
//   4. **Cross-owner isolation.** The join through `barber → location → owner`
//      IS the tenancy boundary. Nothing in the type system, the schema or a
//      policy constrains it.
//
// It also pins the decision C2 reversed mid-implementation: a cancellation
// leaves a `PENDING` receipt alone, which is what keeps it distinguishable from
// a receipt rejection. Both produce `CANCELLED` + `OWNER`; only the receipt's
// status tells the client's page which message to render.
//
// Everything it creates is prefixed `__c2_gate__` and removed at the end, in
// foreign-key order — every booking FK is `Restrict`, so nothing cascades and
// the order is the guarantee rather than a convenience.
//
// It sends no mail: the notification is a stub, because what is under test is
// the transaction, not the provider.
//
//   npx tsx scripts/c2-gate.ts
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma-cli/client';
import { PrismaBookingRepository } from '../src/server/infrastructure/prisma/PrismaBookingRepository';
import { PrismaTransferReceiptRepository } from '../src/server/infrastructure/prisma/PrismaTransferReceiptRepository';
import { BookingCancellationService } from '../src/server/application/services/BookingCancellationService';
import { systemClock } from '../src/server/domain/repositories/IClock';

const MARK = '__c2_gate__';

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

const silentLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

/** Records what it was asked to send, and sends nothing. */
function stubNotifications() {
  const notified: { bookingId: string; depositApproved: boolean }[] = [];
  return {
    notified,
    service: {
      async notifyCancelled(bookingId: string, depositApproved: boolean): Promise<void> {
        notified.push({ bookingId, depositApproved });
      },
    },
  };
}

async function main(): Promise<void> {
  const adapter = new PrismaPg({ connectionString: requireEnv('DATABASE_URL'), maxUses: 1 });
  const prisma = new PrismaClient({ adapter });

  const ownerIds: string[] = [];

  try {
    console.log('\nGATE C2 — owner cancellation\n');

    // ============================================================== fixtures
    async function makeOwner(suffix: string) {
      const owner = await prisma.owner.create({
        data: { email: `${MARK}-${suffix}@example.com` },
        select: { id: true },
      });
      ownerIds.push(owner.id);

      // A profile, because the notice's projection resolves through it.
      await prisma.businessProfile.create({
        data: {
          ownerId: owner.id,
          businessName: `Barbería ${MARK} ${suffix}`,
          publicSlug: `${MARK}-${suffix}`,
        },
      });

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
    const b = await makeOwner('b');

    /** Each booking gets its own hour — B6's fixture lesson, kept. */
    let slot = 0;

    async function makeBooking(
      fixture: Awaited<ReturnType<typeof makeOwner>>,
      token: string,
      row: { status: string; holdExpiresAt?: Date | null } = { status: 'CONFIRMED' }
    ): Promise<string> {
      slot += 1;
      const startTime = new Date(Date.now() + (48 + slot) * 60 * 60_000);
      const booking = await prisma.booking.create({
        data: {
          clientId: fixture.client.id,
          barberId: fixture.barber.id,
          serviceId: fixture.service.id,
          startTime,
          endTime: new Date(startTime.getTime() + 30 * 60_000),
          status: row.status as never,
          priceAtBooking: '9000.00',
          depositAmount: '2000.50',
          cancellationToken: `${MARK}-${token}`,
          holdExpiresAt:
            row.holdExpiresAt === undefined
              ? row.status === 'PENDING_PAYMENT'
                ? new Date(Date.now() + 15 * 60_000)
                : null
              : row.holdExpiresAt,
        },
        select: { id: true },
      });
      return booking.id;
    }

    async function makePayment(
      bookingId: string,
      status: 'PENDING' | 'APPROVED',
      approvedAt: Date | null = null
    ): Promise<string> {
      const payment = await prisma.payment.create({
        data: {
          bookingId,
          method: 'BANK_TRANSFER',
          status,
          amount: '2000.50',
          approvedAt,
        },
        select: { id: true },
      });
      return payment.id;
    }

    const notifications = stubNotifications();
    const repository = new PrismaBookingRepository(prisma as never);
    const service = new BookingCancellationService(
      repository,
      systemClock,
      silentLogger,
      notifications.service as never
    );

    // ================================================== 1. the ordinary path
    const plain = await makeBooking(a, 'plain');

    const applied = await service.cancel(plain, a.owner.id);
    const afterPlain = await prisma.booking.findUnique({ where: { id: plain } });

    report(
      '1.1. A confirmed booking is cancelled',
      applied.outcome === 'cancelled' && afterPlain?.status === 'CANCELLED',
      `outcome=${applied.outcome} status=${afterPlain?.status}`
    );

    report(
      '1.2. The canceller and the instant actually land',
      afterPlain?.cancelledBy === 'OWNER' && afterPlain?.cancelledAt !== null,
      `cancelledBy=${afterPlain?.cancelledBy} cancelledAt=${afterPlain?.cancelledAt?.toISOString()}`
    );

    report(
      '1.3. The hold deadline is cleared',
      afterPlain?.holdExpiresAt === null,
      `holdExpiresAt=${afterPlain?.holdExpiresAt}`
    );

    report(
      '1.4. The client is notified exactly once',
      notifications.notified.length === 1 && notifications.notified[0]?.bookingId === plain,
      `notified=${notifications.notified.length}`
    );

    // ============================================ 2. the guard, for real
    const second = await service.cancel(plain, a.owner.id);

    report(
      '2.1. A second cancellation matches zero rows and reports what it found',
      second.outcome === 'notCancellable',
      `outcome=${second.outcome}`
    );

    report(
      '2.2. It notifies nobody the second time',
      notifications.notified.length === 1,
      `notified=${notifications.notified.length}`
    );

    /**
     * The race this capability actually has: a booking confirmed by a
     * notification, or swept, between the row rendering and the submission.
     * Simulated by moving the row after the service has been handed its id.
     */
    const moved = await makeBooking(a, 'moved', { status: 'PENDING_PAYMENT' });
    await prisma.booking.update({ where: { id: moved }, data: { status: 'EXPIRED' } });

    const afterMove = await service.cancel(moved, a.owner.id);
    const movedRow = await prisma.booking.findUnique({ where: { id: moved } });

    report(
      '2.3. A booking that moved underneath is reported, never overwritten',
      afterMove.outcome === 'notCancellable' && movedRow?.status === 'EXPIRED',
      `outcome=${afterMove.outcome} status=${movedRow?.status}`
    );

    report(
      '2.4. Its canceller stays null, because nothing cancelled it',
      movedRow?.cancelledBy === null && movedRow?.cancelledAt === null,
      `cancelledBy=${movedRow?.cancelledBy}`
    );

    // ================================================== 3. the money
    const paid = await makeBooking(a, 'paid');
    const approvedAt = new Date('2026-08-20T12:00:00.000Z');
    const approvedPayment = await makePayment(paid, 'APPROVED', approvedAt);

    const paidResult = await service.cancel(paid, a.owner.id);
    const paymentAfter = await prisma.payment.findUnique({ where: { id: approvedPayment } });

    report(
      '3.1. An approved payment survives, status and instant intact',
      paymentAfter?.status === 'APPROVED' &&
        paymentAfter?.approvedAt?.getTime() === approvedAt.getTime(),
      `status=${paymentAfter?.status} approvedAt=${paymentAfter?.approvedAt?.toISOString()}`
    );

    report(
      '3.2. The notice is told a deposit was approved',
      paidResult.outcome === 'cancelled' &&
        notifications.notified.at(-1)?.depositApproved === true,
      `depositApproved=${notifications.notified.at(-1)?.depositApproved}`
    );

    const unpaid = await makeBooking(a, 'unpaid', { status: 'PENDING_PAYMENT' });
    const pendingPayment = await makePayment(unpaid, 'PENDING');

    await service.cancel(unpaid, a.owner.id);
    const pendingAfter = await prisma.payment.findUnique({ where: { id: pendingPayment } });

    report(
      '3.3. A pending payment is refused',
      pendingAfter?.status === 'REJECTED',
      `status=${pendingAfter?.status}`
    );

    report(
      '3.4. The notice is told there was no approved deposit',
      notifications.notified.at(-1)?.depositApproved === false,
      `depositApproved=${notifications.notified.at(-1)?.depositApproved}`
    );

    // ======================= 4. the receipt, and the decision C2 reversed
    const awaiting = await makeBooking(a, 'awaiting', { status: 'PENDING_APPROVAL' });
    const awaitingPayment = await makePayment(awaiting, 'PENDING');
    const receipt = await prisma.transferReceipt.create({
      data: { paymentId: awaitingPayment, filePath: `${MARK}/receipt.pdf`, status: 'PENDING' },
      select: { id: true },
    });

    await service.cancel(awaiting, a.owner.id);
    const receiptAfter = await prisma.transferReceipt.findUnique({ where: { id: receipt.id } });

    report(
      '4.1. A pending receipt is left exactly as it was',
      receiptAfter?.status === 'PENDING' && receiptAfter?.reviewedAt === null,
      `status=${receiptAfter?.status} reviewedAt=${receiptAfter?.reviewedAt}`
    );

    report(
      '4.2. That is what keeps a cancellation distinguishable from a rejection',
      receiptAfter?.status === 'PENDING',
      'a rejection would leave REJECTED here; the page renders a different message for each'
    );

    const queueCount = await prisma.transferReceipt.count({
      where: {
        status: 'PENDING',
        payment: { booking: { status: 'PENDING_APPROVAL', barber: { location: { ownerId: a.owner.id } } } },
      },
    });

    report(
      '4.3. The queue hides it anyway, by filtering on the booking status',
      queueCount === 0,
      `${queueCount} rows still queued for this owner`
    );

    // ====================== 5. B6's rejection now records its canceller
    const toReject = await makeBooking(b, 'reject', { status: 'PENDING_APPROVAL' });
    const rejectPayment = await makePayment(toReject, 'PENDING');
    const rejectReceipt = await prisma.transferReceipt.create({
      data: { paymentId: rejectPayment, filePath: `${MARK}/reject.pdf`, status: 'PENDING' },
      select: { id: true },
    });

    await new PrismaTransferReceiptRepository(prisma as never).reject({
      receiptId: rejectReceipt.id,
      ownerId: b.owner.id,
      now: new Date(),
    });

    const rejectedBooking = await prisma.booking.findUnique({ where: { id: toReject } });

    report(
      '5.1. The rejection records who cancelled and when',
      rejectedBooking?.status === 'CANCELLED' &&
        rejectedBooking?.cancelledBy === 'OWNER' &&
        rejectedBooking?.cancelledAt !== null,
      `status=${rejectedBooking?.status} cancelledBy=${rejectedBooking?.cancelledBy}`
    );

    /**
     * The defect this fixes, measured rather than asserted: the dashboard's
     * cancellations counter bounds on `cancelledAt`, so before this change a
     * rejection was invisible to it.
     */
    const countable = await prisma.booking.count({
      where: {
        status: 'CANCELLED',
        cancelledAt: { not: null },
        barber: { location: { ownerId: b.owner.id } },
      },
    });

    report(
      '5.2. A rejection is now visible to the cancellations counter',
      countable === 1,
      `${countable} countable cancellations for owner B`
    );

    // ============================================ 6. cross-owner isolation
    const foreign = await makeBooking(b, 'foreign');

    const crossOwner = await service.cancel(foreign, a.owner.id);
    const foreignRow = await prisma.booking.findUnique({ where: { id: foreign } });

    report(
      '6.1. Another owner cannot cancel this booking',
      crossOwner.outcome === 'notFound' && foreignRow?.status === 'CONFIRMED',
      `outcome=${crossOwner.outcome} status=${foreignRow?.status}`
    );

    const missing = await service.cancel(`${MARK}-absent`, a.owner.id);

    report(
      '6.2. A missing booking answers identically to a foreign one',
      missing.outcome === crossOwner.outcome,
      `missing=${missing.outcome} foreign=${crossOwner.outcome}`
    );

    // ==================== 7. the whole row, before and after
    const compared = await makeBooking(a, 'compare');
    const before = await prisma.booking.findUnique({ where: { id: compared } });

    await service.cancel(compared, a.owner.id);

    const after = await prisma.booking.findUnique({ where: { id: compared } });

    const changed = Object.keys(before ?? {}).filter((key) => {
      const l = (before as Record<string, unknown>)[key];
      const r = (after as Record<string, unknown>)[key];
      return JSON.stringify(l) !== JSON.stringify(r);
    });

    const FORBIDDEN = [
      'priceAtBooking',
      'depositAmount',
      'startTime',
      'endTime',
      'cancellationToken',
      'clientId',
      'barberId',
      'serviceId',
      'createdAt',
    ];
    const forbiddenMoved = changed.filter((key) => FORBIDDEN.includes(key));

    report(
      '7.1. Nothing describing what the booking is was touched',
      forbiddenMoved.length === 0,
      `changed=[${changed.join(', ')}]`
    );

    report(
      '7.2. Only the cancellation columns and the ORM own updatedAt moved',
      changed.every((key) =>
        ['status', 'cancelledAt', 'cancelledBy', 'holdExpiresAt', 'updatedAt'].includes(key)
      ),
      `changed=[${changed.join(', ')}]`
    );

    observe(
      '8.1. The message itself',
      'NOT under test here — the notification is a stub. The builder is covered ' +
        'by unit tests, and delivery is proven by a real inbox and by nothing else.'
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
