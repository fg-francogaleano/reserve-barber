// D6 runtime fixture — seeds the chart states the owner's real data does not
// have, so the authenticated runtime pass has every branch to look at, then
// removes them.
//
// The real shop's history is too thin for these charts to show their own
// states: a handful of bookings on scattered days draws a chart with one bar,
// which exercises neither the fill, nor the split, nor the degenerate case. What
// follows is built so that each period exercises a different branch:
//
//   semana  — a week with money on Monday, Wednesday and Saturday and **holes
//             in between**, paid by BOTH methods, so the fill and the two-part
//             split are both visible. Also carries the retried-payment booking
//             (two REJECTED plus one APPROVED) and an APPROVED payment on an
//             EXPIRED booking, neither of which may appear in any bar.
//   mes     — a single method only, so the split renders the degenerate
//             "todas las señas entraron por…" sentence rather than a bar.
//   hoy     — appointments with NO approved deposit, which is the zero-series
//             state: an answer rather than an absence, and the one most likely
//             to be mistaken for a failure.
//
// It also seeds T83's row: a deposit **approved this week for an appointment
// next month**. That single row is what makes "Dinero cobrado" and "Señas
// cobradas" disagree on screen, which is the thing the copy exists to explain
// and the thing a reviewer should see with their own eyes.
//
// `ayer` and `mes-anterior` are left to the real data, so the pass also sees the
// charts over rows this script did not write.
//
// Marked `__d6_rt__` on the client's email, the booking token and the payment
// id. Payments are removed before bookings: `Payment.bookingId` is `Restrict`.
//
//   npx tsx scripts/d6-runtime-fixture.ts seed
//   npx tsx scripts/d6-runtime-fixture.ts clean
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma-cli/client';
import {
  addDays,
  businessToday,
  dayBoundsOf,
  monthBoundsOf,
  weekBoundsOf,
} from '../src/server/domain/models/bookingCalendar';

const MARK = '__d6_rt__';
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
  const week = weekBoundsOf(today);
  const month = monthBoundsOf(today);
  const todayRange = dayBoundsOf(today);

  /** 13:00 local on day `index` of the week, comfortably inside its bucket. */
  function weekDay(index: number, slot = 0): Date {
    return new Date(week.start.getTime() + (index * 24 * 60 + 13 * 60 + slot * 30) * MINUTE);
  }

  async function client(tag: string): Promise<string> {
    const row = await prisma.client.create({
      data: {
        ownerId: owner.id,
        name: `${tag} (fixture D6)`,
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
      },
      select: { id: true },
    });
    return row.id;
  }

  let paySeq = 0;
  async function pay(input: {
    bookingId: string;
    status: 'APPROVED' | 'REJECTED';
    amount: string;
    method?: 'MERCADO_PAGO' | 'BANK_TRANSFER';
    approvedAt?: Date;
  }): Promise<void> {
    paySeq += 1;
    await prisma.payment.create({
      data: {
        bookingId: input.bookingId,
        method: (input.method ?? 'MERCADO_PAGO') as never,
        amount: input.amount,
        status: input.status as never,
        mpPaymentId: `${MARK}-p${paySeq}`,
        approvedAt: input.status === 'APPROVED' ? (input.approvedAt ?? new Date()) : null,
      },
    });
  }

  // ── This week: holes in the middle, and both payment methods ─────────────

  const ana = await client('ana');

  // Monday — Mercado Pago, with the trailing-zero amount so the runtime pass
  // also confirms `2000.50` does not render as `2000.5`.
  const monday = await book({ clientId: ana, startTime: weekDay(0), status: 'CONFIRMED' });
  await pay({ bookingId: monday, status: 'APPROVED', amount: '2000.50' });

  // Wednesday — bank transfer, so the split has two parts.
  const wednesday = await book({ clientId: ana, startTime: weekDay(2), status: 'CONFIRMED' });
  await pay({
    bookingId: wednesday,
    status: 'APPROVED',
    amount: '1500.00',
    method: 'BANK_TRANSFER',
  });

  // Saturday — the retried booking. Two declined attempts and one approval on
  // ONE booking: it must contribute exactly one payment to Mercado Pago. If it
  // ever reads as three, `p.status = 'APPROVED'` has gone missing.
  const beto = await client('beto');
  const saturday = await book({ clientId: beto, startTime: weekDay(5), status: 'CONFIRMED' });
  await pay({ bookingId: saturday, status: 'REJECTED', amount: '900.00' });
  await pay({ bookingId: saturday, status: 'REJECTED', amount: '900.00' });
  await pay({ bookingId: saturday, status: 'APPROVED', amount: '900.00' });

  // Tuesday, Thursday, Friday and Sunday are deliberately empty. **That is the
  // point of this fixture**: the chart must draw seven bars with four of them at
  // zero, not three bars on a shortened axis.

  // The late-payment case: real money on a booking that never confirmed. It
  // belongs in no bar and in neither method — and it is invisible everywhere
  // else in the product too, which is T82.
  const lapsed = await client('lapsed');
  const expired = await book({ clientId: lapsed, startTime: weekDay(3), status: 'EXPIRED' });
  await pay({ bookingId: expired, status: 'APPROVED', amount: '7777.00' });

  // ── T83: the row that makes the two income figures disagree ──────────────
  //
  // Approved **today**, for an appointment early next month. It belongs to this
  // week's "Dinero cobrado" and to next month's "Señas cobradas", and to no bar
  // on this week's chart. Seeing these two cards differ by exactly this amount
  // is the point of the runtime pass.
  const future = await client('future');
  const nextMonth = await book({
    clientId: future,
    startTime: new Date(month.end.getTime() + 3 * 24 * 60 * MINUTE),
    status: 'CONFIRMED',
  });
  await pay({ bookingId: nextMonth, status: 'APPROVED', amount: '4321.00' });

  // ── Today: appointments, no approved deposit ─────────────────────────────
  //
  // The zero-series state, and the one most easily mistaken for a failure. The
  // page must draw a flat axis and say the period collected nothing — not show
  // the empty state, and certainly not the chart failure.
  const carla = await client('carla');
  const unpaid = await book({
    clientId: carla,
    startTime: new Date(todayRange.start.getTime() + 15 * 60 * MINUTE),
    status: 'CONFIRMED',
  });
  await pay({ bookingId: unpaid, status: 'REJECTED', amount: '1000.00' });

  // ── Earlier this month: a single method, for the degenerate split ────────
  //
  // Only reachable if `mes` contains days outside this week; when the 1st falls
  // in the current week this adds nothing and the month simply shows the split
  // above, which is still a correct render.
  const early = addDays(today, -14);
  if (monthBoundsOf(early).start.getTime() === month.start.getTime()) {
    const dario = await client('dario');
    const earlier = await book({
      clientId: dario,
      startTime: new Date(dayBoundsOf(early).start.getTime() + 13 * 60 * MINUTE),
      status: 'CONFIRMED',
    });
    await pay({
      bookingId: earlier,
      status: 'APPROVED',
      amount: '3000.00',
      method: 'BANK_TRANSFER',
    });
  }

  console.log('seeded');
  console.log('  semana  — bars on Mon/Wed/Sat, holes on Tue/Thu/Fri/Sun, both methods');
  console.log('  semana  — Dinero cobrado should exceed Señas cobradas by exactly 4321.00');
  console.log('  hoy     — appointments with no approved deposit: a zero series, not an empty state');
  console.log('  mes     — includes the week above plus an earlier transfer-only day');
}

const command = process.argv[2];

async function main(): Promise<void> {
  if (command === 'seed') await seed();
  else if (command === 'clean') await clean();
  else {
    console.error('usage: tsx scripts/d6-runtime-fixture.ts <seed|clean>');
    process.exit(1);
  }
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
