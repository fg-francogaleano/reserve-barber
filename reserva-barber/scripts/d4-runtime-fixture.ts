// D4 runtime fixture — seeds the client shapes the owner's real data does not
// have, so the authenticated runtime pass has every state to look at, then
// removes them.
//
// Marked `__d4_rt__` on the client's email and the booking token.
//
//   npx tsx scripts/d4-runtime-fixture.ts seed
//   npx tsx scripts/d4-runtime-fixture.ts clean
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma-cli/client';

const MARK = '__d4_rt__';
const MINUTE = 60_000;

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL as string }),
});

async function clean(): Promise<void> {
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

  let seq = 0;
  async function book(
    clientId: string,
    status: 'CONFIRMED' | 'CANCELLED' | 'EXPIRED'
  ): Promise<void> {
    seq += 1;
    const start = new Date(Date.now() + (200 + seq) * 24 * 60 * MINUTE);
    await prisma.booking.create({
      data: {
        clientId,
        barberId: barber.id,
        serviceId: service.id,
        startTime: start,
        endTime: new Date(start.getTime() + 30 * MINUTE),
        status: status as never,
        priceAtBooking: '10000.00',
        depositAmount: '3000.00',
        cancellationToken: `${MARK}-${seq}`,
        holdExpiresAt: null,
        cancelledAt: status === 'CANCELLED' ? new Date() : null,
        cancelledBy: status === 'CANCELLED' ? 'CLIENT' : null,
      },
    });
  }

  async function makeClient(tag: string, name: string) {
    return prisma.client.create({
      data: {
        ownerId: owner.id,
        name,
        email: `${MARK}-${tag}@example.com`,
        phone: '+5491155556666',
      },
      select: { id: true },
    });
  }

  // The three shapes real data does not have yet.
  const served = await makeClient('served', 'Rocío Fiel');
  await book(served.id, 'CONFIRMED');
  await book(served.id, 'CONFIRMED');
  await book(served.id, 'CONFIRMED');
  await book(served.id, 'CANCELLED');

  const canceller = await makeClient('canceller', 'Tomás Cancelador');
  await book(canceller.id, 'CANCELLED');
  await book(canceller.id, 'CANCELLED');
  await book(canceller.id, 'EXPIRED');

  // The row a refused checkout leaves behind: no booking of any kind.
  await makeClient('ghost', 'Nadia SinTurno');

  // A maximum-length unbroken name and a very long address, for the layout.
  await makeClient('long', 'a'.repeat(120));

  // Enough clients to force a second page.
  for (let index = 0; index < 24; index += 1) {
    const filler = await makeClient(`fill${String(index).padStart(2, '0')}`, `Relleno ${index}`);
    if (index % 3 === 0) await book(filler.id, 'CONFIRMED');
  }

  const total = await prisma.client.count({ where: { ownerId: owner.id } });
  console.log(JSON.stringify({ total, url: '/clientes' }, null, 2));
}

const [command] = process.argv.slice(2);
const run = command === 'seed' ? seed() : clean();

run
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
