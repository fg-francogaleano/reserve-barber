import { cache } from 'react';
import type { PrismaClient } from '@/generated/prisma/client';
import { createPrismaClient } from './createClient';

export { createPrismaClient };

/**
 * Returns a Prisma client scoped to the current request. React `cache()` dedupes
 * it within one invocation while guaranteeing a fresh client per request:
 * caching a client at module scope makes later requests reuse sockets opened in
 * an earlier request context, which `workerd` cannot do — the query then hangs
 * until the read timeout. Fails fast with a clear English error when
 * DATABASE_URL is missing.
 *
 * **Unusable outside a request.** `cache()` needs a request store to memoize
 * into, and `process.env` is populated per request by the adapter — neither
 * holds in a scheduled invocation, where bindings arrive as an argument. Code
 * on that path calls `createPrismaClient` directly, and imports it from
 * `./createClient` rather than from here so that React does not follow it into
 * a bundle that has no React in it.
 */
export const getPrismaClient = cache((): PrismaClient => {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('Missing required environment variable: DATABASE_URL');
  }
  return createPrismaClient(connectionString);
});
