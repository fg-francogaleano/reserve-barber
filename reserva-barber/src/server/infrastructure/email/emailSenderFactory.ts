import type {
  EmailMessage,
  EmailSendResult,
  IEmailSender,
} from '@/server/domain/repositories/IEmailSender';
import type { ILogger } from '@/server/domain/repositories/ILogger';
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
 * `rejected` rather than `retry`: nothing about a missing variable is
 * transient, and a caller treating it as transient would keep a useless outcome
 * alive in the logs.
 */
class UnconfiguredEmailSender implements IEmailSender {
  constructor(
    private readonly missing: readonly string[],
    private readonly logger: ILogger
  ) {}

  async send(_message: EmailMessage): Promise<EmailSendResult> {
    void _message;

    this.logger.error('Confirmation email not sent: missing configuration', {
      operation: 'email.bookingConfirmation',
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
 */
export function createEmailSender(logger: ILogger): IEmailSender {
  const apiKey = process.env[EMAIL_API_KEY_VAR]?.trim();
  const from = process.env[EMAIL_FROM_VAR]?.trim();

  const missing: string[] = [];
  if (!apiKey) missing.push(EMAIL_API_KEY_VAR);
  if (!from) missing.push(EMAIL_FROM_VAR);

  if (!apiKey || !from) {
    return new UnconfiguredEmailSender(missing, logger);
  }

  return new ResendEmailSender(apiKey, from);
}
