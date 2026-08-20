import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma-cli/client';

const MARK = '__b5_rt__';

async function main() {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL!, maxUses: 1 }),
  });
  const mode = process.argv[2] ?? 'seed';

  if (mode === 'clean') {
    await prisma.payment.deleteMany({ where: { booking: { cancellationToken: { startsWith: MARK } } } });
    await prisma.booking.deleteMany({ where: { cancellationToken: { startsWith: MARK } } });
    await prisma.client.deleteMany({ where: { email: { startsWith: MARK } } });
    console.log('cleaned');
    await prisma.$disconnect();
    return;
  }

  if (mode === 'show') {
    const rows = await prisma.booking.findMany({
      where: { cancellationToken: { startsWith: MARK } },
      select: { id: true, status: true, holdExpiresAt: true, cancellationToken: true,
        payments: { select: { id: true, status: true, mpPaymentId: true, mpPreferenceId: true, mpInitPoint: true, amount: true } } },
    });
    console.log(JSON.stringify(rows.map((r) => ({ ...r, payments: r.payments.map((p) => ({ ...p, amount: String(p.amount), mpInitPoint: p.mpInitPoint ? 'set' : null })) })), null, 2));
    await prisma.$disconnect();
    return;
  }

  const suffix = process.argv[3] ?? '1';
  const holdMinutes = Number(process.argv[4] ?? 15);

  const client = await prisma.client.upsert({
    where: { ownerId_email: { ownerId: 'owner-root', email: `${MARK}${suffix}@example.com` } },
    update: {},
    create: { ownerId: 'owner-root', name: `${MARK} cliente`, email: `${MARK}${suffix}@example.com`, phone: '+541100000000' },
    select: { id: true },
  });

  const startTime = new Date(Date.now() + (72 + Number(suffix)) * 60 * 60_000);
  const booking = await prisma.booking.create({
    data: {
      clientId: client.id,
      barberId: 'cmsl1lqws0001psp79h6g3wd9',
      serviceId: 'cmsmj0n0g0000psp7n83tpwkj',
      startTime,
      endTime: new Date(startTime.getTime() + 35 * 60_000),
      status: 'PENDING_PAYMENT',
      priceAtBooking: '10000.00',
      depositAmount: '2000.00',
      cancellationToken: `${MARK}${suffix}-${Date.now()}`,
      holdExpiresAt: new Date(Date.now() + holdMinutes * 60_000),
    },
    select: { id: true, cancellationToken: true },
  });

  console.log(JSON.stringify(booking));
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
