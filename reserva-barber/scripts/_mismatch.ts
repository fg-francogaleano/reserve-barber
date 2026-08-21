import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma-cli/client';

/**
 * 11.6, properly. Mercado Pago payment 173935835159 is a REAL approved charge
 * of 2000 ARS whose external_reference is this booking id. Recreating the
 * booking with that id makes the reference match, so the amount comparison is
 * the only thing left that can refuse it — which is the point.
 */
const BOOKING = 'cmt27n1wc0001h8u6oe0w3eje';

async function main() {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL!, maxUses: 1 }),
  });
  const cmd = process.argv[2];

  if (cmd === 'prep') {
    const client = await prisma.client.upsert({
      where: { ownerId_email: { ownerId: 'owner-root', email: '__b5_mm__@example.com' } },
      update: {},
      create: { ownerId: 'owner-root', name: '__b5_mm__ cliente', email: '__b5_mm__@example.com', phone: '+541100000000' },
      select: { id: true },
    });
    const startTime = new Date(Date.now() + 120 * 60 * 60_000);
    await prisma.booking.create({
      data: {
        id: BOOKING,
        clientId: client.id,
        barberId: 'cmsl1lqws0001psp79h6g3wd9',
        serviceId: 'cmsmj0n0g0000psp7n83tpwkj',
        startTime,
        endTime: new Date(startTime.getTime() + 35 * 60_000),
        status: 'PENDING_PAYMENT',
        priceAtBooking: '10000.00',
        // The snapshot says 5000. Mercado Pago's real charge was 2000.
        depositAmount: '5000.00',
        cancellationToken: `__b5_mm__-${Date.now()}`,
        holdExpiresAt: new Date(Date.now() + 60 * 60_000),
      },
    });
    const p = await prisma.payment.create({
      data: { bookingId: BOOKING, method: 'MERCADO_PAGO', status: 'PENDING', amount: '5000.00' },
      select: { id: true },
    });
    console.log(JSON.stringify({ ref: p.id, storedAmount: '5000.00', gatewayAmount: '2000.00' }));
  }

  if (cmd === 'show') {
    const b = await prisma.booking.findUnique({
      where: { id: BOOKING },
      select: { status: true, payments: { select: { status: true, mpPaymentId: true } } },
    });
    const p = b?.payments[0];
    console.log(`booking=${b?.status}  payment=${p?.status} mpPaymentId=${p?.mpPaymentId ?? '-'}`);
  }

  if (cmd === 'clean') {
    await prisma.payment.deleteMany({ where: { bookingId: BOOKING } });
    await prisma.booking.deleteMany({ where: { id: BOOKING } });
    await prisma.client.deleteMany({ where: { email: { startsWith: '__b5_mm__' } } });
    console.log('cleaned');
  }

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
