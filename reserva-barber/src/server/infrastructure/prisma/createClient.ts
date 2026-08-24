import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/generated/prisma/client';

const CONNECTION_TIMEOUT_MS = 10_000;
const QUERY_TIMEOUT_MS = 10_000;

/**
 * Creates a Prisma client backed by the pg driver adapter, connecting through
 * the Supabase Supavisor pooler (transaction mode). Required for the Cloudflare
 * workerd runtime — no native engine binary. See backend-standards.md → Database Patterns.
 *
 * **This lives apart from `client.ts` so that a caller with no request context
 * can reach it without importing one.** `getPrismaClient` is memoized with
 * React's `cache()`, which means importing that module executes `cache(...)` at
 * load time and pulls React into whatever bundle the importer belongs to. The
 * scheduled sweep worker (B7) is not a Next.js runtime and has no React in it;
 * the split is what keeps it that way.
 */
export function createPrismaClient(connectionString: string): PrismaClient {
  const adapter = new PrismaPg({
    connectionString,
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
    query_timeout: QUERY_TIMEOUT_MS,
    statement_timeout: QUERY_TIMEOUT_MS,
    // Supavisor transaction mode: no prepared statements across requests.
    max: 5,
    // Workers cannot reuse a socket across request contexts — retire each
    // connection after a single use so none is ever carried over.
    maxUses: 1,
  });
  return new PrismaClient({ adapter });
}
