import { cache } from 'react';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/generated/prisma/client';

const CONNECTION_TIMEOUT_MS = 10_000;
const QUERY_TIMEOUT_MS = 10_000;

/**
 * Creates a Prisma client backed by the pg driver adapter, connecting through
 * the Supabase Supavisor pooler (transaction mode). Required for the Cloudflare
 * workerd runtime — no native engine binary. See backend-standards.md → Database Patterns.
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

/**
 * Returns a Prisma client scoped to the current request. React `cache()` dedupes
 * it within one invocation while guaranteeing a fresh client per request:
 * caching a client at module scope makes later requests reuse sockets opened in
 * an earlier request context, which `workerd` cannot do — the query then hangs
 * until the read timeout. Fails fast with a clear English error when
 * DATABASE_URL is missing.
 */
export const getPrismaClient = cache((): PrismaClient => {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('Missing required environment variable: DATABASE_URL');
  }
  return createPrismaClient(connectionString);
});
