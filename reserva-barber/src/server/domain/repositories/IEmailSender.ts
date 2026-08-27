/**
 * Outbound port for transactional email.
 *
 * **This port never throws, and that is a correctness property rather than a
 * style preference.**
 *
 * Its first caller sits on the Mercado Pago notification path, which answers
 * `200` to everything it handled, ignored or refused, and `503` only for a
 * genuinely transient failure — because a `503` is a request for redelivery. If
 * a provider outage surfaced here as an exception, it would propagate to the
 * route's `catch`, become that `503`, and ask Mercado Pago to redeliver a
 * confirmation **that already succeeded**. The redelivery would find the
 * booking `CONFIRMED`, report `alreadyProcessed`, and — because the send is
 * keyed on the confirming *outcome* and never on the observed status — send
 * nothing at all. So the failure would erase its own evidence while spending an
 * outbound call on every delivery attempt.
 *
 * Its second caller is the owner's receipt approval, which has already
 * committed a transaction by the time this runs. An exception there would turn
 * a successful approval into a failed-looking action over a booking that is
 * confirmed in the database.
 *
 * Returning the failure as a value makes both shapes unreachable rather than
 * merely avoided by a `try` that a later change could remove.
 */

/**
 * A composed message. Every field is already final: the port neither formats
 * nor escapes, because the rules for both belong to the domain builder that
 * produced this and are testable there without a transport.
 *
 * `to` is a single address, never a list assembled by parsing. `subject` is
 * built from server-held values — a guest-supplied string in a header is a
 * second message with an attacker-chosen recipient.
 */
export interface EmailMessage {
  readonly to: string;
  readonly subject: string;
  /**
   * The plain-text part, and not a courtesy. It is where a link rendered only
   * as a styled control disappears, and a forwarded or degraded rendering is
   * exactly the case where the reader most needs the URL.
   */
  readonly text: string;
  readonly html: string;
}

/**
 * Every distinguishable thing that can happen, because "email failed" tells an
 * operator nothing.
 *
 * **`throttled` is deliberately split from `rejected`.** They look the same at
 * the call site — no message was delivered, nothing is retried — and they lead
 * to completely different action. A rejection is a wrong request and stays
 * wrong. Being rate-limited or over quota means the shop has **stopped
 * notifying its clients**, most likely on its busiest day, while every booking
 * still confirms and every page still works. That failure is invisible by
 * construction, so collapsing it into a generic rejection would hide the one
 * outcome an operator most needs to find in a log.
 */
export type EmailSendOutcome =
  /** The provider accepted the message for delivery. NOT proof of delivery. */
  | 'sent'
  /** Refused for a reason another attempt cannot change. */
  | 'rejected'
  /** Rate-limited or over quota. Nothing is wrong with the message. */
  | 'throttled'
  /** Transient: the provider erred, the transport failed, or the call timed out. */
  | 'retry';

export interface EmailSendResult {
  readonly outcome: EmailSendOutcome;
}

export interface IEmailSender {
  /**
   * Hand one message to the provider.
   *
   * Resolves for every outcome, including failure. Implementations catch their
   * own transport errors and their own abort, and **never** attach a provider
   * response body to the result: a rejection payload routinely echoes the
   * submitted fields, which here are the recipient's address and whatever link
   * the message carried.
   */
  send(message: EmailMessage): Promise<EmailSendResult>;
}
