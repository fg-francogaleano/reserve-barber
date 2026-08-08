// Idempotent seed — safe to run multiple times (upsert-by-name semantics).
// Run with: npx prisma db seed
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma-cli/client';

/**
 * Fixed Owner id created by the A1 migration (see prisma/migrations/*_add_owner_and_location_fk).
 * This script seeds domain data only — it never creates the Owner row itself
 * (see `data-persistence` spec, "Exactly one Owner").
 */
const OWNER_ID = 'owner-root';

const SEED_LOCATIONS: ReadonlyArray<{ name: string; address: string }> = [
  { name: 'Sucursal Centro', address: 'Av. Corrientes 1234, CABA' },
  { name: 'Sucursal Norte', address: 'Av. Cabildo 2200, CABA' },
];

async function main(): Promise<void> {
  const connectionString = process.env.DIRECT_URL;
  if (!connectionString) {
    throw new Error('Missing required environment variable: DIRECT_URL');
  }

  const adapter = new PrismaPg({ connectionString });
  const prisma = new PrismaClient({ adapter });

  try {
    for (const location of SEED_LOCATIONS) {
      // Upsert on the (ownerId, name) unique key added by M1. The previous
      // implementation emulated this with `findFirst({ where: { name } })`
      // because no unique key existed yet — a lookup that was **not scoped by
      // owner**. It is harmless with a single Owner and actively wrong with
      // two: it would match another owner's location by name and reassign it
      // here via `ownerId`, silently transferring their branch. Scoping the
      // key is what keeps this script honest to the rule the repository
      // interface enforces everywhere else (design D7).
      await prisma.location.upsert({
        where: { ownerId_name: { ownerId: OWNER_ID, name: location.name } },
        update: { address: location.address, isActive: true },
        create: { ...location, ownerId: OWNER_ID, isActive: true },
      });
    }

    const count = await prisma.location.count();
    console.log(`Seed complete. Location rows: ${count}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error('Seed failed:', error);
  process.exitCode = 1;
});
