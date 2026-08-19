// GATE B5 — the payment path against the live database and the real Mercado Pago.
//
// B4's runtime found two defects in its first ten minutes against 2061 passing
// tests, and both were invisible to the suite by construction. This gate exists
// for the same class of question: things a mock cannot answer because the mock
// is the thing being doubted.
//
// Four of its probes are **open questions**, not regression checks. They are
// here because the code makes an assumption that only the real system can
// confirm, and each one is recorded in the change's task list:
//
//   11.18 (T45) — Mercado Pago's real minimum chargeable amount in ARS. Their
//         API reference states none and their help page refuses automated
//         requests, so the only honest way to learn it is to ask by trying.
//   11.19       — what the pg driver adapter reports for a violation of a
//         PARTIAL unique index. `p1-gate-db.ts` measured the ordinary case;
//         `PrismaPaymentRepository` discriminates two constraints by that
//         shape, and if a partial index reports differently both translations
//         collapse into the fallback and the two outcomes swap meanings.
//   11.20       — whether Mercado Pago accepts `date_of_expiration` with a `Z`
//         offset. Every example in their docs uses a numeric offset. A refusal
//         would surface as `invalid` on every preference — the whole story
//         dead — and no unit test can see it through a transport double.
//   11.1–11.2   — that the migration's constraints exist and actually refuse.
//
// Everything it creates is prefixed `__b5_gate__` and removed at the end, in
// foreign-key order — every booking FK is `Restrict`, so nothing cascades.
//
// Mercado Pago probes run only when MP_GATE_ACCESS_TOKEN is set, and it MUST be
// a test credential. The script refuses a token that does not announce itself
// as one rather than risk creating a real charge.
//
//   npx tsx scripts/b5-gate.ts
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma-cli/client';
import { MercadoPagoGateway } from '../src/server/infrastructure/payments/MercadoPagoGateway';
import { PrismaPaymentRepository } from '../src/server/infrastructure/prisma/PrismaPaymentRepository';

const MARK = '__b5_gate__';

/** Descending, to find the floor by where Mercado Pago stops accepting. */
const MINIMUM_PROBE_AMOUNTS = ['5.00', '1.00', '0.50', '0.10', '0.01'];

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

/** An open question. Reported, never counted as a failure — it has no expected answer. */
function observe(probe: string, detail: string): void {
  console.log(`OBSERVED  ${probe} — ${detail}`);
}

async function main(): Promise<void> {
  const adapter = new PrismaPg({ connectionString: requireEnv('DATABASE_URL'), maxUses: 1 });
  const prisma = new PrismaClient({ adapter });

  const createdIds: Record<string, string | undefined> = {};

  try {
    // ---------------------------------------------------------------- 11.1
    // The table, both enums, and the two indexes Prisma cannot fully declare.
    {
      const columns = await prisma.$queryRaw<{ column_name: string }[]>`
        SELECT column_name FROM information_schema.columns WHERE table_name = 'Payment'
      `;
      const names = columns.map((c) => c.column_name).sort();
      const required = [
        'amount',
        'approvedAt',
        'bookingId',
        'id',
        'method',
        'mpInitPoint',
        'mpPaymentId',
        'mpPreferenceId',
        'status',
      ];
      const missing = required.filter((column) => !names.includes(column));
      report(
        '11.1a. The Payment table exists with every column the code selects',
        missing.length === 0,
        missing.length === 0 ? `${names.length} columns` : `missing: ${missing.join(', ')}`
      );
    }

    {
      const enums = await prisma.$queryRaw<{ typname: string }[]>`
        SELECT typname FROM pg_type WHERE typname IN ('PaymentMethod', 'PaymentStatus')
      `;
      report(
        '11.1b. Both payment enums exist',
        enums.length === 2,
        enums.map((e) => e.typname).join(', ') || 'none found'
      );
    }

    {
      const indexes = await prisma.$queryRaw<{ indexname: string; indexdef: string }[]>`
        SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'Payment'
      `;
      const partial = indexes.find((i) => i.indexname === 'Payment_one_live_per_booking');
      report(
        '11.1c. The partial unique index exists and carries its predicate',
        partial !== undefined && /WHERE.*REJECTED/i.test(partial.indexdef),
        partial?.indexdef ?? 'index absent — the live-payment bound is NOT enforced',
      );
      report(
        '11.1d. The gateway payment id is unique',
        indexes.some((i) => i.indexname === 'Payment_mpPaymentId_key'),
        indexes.map((i) => i.indexname).join(', ')
      );
    }

    // Fixtures: an owner, a location, a service, a barber, a client, a booking.
    const owner = await prisma.owner.findFirst({ select: { id: true } });
    if (!owner) throw new Error('Gate needs an owner to exist — run provision-owner first');

    const location = await prisma.location.create({
      data: { ownerId: owner.id, name: `${MARK} sucursal` },
      select: { id: true },
    });
    createdIds.location = location.id;

    const service = await prisma.service.create({
      data: { ownerId: owner.id, name: `${MARK} corte`, price: '10000.00', durationMinutes: 30 },
      select: { id: true },
    });
    createdIds.service = service.id;

    const barber = await prisma.barber.create({
      data: { locationId: location.id, displayName: `${MARK} barbero` },
      select: { id: true },
    });
    createdIds.barber = barber.id;

    const client = await prisma.client.create({
      data: {
        ownerId: owner.id,
        name: `${MARK} cliente`,
        email: `${MARK}@example.com`,
        phone: '+541100000000',
      },
      select: { id: true },
    });
    createdIds.client = client.id;

    const startTime = new Date(Date.now() + 48 * 60 * 60_000);
    const booking = await prisma.booking.create({
      data: {
        clientId: client.id,
        barberId: barber.id,
        serviceId: service.id,
        startTime,
        endTime: new Date(startTime.getTime() + 30 * 60_000),
        status: 'PENDING_PAYMENT',
        priceAtBooking: '10000.00',
        depositAmount: '2000.50',
        cancellationToken: `${MARK}-token-1`,
        holdExpiresAt: new Date(Date.now() + 15 * 60_000),
      },
      select: { id: true },
    });
    createdIds.booking = booking.id;

    const payments = new PrismaPaymentRepository(prisma as never);

    // ---------------------------------------------------------------- 11.2
    // The partial index must actually refuse a second live payment. A
    // constraint that exists and does not bind is worse than none, because the
    // code above it stops checking.
    {
      const first = await payments.createPendingMercadoPago({
        bookingId: booking.id,
        amount: '2000.50',
      });

      let refused = false;
      let rawError: unknown = null;
      try {
        await prisma.payment.create({
          data: {
            bookingId: booking.id,
            method: 'MERCADO_PAGO',
            status: 'PENDING',
            amount: '2000.50',
          },
        });
      } catch (error) {
        refused = true;
        rawError = error;
      }

      report(
        '11.2. A second live payment for one booking is refused by the database',
        refused && first.outcome === 'created',
        refused ? 'refused as expected' : 'ACCEPTED — the live-payment bound does not hold'
      );

      // ------------------------------------------------------------- 11.19
      // The open question. `PrismaPaymentRepository` discriminates the two
      // constraints by `meta.driverAdapterError.cause.constraint.fields`, a
      // shape measured for an ordinary unique index and ASSUMED for a partial
      // one. If it differs, both translations fall through to the generic
      // branch and the two outcomes swap meanings: a double-tap becomes an
      // error shown to somebody who succeeded, and a duplicate notification
      // becomes a 503 asking Mercado Pago for a third delivery.
      if (rawError !== null) {
        const shaped = rawError as {
          code?: unknown;
          meta?: { driverAdapterError?: { cause?: { constraint?: { fields?: unknown } } } };
        };
        const fields = shaped.meta?.driverAdapterError?.cause?.constraint?.fields;
        observe(
          '11.19. What the driver reports for a PARTIAL unique index violation',
          `code=${String(shaped.code)} fields=${JSON.stringify(fields)}`
        );
        report(
          '11.19b. The repository can discriminate that violation',
          Array.isArray(fields) &&
            fields.map((f) => String(f).replaceAll('"', '')).includes('bookingId'),
          Array.isArray(fields)
            ? `resolves to ${JSON.stringify(fields)}`
            : 'UNRECOGNISED — createPendingMercadoPago will rethrow instead of returning alreadyLive'
        );
      }

      // The repository's own translation, end to end.
      const second = await payments.createPendingMercadoPago({
        bookingId: booking.id,
        amount: '2000.50',
      });
      report(
        '11.2b. The repository translates that violation into the existing payment',
        second.outcome === 'alreadyLive',
        `outcome=${second.outcome}`
      );

      // A rejected payment must not block a retry.
      await prisma.payment.updateMany({
        where: { bookingId: booking.id },
        data: { status: 'REJECTED' },
      });
      const afterRejection = await payments.createPendingMercadoPago({
        bookingId: booking.id,
        amount: '2000.50',
      });
      report(
        '11.2c. A rejected payment does not block a new one',
        afterRejection.outcome === 'created',
        `outcome=${afterRejection.outcome}`
      );
    }

    // ------------------------------------------------------- 11.3 / .18 / .20
    // Mercado Pago, for real. Skipped unless a TEST credential is supplied.
    const accessToken = process.env.MP_GATE_ACCESS_TOKEN;
    if (!accessToken) {
      console.log(
        '\nSKIPPED  Mercado Pago probes (11.3, 11.18, 11.20) — set MP_GATE_ACCESS_TOKEN to a TEST credential\n'
      );
    } else if (!accessToken.startsWith('TEST-')) {
      // Refused rather than risked. A production token here would create real
      // preferences on the owner's account.
      report(
        '11.3. Mercado Pago probes use a test credential',
        false,
        'MP_GATE_ACCESS_TOKEN does not start with TEST- — refusing to create preferences with it'
      );
    } else {
      const gateway = new MercadoPagoGateway();
      const expiresAt = new Date(Date.now() + 15 * 60_000);

      const preference = await gateway.createPreference(
        {
          title: `${MARK} corte`,
          amount: '2000.50',
          externalReference: booking.id,
          notificationUrl: 'https://example.com/api/webhooks/mercadopago?ref=gate',
          backUrl: 'https://example.com/b/gate/pago/retorno',
          expiresAt,
        },
        accessToken
      );

      report(
        '11.3. A preference is created for a real booking amount',
        preference.status === 'created',
        preference.status === 'created'
          ? `preference ${preference.preferenceId}`
          : `status=${preference.status}`
      );

      // ------------------------------------------------------------- 11.20
      // If `date_of_expiration` with a `Z` offset were refused, the call above
      // would have come back `invalid` — every preference in production would,
      // and the whole story would be dead with a green suite.
      observe(
        '11.20. date_of_expiration with a Z offset',
        preference.status === 'created'
          ? `ACCEPTED (${expiresAt.toISOString()}) — no numeric-offset conversion needed`
          : `NOT ACCEPTED (status=${preference.status}) — switch to a numeric offset built from the business timezone`
      );

      // ------------------------------------------------------------- 11.18
      // T45. The floor is a guess until this runs. Descending amounts until
      // Mercado Pago stops accepting; the smallest accepted is the answer.
      let smallestAccepted: string | null = null;
      for (const amount of MINIMUM_PROBE_AMOUNTS) {
        const attempt = await gateway.createPreference(
          {
            title: `${MARK} minimum probe`,
            amount,
            externalReference: booking.id,
            notificationUrl: 'https://example.com/api/webhooks/mercadopago?ref=gate',
            backUrl: 'https://example.com/b/gate/pago/retorno',
            expiresAt,
          },
          accessToken
        );
        observe(`11.18. minimum probe at ${amount} ARS`, `status=${attempt.status}`);
        if (attempt.status === 'created') smallestAccepted = amount;
      }

      observe(
        '11.18. RESULT — smallest accepted amount',
        smallestAccepted === null
          ? 'none of the probed amounts was accepted; widen MINIMUM_PROBE_AMOUNTS upward'
          : `${smallestAccepted} ARS. Write this into MIN_DEPOSIT_AMOUNT and close T45 (tasks 1.2, 1.5, 1.6b, 2.6)`
      );
    }
  } finally {
    // Foreign-key order. Every booking FK is Restrict, so nothing cascades and
    // the order is the guarantee rather than a convenience.
    await prisma.payment.deleteMany({ where: { booking: { cancellationToken: { startsWith: MARK } } } });
    await prisma.booking.deleteMany({ where: { cancellationToken: { startsWith: MARK } } });
    if (createdIds.client) await prisma.client.delete({ where: { id: createdIds.client } });
    if (createdIds.barber) await prisma.barber.delete({ where: { id: createdIds.barber } });
    if (createdIds.service) await prisma.service.delete({ where: { id: createdIds.service } });
    if (createdIds.location) await prisma.location.delete({ where: { id: createdIds.location } });

    const leftover = await prisma.booking.count({
      where: { cancellationToken: { startsWith: MARK } },
    });
    report('11.z. The gate cleaned up after itself', leftover === 0, `${leftover} rows left behind`);

    await prisma.$disconnect();
  }

  console.log(failures === 0 ? '\nGATE PASSED\n' : `\nGATE FAILED (${failures})\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
