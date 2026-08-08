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
  });
  return new PrismaClient({ adapter });
}

let cachedClient: PrismaClient | null = null;

/**
 * Returns a lazily-created Prisma client reusing a single instance per
 * Worker invocation context. Fails fast with a clear English error when
 * DATABASE_URL is missing.
 */
export function getPrismaClient(): PrismaClient {
  if (cachedClient) {
    return cachedClient;
  }
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('Missing required environment variable: DATABASE_URL');
  }
  cachedClient = createPrismaClient(connectionString);
  return cachedClient;
}
