import type {
  EmailMessage,
  EmailSendResult,
  IEmailSender,
} from '@/server/domain/repositories/IEmailSender';
import type { ILogger } from '@/server/domain/repositories/ILogger';
import type { EmailCapability } from '@/server/domain/models/emailCapability';
import { ResendEmailSender } from './ResendEmailSender';

/**
 * Building the email sender, and what happens when it cannot be built.
 *
 * **The key is validated here — at the composition root of the one feature that
 * uses it — and never in the application's global startup validation.** That is
 * the rule `PAYMENT_CREDENTIALS_KEY` established: a deploy missing a
 * per-feature secret must break that feature alone, not every page. Here the
 * stakes are sharper than usual, because the caller is the Mercado Pago
 * notification endpoint: a global check that threw would take down payment
 * confirmation itself over a missing mail credential, turning "clients are not
 * being emailed" into "money moves and no booking confirms".
 *
 * So a missing key produces a *sender that cannot send* rather than an
 * exception. Bookings still confirm, the failure is named in the log, and the
 * confirmation page's could-not-send state does the rest.
 */

/** Named so the log line can be acted on without reading this file. */
export const EMAIL_API_KEY_VAR = 'RESEND_API_KEY';
export const EMAIL_FROM_VAR = 'EMAIL_FROM';

/**
 * The sender used when configuration is absent.
 *
 * **It reports itself when a message was actually going to be sent, and never
 * at construction.** The first version logged in the constructor, and the
 * comment there claimed that produced "one line to find, not hundreds". The
 * adversarial pass measured the opposite: composition roots are per-request
 * functions, so three POSTs carrying references that resolved *nothing*
 * produced three `error` lines. That is one line per request on a **public,
 * unauthenticated endpoint** — log volume any stranger can drive, on the exact
 * endpoint already flagged as unmetered (T55, T60) — plus one for every render
 * of the owner's receipt queue, where nobody was sending anything either.
 *
 * Logging at send time bounds the cardinality to **one line per confirmed
 * booking**, which is the event that actually matters, and puts it out of reach
 * of an anonymous caller: a forged notification never reaches a confirming
 * outcome, so it never reaches this method.
 *
 * **It reports the capability it was built for, and never a fixed one.** The
 * first version named the confirmation in both the sentence and the operation,
 * because the confirmation was the only caller. C2 then reused this factory for
 * the cancellation notice — the correct use of a factory — and every
 * cancellation that could not be sent filed itself under
 * `email.bookingConfirmation`, while the cancellation's own line carried a bare
 * `rejected` with no cause. That ran in production, on the only mail path an
 * owner could reach while no provider key was set.
 *
 * `rejected` rather than `retry`: nothing about a missing variable is
 * transient, and a caller treating it as transient would keep a useless outcome
 * alive in the logs.
 */
class UnconfiguredEmailSender implements IEmailSender {
  constructor(
    private readonly missing: readonly string[],
    private readonly logger: ILogger,
    private readonly capability: EmailCapability
  ) {}

  async send(_message: EmailMessage): Promise<EmailSendResult> {
    void _message;

    this.logger.error(`${this.capability.subject} not sent: missing configuration`, {
      operation: this.capability.operation,
      reason: 'notConfigured',
      // The variable names, never their values, and never the message. A name
      // is what an operator needs; a value here would be the credential, and
      // the message would be the recipient's address and their booking link.
      missing: this.missing.join(', '),
    });

    return { outcome: 'rejected' };
  }
}

/**
 * The sender this deployment can actually use.
 *
 * Reads the two configuration values — one a secret, one not — and returns a
 * working sender or one that reports its own absence. Never throws, because its
 * callers are two paths that have both already committed money-bearing writes
 * by the time they reach it.
 *
 * **Both values are required and neither has a default.** `EMAIL_FROM`
 * especially: a plausible-looking fallback is worse than nothing here, because
 * a provider's shared onboarding sender delivers only to the account owner's
 * own address. That configuration passes a verification done from the owner's
 * inbox and silently drops every real client — the one failure shape this
 * feature is least able to detect.
 *
 * **`capability` is required and has no default**, so a message type added
 * later cannot inherit whichever identity happened to be written first. That is
 * T57's rule about optional dependencies applied to a name rather than to a
 * collaborator, and it is the specific hole the cancellation notice fell
 * through.
 */
export function createEmailSender(logger: ILogger, capability: EmailCapability): IEmailSender {
  return createEmailSenderFrom(
    { apiKey: process.env[EMAIL_API_KEY_VAR], from: process.env[EMAIL_FROM_VAR] },
    logger,
    capability
  );
}

/** The two values, however the caller came by them. */
export interface EmailConfiguration {
  readonly apiKey: string | undefined;
  readonly from: string | undefined;
}

/**
 * The same decision, with the configuration handed in rather than read.
 *
 * **This exists because a scheduled invocation has no request context.** N2's
 * reminder job runs on the cron Worker, where bindings arrive on the handler's
 * `env` argument and `process.env` is not populated from them — the same
 * property that makes `worker/scheduled.ts` build its own Prisma client from a
 * connection string instead of using the request-memoized factory.
 *
 * **Not left to the runtime, deliberately.** Some workerd compatibility dates
 * do populate `process.env` from deployment bindings. Depending on that would
 * make this feature's correctness a property of a runtime behaviour nobody here
 * has measured — the assumption B5 was written to refuse, having measured
 * `Intl` and `fetch` rather than trusting them. An explicit parameter costs one
 * signature and cannot be wrong.
 *
 * **Why the stakes are higher on the scheduled path than on either request
 * path.** The reminder job claims its rows *before* it sends, because that
 * claim is the only thing making delivery at-most-once. An unconfigured sender
 * therefore answers `rejected` for every booking it was handed, and every one
 * of them stays permanently marked as reminded — nobody reminded, no retry, and
 * every page, test and status check still reporting correctly. The confirmation
 * path fails visibly on a page; this one fails once, silently, and for good.
 *
 * Values are trimmed and empty-after-trim is treated as absent, which is the
 * byte-hygiene failure B7 lost an hour to twice: a secret uploaded as an empty
 * string lists as present and behaves as missing.
 */
export function createEmailSenderFrom(
  configuration: EmailConfiguration,
  logger: ILogger,
  capability: EmailCapability
): IEmailSender {
  const missing = missingEmailConfiguration(configuration);

  if (missing.length > 0) {
    return new UnconfiguredEmailSender(missing, logger, capability);
  }

  return new ResendEmailSender(
    configuration.apiKey!.trim(),
    configuration.from!.trim()
  );
}

/**
 * Which of the two values a deployment is missing, by name.
 *
 * **Separate from building the sender because one caller needs the answer
 * BEFORE it does anything else.** Both request-served paths can afford to
 * discover a missing key at send time: the booking is already confirmed, the
 * failure is logged, and the page tells the client the truth. N2's reminder
 * cannot. It claims each row before sending — the claim is the only thing
 * making delivery at-most-once — so an unconfigured deployment would claim
 * every due booking and deliver nothing, permanently, on its first run.
 *
 * Its composition root therefore asks this first and refuses to run at all,
 * which is what makes "the key is deliberately unset in production" (T76) a
 * handled state rather than a slow-motion data loss.
 *
 * Empty-after-trim counts as absent: a secret uploaded as an empty string lists
 * as present and behaves as missing, which is the byte-hygiene failure B7 lost
 * an hour to twice.
 */
export function missingEmailConfiguration(
  configuration: EmailConfiguration
): readonly string[] {
  const missing: string[] = [];
  if (!configuration.apiKey?.trim()) missing.push(EMAIL_API_KEY_VAR);
  if (!configuration.from?.trim()) missing.push(EMAIL_FROM_VAR);
  return missing;
}
