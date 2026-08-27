// C1 runtime fixture — a real shop and a real booking, for driving over HTTP.
//
// The gate cleans up after itself inside one process; this one has to survive
// between `curl` invocations, so it is seed/clean rather than a single run.
//
//   npx tsx scripts/c1-runtime-fixture.ts seed
//   npx tsx scripts/c1-runtime-fixture.ts status
//   npx tsx scripts/c1-runtime-fixture.ts clean
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma-cli/client';

const MARK = '__c1_rt__';
const SLUG = 'c1-runtime';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

async function main(): Promise<void> {
  const mode = process.argv[2] ?? 'seed';
  const adapter = new PrismaPg({ connectionString: requireEnv('DATABASE_URL'), maxUses: 1 });
  const prisma = new PrismaClient({ adapter });

  try {
    if (mode === 'clean') {
      const owners = await prisma.owner.findMany({
        where: { email: { startsWith: MARK } },
        select: { id: true },
      });
      const ownerIds = owners.map((o) => o.id);

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
      await prisma.paymentConfig.deleteMany({ where: { ownerId: { in: ownerIds } } });
      await prisma.businessProfile.deleteMany({ where: { ownerId: { in: ownerIds } } });
      await prisma.owner.deleteMany({ where: { id: { in: ownerIds } } });
      console.log('CLEANED');
      return;
    }

    if (mode === 'status') {
      const rows = await prisma.booking.findMany({
        where: { cancellationToken: { startsWith: MARK } },
        select: {
          cancellationToken: true,
          status: true,
          cancelledBy: true,
          cancelledAt: true,
          holdExpiresAt: true,
        },
      });
      for (const row of rows) {
        console.log(
          `${row.cancellationToken}  status=${row.status} cancelledBy=${row.cancelledBy} ` +
            `cancelledAt=${row.cancelledAt?.toISOString() ?? 'null'} hold=${row.holdExpiresAt?.toISOString() ?? 'null'}`
        );
      }
      return;
    }

    const owner = await prisma.owner.create({
      data: { email: `${MARK}owner@example.com` },
      select: { id: true },
    });
    await prisma.businessProfile.create({
      data: { ownerId: owner.id, businessName: 'Barbería Runtime C1', publicSlug: SLUG },
    });
    // A configured shop, so the confirmation page can reach the awaiting state
    // rather than falling to "this shop cannot take payments". The token is a
    // placeholder: nothing on the page path decrypts it — the projection derives
    // `hasMercadoPago` in SQL as `mpAccessToken IS NOT NULL`.
    await prisma.paymentConfig.create({
      data: { ownerId: owner.id, mpAccessToken: 'runtime-placeholder', mpPublicKey: 'runtime-pk' },
    });

    const location = await prisma.location.create({
      data: { ownerId: owner.id, name: 'Sucursal Runtime' },
      select: { id: true },
    });
    const barber = await prisma.barber.create({
      data: { locationId: location.id, displayName: 'Barbero Runtime' },
      select: { id: true },
    });
    const service = await prisma.service.create({
      data: { ownerId: owner.id, name: 'Corte Runtime', price: '9000.00', durationMinutes: 30 },
      select: { id: true },
    });
    const client = await prisma.client.create({
      data: {
        ownerId: owner.id,
        name: 'Cliente Runtime',
        email: `${MARK}client@example.com`,
        phone: '+5491133334444',
      },
      select: { id: true },
    });

    let slot = 0;
    async function booking(token: string, status: string, hoursAhead = 0): Promise<string> {
      slot += 1;
      const startTime = new Date(Date.now() + (72 + slot + hoursAhead) * 60 * 60_000);
      const full = `${MARK}${token}`;
      await prisma.booking.create({
        data: {
          clientId: client.id,
          barberId: barber.id,
          serviceId: service.id,
          startTime,
          endTime: new Date(startTime.getTime() + 30 * 60_000),
          status: status as never,
          priceAtBooking: '9000.00',
          depositAmount: '2000.50',
          cancellationToken: full,
          holdExpiresAt: status === 'PENDING_PAYMENT' ? new Date(Date.now() + 15 * 60_000) : null,
        },
      });
      return full;
    }

    const confirmed = await booking('confirmed', 'CONFIRMED');
    const second = await booking('second', 'CONFIRMED');
    const held = await booking('held', 'PENDING_PAYMENT');

    console.log(`SLUG=${SLUG}`);
    console.log(`CONFIRMED=${confirmed}`);
    console.log(`SECOND=${second}`);
    console.log(`HELD=${held}`);
  } finally {
    await prisma.$disconnect();
  }
}

void main();
