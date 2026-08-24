/**
 * The scheduled sweep, as its own Worker.
 *
 * **Why this is a second Worker rather than a handler on the first one.**
 * B7 was built first as a `scheduled()` handler on a committed entrypoint that
 * wrapped OpenNext's generated worker (design D1, option A). It worked — the
 * app served correctly through the wrapper and `sweepExpiredHolds` shipped in
 * the bundle — and it was abandoned on a measurement:
 *
 *   | entrypoint                        | gzip        |
 *   | --------------------------------- | ----------- |
 *   | B6, before this story             | 2924.08 KiB |
 *   | wrapper with an empty `scheduled` | 2924.23 KiB |
 *   | wrapper importing the sweep       | 3812.20 KiB |
 *
 * The wrapper itself costs 0.15 KiB. The other 888 KiB is **the Prisma query
 * compiler bundled a second time**: anything the entrypoint imports from
 * `src/` is compiled by wrangler's own esbuild pass, separately from the copy
 * already inside `.open-next/server-functions/default/handler.mjs`, and the
 * output carried the same 1.85 MB wasm under two names. That is over the free
 * plan's 3 MiB ceiling, so the deploy would have been rejected — the B2 failure
 * repeating, in the place `docs/tech-debt.md` T51 predicted it.
 *
 * It is a structural property, not a detail worth working around: **a custom
 * entrypoint cannot import application code that reaches Prisma.** Splitting
 * the job out is what makes the duplication moot — this Worker carries the one
 * copy it needs and the app's Worker goes back to 2924 KiB.
 *
 * The alternative rejected in the same breath was an `/api/cron/…` route
 * invoked over `fetch`, which would have kept one deploy at the cost of a
 * fourth public door in a deny-by-default guard plus a shared secret to defend
 * it. Two deploys is a cheaper price than a new attack surface.
 *
 * **This Worker needs no Next.js build.** The sweep is domain, application and
 * one repository; nothing here imports a page, a route or a React component.
 * Wrangler compiles this file directly.
 *
 * Deployed with its own config:
 *
 *   npx wrangler deploy -c wrangler.cron.jsonc
 *
 * and its own `DATABASE_URL`:
 *
 *   npx wrangler secret put DATABASE_URL -c wrangler.cron.jsonc
 */

// Relative imports, not the `@/` alias. Wrangler compiles this file with its
// own esbuild pass rather than through Next's resolver, and a path mapping that
// happens to work is one more thing that can silently stop working.
import { createPrismaClient } from '../src/server/infrastructure/prisma/createClient';
import { PrismaExpiredHoldRepository } from '../src/server/infrastructure/prisma/PrismaExpiredHoldRepository';
import { ExpiredHoldSweepService } from '../src/server/application/services/ExpiredHoldSweepService';
import { systemClock } from '../src/server/domain/repositories/IClock';
import { logger } from '../src/server/infrastructure/logger';

/**
 * What a scheduled invocation is handed, declared structurally.
 *
 * `@cloudflare/workers-types` is deliberately not added for this: it redeclares
 * `Request`, `Response` and friends, and the Next.js application type-checks
 * against the DOM lib in the same `tsconfig.json`. Two competing definitions of
 * `Request` is a much larger problem than one interface written out by hand.
 */
interface ScheduledEvent {
  readonly cron: string;
  readonly scheduledTime: number;
}

/**
 * **Bindings arrive here, not in `process.env`.**
 *
 * There is no request context in a scheduled invocation, which is why this
 * Worker imports `createPrismaClient` from `createClient.ts` rather than
 * `getPrismaClient` from `client.ts`: the latter is memoized with React's
 * request-scoped `cache()` and reads `process.env`, and neither exists here.
 */
interface WorkerEnv {
  readonly DATABASE_URL?: string;
}

const OPERATION = 'booking.sweepExpiredHolds';

const worker = {
  /**
   * Sweeps abandoned provisional holds into `EXPIRED`.
   *
   * The work is awaited rather than handed to `waitUntil`: a scheduled
   * invocation's lifetime is the handler's promise, and detaching it would let
   * the runtime consider the run finished while the sweep was still writing.
   *
   * Failures are logged and rethrown. Rethrowing is what marks the invocation
   * failed in the platform's own view of the schedule — swallowing it would
   * leave a dead job looking exactly like a healthy one, which is the failure
   * mode this whole capability is written against.
   */
  async scheduled(event: ScheduledEvent, env: WorkerEnv): Promise<void> {
    const connectionString = env.DATABASE_URL;

    if (!connectionString) {
      // Named, and at error level. The application's own startup validation
      // cannot report this: no request started, so it never ran — and this
      // Worker has a secret of its own, set separately from the app's.
      logger.error('Missing required environment variable: DATABASE_URL', {
        operation: OPERATION,
        cron: event.cron,
      });
      throw new Error('Missing required environment variable: DATABASE_URL');
    }

    const db = createPrismaClient(connectionString);

    try {
      const sweep = new ExpiredHoldSweepService(
        new PrismaExpiredHoldRepository(db),
        systemClock,
        logger
      );
      await sweep.sweep();
    } catch (error) {
      logger.error('Expired hold sweep failed', {
        operation: OPERATION,
        cron: event.cron,
        reason: error instanceof Error ? error.name : 'Unknown',
      });
      throw error;
    } finally {
      // The pg adapter retires a connection after a single use because workerd
      // cannot carry a socket across invocation contexts. This invocation is
      // over; release it rather than leaving it to a timeout.
      await db.$disconnect();
    }
  },
};

export default worker;
