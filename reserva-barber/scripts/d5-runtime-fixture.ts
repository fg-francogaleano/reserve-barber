// D5 runtime fixture — seeds the figures the owner's real data does not have,
// so the authenticated runtime pass has every state to look at, then removes
// them.
//
// The real shop has too little history for this page to show its own states: on
// the day this was written "hoy" held nothing, so the page an owner would open
// rendered the quiet-period empty state and nothing else. What follows is built
// so that each period exercises a different branch of the spec:
//
//   hoy            — every figure populated, including the retried-payment
//                    booking (counted once), an approved payment on an EXPIRED
//                    booking (counted nowhere), a live hold (counted nowhere),
//                    and all three cancellation shapes: OWNER, CLIENT, and one
//                    written before `cancelledBy` had a writer.
//   mes-anterior   — cancellations and no confirmed appointments, which is the
//                    only combination that renders the ABSENT average beside
//                    real figures rather than beside an empty state.
//
// `ayer`, `semana`, `mes` are left to the real data, so the pass also sees the
// page over rows this script did not write.
//
// Marked `__d5_rt__` on the client's email, the booking token and the payment
// id. Payments are removed before bookings: `Payment.bookingId` is `Restrict`.
//
//   npx tsx scripts/d5-runtime-fixture.ts seed
//   npx tsx scripts/d5-runtime-fixture.ts clean
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma-cli/client';
import { businessToday, dayBoundsOf, monthBoundsOf, previousMonth } from '../src/server/domain/models/bookingCalendar';

const MARK = '__d5_rt__';
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
  console.log('cleaned');
}

async function seed(): Promise<void> {
  await clean();

  const owner = await prisma.owner.findFirstOrThrow({ select: { id: true } });
  const barber = await prisma.barber.findFirstOrThrow({
    where: { location: { ownerId: owner.id } },
    select: { id: true },
  });
  const service = await prisma.service.findFirstOrThrow({
    where: { ownerId: owner.id },
    select: { id: true },
  });

  const today = businessToday(new Date());
  const todayRange = dayBoundsOf(today);
  const lastMonthRange = monthBoundsOf(previousMonth(today));

  /** Noon-ish inside a range, spaced so nothing collides. */
  function inside(range: { start: Date; end: Date }, slot: number): Date {
    return new Date(range.start.getTime() + (9 * 60 + slot * 30) * MINUTE);
  }

  async function client(tag: string): Promise<string> {
    const row = await prisma.client.create({
      data: {
        ownerId: owner.id,
        name: `${tag} (fixture D5)`,
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
    startTime: Date;
    status: 'CONFIRMED' | 'CANCELLED' | 'EXPIRED' | 'PENDING_PAYMENT';
    cancelledBy?: 'OWNER' | 'CLIENT' | null;
  }): Promise<string> {
    seq += 1;
    const row = await prisma.booking.create({
      data: {
        clientId: input.clientId,
        barberId: barber.id,
        serviceId: service.id,
        startTime: input.startTime,
        endTime: new Date(input.startTime.getTime() + 30 * MINUTE),
        status: input.status as never,
        priceAtBooking: '10000.00',
        depositAmount: '3000.00',
        cancellationToken: `${MARK}-${seq}`,
        holdExpiresAt:
          input.status === 'PENDING_PAYMENT' ? new Date(Date.now() + 30 * MINUTE) : null,
        cancelledAt: input.status === 'CANCELLED' ? new Date() : null,
        cancelledBy: (input.cancelledBy ?? null) as never,
      },
      select: { id: true },
    });
    return row.id;
  }

  let paySeq = 0;
  async function pay(
    bookingId: string,
    status: 'APPROVED' | 'REJECTED',
    amount: string
  ): Promise<void> {
    paySeq += 1;
    await prisma.payment.create({
      data: {
        bookingId,
        method: 'MERCADO_PAGO' as never,
        amount,
        status: status as never,
        mpPaymentId: `${MARK}-p${paySeq}`,
        approvedAt: status === 'APPROVED' ? new Date() : null,
      },
    });
  }

  // ── Today ────────────────────────────────────────────────────────────────

  const ana = await client('ana');
  for (const slot of [0, 1, 2]) {
    const id = await book({ clientId: ana, startTime: inside(todayRange, slot), status: 'CONFIRMED' });
    await pay(id, 'APPROVED', '1000.00');
  }

  // The probe that matters: two declined attempts and one approval on ONE
  // booking. If Payment were joined into the counted row set this would read as
  // three appointments instead of one, and the trailing zero would vanish.
  const beto = await client('beto');
  const retried = await book({ clientId: beto, startTime: inside(todayRange, 3), status: 'CONFIRMED' });
  await pay(retried, 'REJECTED', '500.00');
  await pay(retried, 'REJECTED', '500.00');
  await pay(retried, 'APPROVED', '2000.50');

  // Real money on a booking that never confirmed — T82's case. It must appear
  // in no figure on the page.
  const caro = await client('caro');
  const lapsed = await book({ clientId: caro, startTime: inside(todayRange, 4), status: 'EXPIRED' });
  await pay(lapsed, 'APPROVED', '9999.00');

  // A live hold: neither an appointment nor a cancellation.
  const dani = await client('dani');
  await book({ clientId: dani, startTime: inside(todayRange, 5), status: 'PENDING_PAYMENT' });

  // The three cancellation shapes.
  const eze = await client('eze');
  await book({ clientId: eze, startTime: inside(todayRange, 6), status: 'CANCELLED', cancelledBy: 'OWNER' });
  await book({ clientId: eze, startTime: inside(todayRange, 7), status: 'CANCELLED', cancelledBy: 'CLIENT' });
  await book({ clientId: eze, startTime: inside(todayRange, 8), status: 'CANCELLED', cancelledBy: null });

  // ── Last month: cancellations and nothing confirmed ───────────────────────
  //
  // The only combination that renders the average as ABSENT beside populated
  // figures. With no cancellations the page would show the quiet-period empty
  // state instead, and the dash would never be seen.

  const fran = await client('fran');
  await book({
    clientId: fran,
    startTime: inside(lastMonthRange, 2),
    status: 'CANCELLED',
    cancelledBy: 'CLIENT',
  });

  console.log('seeded');
  console.log('  hoy          → 4 turnos, $5.000,50, 3 cancelaciones (1 tuya / 1 del cliente), 2 clientes, promedio $1.250,13');
  console.log('  mes-anterior → 0 turnos, $0,00, 1 cancelación, 0 clientes, promedio — (ausente)');
  console.log('  ayer/semana/mes → the real data, untouched');
}

/**
 * The timezone fixture — three bookings that answer differently depending on
 * whose calendar decided "today".
 *
 * **`workerd`'s clock is UTC and ignores `TZ`**, so the technique D3 used on
 * Node (run the server in a zone already on the next date) cannot be applied to
 * it. The only way to make its runtime calendar disagree with the business's is
 * to run in the real window: between 21:00 and 23:59 ART, UTC has rolled to the
 * next day and Argentina has not.
 *
 * The statistics page renders no date — only the period's label and its figures
 * — so the disagreement has to be made visible through the **counts**. These
 * three bookings do that, and they fail in both directions rather than one:
 *
 *   morning    13:00 UTC on the business's today   → in the business's day, NOT in the runtime's
 *   lateNight  00:30 UTC on the runtime's today    → in the business's day, NOT in the runtime's
 *   tomorrow   13:00 UTC on the runtime's today    → in the runtime's day, NOT in the business's
 *
 * A page computing the day from the business's calendar answers **2**.
 * A page computing it from the runtime's answers **1**, and the one it counts is
 * an appointment that has not happened yet.
 *
 * **Read `Ayer` as well as `Hoy`, and this fixture deliberately seeds nothing
 * there.** A correct page reports whatever the shop really had on the previous
 * business day; a page reading the runtime's calendar shifts "yesterday" onto
 * the business's *today* and reports the two rows above. Two independent
 * discriminators rather than one — `Hoy` alone cannot separate "counted the
 * wrong day" from "counted nothing", and the first run of this check made
 * exactly that mistake by predicting `Ayer = 0` while real bookings sat there.
 *
 * Run this only inside the window; outside it the three collapse onto one day
 * and prove nothing.
 */
async function seedTimezone(): Promise<void> {
  await clean();

  const owner = await prisma.owner.findFirstOrThrow({ select: { id: true } });
  const barber = await prisma.barber.findFirstOrThrow({
    where: { location: { ownerId: owner.id } },
    select: { id: true },
  });
  const service = await prisma.service.findFirstOrThrow({
    where: { ownerId: owner.id },
    select: { id: true },
  });

  const now = new Date();
  const businessDay = businessToday(now);
  const bounds = dayBoundsOf(businessDay);

  if (now.getUTCDate() === bounds.start.getUTCDate()) {
    throw new Error(
      'Outside the window: the runtime\'s UTC date still agrees with the business day. ' +
        'This fixture only proves anything between 21:00 and 23:59 ART.'
    );
  }

  const client = await prisma.client.create({
    data: {
      ownerId: owner.id,
      name: 'TZ (fixture D5)',
      email: `${MARK}-tz@example.com`,
      phone: '+541100000000',
    },
    select: { id: true },
  });

  let seq = 0;
  async function book(startTime: Date, label: string): Promise<void> {
    seq += 1;
    await prisma.booking.create({
      data: {
        clientId: client.id,
        barberId: barber.id,
        serviceId: service.id,
        startTime,
        endTime: new Date(startTime.getTime() + 30 * MINUTE),
        status: 'CONFIRMED' as never,
        priceAtBooking: '10000.00',
        depositAmount: '3000.00',
        cancellationToken: `${MARK}-tz-${seq}`,
      },
    });
    console.log(`  ${label.padEnd(10)} ${startTime.toISOString()}`);
  }

  // 10:00 in the business's morning — 13:00 UTC on the business's own date.
  await book(new Date(bounds.start.getTime() + 10 * 60 * MINUTE), 'morning');
  // 21:30 ART tonight — already tomorrow in UTC, still today for the business.
  await book(new Date(bounds.start.getTime() + 21.5 * 60 * MINUTE), 'lateNight');
  // 10:00 tomorrow for the business — today for a runtime reading UTC.
  await book(new Date(bounds.end.getTime() + 10 * 60 * MINUTE), 'tomorrow');

  console.log('\nseeded the timezone fixture');
  console.log(`  business day : ${businessDay.year}-${businessDay.month}-${businessDay.day}`);
  console.log(`  runtime UTC  : ${now.toISOString()}`);
  console.log('\n  Hoy = 2  → the business calendar decided the day (correct)');
  console.log('  Hoy = 1  → the runtime calendar decided it, and the one counted has not happened');
  console.log('');
  console.log('  Ayer discriminates too, and it is the better half of the check:');
  console.log('    correct → yesterday is the business\'s previous day, which this fixture');
  console.log('              does not touch, so it reports whatever the shop really had');
  console.log('    broken  → yesterday becomes the business\'s TODAY, and reports 2 —');
  console.log('              the two rows Hoy should have been reporting');
  console.log('');
  console.log('  Read both. Hoy alone cannot tell "counted the wrong day" from "counted nothing".');
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command === 'seed') await seed();
  else if (command === 'seed-tz') await seedTimezone();
  else if (command === 'clean') await clean();
  else throw new Error('usage: d5-runtime-fixture.ts seed|seed-tz|clean');
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
