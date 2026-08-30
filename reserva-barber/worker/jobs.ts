/**
 * The scheduled Worker: two jobs, two schedules, one deploy.
 *
 * **Why this is a second Worker rather than a handler on the application's.**
 * B7 was built first as a `scheduled()` handler on a committed entrypoint that
 * wrapped OpenNext's generated worker (design D1, option A). It worked — the
 * app served correctly through the wrapper and `sweepExpiredHolds` shipped in
 * the bundle — and it was abandoned on a measurement:
 *
 *   | entrypoint                        | gzip        |
 *   | --------------------------------- | ----------- |
 *   | B6, before that story             | 2924.08 KiB |
 *   | wrapper with an empty `scheduled` | 2924.23 KiB |
 *   | wrapper importing the sweep       | 3812.20 KiB |
 *
 * The wrapper itself costs 0.15 KiB. The other 888 KiB is **the Prisma query
 * compiler bundled a second time**: anything the entrypoint imports from
 * `src/` is compiled by wrangler's own esbuild pass, separately from the copy
 * already inside `.open-next/server-functions/default/handler.mjs`, and the
 * output carried the same 1.85 MB wasm under two names.
 *
 * At the time that was over the free plan's 3 MiB ceiling and the deploy would
 * have been rejected. **T51 has since closed** — Franco took Workers Paid
 * before N1, so the ceiling is 10 MiB — and the split stands anyway, on T51's
 * own closing note: shipping the query compiler twice was a
 * correctness-of-bundling problem, not a size-limit one, and 10 MiB does not
 * make it a good idea. The structural rule is unchanged: **a custom entrypoint
 * cannot import application code that reaches Prisma** without duplicating it.
 *
 * The alternative rejected in the same breath was an `/api/cron/…` route
 * invoked over `fetch`, which would have kept one deploy at the cost of a
 * fourth public door in a deny-by-default guard plus a shared secret to defend
 * it. Two deploys is a cheaper price than a new attack surface.
 *
 * **This Worker needs no Next.js build.** Both jobs are domain, application and
 * one repository each; nothing here imports a page, a route or a React
 * component. Wrangler compiles this file directly.
 *
 * ---
 *
 * **Why two jobs are dispatched rather than called from one handler (N2).**
 *
 * Each job rethrows on failure, deliberately: rethrowing is what marks the
 * invocation failed in the platform's own view of the schedule, and a dead job
 * that looks healthy is the failure this whole family of jobs is written
 * against. Running both from one handler body would destroy that on both sides
 * — either the reminder's fault would mark a healthy sweep failed, or the
 * sweep's rethrow would stop the reminder ever reporting.
 *
 * Dispatching on `event.cron` keeps two independent failure domains inside one
 * deployment, and lets each job carry the cadence it actually needs.
 *
 * Deployed with its own config:
 *
 *   npx wrangler deploy -c wrangler.cron.jsonc
 *
 * and its own secrets, set separately from the application Worker's:
 *
 *   npx wrangler secret bulk secret.json -c wrangler.cron.jsonc
 */

// Relative imports, not the `@/` alias. Wrangler compiles this file with its
// own esbuild pass rather than through Next's resolver, and a path mapping that
// happens to work is one more thing that can silently stop working.
import { createPrismaClient } from '../src/server/infrastructure/prisma/createClient';
import { PrismaExpiredHoldRepository } from '../src/server/infrastructure/prisma/PrismaExpiredHoldRepository';
import { PrismaBookingReminderRepository } from '../src/server/infrastructure/prisma/PrismaBookingReminderRepository';
import { ExpiredHoldSweepService } from '../src/server/application/services/ExpiredHoldSweepService';
import { BookingReminderService } from '../src/server/application/services/BookingReminderService';
import {
  createEmailSenderFrom,
  missingEmailConfiguration,
} from '../src/server/infrastructure/email/emailSenderFactory';
import { BOOKING_REMINDER_EMAIL } from '../src/server/domain/models/emailCapability';
import { systemClock } from '../src/server/domain/repositories/IClock';
import { logger as defaultLogger } from '../src/server/infrastructure/logger';
import type { IEmailSender } from '../src/server/domain/repositories/IEmailSender';
import type { ILogger } from '../src/server/domain/repositories/ILogger';
import type { PrismaClient } from '../src/generated/prisma/client';

/**
 * What a scheduled invocation is handed, declared structurally.
 *
 * `@cloudflare/workers-types` is deliberately not added for this: it redeclares
 * `Request`, `Response` and friends, and the Next.js application type-checks
 * against the DOM lib in the same `tsconfig.json`. Two competing definitions of
 * `Request` is a much larger problem than one interface written out by hand.
 */
export interface ScheduledEvent {
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
 *
 * **N2 makes the same point about the email configuration**, which is why
 * `createEmailSenderFrom` takes its values as arguments. Some workerd
 * compatibility dates do populate `process.env` from bindings; depending on
 * that would make this job's correctness a property of a runtime behaviour
 * nobody here has measured — the assumption B5 was written to refuse.
 *
 * Every value is optional at the type level, because a deploy can omit any of
 * them and each absence has its own handled consequence: no `DATABASE_URL` is
 * fatal and named, a missing provider key disables sending and is named per
 * message, and a missing `APP_ORIGIN` sends the message without its link.
 */
export interface WorkerEnv {
  readonly DATABASE_URL?: string;
  readonly RESEND_API_KEY?: string;
  readonly EMAIL_FROM?: string;
  readonly APP_ORIGIN?: string;
}

/**
 * Every five minutes. A data-freshness choice, not a correctness one: a lapsed
 * hold stopped blocking its slot the instant it lapsed, because availability
 * reads `holdExpiresAt` rather than the status.
 */
export const SWEEP_CRON = '*/5 * * * *';

/**
 * Hourly. Also a data-freshness choice, and a wider one: at a 24-hour lead
 * nothing a client or an owner can see depends on the message landing within
 * five minutes, and 288 daily invocations against a pooler capped at five
 * connections buys nothing.
 *
 * **The reminder's candidate rule does not depend on this value.** Its window
 * ends at the appointment rather than being centred on a target instant, so
 * anything a missed run skipped is still a candidate on the next one. The
 * cadence can be changed without touching a rule, a query or an index — which
 * is exactly what a window centred on `now + lead` would have forbidden.
 */
export const REMINDER_CRON = '0 * * * *';

const SWEEP_OPERATION = 'booking.sweepExpiredHolds';

/** The dispatcher's own name, for a failure that belongs to no job. */
const DISPATCH_OPERATION = 'worker.scheduled';

/**
 * Which job a failure belongs to.
 *
 * Three answers, not two. A schedule that matches no job is a **configuration**
 * fault and must not borrow a job's identity — an operator filtering on the
 * sweep's name would otherwise count a missing wiring as a sweep failure, which
 * is the C2 mislabel in a new place.
 */
function operationFor(cron: string): string {
  if (cron === SWEEP_CRON) return SWEEP_OPERATION;
  if (cron === REMINDER_CRON) return BOOKING_REMINDER_EMAIL.operation;
  return DISPATCH_OPERATION;
}

function requireDatabase(env: WorkerEnv, logger: ILogger, cron: string): string {
  if (!env.DATABASE_URL) {
    // Named, and at error level. The application's own startup validation
    // cannot report this: no request started, so it never ran — and this
    // Worker has secrets of its own, set separately from the app's.
    logger.error('Missing required environment variable: DATABASE_URL', {
      operation: DISPATCH_OPERATION,
      cron,
    });
    throw new Error('Missing required environment variable: DATABASE_URL');
  }

  return env.DATABASE_URL;
}

/**
 * The reminder's composition root, **exported so it can be asserted**.
 *
 * This is the one wiring in the product whose failure is invisible everywhere.
 * The reminder claims its rows *before* it sends, because the claim is the only
 * thing making delivery at-most-once — so a sender that resolves unconfigured
 * answers `rejected` for every booking, marks every due row as reminded, and
 * delivers nothing. Permanently, on the first run, with every page, test and
 * status check still reporting correctly.
 *
 * B7 could only ask for the trigger to be fired by hand, because nothing under
 * `worker/` was collected by the test runner. N2 added it to the globs so this
 * function could be called directly with an environment and its collaborators
 * inspected.
 *
 * The origin is **not** validated here — `BookingReminderService` resolves it
 * through the shared origin module, which refuses loopback and private
 * addresses and logs once per run when none is usable. This root only decides
 * whether a value was configured at all.
 *
 * **`missingConfiguration` is why this returns a record rather than a service.**
 * `runReminders` refuses to run at all when it is non-empty — see there for what
 * that prevents.
 *
 * `db` is **required and has no default**. An earlier version defaulted it to an
 * empty object so a test could inspect the wiring without a database, which is
 * precisely the hole T57 records: an optional constructor dependency the type
 * system stops guarding, on a production composition root, for a test's
 * convenience. The tests pass their own stub instead.
 */
export function buildReminderService(
  env: WorkerEnv,
  logger: ILogger,
  db: PrismaClient
): {
  service: BookingReminderService;
  sender: IEmailSender;
  origin: string | null;
  missingConfiguration: readonly string[];
} {
  const configuration = { apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM };
  const sender = createEmailSenderFrom(configuration, logger, BOOKING_REMINDER_EMAIL);

  const origin = env.APP_ORIGIN?.trim() ? env.APP_ORIGIN.trim() : null;

  const service = new BookingReminderService(
    new PrismaBookingReminderRepository(db),
    sender,
    systemClock,
    logger,
    origin
  );

  return {
    service,
    sender,
    origin,
    missingConfiguration: missingEmailConfiguration(configuration),
  };
}

async function runSweep(db: PrismaClient, logger: ILogger): Promise<void> {
  const sweep = new ExpiredHoldSweepService(
    new PrismaExpiredHoldRepository(db),
    systemClock,
    logger
  );
  await sweep.sweep();
}

/**
 * The reminder run, and the refusal that has to come before it.
 *
 * **A deployment with no usable sender must not claim anything.** This is the
 * one place the ordering that makes the reminder correct becomes dangerous: the
 * claim precedes the send, so an unconfigured sender would answer `rejected`
 * for every booking it was handed and leave all of them permanently marked as
 * reminded. Nobody reminded, no retry, and every page, test and status check
 * still reporting correctly.
 *
 * That is not a hypothetical configuration. **T76 requires the provider key to
 * be absent in production** until a sending domain is verified, so the very
 * first scheduled run on the intended deployment would have burned every due
 * booking. Two documents asserted the opposite — that such a deployment "claims
 * nothing" — which is now true because of this function rather than in spite of
 * it.
 *
 * The refusal is **not** an invocation failure. It is the state the deployment
 * was told to be in; marking the invocation failed every hour would train an
 * operator to ignore the only signal this job has. It is an error line naming
 * the variables, plus a zero summary — because a run that declined and a run
 * that never fired must not look the same.
 */
async function runReminders(db: PrismaClient, env: WorkerEnv, logger: ILogger): Promise<void> {
  const { service, missingConfiguration } = buildReminderService(env, logger, db);

  if (missingConfiguration.length > 0) {
    logger.error('Booking reminders not run: missing configuration', {
      operation: BOOKING_REMINDER_EMAIL.operation,
      reason: 'notConfigured',
      // The variable names, never their values.
      missing: missingConfiguration.join(', '),
    });

    logger.info('Booking reminder run complete', {
      operation: BOOKING_REMINDER_EMAIL.operation,
      candidatesScanned: 0,
      due: 0,
      claimed: 0,
      sent: 0,
      failed: 0,
      outcomes: { rejected: 0, throttled: 0, retry: 0 },
      batches: 0,
      durationMs: 0,
      skipped: 'notConfigured',
    });

    return;
  }

  await service.run();
}

/**
 * Runs the job this schedule belongs to.
 *
 * The work is awaited rather than handed to `waitUntil`: a scheduled
 * invocation's lifetime is the handler's promise, and detaching it would let
 * the runtime consider the run finished while the job was still writing.
 *
 * Failures are logged and rethrown. Rethrowing is what marks the invocation
 * failed in the platform's own view of the schedule — swallowing it would leave
 * a dead job looking exactly like a healthy one, which is the failure mode this
 * whole capability family is written against.
 *
 * `logger` is a parameter with a default so the dispatch can be asserted
 * without capturing global output. The runtime never passes it.
 */
export async function runScheduledJob(
  event: ScheduledEvent,
  env: WorkerEnv,
  logger: ILogger = defaultLogger,
  /**
   * How to build the database client.
   *
   * A parameter with a default so a test can prove that the reminder's refusal
   * path **touches no database at all** — the only way to assert an absence of
   * queries is to make any query throw. The runtime never passes it, and unlike
   * the `db` default this replaces, it is a factory rather than a stand-in
   * object: there is no shape of it that silently half-works.
   */
  createDb: (connectionString: string) => PrismaClient = createPrismaClient
): Promise<void> {
  const connectionString = requireDatabase(env, logger, event.cron);
  const db = createDb(connectionString);

  try {
    if (event.cron === SWEEP_CRON) {
      await runSweep(db, logger);
      return;
    }

    if (event.cron === REMINDER_CRON) {
      await runReminders(db, env, logger);
      return;
    }

    /**
     * A schedule with no job behind it — an expression added to the
     * configuration and never wired here.
     *
     * **Loud, and never a fall-through to whichever job is listed first.**
     * Silently running the wrong job on the wrong cadence is worse than running
     * none, and silently running none is the exact failure this family of jobs
     * exists to make visible.
     */
    logger.error('No job is registered for this schedule', {
      operation: DISPATCH_OPERATION,
      cron: event.cron,
    });
    throw new Error(`No job is registered for schedule: ${event.cron}`);
  } catch (error) {
    logger.error('Scheduled job failed', {
      // **Attributed by schedule, with a neutral name for one that matches no
      // job.** The first version of this line used a two-way ternary defaulting
      // to the sweep, so an unrecognised cron — a configuration error, not a
      // sweep failure — filed itself under `booking.sweepExpiredHolds`. Caught
      // by reading the real log from the local runtime, and it is the C2
      // mislabel repeating in a new place: an operator filtering on the sweep's
      // name would have counted a config mistake as a sweep fault. That defect
      // is exactly what `emailCapability.ts` exists to prevent for messages;
      // the same discipline applies to jobs.
      operation: operationFor(event.cron),
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
}
