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
      // Upsert-by-name: Location.name has no unique constraint in S0,
      // so emulate idempotency with findFirst + create/update.
      const existing = await prisma.location.findFirst({ where: { name: location.name } });
      if (existing) {
        await prisma.location.update({
          where: { id: existing.id },
          data: { address: location.address, ownerId: OWNER_ID, isActive: true },
        });
      } else {
        await prisma.location.create({
          data: { ...location, ownerId: OWNER_ID, isActive: true },
        });
      }
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
