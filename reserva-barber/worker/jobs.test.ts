import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { REMINDER_CRON, SWEEP_CRON, buildReminderService, runScheduledJob } from './jobs';
import { ResendEmailSender } from '../src/server/infrastructure/email/ResendEmailSender';
import type { ILogger } from '../src/server/domain/repositories/ILogger';

/**
 * The scheduled entrypoint, and the one wiring failure nothing else can catch.
 *
 * B7 could only require that the trigger be fired by hand, because nothing
 * under `worker/` was collected by the test runner. N2 adds it to the globs,
 * for a reason specific to this job: **the reminder claims its rows before it
 * sends.** A sender that resolves unconfigured answers `rejected` for every
 * booking, so every due row is permanently marked as reminded, nobody is
 * reminded, and every page, test and status check still reports correctly. It
 * fails once, silently, and irreversibly.
 *
 * `process.env` is deliberately emptied in these tests. A scheduled invocation
 * has no request context and its bindings arrive on the handler's `env`
 * argument; an implementation that reached for the process environment would
 * pass in Node and fail in production, which is the exact shape of bug this
 * file exists to prevent.
 */
const ORIGINAL = { ...process.env };

function completeEnv() {
  return {
    DATABASE_URL: 'postgresql://user:pass@pooler.example.com:6543/postgres',
    RESEND_API_KEY: 'key-from-binding',
    EMAIL_FROM: 'turnos@barberia.test',
    APP_ORIGIN: 'https://reservabarber.com',
  };
}

function testLogger(): ILogger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Every value this entrypoint might read, removed. Nothing here may fall back
  // to it.
  for (const name of ['DATABASE_URL', 'RESEND_API_KEY', 'EMAIL_FROM', 'APP_ORIGIN']) {
    delete process.env[name];
  }
});

afterEach(() => {
  process.env = { ...ORIGINAL };
});

describe('the reminder composition root', () => {
  it('should_build_a_real_sender_from_the_invocation_environment', () => {
    // The assertion the whole capability's honesty rests on. If this returns
    // the unconfigured stand-in, the job still runs, still claims, still logs a
    // summary, and delivers nothing — forever.
    const { sender } = buildReminderService(completeEnv(), testLogger(), {} as never);

    expect(sender).toBeInstanceOf(ResendEmailSender);
  });

  it('should_not_fall_back_to_the_process_environment', () => {
    // The reverse direction. With the values present in `process.env` and
    // absent from `env`, an implementation reading the wrong one would look
    // healthy here and be unconfigured in workerd.
    process.env.RESEND_API_KEY = 'key-from-process';
    process.env.EMAIL_FROM = 'process@barberia.test';

    const { sender } = buildReminderService(
      { DATABASE_URL: 'postgresql://user:pass@pooler.example.com:6543/postgres' },
      testLogger(),
      {} as never
    );

    expect(sender).not.toBeInstanceOf(ResendEmailSender);
  });

  it('should_pass_the_origin_from_the_environment_into_the_service', () => {
    const { origin } = buildReminderService(completeEnv(), testLogger(), {} as never);

    expect(origin).toBe('https://reservabarber.com');
  });

  it('should_carry_a_null_origin_rather_than_inventing_one', () => {
    const { origin } = buildReminderService(
      { DATABASE_URL: 'postgresql://user:pass@pooler.example.com:6543/postgres' },
      testLogger(),
      {} as never
    );

    expect(origin).toBeNull();
  });
});

/**
 * The guard that stops a deployment burning every reminder it has.
 *
 * **This is the defect the adversarial pass found, and the plan walked toward
 * it deliberately.** T76 requires `RESEND_API_KEY` to stay unset in production
 * while no sending domain is verified. The reminder claims each row *before* it
 * sends, because the claim is the only thing making delivery at-most-once. Put
 * those two together and the first scheduled run claims every due booking,
 * `UnconfiguredEmailSender` answers `rejected` for each of them, and every one
 * is permanently marked as reminded having received nothing.
 *
 * Two documents asserted the opposite — that an unconfigured deployment "claims
 * nothing" — which is what made it worth catching before archive rather than in
 * production.
 *
 * The guard belongs at the composition root rather than in the service: this is
 * where configuration is read, and a service that re-checked it would be a
 * second place for the answer to live.
 */
describe('refusing to run without a usable sender', () => {
  it('should_report_the_missing_variables_by_name', () => {
    const { missingConfiguration } = buildReminderService(
      { DATABASE_URL: 'postgresql://user:pass@pooler.example.com:6543/postgres' },
      testLogger(),
      {} as never
    );

    expect(missingConfiguration).toEqual(['RESEND_API_KEY', 'EMAIL_FROM']);
  });

  it('should_report_nothing_missing_when_the_environment_is_complete', () => {
    const { missingConfiguration } = buildReminderService(
      completeEnv(),
      testLogger(),
      {} as never
    );

    expect(missingConfiguration).toEqual([]);
  });

  it('should_touch_no_database_at_all_when_the_sender_cannot_send', async () => {
    // The whole point. The repository double throws on any call, so a run that
    // reached the candidate query — let alone the claim — fails loudly here
    // rather than silently in production.
    const logger = testLogger();

    // Throws on every access **except `$disconnect`**, and the exception is the
    // point rather than a loophole. The client object is constructed either
    // way — the pg adapter opens no socket until a statement runs — and the
    // invocation still releases it, which is not a database touch. What must
    // never happen is a *query*: the candidate read, or worse the claim.
    const unreachable = new Proxy(
      {},
      {
        get(_target, property) {
          if (property === '$disconnect') return async () => undefined;
          throw new Error(`the database must not be queried: reached '${String(property)}'`);
        },
      }
    );

    await runScheduledJob(
      { cron: REMINDER_CRON, scheduledTime: Date.now() },
      { DATABASE_URL: 'postgresql://user:pass@pooler.example.com:6543/postgres' },
      logger,
      () => unreachable as never
    );

    expect(logger.error).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        operation: 'email.bookingReminder',
        reason: 'notConfigured',
        missing: 'RESEND_API_KEY, EMAIL_FROM',
      })
    );
  });

  it('should_still_emit_one_summary_so_a_refusal_is_not_silence', async () => {
    // Silence is this job's failure mode, so a refusal must not also be silent.
    // A run that declined and a run that never fired have to look different.
    const logger = testLogger();
    const unreachable = new Proxy({}, { get: () => async () => undefined });

    await runScheduledJob(
      { cron: REMINDER_CRON, scheduledTime: Date.now() },
      { DATABASE_URL: 'postgresql://user:pass@pooler.example.com:6543/postgres' },
      logger,
      () => unreachable as never
    );

    expect(logger.info).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        operation: 'email.bookingReminder',
        claimed: 0,
        sent: 0,
        candidatesScanned: 0,
      })
    );
  });

  it('should_not_mark_the_invocation_failed_for_a_configuration_it_is_told_to_have', async () => {
    // T76 requires the key to be absent in production. That is a handled state,
    // not a fault: marking the invocation failed every hour would train an
    // operator to ignore the one signal this job has.
    const unreachable = new Proxy({}, { get: () => async () => undefined });

    await expect(
      runScheduledJob(
        { cron: REMINDER_CRON, scheduledTime: Date.now() },
        { DATABASE_URL: 'postgresql://user:pass@pooler.example.com:6543/postgres' },
        testLogger(),
        () => unreachable as never
      )
    ).resolves.toBeUndefined();
  });
});

describe('the schedule dispatch', () => {
  it('should_declare_a_distinct_expression_per_job', () => {
    expect(SWEEP_CRON).not.toBe(REMINDER_CRON);
  });

  it('should_refuse_an_invocation_with_no_database_binding_by_name', async () => {
    await expect(
      runScheduledJob({ cron: SWEEP_CRON, scheduledTime: Date.now() }, {})
    ).rejects.toThrow(/DATABASE_URL/);
  });

  it('should_report_a_schedule_that_matches_no_job_rather_than_run_one', async () => {
    // A cron expression added to the configuration without a job behind it. The
    // failure mode this whole family of jobs is written against is a job that
    // silently does nothing, so an unrecognised schedule must be loud rather
    // than a quiet no-op — and it must NOT fall through to whichever job
    // happens to be listed first.
    const logger = testLogger();

    await expect(
      runScheduledJob({ cron: '0 0 1 1 *', scheduledTime: Date.now() }, completeEnv(), logger)
    ).rejects.toThrow(/schedule/i);
  });

  it('should_attribute_an_unknown_schedule_to_the_dispatcher_and_not_to_a_job', async () => {
    // **Caught by reading the real log from the local runtime, not by a test.**
    // The first version used a two-way ternary defaulting to the sweep, so a
    // configuration fault — a cron expression with no job behind it — filed
    // itself under `booking.sweepExpiredHolds`. An operator filtering on that
    // name would have counted a missing wiring as a sweep failure, which is the
    // C2 mislabel in a new place: `emailCapability.ts` exists to stop exactly
    // this for messages, and jobs deserve the same discipline.
    const logger = testLogger();

    await expect(
      runScheduledJob({ cron: '0 0 1 1 *', scheduledTime: Date.now() }, completeEnv(), logger)
    ).rejects.toThrow();

    const operations = (logger.error as ReturnType<typeof vi.fn>).mock.calls.map(
      (call) => call[1]?.operation
    );

    expect(operations.length).toBeGreaterThan(0);
    expect(operations).not.toContain('booking.sweepExpiredHolds');
    expect(operations).not.toContain('email.bookingReminder');
    expect([...new Set(operations)]).toEqual(['worker.scheduled']);
  });
});

/**
 * The entrypoint's export map, and the defect it exists to prevent.
 *
 * **workerd treats every named export of an entrypoint module as an entry in
 * the service's export map** and refuses to start when one of them is not a
 * handler:
 *
 *   Uncaught TypeError: Incorrect type for map entry 'REMINDER_CRON':
 *   the provided value is not of type 'function or ExportedHandler'.
 *
 * N2's first version put the schedules and the composition root on the
 * entrypoint so this very file could import them. **Every unit test passed,
 * `tsc --noEmit` passed, the bundle built, and the Worker could not start.**
 * The only thing that caught it was firing the trigger by hand against the
 * local runtime — which is why `cloudflare-deployment` requires that step and
 * why B7's spec calls it out.
 *
 * Asserted against the module's runtime exports rather than its source text: a
 * source scan cannot tell an export from the word "export" in a comment, which
 * is a mistake this change already made three times in other files.
 */
describe('the entrypoint export map', () => {
  it('should_export_nothing_but_the_default_handler', async () => {
    const entrypoint = await import('./scheduled');

    // Type-only exports are erased before workerd sees them. A `const` or a
    // `function` is not, and is what breaks startup.
    expect(Object.keys(entrypoint)).toEqual(['default']);
  });

  it('should_export_a_default_carrying_a_scheduled_handler', async () => {
    const entrypoint = await import('./scheduled');

    expect(typeof entrypoint.default.scheduled).toBe('function');
  });
});
