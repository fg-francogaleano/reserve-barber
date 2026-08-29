// D7 runtime fixture — seeds the breakdown states the owner's real data does
// not have, so the authenticated runtime pass has every branch to look at, then
// removes them.
//
// The real shop's history is too thin for these three sections to show their own
// states: one barber, a short catalogue and a handful of appointments draws a
// ranking of one and an hour axis with a single column, which exercises neither
// the fold, nor the disambiguation, nor the hour distribution the story exists
// for. What follows is built so each period exercises a different branch:
//
//   semana  — **twelve services past a cap of eight**, so the fold and its
//             `Otros` row are visible; **two barbers sharing a display name at
//             two branches**, which is the one case the ranking cannot render
//             without its location; and appointments spread across nine hours
//             of the day including **21:30**, which is the hour a runtime
//             reading its own clock would put in the next day.
//   hoy     — a handful of appointments in three hours, so the single-day copy
//             and a sparse 24-hour axis are both on screen.
//   mes     — inherits the week's rows plus a second barber, so the barber
//             ranking is a real ranking rather than a sentence.
//
// `ayer`, `semana-anterior` and `mes-anterior` are left to the real data, so the
// pass also sees the sections over rows this script did not write — including,
// most likely, the empty and degenerate states.
//
// **A second location and a second barber are created and removed** with the
// fixture. They are the only way to reach the disambiguation branch, and they
// are marked like everything else.
//
// Marked `__d7_rt__` on the client's email, the booking token, the service name
// and the location name. Bookings are removed before barbers and services:
// every booking foreign key is `Restrict`.
//
//   npx tsx scripts/d7-runtime-fixture.ts seed
//   npx tsx scripts/d7-runtime-fixture.ts clean
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma-cli/client';
import {
  businessToday,
  dayBoundsOf,
  weekBoundsOf,
} from '../src/server/domain/models/bookingCalendar';

const MARK = '__d7_rt__';
const MINUTE = 60_000;

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL as string }),
});

async function clean(): Promise<void> {
  await prisma.payment.deleteMany({
    where: { booking: { cancellationToken: { startsWith: MARK } } },
  });
  await prisma.booking.deleteMany({ where: { cancellationToken: { startsWith: MARK } } });
  await prisma.client.deleteMany({ where: { email: { startsWith: MARK } } });
  await prisma.barber.deleteMany({ where: { location: { name: { startsWith: MARK } } } });
  await prisma.service.deleteMany({ where: { name: { startsWith: MARK } } });
  await prisma.location.deleteMany({ where: { name: { startsWith: MARK } } });
  console.log('cleaned');
}

async function seed(): Promise<void> {
  await clean();

  const owner = await prisma.owner.findFirstOrThrow({ select: { id: true } });
  const barber = await prisma.barber.findFirstOrThrow({
    where: { location: { ownerId: owner.id } },
    select: { id: true, displayName: true },
  });

  // The twin: the same display name at a second branch. Legal by
  // `@@unique([locationId, displayName])`, and the only way to see the barber
  // ranking qualify a row with its location.
  const branch = await prisma.location.create({
    data: { ownerId: owner.id, name: `${MARK} Sucursal Norte` },
    select: { id: true },
  });
  const twin = await prisma.barber.create({
    data: { locationId: branch.id, displayName: barber.displayName },
    select: { id: true },
  });

  // Twelve services, so the ranking folds four of them into `Otros`.
  const services: string[] = [];
  for (let index = 0; index < 12; index += 1) {
    const created = await prisma.service.create({
      data: {
        ownerId: owner.id,
        name: `${MARK} Servicio ${index + 1}`,
        price: '10000.00',
        durationMinutes: 30,
      },
      select: { id: true },
    });
    services.push(created.id);
  }

  const today = businessToday(new Date());
  const week = weekBoundsOf(today);
  const todayRange = dayBoundsOf(today);

  /** `hour`:`minute` local on day `index` of the week. */
  function weekAt(index: number, hour: number, minute = 0): Date {
    return new Date(week.start.getTime() + (index * 24 * 60 + hour * 60 + minute) * MINUTE);
  }

  async function client(tag: string): Promise<string> {
    const row = await prisma.client.create({
      data: {
        ownerId: owner.id,
        name: `${tag} (fixture D7)`,
        email: `${MARK}-${tag}@example.com`,
        phone: '+541100000000',
      },
      select: { id: true },
    });
    return row.id;
  }

  let seq = 0;
  async function book(input: {
    clientId: string;
    barberId: string;
    serviceId: string;
    startTime: Date;
    status?: 'CONFIRMED' | 'EXPIRED';
  }): Promise<void> {
    seq += 1;
    await prisma.booking.create({
      data: {
        clientId: input.clientId,
        barberId: input.barberId,
        serviceId: input.serviceId,
        startTime: input.startTime,
        endTime: new Date(input.startTime.getTime() + 30 * MINUTE),
        status: (input.status ?? 'CONFIRMED') as never,
        priceAtBooking: '10000.00',
        depositAmount: '3000.00',
        cancellationToken: `${MARK}-${seq}`,
        holdExpiresAt: null,
        cancelledAt: null,
      },
    });
  }

  const who = await client('semana');

  // A ranking with a clear shape: the first service is booked far more than the
  // rest, and the tail is what gets folded.
  const counts = [9, 6, 5, 4, 4, 3, 3, 2, 2, 1, 1, 1];
  // Nine distinct hours across the week, so the distribution has a real shape
  // rather than one spike — and 21 among them.
  const hours = [9, 10, 11, 13, 14, 16, 17, 19, 21];

  let placed = 0;
  for (const [index, count] of counts.entries()) {
    for (let n = 0; n < count; n += 1) {
      const hour = hours[placed % hours.length] as number;
      // 21:30, deliberately: 00:30 UTC the next day. A runtime reading its own
      // clock would draw this column at hour 0.
      const minute = hour === 21 ? 30 : (placed % 2) * 15;
      await book({
        clientId: who,
        // Every third appointment goes to the twin, so the barber ranking has
        // two rows with the same name and different counts.
        barberId: placed % 3 === 0 ? twin.id : barber.id,
        serviceId: services[index] as string,
        startTime: weekAt(placed % 7, hour, minute),
      });
      placed += 1;
    }
  }

  // An expiry in the same week, which must appear in no ranking and no column.
  await book({
    clientId: who,
    barberId: barber.id,
    serviceId: services[0] as string,
    startTime: weekAt(2, 15),
    status: 'EXPIRED',
  });

  // Today: three hours only, so the single-day copy renders over a sparse axis.
  const todayClient = await client('hoy');
  for (const [index, hour] of [11, 15, 18].entries()) {
    await book({
      clientId: todayClient,
      barberId: index === 0 ? twin.id : barber.id,
      serviceId: services[index] as string,
      startTime: new Date(todayRange.start.getTime() + hour * 60 * MINUTE),
    });
  }

  console.log(`seeded ${placed + 4} bookings across 12 services and 2 barbers`);
  console.log(`week starts ${week.start.toISOString()}`);
}

const command = process.argv[2];

(command === 'clean' ? clean() : seed())
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
