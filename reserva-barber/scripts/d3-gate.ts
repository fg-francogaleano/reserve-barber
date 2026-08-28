// GATE D3 — the per-barber calendar against the live database.
//
// What a mock cannot certify here (T58), and why each one is worth a real row:
//
//   1. **Cross-owner isolation.** There is no row-level security on these
//      tables — the `barber → location → ownerId` join is the entire tenancy
//      boundary. A leaked calendar produces no row that can look wrong, only a
//      plausible day, which makes it the worst possible place to rely on a
//      reviewer noticing. Section 2 holds it with a two-owner fixture, in both
//      directions.
//
//   2. **The overlap predicates.** `startTime IN [day)` is the filter one writes
//      without thinking, and it silently drops an appointment that crosses
//      midnight from the second of its two days and a multi-day absence from its
//      middle. Sections 4 and 5 seed exactly those rows and read the days on
//      either side. A unit test over a mocked client asserts the *shape* of the
//      predicate; only this asserts what PostgreSQL returns for it.
//
//   3. **The stranded appointment (T29).** Section 6 does not assert the badge
//      against a fixture that was told the answer — it books an appointment
//      inside a working window and then **narrows the window underneath it**,
//      which is the exact sequence the debt entry describes, and reads the day
//      back through the real repository.
//
//   4. **One round trip.** Section 7 counts the queries the driver actually
//      issued, because "one query" is a claim about a Prisma call that nests
//      four selections, and nesting is precisely what silently becomes several.
//
//   5. **The composed day end to end.** Free time, the two lanes, and the
//      presence of a lapsed hold are pure functions — but they are fed by a
//      projection this gate is the only thing to exercise against real columns
//      (`Decimal`, `Timestamptz`, two enums).
//
// Everything it creates is prefixed `__d3_gate__` and removed at the end in
// foreign-key order. Every booking FK is `Restrict`, so nothing cascades and the
// order is the guarantee rather than a convenience.
//
// It needs no owner sign-in: nothing here touches storage or a session. Only
// DATABASE_URL, which `.env` already provides.
//
//   npx tsx scripts/d3-gate.ts
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma-cli/client';
import { PrismaBarberCalendarRepository } from '../src/server/infrastructure/prisma/PrismaBarberCalendarRepository';
import { BarberCalendarService } from '../src/server/application/services/BarberCalendarService';
import {
  addDays,
  businessToday,
  dayBoundsOf,
  formatLocalDate,
  weekdayOfLocalDate,
  type LocalDate,
} from '../src/server/domain/models/bookingCalendar';
import { localToInstant } from '../src/server/domain/models/businessTime';
import { systemClock } from '../src/server/domain/repositories/IClock';

const MARK = '__d3_gate__';
const MINUTE = 60_000;

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

/** An observation. Reported, never counted as a failure. */
function observe(probe: string, detail: string): void {
  console.log(`OBSERVED  ${probe} — ${detail}`);
}

/**
 * Runs a probe and reports an environment fault as one rather than as a product
 * result.
 *
 * **T68**, and this gate is the one that entry named: on a network path with a
 * broken path MTU, any response above roughly 1.4 KB never arrives — a single
 * 1400-byte value reproduces it with no table involved. Confirmed again while
 * writing this gate: `repeat('x', 1000)` returns in 59 ms and
 * `repeat('x', 1400)` never returns.
 *
 * The fixture below is deliberately small — short names, few bookings — so that
 * as many probes as possible fit under the ceiling and actually run. What must
 * never happen is the opposite of a failure: an environment fault reported as a
 * passing product. A skipped probe is announced as **not run**, and the count
 * is repeated in the final line so it cannot be missed.
 */
async function probeOrSkip(probe: string, run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('timeout') || message.includes('Timed out')) {
      skipped += 1;
      observe(
        probe,
        `NOT RUN — the response never arrived (${message}). This is T68, the local network's ` +
          'path-MTU fault, not a result about the product. Confirm with ' +
          "`SELECT repeat('x', 1400)`, which fails on an affected machine with no table involved."
      );
      return;
    }
    throw error;
  }
}

/**
 * Removes everything this gate has ever created, keyed on the mark alone.
 *
 * Run at the start as well as at the end, for D1's reason: a run interrupted
 * between its first insert and its cleanup leaves an `Owner` behind whose email
 * is unique, so the next run dies on that constraint before reaching a single
 * assertion.
 */
async function removeMarkedRows(prisma: PrismaClient): Promise<void> {
  await prisma.booking.deleteMany({ where: { cancellationToken: { startsWith: MARK } } });
  await prisma.timeOff.deleteMany({
    where: { barber: { location: { owner: { email: { startsWith: MARK } } } } },
  });
  await prisma.workingHours.deleteMany({
    where: { barber: { location: { owner: { email: { startsWith: MARK } } } } },
  });
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

  const repository = new PrismaBarberCalendarRepository(prisma as never);
  const service = new BarberCalendarService(repository, systemClock);

  await removeMarkedRows(prisma);

  try {
    // ─── 1. Fixture ──────────────────────────────────────────────────────────
    //
    // Two owners, so isolation is a property of the data rather than of a
    // reviewer's attention. Names are short on purpose: every byte counts
    // against T68's ceiling, and a projection this narrow is exactly what gives
    // the probes below a chance of returning at all.

    const today = businessToday(new Date());
    // A fixed offset from today rather than a fixed date, so the weekday
    // schedule is deterministic without the gate depending on when it is run —
    // and far enough ahead that it cannot collide with a real appointment.
    const day = addDays(today, ((9 - weekdayOfLocalDate(today)) % 7) + 1);
    const weekday = weekdayOfLocalDate(day);

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
      const svc = await prisma.service.create({
        data: {
          ownerId: owner.id,
          name: `S${suffix}`,
          price: '10000.00',
          durationMinutes: 30,
        },
        select: { id: true },
      });
      const client = await prisma.client.create({
        data: {
          ownerId: owner.id,
          name: `C${suffix}`,
          email: `${MARK}-${suffix}-c@e.com`,
          phone: '+541100000000',
        },
        select: { id: true },
      });
      return { owner, location, barber, service: svc, client };
    }

    const a = await makeOwner('a');
    const b = await makeOwner('b');

    /** A local wall-clock time on the fixture day, as an instant. */
    function atLocal(date: LocalDate, hour: number, minute = 0): Date {
      return localToInstant({ ...date, minuteOfDay: hour * 60 + minute });
    }

    async function makeBooking(
      fixture: typeof a,
      token: string,
      row: {
        start: Date;
        endMinutes?: number;
        status?: 'PENDING_PAYMENT' | 'PENDING_APPROVAL' | 'CONFIRMED' | 'CANCELLED' | 'EXPIRED';
        holdExpiresAt?: Date | null;
      }
    ): Promise<string> {
      const status = row.status ?? 'CONFIRMED';
      const booking = await prisma.booking.create({
        data: {
          clientId: fixture.client.id,
          barberId: fixture.barber.id,
          serviceId: fixture.service.id,
          startTime: row.start,
          endTime: new Date(row.start.getTime() + (row.endMinutes ?? 30) * MINUTE),
          status: status as never,
          priceAtBooking: '10000.00',
          depositAmount: '3000.00',
          cancellationToken: `${MARK}-${token}`,
          // The check constraint requires a PENDING_PAYMENT row to carry one.
          holdExpiresAt:
            row.holdExpiresAt === undefined
              ? status === 'PENDING_PAYMENT'
                ? new Date(Date.now() + 30 * MINUTE)
                : null
              : row.holdExpiresAt,
          cancelledAt: status === 'CANCELLED' ? new Date() : null,
          cancelledBy: status === 'CANCELLED' ? 'CLIENT' : null,
        },
        select: { id: true },
      });
      return booking.id;
    }

    // Owner A's barber works 09:00–13:00 and 16:00–20:00 on the fixture
    // weekday: a **split shift**, which the editor cannot write today (T27) and
    // the schema has always permitted.
    await prisma.workingHours.createMany({
      data: [
        { barberId: a.barber.id, dayOfWeek: weekday, startMinute: 9 * 60, endMinute: 13 * 60 },
        { barberId: a.barber.id, dayOfWeek: weekday, startMinute: 16 * 60, endMinute: 20 * 60 },
      ],
    });

    report(
      '1.1. Fixture built',
      true,
      `two owners, one barber each, split shift on ${formatLocalDate(day)} (weekday ${weekday})`
    );

    // ─── 2. Cross-owner isolation ────────────────────────────────────────────

    await probeOrSkip('2.x', async () => {
      const mine = await repository.findDay({
        barberId: a.barber.id,
        ownerId: a.owner.id,
        weekday,
        range: dayBoundsOf(day),
      });
      report('2.1. An owner reads their own barber', mine !== null, `${mine?.barber.displayName}`);

      const foreign = await repository.findDay({
        barberId: b.barber.id,
        ownerId: a.owner.id,
        weekday,
        range: dayBoundsOf(day),
      });
      report(
        "2.2. Owner A cannot read owner B's barber",
        foreign === null,
        foreign === null ? 'null' : 'LEAKED'
      );

      const reverse = await repository.findDay({
        barberId: a.barber.id,
        ownerId: b.owner.id,
        weekday,
        range: dayBoundsOf(day),
      });
      report(
        '2.3. And not the other way round either',
        reverse === null,
        reverse === null ? 'null' : 'LEAKED'
      );

      const unknown = await repository.findDay({
        barberId: 'ckzzzzzzzzzzzzzzzzzzzzzzz',
        ownerId: a.owner.id,
        weekday,
        range: dayBoundsOf(day),
      });
      report(
        '2.4. An unknown id is indistinguishable from a foreign one',
        unknown === null && foreign === null,
        'both null'
      );
    });

    // ─── 3. The split shift and its free time ────────────────────────────────

    await probeOrSkip('3.x', async () => {
      const view = await service.dayFor({
        barberId: a.barber.id,
        ownerId: a.owner.id,
        date: day,
      });

      report(
        '3.1. Both windows of a split shift are returned',
        view?.day.workingIntervals.length === 2,
        `${view?.day.workingIntervals.length} windows`
      );
      report(
        '3.2. Free time is offered inside each window, not across the gap',
        view?.day.freeIntervals.length === 2,
        (view?.day.freeIntervals ?? [])
          .map((i) => `${i.start.toISOString()}→${i.end.toISOString()}`)
          .join(' ')
      );
    });

    // ─── 4. A three-day absence, read on its middle day ──────────────────────

    await probeOrSkip('4.x', async () => {
      await prisma.timeOff.create({
        data: {
          barberId: a.barber.id,
          startsAt: atLocal(addDays(day, -1), 10),
          endsAt: atLocal(addDays(day, 1), 18),
          reason: `${MARK} vacaciones`,
        },
      });

      const view = await service.dayFor({ barberId: a.barber.id, ownerId: a.owner.id, date: day });

      report(
        '4.1. A multi-day absence is present on its middle day',
        (view?.day.absences.length ?? 0) === 1,
        `${view?.day.absences.length} absences`
      );
      report(
        '4.2. It removes every free interval it covers',
        view?.day.freeIntervals.length === 0,
        `${view?.day.freeIntervals.length} free intervals left`
      );
      // **The defect the adversarial pass found**, against a real three-day row:
      // described from its two instants, this absence rendered as "10:00 a
      // 18:00" — eight hours on a day the barber is away for all of.
      report(
        '4.3. And it is described as covering the whole day, not as a range',
        view?.day.absences[0]?.kind === 'wholeDay',
        `kind = ${view?.day.absences[0]?.kind}`
      );
      report(
        '4.4. No instant from another date leaks into the day',
        JSON.stringify(view?.day.absences).includes('T') === false,
        'the whole-day form carries no instant at all'
      );

      // The projection is the guarantee, and it lives on the repository — so it
      // is asserted there rather than on a composed view that may have dropped
      // the fields anyway.
      const raw = await repository.findDay({
        barberId: a.barber.id,
        ownerId: a.owner.id,
        weekday,
        range: dayBoundsOf(day),
      });
      report(
        '4.5. The absence carries no reason across the repository boundary',
        !JSON.stringify(raw?.absences).includes('vacaciones'),
        'no reason in the projection'
      );

      await prisma.timeOff.deleteMany({ where: { barberId: a.barber.id } });
    });

    // ─── 5. An appointment crossing midnight ─────────────────────────────────

    await probeOrSkip('5.x', async () => {
      // 23:45 → 00:15, so it belongs to two calendar days.
      await makeBooking(a, 'midnight', { start: atLocal(day, 23, 45), endMinutes: 30 });

      const first = await service.dayFor({ barberId: a.barber.id, ownerId: a.owner.id, date: day });
      const second = await service.dayFor({
        barberId: a.barber.id,
        ownerId: a.owner.id,
        date: addDays(day, 1),
      });

      const onFirst = [...(first?.day.occupying ?? []), ...(first?.day.recorded ?? [])];
      const onSecond = [...(second?.day.occupying ?? []), ...(second?.day.recorded ?? [])];

      report(
        '5.1. It appears on the day it starts',
        onFirst.length === 1,
        `${onFirst.length} appointments`
      );
      report(
        '5.2. And on the day it ends',
        onSecond.length === 1,
        `${onSecond.length} appointments — a start-only filter returns 0 here`
      );

      await prisma.booking.deleteMany({ where: { cancellationToken: `${MARK}-midnight` } });
    });

    // ─── 6. The lanes, and a schedule narrowed under a booking (T29) ─────────

    await probeOrSkip('6.x', async () => {
      // Inside the morning window.
      await makeBooking(a, 'confirmed', { start: atLocal(day, 10) });
      // A hold whose deadline has already passed and which no sweep has
      // collected: the slot is back on sale, so it must not occupy the day.
      await makeBooking(a, 'lapsed', {
        start: atLocal(day, 11),
        status: 'PENDING_PAYMENT',
        holdExpiresAt: new Date(Date.now() - 60 * MINUTE),
      });
      // Cancelled at the same time as the confirmed one: the ordinary state of
      // any shop that has had a cancellation, and the reason for two lanes.
      await makeBooking(a, 'cancelled', { start: atLocal(day, 10), status: 'CANCELLED' });

      const before = await service.dayFor({
        barberId: a.barber.id,
        ownerId: a.owner.id,
        date: day,
      });

      report(
        '6.1. Only the confirmed appointment occupies the timeline',
        before?.day.occupying.length === 1,
        `${before?.day.occupying.length} occupying, ${before?.day.recorded.length} recorded`
      );
      report(
        '6.2. A lapsed hold and a cancellation are recorded, not drawn in the day',
        before?.day.recorded.length === 2,
        (before?.day.recorded ?? []).map((entry) => entry.presence).join(', ')
      );
      report(
        '6.3. Nothing is stranded while the schedule still contains it',
        before?.day.occupying.every((entry) => !entry.outsideWorkingHours) === true,
        'no badge'
      );
      report(
        '6.4. The client and service names arrive flattened',
        before?.day.occupying[0]?.appointment.clientName === 'Ca' &&
          before?.day.occupying[0]?.appointment.serviceName === 'Sa',
        `${before?.day.occupying[0]?.appointment.clientName} / ${before?.day.occupying[0]?.appointment.serviceName}`
      );
      report(
        '6.5. A cancellation carries its actor across the boundary',
        before?.day.recorded.some((entry) => entry.appointment.cancelledBy === 'CLIENT') === true,
        'CLIENT reached the domain'
      );

      // **Now narrow the morning window underneath the booking** — the exact
      // sequence T29 describes, performed rather than simulated.
      await prisma.workingHours.updateMany({
        where: { barberId: a.barber.id, dayOfWeek: weekday, startMinute: 9 * 60 },
        data: { endMinute: 9 * 60 + 30 },
      });

      const after = await service.dayFor({ barberId: a.barber.id, ownerId: a.owner.id, date: day });

      report(
        '6.6. The stranded appointment is still rendered',
        after?.day.occupying.length === 1,
        `${after?.day.occupying.length} occupying`
      );
      report(
        '6.7. And it is now flagged as outside working hours',
        after?.day.occupying[0]?.outsideWorkingHours === true,
        'badge raised by a real schedule edit'
      );
      report(
        '6.8. The free time follows the narrowed window',
        after?.day.freeIntervals.some(
          (interval) => interval.end.getTime() === atLocal(day, 9, 30).getTime()
        ) === true,
        (after?.day.freeIntervals ?? []).map((i) => i.end.toISOString()).join(' ')
      );
    });

    // ─── 7. One round trip ───────────────────────────────────────────────────

    await probeOrSkip('7.x', async () => {
      let queries = 0;
      const counting = new PrismaClient({ adapter }).$extends({
        query: {
          $allOperations({ args, query }) {
            queries += 1;
            return query(args);
          },
        },
      });

      const counted = new PrismaBarberCalendarRepository(counting as never);
      await counted.findDay({
        barberId: a.barber.id,
        ownerId: a.owner.id,
        weekday,
        range: dayBoundsOf(day),
      });

      report(
        '7.1. The whole day costs one query',
        queries === 1,
        `${queries} — the barber, the windows, the absences and the appointments`
      );

      await (counting as unknown as PrismaClient).$disconnect();
    });

    // ─── 8. Cost ─────────────────────────────────────────────────────────────

    await probeOrSkip('8.x', async () => {
      const started = Date.now();
      await repository.findDay({
        barberId: a.barber.id,
        ownerId: a.owner.id,
        weekday,
        range: dayBoundsOf(day),
      });
      observe('8.1. Wall-clock cost of the page read', `${Date.now() - started} ms`);
    });
  } finally {
    await removeMarkedRows(prisma);

    const leftover = await prisma.booking.count({
      where: { cancellationToken: { startsWith: MARK } },
    });
    report('9.1. The gate cleaned up after itself', leftover === 0, `${leftover} rows left behind`);

    await prisma.$disconnect();
  }

  if (skipped > 0) {
    console.log(
      `\n${skipped} probe group(s) NOT RUN — T68, the local path-MTU fault. ` +
        'They are not results about the product and must not be read as passing.'
    );
  }
  console.log(failures === 0 ? '\nGATE PASSED\n' : `\nGATE FAILED (${failures})\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
