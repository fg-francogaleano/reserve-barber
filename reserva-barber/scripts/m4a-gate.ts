// GATE M4a — bookability excludes barbers at closed branches.
//
// The unit tests assert the *shape* of the query object. Only the database can
// show that a nested relation filter carrying two conditions
// (`location: { ownerId, isActive }`) actually discriminates in SQL — and the
// state it needs does not exist naturally, because no branch is deactivated.
//
// This script creates that state, measures, and restores it. Every mutation is
// undone in the `finally` block: the assignment row is deleted and the location
// is set back to active regardless of how the run ends.
//
//   npx tsx scripts/m4a-gate.ts
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma-cli/client';

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

  const service = await prisma.service.findFirst({ select: { id: true, ownerId: true } });
  if (!service) {
    throw new Error('Gate needs at least one service to exist');
  }

  // Pick a pair that is NOT already assigned. Selecting blindly collides with
  // the unique constraint the moment the owner has real assignments — which is
  // the normal state, not an edge case.
  const barber = await prisma.barber.findFirst({
    where: {
      isActive: true,
      location: { isActive: true, ownerId: service.ownerId },
      services: { none: { serviceId: service.id } },
    },
    select: { id: true, locationId: true },
  });
  if (!barber) {
    throw new Error(
      'Gate needs one active barber at an active location who is not already assigned to the chosen service'
    );
  }
  const ownerId = service.ownerId;

  /** Mirrors PrismaBarberServiceRepository.countActiveBarbersByService exactly. */
  const countReachable = () =>
    prisma.barberService.groupBy({
      by: ['serviceId'],
      where: {
        service: { ownerId },
        barber: { isActive: true, location: { ownerId, isActive: true } },
      },
      _count: { _all: true },
    });

  let locationClosed = false;
  let assignmentCreated = false;

  // Measure deltas, never absolutes: the database is the owner's real one and
  // may already hold assignments — including, as this gate found on its first
  // run, one created by the owner mid-session. An absolute expectation makes
  // the gate report a defect in the code when the only thing that changed was
  // the data around it.
  const countFor = async (): Promise<number> => {
    const rows = await countReachable();
    return rows.find((row) => row.serviceId === service.id)?._count._all ?? 0;
  };

  /**
   * Whether **this specific barber** is reachable under the same predicate.
   *
   * The aggregate alone is not a reliable probe: other barbers may already be
   * assigned to the chosen service, and some of them may share the branch being
   * closed — in which case the total drops by more than one and an
   * "exactly one fewer" assertion fails on correct behaviour. Asking about the
   * one row this gate created is immune to whatever else the owner has.
   */
  const isBarberReachable = async (): Promise<boolean> =>
    (await prisma.barberService.count({
      where: {
        barberId: barber.id,
        serviceId: service.id,
        service: { ownerId },
        barber: { isActive: true, location: { ownerId, isActive: true } },
      },
    })) === 1;

  const baseline = await countFor();
  const baselineAssignments = await prisma.barberService.count();

  try {
    await prisma.barberService.create({
      data: { barberId: barber.id, serviceId: service.id },
    });
    assignmentCreated = true;

    const whileOpen = await countFor();
    const reachableWhileOpen = await isBarberReachable();
    report(
      'G branch open counts the barber',
      reachableWhileOpen && whileOpen === baseline + 1,
      `barber reachable=${reachableWhileOpen}, aggregate baseline=${baseline} → open=${whileOpen}`
    );

    await prisma.location.update({
      where: { id: barber.locationId },
      data: { isActive: false },
    });
    locationClosed = true;

    const whileClosed = await countFor();
    const reachableWhileClosed = await isBarberReachable();
    report(
      'H branch closed excludes the barber',
      !reachableWhileClosed && whileClosed < whileOpen,
      `barber reachable=${reachableWhileClosed} (must be false), aggregate open=${whileOpen} → closed=${whileClosed}`
    );

    // The assignment row must survive: closing a branch suppresses bookability,
    // it does not silently unassign anyone.
    const stillAssigned = await prisma.barberService.count({
      where: { barberId: barber.id, serviceId: service.id },
    });
    report(
      'I the assignment itself is untouched',
      stillAssigned === 1,
      `rows=${stillAssigned} (closing a branch must not destroy assignments)`
    );
  } finally {
    if (locationClosed) {
      await prisma.location.update({
        where: { id: barber.locationId },
        data: { isActive: true },
      });
    }
    if (assignmentCreated) {
      await prisma.barberService.deleteMany({
        where: { barberId: barber.id, serviceId: service.id },
      });
    }
    const leftoverAssignments = await prisma.barberService.count();
    const inactiveLocations = await prisma.location.count({ where: { isActive: false } });
    const restored = leftoverAssignments === baselineAssignments && inactiveLocations === 0;
    console.log(
      `cleanup: assignments=${leftoverAssignments} (baseline ${baselineAssignments}), inactive locations=${inactiveLocations}`
    );
    if (!restored) {
      failures += 1;
      console.log('FAIL  cleanup did not restore the original state');
    }
    await prisma.$disconnect();
  }

  if (failures > 0) {
    throw new Error(`${failures} gate probe(s) failed`);
  }
  console.log('\nM4a gate passed: a closed branch removes its barbers from bookability.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
