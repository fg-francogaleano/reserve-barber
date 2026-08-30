// GATE N2 — the appointment reminder against the live database.
//
// **The claim is the only thing making this job at-most-once, and a mock cannot
// prove a claim.** N1 inherited at-most-once from a guarded status transition;
// N2 has no transition to key on, so the guarantee is a single conditional
// update — and whether that statement really matches zero rows when a row moved
// underneath it is a question only Postgres can answer.
//
// Four guarantees exist only where a mock cannot see them:
//
//   1. **`startTime > now`.** The one bound in this capability whose failure is
//      unrecoverable: without it the first run selects every confirmed booking
//      in history and mails all of them. Section 2 plants a confirmed past
//      appointment and proves no run ever reaches it.
//
//   2. **The claim's guards.** `reminderEmailSentAt IS NULL AND status =
//      'CONFIRMED'`, asserted against real concurrent writes rather than
//      against a mock's recorded arguments.
//
//   3. **The partial index.** `Booking_reminder_due` is raw SQL in a migration;
//      Prisma neither declares it nor reports its absence as drift. If it were
//      missing every probe below would still pass and the job would walk the
//      whole table every hour forever.
//
//   4. **Cross-owner isolation.** This is the product's third unscoped query
//      and its second unscoped write. Nothing in the type system, the schema or
//      a policy constrains it — the property is held by this probe and by one
//      unit test, and by nothing else.
//
// **This gate sends no email.** The sender is a stub that records what it was
// handed, which is deliberate and not a shortcut: T76 stands, no sending domain
// is verified, and a real send here would reach exactly one mailbox while
// claiming every row it touched. What the gate proves is the part that is about
// rows; delivery is proven elsewhere, and the story records that it cannot be.
//
// Everything it creates is prefixed `__n2_gate__` and removed at the end, in
// foreign-key order — every booking FK is `Restrict`, so nothing cascades and
// the order is the guarantee rather than a convenience.
//
//   npx tsx scripts/n2-gate.ts
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma-cli/client';
import { PrismaBookingReminderRepository } from '../src/server/infrastructure/prisma/PrismaBookingReminderRepository';
import { BookingReminderService } from '../src/server/application/services/BookingReminderService';
import {
  REMINDER_LEAD_HOURS,
  REMINDER_MIN_GAP_HOURS,
} from '../src/server/domain/models/bookingHorizon';
import { systemClock } from '../src/server/domain/repositories/IClock';
import type { EmailMessage, IEmailSender } from '../src/server/domain/repositories/IEmailSender';

const MARK = '__n2_gate__';
const ORIGIN = 'https://gate.example.com';

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
const HOUR = 60 * MINUTE;
const hoursAhead = (n: number): Date => new Date(Date.now() + n * HOUR);
const hoursAgo = (n: number): Date => new Date(Date.now() - n * HOUR);

/**
 * A sender that delivers nothing and remembers everything.
 *
 * Nothing leaves this process. See the header: T76 stands, and a real send here
 * would reach one mailbox while claiming every row it touched.
 */
function recordingSender(outcome: 'sent' | 'rejected' = 'sent') {
  const sent: EmailMessage[] = [];
  const sender: IEmailSender = {
    async send(message) {
      sent.push(message);
      return { outcome };
    },
  };
  return { sent, sender };
}

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
    console.log('\nGATE N2 — the appointment reminder\n');

    // ============================================================== fixtures
    //
    // Two owners, because cross-owner isolation is the property with no
    // enforcement behind it. Each gets a BusinessProfile: the reminder's
    // message projection reads the public slug through it, and a booking whose
    // shop has none is deliberately dropped rather than sent — which section 6
    // proves on purpose.
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
            businessName: `${MARK} barberia ${suffix}`,
            publicSlug: `${MARK}-${suffix}`.replace(/_/g, '-'),
          },
        });
      }

      const location = await prisma.location.create({
        data: { ownerId: owner.id, name: `${MARK} sucursal ${suffix}`, address: 'Gorriti 4500' },
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
    const noProfile = await makeOwner('c', false);

    /** Each booking gets its own slot — B6's fixture lesson, kept. */
    let slot = 0;

    async function makeBooking(
      fixture: Awaited<ReturnType<typeof makeOwner>>,
      token: string,
      row: {
        status?: string;
        startTime?: Date;
        createdAt?: Date;
        reminderEmailSentAt?: Date | null;
      }
    ): Promise<string> {
      slot += 1;
      // Inside the reminder window by default, and staggered by a minute so two
      // fixtures never collide on the no-overlap invariant.
      const startTime = row.startTime ?? hoursAhead(REMINDER_LEAD_HOURS - 1 - slot / 60);
      const booking = await prisma.booking.create({
        data: {
          clientId: fixture.client.id,
          barberId: fixture.barber.id,
          serviceId: fixture.service.id,
          startTime,
          endTime: new Date(startTime.getTime() + 30 * MINUTE),
          status: (row.status ?? 'CONFIRMED') as never,
          priceAtBooking: '10000.00',
          depositAmount: '3000.00',
          cancellationToken: `${MARK}-${token}`,
          // A confirmed booking has no hold left to describe.
          holdExpiresAt: null,
          // Old enough to clear the minimum gap unless a probe says otherwise.
          createdAt: row.createdAt ?? hoursAgo(72),
          reminderEmailSentAt: row.reminderEmailSentAt ?? null,
        },
        select: { id: true },
      });
      return booking.id;
    }

    function build(sender: IEmailSender, logger: ReturnType<typeof recordingLogger>['logger']) {
      return new BookingReminderService(
        new PrismaBookingReminderRepository(prisma as never),
        sender,
        systemClock,
        logger,
        ORIGIN
      );
    }

    async function statusOf(id: string) {
      return prisma.booking.findUnique({
        where: { id },
        select: { status: true, reminderEmailSentAt: true, updatedAt: true },
      });
    }

    // ============================================ 1. the ordinary due booking
    const due = await makeBooking(a, 'due', {});

    {
      const { sent, sender } = recordingSender();
      const { logger, infos } = recordingLogger();
      const summary = await build(sender, logger).run();

      const row = await statusOf(due);
      const mine = sent.filter((message) => message.text.includes(`${MARK}-due`));

      report(
        '1.1. A due confirmed booking is claimed and sent to exactly once',
        mine.length === 1 && row?.reminderEmailSentAt !== null,
        `${mine.length} message(s), claimed at ${row?.reminderEmailSentAt?.toISOString() ?? 'null'}`
      );
      report(
        '1.2. The message carries the booking link built on the configured origin',
        mine[0]?.text.includes(`${ORIGIN}/b/`) === true,
        mine[0]?.text.split('\n').find((line) => line.startsWith(ORIGIN)) ?? 'no URL in the message'
      );
      report(
        '1.3. The run emits one summary even though it also did work',
        infos.some((entry) => entry.message.includes('run complete')),
        `sent=${summary.sent} claimed=${summary.claimed} candidates=${summary.candidatesScanned}`
      );
    }

    // ================================================ 2. the past is unreachable
    //
    // THE PROBE THAT MATTERS MOST. Without `startTime > now` the first run in
    // any environment mails every confirmed booking in history.
    const past = await makeBooking(a, 'past', {
      startTime: hoursAgo(2),
      createdAt: hoursAgo(200),
    });
    const longPast = await makeBooking(a, 'long-past', {
      startTime: hoursAgo(24 * 30),
      createdAt: hoursAgo(24 * 40),
    });

    {
      const { sent, sender } = recordingSender();
      const { logger } = recordingLogger();
      await build(sender, logger).run();

      const rows = await Promise.all([statusOf(past), statusOf(longPast)]);
      const touched = sent.filter(
        (message) => message.text.includes('-past') || message.text.includes('-long-past')
      );

      report(
        '2.1. A confirmed appointment that has already started is never selected',
        touched.length === 0 && rows.every((row) => row?.reminderEmailSentAt === null),
        `${touched.length} message(s); claims: ${rows.map((row) => String(row?.reminderEmailSentAt)).join(', ')}`
      );
    }

    // ================================================== 3. idempotence
    {
      const { sent, sender } = recordingSender();
      const { logger } = recordingLogger();
      const before = await statusOf(due);
      const summary = await build(sender, logger).run();
      const after = await statusOf(due);

      const mine = sent.filter((message) => message.text.includes(`${MARK}-due`));

      report(
        '3.1. A second run claims nothing and sends nothing for an already-claimed booking',
        mine.length === 0,
        `${mine.length} message(s), summary claimed=${summary.claimed}`
      );
      report(
        '3.2. The claim instant is not moved by a later run',
        before?.reminderEmailSentAt?.getTime() === after?.reminderEmailSentAt?.getTime(),
        `${before?.reminderEmailSentAt?.toISOString()} → ${after?.reminderEmailSentAt?.toISOString()}`
      );
    }

    // =============================== 4. a row that changed underneath the run
    //
    // The claim's guards, against a real concurrent write rather than a mock's
    // recorded arguments.
    const racing = await makeBooking(a, 'racing', {});

    {
      const repository = new PrismaBookingReminderRepository(prisma as never);
      const now = new Date();
      const candidates = await repository.findDueCandidates({
        now,
        windowEnd: new Date(now.getTime() + REMINDER_LEAD_HOURS * HOUR),
        limit: 200,
      });
      const selected = candidates.some((candidate) => candidate.id === racing);

      // The client cancels between the read and the claim.
      await prisma.booking.update({
        where: { id: racing },
        data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledBy: 'CLIENT' },
      });

      const claimed = await repository.claimDue({ ids: [racing], claimedAt: now });
      const row = await statusOf(racing);

      report(
        '4.1. The candidate query saw the booking before it changed',
        selected,
        `${candidates.length} candidate(s) in the window`
      );
      report(
        '4.2. A booking cancelled between the read and the claim matches zero rows',
        claimed.length === 0 && row?.reminderEmailSentAt === null,
        `claimed ${claimed.length}, status ${row?.status}, claim ${String(row?.reminderEmailSentAt)}`
      );
    }

    // ============================================ 5. the short-notice booking
    const shortNotice = await makeBooking(a, 'short-notice', {
      startTime: hoursAhead(1),
      createdAt: new Date(Date.now() - (REMINDER_MIN_GAP_HOURS - 2) * HOUR),
    });

    {
      const { sent, sender } = recordingSender();
      const { logger } = recordingLogger();
      await build(sender, logger).run();

      const row = await statusOf(shortNotice);
      const mine = sent.filter((message) => message.text.includes(`${MARK}-short-notice`));

      report(
        '5.1. A booking made inside its own lead window is not reminded of itself',
        mine.length === 0 && row?.reminderEmailSentAt === null,
        `${mine.length} message(s), claim ${String(row?.reminderEmailSentAt)}`
      );
    }

    // ======================================= 6. a shop with no public profile
    const profileless = await makeBooking(noProfile, 'no-profile', {});

    {
      const { sent, sender } = recordingSender();
      const { logger } = recordingLogger();
      await build(sender, logger).run();

      const row = await statusOf(profileless);
      const mine = sent.filter((message) => message.text.includes(`${MARK}-no-profile`));

      // Claimed but not sent: the claim is a blind conditional update over the
      // ids the predicate approved, and only the message projection can
      // discover that the shop has no slug. Dropping it there is the right
      // answer — a link built on an absent slug is a permanent 404 in an inbox
      // — and the row staying claimed is the cost, recorded rather than hidden.
      report(
        '6.1. A booking whose shop has no public profile is never sent a message',
        mine.length === 0,
        `${mine.length} message(s)`
      );
      observe(
        '6.2. Such a booking is claimed and then dropped',
        `claim ${String(row?.reminderEmailSentAt)} — the claim precedes the projection that ` +
          'discovers the missing slug, so the row is consumed without a message. Unreachable ' +
          'today (the slug IS the profile, so a booking cannot exist without one) and worth ' +
          'knowing if it ever becomes reachable'
      );
    }

    // ================================================ 7. cross-owner isolation
    const otherOwner = await makeBooking(b, 'other-owner', {});
    const otherOwnerClaimed = await makeBooking(b, 'other-owner-claimed', {
      reminderEmailSentAt: hoursAgo(5),
    });
    const otherOwnerFuture = await makeBooking(b, 'other-owner-future', {
      startTime: hoursAhead(REMINDER_LEAD_HOURS + 48),
    });

    {
      const { sent, sender } = recordingSender();
      const { logger } = recordingLogger();
      await build(sender, logger).run();

      const rows = await Promise.all([
        statusOf(otherOwner),
        statusOf(otherOwnerClaimed),
        statusOf(otherOwnerFuture),
      ]);

      report(
        "7.1. A second owner's due booking is served by the same unscoped run",
        rows[0]?.reminderEmailSentAt !== null &&
          sent.some((message) => message.text.includes(`${MARK}-other-owner`)),
        `claim ${String(rows[0]?.reminderEmailSentAt)}`
      );
      report(
        "7.2. A second owner's already-claimed booking is untouched",
        Math.abs((rows[1]?.reminderEmailSentAt?.getTime() ?? 0) - hoursAgo(5).getTime()) < HOUR,
        `claim ${String(rows[1]?.reminderEmailSentAt)}`
      );
      report(
        "7.3. A second owner's out-of-window booking is untouched",
        rows[2]?.reminderEmailSentAt === null,
        `claim ${String(rows[2]?.reminderEmailSentAt)}`
      );
    }

    // ================================== 8. a failed send never releases a row
    const failing = await makeBooking(a, 'failing', {});

    {
      const { sender } = recordingSender('rejected');
      const { logger, errors } = recordingLogger();
      const summary = await build(sender, logger).run();

      const row = await statusOf(failing);

      report(
        '8.1. A rejected send leaves the claim in place, so nothing ever retries it',
        row?.reminderEmailSentAt !== null,
        `claim ${String(row?.reminderEmailSentAt)}, summary failed=${summary.failed}`
      );
      report(
        '8.2. The failure is reported with the booking id and the outcome',
        errors.some((entry) => entry.context?.outcome === 'rejected'),
        errors.map((entry) => String(entry.context?.outcome)).join(', ') || 'no error logged'
      );
      report(
        '8.3. No recipient address or token reaches the log',
        !JSON.stringify(errors).includes(`${MARK}-a-client@example.com`) &&
          !JSON.stringify(errors).includes(`${MARK}-failing`),
        'checked every error line for the address and the cancellation token'
      );
    }

    // ===================================== 9. the claim writes one column only
    {
      const subject = await makeBooking(a, 'one-column', {});
      const before = await prisma.booking.findUnique({ where: { id: subject } });

      const repository = new PrismaBookingReminderRepository(prisma as never);
      await repository.claimDue({ ids: [subject], claimedAt: new Date() });

      const after = await prisma.booking.findUnique({ where: { id: subject } });

      const changed = Object.keys(before ?? {}).filter(
        (key) =>
          JSON.stringify((before as Record<string, unknown>)[key]) !==
          JSON.stringify((after as Record<string, unknown>)[key])
      );

      report(
        '9.1. The claim changes only the claim instant and the automatic timestamp',
        changed.sort().join(',') === 'reminderEmailSentAt,updatedAt',
        `changed: ${changed.sort().join(', ')}`
      );
    }

    // ==================================================== 10. the index
    //
    // Raw SQL in a migration: Prisma neither declares it nor reports its
    // absence as drift, so nothing else in this repository would ever notice.
    {
      const rows = await prisma.$queryRawUnsafe<{ indexdef: string }[]>(
        `SELECT indexdef FROM pg_indexes WHERE tablename = 'Booking' AND indexname = 'Booking_reminder_due'`
      );
      const definition = rows[0]?.indexdef ?? '';

      report(
        '10.1. The partial index exists with both predicate clauses',
        definition.includes("status = 'CONFIRMED'") &&
          definition.includes('"reminderEmailSentAt" IS NULL'),
        definition || 'the index is absent'
      );

      const CANDIDATE_QUERY =
        `SELECT "id", "startTime", "createdAt" FROM "Booking" ` +
        `WHERE "status" = 'CONFIRMED' AND "reminderEmailSentAt" IS NULL ` +
        `AND "startTime" > now() AND "startTime" < now() + interval '${REMINDER_LEAD_HOURS} hours' ` +
        `ORDER BY "startTime" ASC LIMIT 200`;

      const planText = (rows: { 'QUERY PLAN': string }[]) =>
        rows.map((line) => line['QUERY PLAN']).join(' | ');

      /**
       * **Forced, and B7's gate does the same for the same reason.**
       *
       * At this table size the planner is right to prefer a sequential scan —
       * descending an index to fetch two rows out of twenty-five costs more
       * than reading them. Asserting on the natural plan would therefore be
       * asserting on the row count of a development database, which is a test
       * that fails for a reason unrelated to the code and passes again when
       * somebody adds fixtures.
       *
       * What is worth asserting is the property of the INDEX: that it is
       * capable of serving this predicate. That is what changes if the index is
       * dropped, if its columns drift from the query, or if a clause is added
       * that its predicate cannot absorb — and it is true at every table size.
       */
      const forced = await prisma
        .$queryRawUnsafe<
          { 'QUERY PLAN': string }[]
        >(`SET LOCAL enable_seqscan = off; EXPLAIN ${CANDIDATE_QUERY}`)
        .then(planText)
        .catch(async () => {
          // `SET LOCAL` needs a transaction; some poolers reject the compound
          // statement outright. Fall back to a session-scoped setting.
          await prisma.$executeRawUnsafe('SET enable_seqscan = off');
          const rows = await prisma.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(
            `EXPLAIN ${CANDIDATE_QUERY}`
          );
          await prisma.$executeRawUnsafe('SET enable_seqscan = on');
          return planText(rows);
        });

      report(
        '10.2. The candidate predicate can be served by that index',
        forced.includes('Booking_reminder_due'),
        forced
      );

      const natural = await prisma
        .$queryRawUnsafe<{ 'QUERY PLAN': string }[]>(`EXPLAIN ${CANDIDATE_QUERY}`)
        .then(planText);

      observe(
        '10.3. What the planner chooses at this table size',
        `${natural.split('|')[0].trim()} — a sequential scan here is the planner being right, ` +
          'not the index being wrong; it flips on its own once the table is large enough for ' +
          'the index to be worth descending, which is the only condition under which this job ' +
          'is expensive in the first place'
      );
    }
  } finally {
    // Foreign-key order. Every booking FK is Restrict, so nothing cascades.
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
    report('11.1. The gate cleaned up after itself', leftover === 0, `${leftover} rows left behind`);

    await prisma.$disconnect();
  }

  console.log(failures === 0 ? '\nGATE PASSED\n' : `\nGATE FAILED (${failures})\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
