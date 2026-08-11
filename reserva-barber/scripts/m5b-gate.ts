// GATE M5b — an instant survives storage without drifting.
//
// `TimeOff.startsAt` / `endsAt` are the first `@db.Timestamptz` columns in the
// schema. PostgreSQL stores UTC either way, but the column type governs how a
// value is interpreted on the way in — and a silent three-hour shift would look
// exactly like correct data, since every value in this system is three hours
// from UTC by construction.
//
// Also checks the whole-day boundary: "all of 2026-08-11 local" must land on
// 03:00Z to 03:00Z, which is the arithmetic most likely to be off by a day.
//
//   npx tsx scripts/m5b-gate.ts
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma-cli/client';
import { localToInstant } from '../src/server/domain/models/businessTime';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
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

  const barber = await prisma.barber.findFirst({ select: { id: true } });
  if (!barber) {
    throw new Error('Gate needs at least one barber to exist');
  }

  // Whole day of 2026-08-11 in business local time.
  const startsAt = localToInstant({ year: 2026, month: 8, day: 11, minuteOfDay: 0 });
  const endsAt = localToInstant({ year: 2026, month: 8, day: 12, minuteOfDay: 0 });

  report(
    'A whole-day boundary lands on the expected instants',
    startsAt.toISOString() === '2026-08-11T03:00:00.000Z' &&
      endsAt.toISOString() === '2026-08-12T03:00:00.000Z',
    `${startsAt.toISOString()} → ${endsAt.toISOString()}`
  );

  report(
    'B a whole day is exactly 24 hours today',
    endsAt.getTime() - startsAt.getTime() === 24 * 60 * 60 * 1000,
    `${(endsAt.getTime() - startsAt.getTime()) / 3_600_000} hours (no DST in this market)`
  );

  let created: string | null = null;
  const baseline = await prisma.timeOff.count();

  try {
    const row = await prisma.timeOff.create({
      data: { barberId: barber.id, startsAt, endsAt, reason: null },
      select: { id: true, startsAt: true, endsAt: true },
    });
    created = row.id;

    report(
      'C the stored instant is returned unchanged',
      row.startsAt.getTime() === startsAt.getTime() && row.endsAt.getTime() === endsAt.getTime(),
      `read back ${row.startsAt.toISOString()} → ${row.endsAt.toISOString()}`
    );

    // Re-read through a fresh query rather than the create's return value: the
    // create may echo what it sent, which would hide a storage-side drift.
    const reread = await prisma.timeOff.findUniqueOrThrow({
      where: { id: row.id },
      select: { startsAt: true, endsAt: true },
    });
    report(
      'D a separate read agrees',
      reread.startsAt.getTime() === startsAt.getTime(),
      `re-read ${reread.startsAt.toISOString()}`
    );

    // The unique key is what makes a retried create idempotent.
    const duplicate = await prisma.timeOff.createMany({
      data: [{ barberId: barber.id, startsAt, endsAt }],
      skipDuplicates: true,
    });
    const total = await prisma.timeOff.count({ where: { barberId: barber.id } });
    report(
      'E a duplicate create is absorbed',
      duplicate.count === 0 && total === 1,
      `insert reported count=${duplicate.count}, rows for barber=${total}`
    );
  } finally {
    if (created) {
      await prisma.timeOff.deleteMany({ where: { id: created } });
    }
    const remaining = await prisma.timeOff.count();
    console.log(`cleanup: TimeOff rows = ${remaining} (baseline ${baseline})`);
    if (remaining !== baseline) {
      failures += 1;
      console.log('FAIL  cleanup did not restore the original state');
    }
    await prisma.$disconnect();
  }

  if (failures > 0) {
    throw new Error(`${failures} gate probe(s) failed`);
  }
  console.log('\nM5b gate passed: instants round-trip through timestamptz unchanged.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
