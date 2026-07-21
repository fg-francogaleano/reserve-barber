// Prisma 7 configuration — connection URLs for CLI commands (migrate, seed).
// The runtime client uses the driver adapter in src/server/infrastructure/prisma/client.ts.
import 'dotenv/config';
import { defineConfig } from 'prisma/config';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'npx tsx prisma/seed.ts',
  },
  // Migrations and seed use the DIRECT connection (port 5432) — never the
  // transaction-mode pooler, which hangs DDL. See design.md D5.
  datasource: {
    url: requireEnv('DIRECT_URL'),
  },
});
