/**
 * The scheduled Worker's entrypoint, and **nothing else**.
 *
 * ---
 *
 * **THIS MODULE MUST EXPORT ONE THING: the default handler.**
 *
 * Not a style rule. workerd treats every **named** export of an entrypoint
 * module as an entry in the service's export map, and refuses to start when one
 * of them is not a handler:
 *
 *   Uncaught TypeError: Incorrect type for map entry 'REMINDER_CRON':
 *   the provided value is not of type 'function or ExportedHandler'.
 *
 * N2's first version of this file exported the two cron expressions and the
 * reminder's composition root alongside the handler, so that a test could
 * assert them. **Every unit test passed, `tsc --noEmit` passed, the bundle
 * built, and the Worker could not start.** Nothing in this repository would
 * have caught it before deploy except the step that caught it: firing the
 * scheduled trigger by hand against the local runtime, which is exactly what
 * `cloudflare-deployment` requires and why.
 *
 * Type-only exports are erased before workerd sees them and are harmless. A
 * `const` or a `function` is not.
 *
 * So everything worth testing lives in `./jobs` — the schedules, the
 * composition roots, the dispatch — and this file is the three lines that
 * cannot be tested any other way.
 *
 * ---
 *
 * The reasoning for **why the scheduled work is a separate Worker at all**, and
 * for **why two jobs are dispatched rather than run from one handler body**, is
 * recorded at the top of `./jobs`.
 *
 * Deployed with its own config:
 *
 *   npx wrangler deploy -c wrangler.cron.jsonc
 *   npx wrangler dev -c wrangler.cron.jsonc --test-scheduled
 */

import { runScheduledJob, type ScheduledEvent, type WorkerEnv } from './jobs';

// Named locally but NOT exported, which is the distinction that matters here:
// the lint rule wants a variable, and workerd only ever sees `default`.
const worker = {
  async scheduled(event: ScheduledEvent, env: WorkerEnv): Promise<void> {
    await runScheduledJob(event, env);
  },
};

export default worker;
