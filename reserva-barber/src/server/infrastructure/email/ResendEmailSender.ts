import type {
  EmailMessage,
  EmailSendResult,
  IEmailSender,
} from '@/server/domain/repositories/IEmailSender';

/**
 * The one Resend call this product makes, over the platform `fetch`.
 *
 * **No SDK, deliberately**, and the reasoning is inherited whole from
 * `MercadoPagoGateway`: `tech-debt.md` T51 records that the Worker sits under
 * Cloudflare's free-plan script ceiling by a margin Cloudflare measures more
 * strictly than wrangler reports. Two endpoints did not justify a vendor
 * package there; one endpoint justifies it less here. `npm i resend` is the
 * obvious first move on this story and it is the wrong one.
 *
 * Every property below is inherited from that gateway for the same reasons it
 * had them: an injected transport so tests never reach the network, a bounded
 * timeout, the credential in a header and never a URL, and **nothing from a
 * response ever escaping this file**.
 *
 * That last one transfers exactly rather than by analogy. Mercado Pago's
 * rejection payloads echo the credential they rejected; Resend's `422` echoes
 * the submitted `to`, `subject` and `html` — which for this product is **the
 * client's address and the cancellation link**, a credential in string form. A
 * body that reaches a log is a leak in both cases, so this adapter does not
 * read one at all.
 *
 * This module imports nothing from the database layer, which is the structural
 * form of "no provider call inside a transaction".
 */

/** Documented. The only endpoint this product uses. */
export const RESEND_URL = 'https://api.resend.com/emails';

/**
 * Short, because nobody is watching.
 *
 * The same reasoning `PAYMENT_TIMEOUT_MS` carries: this adapter's callers are
 * Mercado Pago's notification handler and an owner's already-committed
 * approval. Neither has a person waiting on the provider, and a request held
 * open helps no one — on the notification path it walks toward Mercado Pago's
 * own delivery timeout, which triggers a redelivery that cannot resend the
 * message anyway.
 */
export const EMAIL_TIMEOUT_MS = 5000;

/** The credential is wrong, or the request is. Another attempt changes neither. */
const TERMINAL_STATUSES = new Set([400, 401, 403, 404, 422]);

/** Rate-limited or over quota. Its own outcome; see `IEmailSender`. */
const THROTTLE_STATUS = 429;

export class ResendEmailSender implements IEmailSender {
  /**
   * The transport is injected so tests never reach the network, and so the
   * timeout behaviour is provable rather than assumed.
   */
  constructor(
    private readonly apiKey: string,
    /** A verified sender on the configured domain. Never guest-supplied. */
    private readonly from: string,
    private readonly transport: typeof fetch = fetch
  ) {}

  async send(message: EmailMessage): Promise<EmailSendResult> {
    let response: Response;

    try {
      response = await this.transport(RESEND_URL, {
        method: 'POST',
        headers: {
          // In a header, never a query parameter: a key in a URL lands in
          // access logs, proxy caches and browser history.
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: this.from,
          // A single address in a one-element list, which is the shape this API
          // takes. Never a list assembled by parsing a string — that is how one
          // message becomes two with a recipient nobody chose.
          to: [message.to],
          subject: message.subject,
          text: message.text,
          html: message.html,
        }),
        // Bounded, always.
        signal: AbortSignal.timeout(EMAIL_TIMEOUT_MS),
      });
    } catch {
      // Swallowed on purpose, twice over. The thrown error may quote the
      // request — the `Authorization` header included — and **this port must
      // never throw**: its first caller sits on a webhook whose `catch` answers
      // `503`, which would ask Mercado Pago to redeliver a confirmation that
      // already succeeded and which, by the trigger rule, could never resend
      // this message.
      return { outcome: 'retry' };
    }

    if (response.status === THROTTLE_STATUS) return { outcome: 'throttled' };

    if (TERMINAL_STATUSES.has(response.status)) return { outcome: 'rejected' };

    if (!response.ok) return { outcome: 'retry' };

    // The body is deliberately not read. Nothing in this result depends on it,
    // and the provider's message id has no reader in this product — the fact
    // worth keeping is "accepted", which the status already carries.
    return { outcome: 'sent' };
  }
}
