// D3 runtime fixture — seeds one barber's days so the authenticated runtime
// pass has every state to look at, then removes everything it created.
//
// Marked `__d3_rt__` on the booking token, the absence reason and the client's
// email, so `clean` can find its own rows and nothing else.
//
//   npx tsx scripts/d3-runtime-fixture.ts inspect
//   npx tsx scripts/d3-runtime-fixture.ts seed <barberId>
//   npx tsx scripts/d3-runtime-fixture.ts clean
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma-cli/client';
import {
  addDays,
  businessToday,
  formatLocalDate,
} from '../src/server/domain/models/bookingCalendar';
import { localToInstant } from '../src/server/domain/models/businessTime';

const MARK = '__d3_rt__';
const MINUTE = 60_000;

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL as string }),
});

async function inspect(): Promise<void> {
  const barbers = await prisma.barber.findMany({
    select: { id: true, displayName: true, location: { select: { name: true } } },
    take: 10,
  });
  console.log('BARBERS:', JSON.stringify(barbers));
}

async function clean(): Promise<void> {
  await prisma.booking.deleteMany({ where: { cancellationToken: { startsWith: MARK } } });
  await prisma.timeOff.deleteMany({ where: { reason: { startsWith: MARK } } });
  await prisma.client.deleteMany({ where: { email: { startsWith: MARK } } });
  console.log('cleaned');
}

async function seed(barberId: string): Promise<void> {
  await clean();

  const barber = await prisma.barber.findUniqueOrThrow({
    where: { id: barberId },
    select: { id: true, displayName: true, location: { select: { ownerId: true } } },
  });
  const service = await prisma.service.findFirstOrThrow({
    where: { ownerId: barber.location.ownerId },
    select: { id: true, name: true },
  });

  const client = await prisma.client.create({
    data: {
      ownerId: barber.location.ownerId,
      name: `${MARK} Cliente Demo`,
      email: `${MARK}@example.com`,
      phone: '+541100000000',
    },
    select: { id: true },
  });

  // Two days out, so nothing collides with real business.
  const day = addDays(businessToday(new Date()), 2);
  const at = (hour: number, minute = 0): Date =>
    localToInstant({ ...day, minuteOfDay: hour * 60 + minute });

  async function book(
    token: string,
    hour: number,
    status: 'CONFIRMED' | 'CANCELLED' | 'PENDING_PAYMENT' | 'PENDING_APPROVAL',
    holdExpiresAt?: Date | null
  ): Promise<void> {
    await prisma.booking.create({
      data: {
        clientId: client.id,
        barberId: barber.id,
        serviceId: service.id,
        startTime: at(hour),
        endTime: new Date(at(hour).getTime() + 30 * MINUTE),
        status: status as never,
        priceAtBooking: '10000.00',
        depositAmount: '3000.00',
        cancellationToken: `${MARK}-${token}`,
        holdExpiresAt:
          holdExpiresAt === undefined
            ? status === 'PENDING_PAYMENT'
              ? new Date(Date.now() + 30 * MINUTE)
              : null
            : holdExpiresAt,
        cancelledAt: status === 'CANCELLED' ? new Date() : null,
        cancelledBy: status === 'CANCELLED' ? 'CLIENT' : null,
      },
    });
  }

  // All after 12:00, so only the 22:00 one carries the stranded badge: an
  // appointment overlapping the absence below would be flagged too — correct,
  // and it would muddy what the badge is demonstrating.
  await book('confirmed', 14, 'CONFIRMED');
  await book('receipt', 15, 'PENDING_APPROVAL');
  await book('cancelled', 14, 'CANCELLED');
  await book('lapsed', 16, 'PENDING_PAYMENT', new Date(Date.now() - 60 * MINUTE));
  // Outside the barber's 08:00–17:00 window — the stranded badge.
  await book('stranded', 22, 'CONFIRMED');

  // Began yesterday and lifts at 12:00 on the seeded day → "Hasta las 12:00".
  await prisma.timeOff.create({
    data: {
      barberId: barber.id,
      startsAt: localToInstant({ ...addDays(day, -1), minuteOfDay: 10 * 60 }),
      endsAt: at(12),
      reason: `${MARK} ausencia parcial`,
    },
  });

  // A different day, covered end to end by a three-day absence → "Todo el día".
  const wholeDay = addDays(day, 4);
  await prisma.timeOff.create({
    data: {
      barberId: barber.id,
      startsAt: localToInstant({ ...addDays(wholeDay, -1), minuteOfDay: 10 * 60 }),
      endsAt: localToInstant({ ...addDays(wholeDay, 1), minuteOfDay: 18 * 60 }),
      reason: `${MARK} vacaciones`,
    },
  });

  console.log(
    JSON.stringify(
      {
        barber: barber.displayName,
        seededDay: `/barberos/${barber.id}/calendario?fecha=${formatLocalDate(day)}`,
        wholeDayAbsence: `/barberos/${barber.id}/calendario?fecha=${formatLocalDate(wholeDay)}`,
      },
      null,
      2
    )
  );
}

const [command, arg] = process.argv.slice(2);
const run = command === 'seed' ? seed(arg as string) : command === 'clean' ? clean() : inspect();

run
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
