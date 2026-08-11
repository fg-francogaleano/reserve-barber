// GATE M4 — batched transaction semantics for the assignment set write.
//
// M4 introduces the project's first multi-statement write. Three properties
// have to hold before the write path is built on top of them, and none can be
// established by a mock — they are properties of the driver adapter and of
// Supavisor in transaction mode, not of our code:
//
//   A. `createMany({ skipDuplicates: true })` is accepted by the driver adapter
//      and does not raise P2002 on an existing row.
//   B. `$transaction([deleteMany, createMany])` commits both statements.
//   C. A failure inside that batch rolls BOTH statements back, so no
//      half-applied set can exist.
//
// Connects through the POOLER (DATABASE_URL, transaction mode, port 6543) with
// the same adapter settings as the runtime client, because the pooler is the
// thing in question. Run:
//
//   npx tsx scripts/m4-gate.ts
//
// Touches only `BarberService`, which no shipped code path reads or writes yet,
// and removes every row it created in a finally block.
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma-cli/client';

const MISSING_SERVICE_ID = 'gate-nonexistent-service-id';
const FOREIGN_OWNER_ID = 'gate-foreign-owner-id';

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
  if (!passed) {
    failures += 1;
  }
}

async function main(): Promise<void> {
  // Mirrors src/server/infrastructure/prisma/client.ts: the pooler connection,
  // and `maxUses: 1` in particular, is what the batch has to survive.
  const adapter = new PrismaPg({
    connectionString: requireEnv('DATABASE_URL'),
    max: 5,
    maxUses: 1,
  });
  const prisma = new PrismaClient({ adapter });

  const barber = await prisma.barber.findFirst({
    select: { id: true, location: { select: { ownerId: true } } },
  });
  const service = await prisma.service.findFirst({ select: { id: true } });
  if (!barber || !service) {
    throw new Error('Gate needs at least one barber and one service to exist');
  }
  const OWNER_ID = barber.location.ownerId;

  const pair = { barberId: barber.id, serviceId: service.id };
  const owned = { barberId: barber.id };

  try {
    // --- Probe A: skipDuplicates absorbs a re-insert -----------------------
    await prisma.barberService.deleteMany({ where: owned });
    await prisma.barberService.createMany({ data: [pair] });

    let duplicateRaised: string | null = null;
    let secondInsertCount = -1;
    try {
      const result = await prisma.barberService.createMany({
        data: [pair],
        skipDuplicates: true,
      });
      secondInsertCount = result.count;
    } catch (error) {
      duplicateRaised = error instanceof Error ? error.message : String(error);
    }
    const rowsAfterA = await prisma.barberService.count({ where: owned });
    report(
      'A skipDuplicates',
      duplicateRaised === null && secondInsertCount === 0 && rowsAfterA === 1,
      duplicateRaised
        ? `raised: ${duplicateRaised}`
        : `re-insert reported count=${secondInsertCount}, rows=${rowsAfterA}`
    );

    // --- Probe B: the batch commits both statements ------------------------
    await prisma.$transaction([
      prisma.barberService.deleteMany({ where: owned }),
      prisma.barberService.createMany({ data: [pair], skipDuplicates: true }),
    ]);
    const rowsAfterB = await prisma.barberService.count({ where: owned });
    report('B batch commits', rowsAfterB === 1, `rows after delete+create = ${rowsAfterB}`);

    // --- Probe C: a failure inside the batch rolls the delete back ---------
    // The insert references a service id that does not exist, so the second
    // statement fails on the foreign key. If the batch is not atomic, the
    // delete from the first statement survives and the row count drops to 0.
    let batchRejected = false;
    try {
      await prisma.$transaction([
        prisma.barberService.deleteMany({ where: owned }),
        prisma.barberService.createMany({
          data: [{ barberId: barber.id, serviceId: MISSING_SERVICE_ID }],
        }),
      ]);
    } catch {
      batchRejected = true;
    }
    const rowsAfterC = await prisma.barberService.count({ where: owned });
    report(
      'C batch rolls back',
      batchRejected && rowsAfterC === 1,
      `rejected=${batchRejected}, rows preserved = ${rowsAfterC} (expected 1)`
    );

    // --- Probe D: the owner predicate is real SQL, not a hopeful object -----
    // Mock tests prove the repository *sends* `barber.location.ownerId`. Only
    // the database can prove that predicate actually filters. A second Owner
    // row cannot be created to test against — "Exactly one Owner" is a system
    // invariant — so a foreign owner id stands in for one.
    const readAsForeignOwner = await prisma.barberService.findMany({
      where: { barberId: barber.id, barber: { location: { ownerId: FOREIGN_OWNER_ID } } },
      select: { serviceId: true },
    });
    const readAsRealOwner = await prisma.barberService.findMany({
      where: { barberId: barber.id, barber: { location: { ownerId: OWNER_ID } } },
      select: { serviceId: true },
    });
    report(
      'D read is owner-scoped',
      readAsForeignOwner.length === 0 && readAsRealOwner.length === 1,
      `foreign owner sees ${readAsForeignOwner.length}, real owner sees ${readAsRealOwner.length}`
    );

    // --- Probe E: a foreign owner cannot delete another owner's assignment --
    const deleted = await prisma.barberService.deleteMany({
      where: {
        barberId: barber.id,
        serviceId: { in: [service.id] },
        barber: { location: { ownerId: FOREIGN_OWNER_ID } },
      },
    });
    const rowsAfterE = await prisma.barberService.count({ where: owned });
    report(
      'E delete is owner-scoped',
      deleted.count === 0 && rowsAfterE === 1,
      `foreign delete removed ${deleted.count}, rows preserved = ${rowsAfterE}`
    );

    // --- Probe F: groupBy with a relation filter works on the pooler --------
    // The two list pages depend on it; it is as unproven on this stack as the
    // batched transaction was.
    const grouped = await prisma.barberService.groupBy({
      by: ['barberId'],
      where: { barber: { location: { ownerId: OWNER_ID } } },
      _count: { _all: true },
    });
    const groupedForeign = await prisma.barberService.groupBy({
      by: ['barberId'],
      where: { barber: { location: { ownerId: FOREIGN_OWNER_ID } } },
      _count: { _all: true },
    });
    report(
      'F groupBy is supported and scoped',
      grouped.length === 1 && grouped[0]._count._all === 1 && groupedForeign.length === 0,
      `owner groups=${grouped.length}, foreign groups=${groupedForeign.length}`
    );
  } finally {
    await prisma.barberService.deleteMany({ where: owned });
    const leftover = await prisma.barberService.count();
    console.log(`cleanup: BarberService rows remaining = ${leftover}`);
    await prisma.$disconnect();
  }

  if (failures > 0) {
    throw new Error(`${failures} gate probe(s) failed — see design.md D4 for the required fallback`);
  }
  console.log('\nM4 gate passed: batched transaction semantics confirmed on the pooler.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
