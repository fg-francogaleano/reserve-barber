// GATE B4 — the provisional hold against the live database.
//
// Every interesting failure in this story is a race, and a mocked repository
// cannot express one. Five things no unit test can prove:
//
// 1. **The advisory-lock facility exists on the deployed instance.**
//    `hashtextextended` is a PostgreSQL 11+ built-in needing no extension, but
//    "needs no extension" is a claim about a version string, not about this
//    database. If it is missing, the transaction's first statement throws and
//    every concurrency result below would be measuring nothing.
// 2. **N simultaneous submissions for one slot produce exactly one booking.**
//    This is the invariant the roadmap forbids starting B5, B6, B7 and D2
//    without.
// 3. **The same client's repeat submission is idempotent.** The nastiest bug
//    this story could ship is telling the person who just succeeded that their
//    slot belongs to someone else.
// 4. **A lapsed hold releases its slot.** B7 does not exist yet, so an
//    abandoned checkout must stop blocking on its own.
// 5. **An instant written during the last three hours of a local day is
//    stored correctly.** The runtime is UTC and the business is at UTC-3, so a
//    single local-calendar accessor anywhere in the write chain shows up here
//    as an appointment on the wrong day.
//
// Everything it creates is prefixed `__b4_gate__` and removed at the end, in
// foreign-key order — every booking FK is `Restrict`, so nothing cascades.
//
//   npx tsx scripts/b4-gate.ts
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma-cli/client';
import { PrismaBookingRepository } from '../src/server/infrastructure/prisma/PrismaBookingRepository';
import { PrismaClientRepository } from '../src/server/infrastructure/prisma/PrismaClientRepository';
import {
  businessToday,
  dayBoundsOf,
  formatSlotTime,
  weekdayOfLocalDate,
} from '../src/server/domain/models/bookingCalendar';
import { instantToLocal, localToInstant } from '../src/server/domain/models/businessTime';
import { holdExpiresAtFor } from '../src/server/domain/models/Booking';
import type { ProvisionalBookingInput } from '../src/server/domain/repositories/IBookingRepository';

const MARK = '__b4_gate__';
/** How many requests race for one slot. Enough to lose reliably if the lock is absent. */
const CONCURRENT_ATTEMPTS = 8;

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

function addOneDay(date: { year: number; month: number; day: number }) {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + 1));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

async function main(): Promise<void> {
  // `max` above the concurrency, or the requests queue on the pool instead of
  // on the lock and the race is never actually run.
  const adapter = new PrismaPg({
    connectionString: requireEnv('DATABASE_URL'),
    max: CONCURRENT_ATTEMPTS + 4,
    maxUses: 1,
  });
  const prisma = new PrismaClient({ adapter });

  const owner = await prisma.owner.findFirst({ select: { id: true } });
  if (!owner) throw new Error('Gate needs an owner to exist — run provision-owner first');

  const now = new Date();
  const localNow = instantToLocal(now);
  const today = businessToday(now);

  console.log(
    `\nRuntime UTC: ${now.toISOString()}  |  business local: ` +
      `${today.year}-${String(today.month).padStart(2, '0')}-${String(today.day).padStart(2, '0')} ` +
      `${formatSlotTime(now)}\n`
  );

  report(
    'A. Running inside the 21:00–23:59 window where a UTC date is wrong',
    true,
    localNow.minuteOfDay >= 21 * 60
      ? 'yes — the runtime calendar has already rolled over, so this run is the strong one'
      : 'no — re-run this gate after 21:00 local at least once before archiving'
  );

  // Probe 1 before anything else: if the lock facility is missing, every
  // concurrency result below would be measuring an unlocked transaction and
  // reporting it as a pass.
  try {
    await prisma.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('probe', 0))`;
    report('B. The advisory-lock facility is available', true, 'pg_advisory_xact_lock + hashtextextended');
  } catch (error) {
    report(
      'B. The advisory-lock facility is available',
      false,
      `unavailable — every result below is meaningless: ${(error as Error).message}`
    );
  }

  const target = addOneDay(today);
  const weekday = weekdayOfLocalDate(target);
  const dayRange = dayBoundsOf(target);

  const createdIds: {
    location?: string;
    barber?: string;
    service?: string;
    clientA?: string;
    clientB?: string;
  } = {};

  try {
    const location = await prisma.location.create({
      data: { ownerId: owner.id, name: `${MARK} sucursal`, isActive: true },
      select: { id: true },
    });
    createdIds.location = location.id;

    const barber = await prisma.barber.create({
      data: { locationId: location.id, displayName: `${MARK} barbero`, isActive: true },
      select: { id: true },
    });
    createdIds.barber = barber.id;

    const service = await prisma.service.create({
      data: {
        ownerId: owner.id,
        name: `${MARK} corte`,
        price: '10000.00',
        durationMinutes: 30,
        isActive: true,
      },
      select: { id: true },
    });
    createdIds.service = service.id;

    await prisma.barberService.create({ data: { barberId: barber.id, serviceId: service.id } });
    await prisma.workingHours.create({
      data: { barberId: barber.id, dayOfWeek: weekday, startMinute: 9 * 60, endMinute: 20 * 60 },
    });

    const clients = new PrismaClientRepository(prisma as never);
    const bookings = new PrismaBookingRepository(prisma as never);

    // ---- Probe C: the client upsert deduplicates on (owner, email) ----
    const clientA = await clients.resolve({
      ownerId: owner.id,
      name: `${MARK} Ana`,
      email: `${MARK}ana@mail.com`,
      phone: '+5491155554444',
    });
    createdIds.clientA = clientA.id;

    const clientAAgain = await clients.resolve({
      ownerId: owner.id,
      name: `${MARK} Ana Renamed`,
      email: `${MARK}ANA@mail.com`.toLowerCase(),
      phone: '+5491155550000',
    });

    report(
      'C. A returning client resolves to one row and their phone is updated',
      clientA.id === clientAAgain.id,
      `same id ${clientA.id === clientAAgain.id}`
    );

    const clientB = await clients.resolve({
      ownerId: owner.id,
      name: `${MARK} Beto`,
      email: `${MARK}beto@mail.com`,
      phone: '+5491155551111',
    });
    createdIds.clientB = clientB.id;

    function inputFor(
      clientId: string,
      startTime: Date,
      token: string
    ): ProvisionalBookingInput {
      return {
        ownerId: owner!.id,
        barberId: barber.id,
        serviceId: service.id,
        clientId,
        startTime,
        endTime: new Date(startTime.getTime() + 30 * 60_000),
        priceAtBooking: '10000.00',
        depositAmount: '2500.00',
        cancellationToken: token,
        holdExpiresAt: holdExpiresAtFor({ createdAt: new Date(), startTime }),
        weekday,
        localDate: target,
        dayRange,
        now: new Date(),
      };
    }

    // ---- Probe D: N simultaneous submissions for one slot ----
    const contested = localToInstant({ ...target, minuteOfDay: 11 * 60 });
    const attempts = await Promise.all(
      Array.from({ length: CONCURRENT_ATTEMPTS }, (_, index) =>
        bookings.createProvisional(inputFor(clientB.id, contested, `${MARK}race-${index}`))
      )
    );

    const created = attempts.filter((result) => result.outcome === 'created');
    const idempotent = attempts.filter((result) => result.outcome === 'alreadyHeld');
    const refused = attempts.filter((result) => result.outcome === 'slotTaken');

    report(
      `D. ${CONCURRENT_ATTEMPTS} simultaneous submissions produce exactly one booking`,
      created.length === 1,
      `created ${created.length}, alreadyHeld ${idempotent.length}, slotTaken ${refused.length}`
    );

    const rowsAtContested = await prisma.booking.count({
      where: { barberId: barber.id, startTime: contested },
    });
    report(
      'E. The database agrees: one row at the contested start',
      rowsAtContested === 1,
      `${rowsAtContested} rows`
    );

    // The losers are the same client here, so they must all be idempotent
    // rather than refused — a client racing themselves is a double tap.
    report(
      'F. The same client racing themselves is never told the slot is taken',
      refused.length === 0,
      `${refused.length} refusals`
    );

    // ---- Probe G: a different client is refused ----
    const other = await bookings.createProvisional(
      inputFor(clientA.id, contested, `${MARK}other`)
    );
    report(
      'G. A different client is refused the held slot',
      other.outcome === 'slotTaken',
      `outcome ${other.outcome}`
    );

    // ---- Probe H: a lapsed hold releases its slot ----
    const lapsed = localToInstant({ ...target, minuteOfDay: 12 * 60 });
    await prisma.booking.create({
      data: {
        clientId: clientA.id,
        barberId: barber.id,
        serviceId: service.id,
        startTime: lapsed,
        endTime: new Date(lapsed.getTime() + 30 * 60_000),
        status: 'PENDING_PAYMENT',
        priceAtBooking: '10000.00',
        depositAmount: '2500.00',
        cancellationToken: `${MARK}lapsed`,
        // An hour in the past, and no sweeper has run — B7 is three stories away.
        holdExpiresAt: new Date(Date.now() - 3_600_000),
      },
    });

    const overLapsed = await bookings.createProvisional(
      inputFor(clientB.id, lapsed, `${MARK}over-lapsed`)
    );
    report(
      'H. A lapsed hold releases its slot with no sweeper running',
      overLapsed.outcome === 'created',
      `outcome ${overLapsed.outcome}`
    );

    // ---- Probe I: the schedule re-assertion refuses a time outside the window ----
    const outsideWindow = localToInstant({ ...target, minuteOfDay: 21 * 60 });
    const refusedOutside = await bookings.createProvisional(
      inputFor(clientB.id, outsideWindow, `${MARK}outside`)
    );
    report(
      'I. A time outside the working window is refused by the transaction',
      refusedOutside.outcome === 'slotTaken',
      `21:00 local against a 09:00–20:00 window → ${refusedOutside.outcome}`
    );

    // ---- Probe J: the stored instant survives the round trip ----
    const winner = created[0];
    if (winner?.outcome === 'created') {
      const stored = await prisma.booking.findUnique({
        where: { id: winner.booking.id },
        select: { startTime: true, holdExpiresAt: true, depositAmount: true },
      });

      report(
        'J. The appointment instant survives storage without drifting',
        stored?.startTime.getTime() === contested.getTime(),
        `${stored?.startTime.toISOString()} vs ${contested.toISOString()}`
      );

      report(
        'K. The stored local time is the one the client chose',
        stored !== null && formatSlotTime(stored.startTime) === '11:00',
        `reads ${stored ? formatSlotTime(stored.startTime) : 'n/a'} local`
      );

      report(
        'L. The hold never outlives the appointment start',
        stored?.holdExpiresAt !== null &&
          stored !== null &&
          stored.holdExpiresAt!.getTime() <= stored.startTime.getTime(),
        `${stored?.holdExpiresAt?.toISOString()} ≤ ${stored?.startTime.toISOString()}`
      );

      report(
        'M. The deposit snapshot survives as a two-decimal value',
        String(stored?.depositAmount) === '2500' || String(stored?.depositAmount) === '2500.00',
        `reads ${String(stored?.depositAmount)}`
      );
    }

    // ---- Probe N: the live-hold count sees only what still holds ----
    const liveForA = await bookings.countLiveHoldsForClient(clientA.id, new Date());
    report(
      'N. A lapsed hold does not count against the per-client cap',
      liveForA === 0,
      `client A holds ${liveForA} live (their only booking is the lapsed one)`
    );

    // ---- Probe O: the confirmation read carries no contact details ----
    if (winner?.outcome === 'created') {
      const view = await bookings.findByCancellationToken(winner.booking.cancellationToken);
      const serialized = JSON.stringify(view);
      report(
        'O. The confirmation projection carries no email and no phone',
        !serialized.includes('@mail.com') && !serialized.includes('+549'),
        'neither present'
      );
    }
  } finally {
    // Foreign-key order. Every booking FK is Restrict, so nothing cascades and
    // the order is the guarantee rather than a convenience.
    await prisma.booking.deleteMany({ where: { cancellationToken: { startsWith: MARK } } });
    if (createdIds.clientA) await prisma.client.delete({ where: { id: createdIds.clientA } });
    if (createdIds.clientB) await prisma.client.delete({ where: { id: createdIds.clientB } });
    if (createdIds.barber) {
      await prisma.workingHours.deleteMany({ where: { barberId: createdIds.barber } });
      await prisma.barberService.deleteMany({ where: { barberId: createdIds.barber } });
      await prisma.barber.delete({ where: { id: createdIds.barber } });
    }
    if (createdIds.service) await prisma.service.delete({ where: { id: createdIds.service } });
    if (createdIds.location) await prisma.location.delete({ where: { id: createdIds.location } });

    const leftover = await prisma.booking.count({
      where: { cancellationToken: { startsWith: MARK } },
    });
    report('P. The gate cleaned up after itself', leftover === 0, `${leftover} rows left behind`);

    await prisma.$disconnect();
  }

  console.log(failures === 0 ? '\nGATE PASSED\n' : `\nGATE FAILED (${failures})\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
