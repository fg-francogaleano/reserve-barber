// GATE B3 — availability against the live database.
//
// Three things no unit test can prove, each measured rather than assumed:
//
// 1. **Instants survive the new `@db.Timestamptz` columns.** `Booking.startTime`
//    is compared against a human's clock, and a silent three-hour drift looks
//    exactly like correct data in a market that is three hours from UTC.
// 2. **The expired-hold rule works on real rows.** B7 does not exist yet, so an
//    abandoned `PENDING_PAYMENT` booking must stop blocking on its own. No
//    interface in the product can create one — only this script can.
// 3. **The business calendar is the one being read.** Run between 21:00 and
//    23:59 local, the runtime's UTC date is already tomorrow, so a single
//    `getDate()` anywhere in the chain shows up here as the wrong day.
//
// Everything it creates is prefixed `__b3_gate__` and removed at the end, in
// foreign-key order — every booking FK is `Restrict`, so nothing cascades.
//
//   npx tsx scripts/b3-gate.ts
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma-cli/client';
import { PrismaBarberAvailabilityRepository } from '../src/server/infrastructure/prisma/PrismaBarberAvailabilityRepository';
import { generateSlots } from '../src/server/domain/models/availability';
import { blocksAvailability } from '../src/server/domain/models/Booking';
import {
  businessToday,
  dayBoundsOf,
  formatSlotTime,
  weekdayOfLocalDate,
  workingIntervalsFor,
} from '../src/server/domain/models/bookingCalendar';
import { instantToLocal, localToInstant } from '../src/server/domain/models/businessTime';

const MARK = '__b3_gate__';

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

async function main(): Promise<void> {
  const adapter = new PrismaPg({
    connectionString: requireEnv('DATABASE_URL'),
    max: 5,
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

  const inTheDangerWindow = localNow.minuteOfDay >= 21 * 60;
  report(
    'A. Running inside the 21:00–23:59 window where a UTC date is wrong',
    true,
    inTheDangerWindow
      ? 'yes — the runtime calendar has already rolled over, so this run is the strong one'
      : 'no — re-run this gate after 21:00 local at least once before archiving'
  );

  report(
    'B. Today is the business date, not the runtime date',
    today.day === localNow.day && today.year === localNow.year && today.month === localNow.month,
    `business ${today.day} vs runtime UTC ${now.getUTCDate()}`
  );

  // The day under test is tomorrow, so the lead time can never interfere.
  const testDate = {
    year: today.year,
    month: today.month,
    day: today.day,
  };
  const target = addOneDay(testDate);
  const weekday = weekdayOfLocalDate(target);
  const range = dayBoundsOf(target);

  report(
    'C. A local day is bounded by two local midnights',
    range.end.getTime() - range.start.getTime() === 24 * 3_600_000,
    `${range.start.toISOString()} → ${range.end.toISOString()}`
  );

  const createdIds: {
    location?: string;
    barber?: string;
    service?: string;
    client?: string;
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

    // A split shift, which the editor cannot write today (T27) but the schema
    // permits and the generator must honour: 09:00–13:00 and 16:00–20:00.
    await prisma.workingHours.createMany({
      data: [
        { barberId: barber.id, dayOfWeek: weekday, startMinute: 9 * 60, endMinute: 13 * 60 },
        { barberId: barber.id, dayOfWeek: weekday, startMinute: 16 * 60, endMinute: 20 * 60 },
      ],
    });

    // An absence from 10:00 to 11:00 local on the target day.
    await prisma.timeOff.create({
      data: {
        barberId: barber.id,
        startsAt: localToInstant({ ...target, minuteOfDay: 10 * 60 }),
        endsAt: localToInstant({ ...target, minuteOfDay: 11 * 60 }),
        reason: `${MARK} médico`,
      },
    });

    const client = await prisma.client.create({
      data: {
        ownerId: owner.id,
        name: `${MARK} cliente`,
        email: `${MARK}@example.com`,
        phone: '1122334455',
      },
      select: { id: true },
    });
    createdIds.client = client.id;

    const bookingAt = (minuteOfDay: number) => ({
      startTime: localToInstant({ ...target, minuteOfDay }),
      endTime: localToInstant({ ...target, minuteOfDay: minuteOfDay + 30 }),
    });

    await prisma.booking.createMany({
      data: [
        // 12:00 — confirmed, blocks.
        {
          ...bookingAt(12 * 60),
          clientId: client.id,
          barberId: barber.id,
          serviceId: service.id,
          status: 'CONFIRMED',
          priceAtBooking: '10000.00',
          depositAmount: '3000.00',
          cancellationToken: `${MARK}-confirmed`,
        },
        // 16:30 — a live hold, blocks.
        {
          ...bookingAt(16 * 60 + 30),
          clientId: client.id,
          barberId: barber.id,
          serviceId: service.id,
          status: 'PENDING_PAYMENT',
          holdExpiresAt: new Date(now.getTime() + 30 * 60_000),
          priceAtBooking: '10000.00',
          depositAmount: '3000.00',
          cancellationToken: `${MARK}-live-hold`,
        },
        // 17:30 — an abandoned checkout whose hold lapsed. Must NOT block.
        {
          ...bookingAt(17 * 60 + 30),
          clientId: client.id,
          barberId: barber.id,
          serviceId: service.id,
          status: 'PENDING_PAYMENT',
          holdExpiresAt: new Date(now.getTime() - 60 * 60_000),
          priceAtBooking: '10000.00',
          depositAmount: '3000.00',
          cancellationToken: `${MARK}-stale-hold`,
        },
        // 18:30 — cancelled. Must NOT block.
        {
          ...bookingAt(18 * 60 + 30),
          clientId: client.id,
          barberId: barber.id,
          serviceId: service.id,
          status: 'CANCELLED',
          priceAtBooking: '10000.00',
          depositAmount: '3000.00',
          cancellationToken: `${MARK}-cancelled`,
        },
      ],
    });

    // ── 2. Instants survive the round trip ────────────────────────────────
    const stored = await prisma.booking.findFirst({
      where: { cancellationToken: `${MARK}-confirmed` },
      select: { startTime: true, endTime: true, holdExpiresAt: true, priceAtBooking: true },
    });
    const expectedStart = localToInstant({ ...target, minuteOfDay: 12 * 60 });

    report(
      'D. An appointment instant survives storage without drifting',
      stored?.startTime.getTime() === expectedStart.getTime(),
      `wrote ${expectedStart.toISOString()}, read ${stored?.startTime.toISOString()}`
    );

    report(
      'E. It reads back as 12:00 on the business clock',
      stored !== null && formatSlotTime(stored.startTime) === '12:00',
      `${stored === null ? 'no row' : formatSlotTime(stored.startTime)}`
    );

    // ── 3. Availability, through the real repository ──────────────────────
    const started = Date.now();
    const repository = new PrismaBarberAvailabilityRepository(prisma as never);
    const inputs = await repository.findDayInputs(barber.id, owner.id, weekday, range);
    const readMs = Date.now() - started;

    report(
      'F. The composed read returns all three inputs in one round trip',
      inputs.windows.length === 2 && inputs.absences.length === 1 && inputs.bookings.length === 3,
      `${inputs.windows.length} windows, ${inputs.absences.length} absences, ` +
        `${inputs.bookings.length} bookings (cancelled excluded) in ${readMs} ms`
    );

    report(
      'G. The absence projection carries no reason',
      inputs.absences.every((absence) => !('reason' in absence)),
      'no reason field on any returned absence'
    );

    const blocked = inputs.bookings
      .filter((booking) => blocksAvailability(booking, now))
      .map((booking) => ({ start: booking.startTime, end: booking.endTime }));

    report(
      'H. The lapsed hold does not block, the live one does',
      blocked.length === 2,
      `${blocked.length} of ${inputs.bookings.length} fetched bookings block`
    );

    const slots = generateSlots({
      windows: workingIntervalsFor(target, inputs.windows),
      blockers: [...inputs.absences, ...blocked],
      durationMinutes: 30,
      now,
      minLeadMinutes: 60,
    }).map(formatSlotTime);

    report(
      'I. The split shift is honoured — nothing is sold during the break',
      slots.includes('12:30') && !slots.includes('13:00') && !slots.includes('14:00'),
      '12:30 offered, 13:00 and 14:00 absent'
    );

    report(
      'J. The absence is subtracted, and its end instant is bookable',
      !slots.includes('10:00') && !slots.includes('10:30') && slots.includes('11:00'),
      '10:00 and 10:30 absent, 11:00 offered'
    );

    report(
      'K. The confirmed booking is subtracted',
      !slots.includes('12:00'),
      '12:00 absent'
    );

    report(
      'L. The slot behind the abandoned checkout is back on sale',
      slots.includes('17:30'),
      '17:30 offered — B7 does not exist yet and the slot is not lost'
    );

    report(
      'M. The cancelled booking frees its slot',
      slots.includes('18:30'),
      '18:30 offered'
    );

    console.log(`\n     ${slots.length} slots: ${slots.slice(0, 8).join(' ')} …\n`);
  } finally {
    // Foreign-key order. Every booking FK is Restrict, so nothing cascades and
    // the order is the guarantee rather than a convenience.
    await prisma.booking.deleteMany({ where: { cancellationToken: { startsWith: MARK } } });
    if (createdIds.client) await prisma.client.delete({ where: { id: createdIds.client } });
    if (createdIds.barber) {
      await prisma.timeOff.deleteMany({ where: { barberId: createdIds.barber } });
      await prisma.workingHours.deleteMany({ where: { barberId: createdIds.barber } });
      await prisma.barberService.deleteMany({ where: { barberId: createdIds.barber } });
      await prisma.barber.delete({ where: { id: createdIds.barber } });
    }
    if (createdIds.service) await prisma.service.delete({ where: { id: createdIds.service } });
    if (createdIds.location) await prisma.location.delete({ where: { id: createdIds.location } });

    const leftover = await prisma.booking.count({
      where: { cancellationToken: { startsWith: MARK } },
    });
    report('N. The gate cleaned up after itself', leftover === 0, `${leftover} rows left behind`);

    await prisma.$disconnect();
  }

  console.log(failures === 0 ? '\nGATE PASSED\n' : `\nGATE FAILED (${failures})\n`);
  process.exit(failures === 0 ? 0 : 1);
}

function addOneDay(date: { year: number; month: number; day: number }) {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + 1));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
