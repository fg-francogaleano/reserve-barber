/**
 * Which message a send belongs to, and the two names every line about it uses.
 *
 * **This exists because a shared component reported the wrong capability.** N1
 * wrote the sender factory for one message and hard-coded "Confirmation email"
 * and `email.bookingConfirmation` into the line it emits when configuration is
 * missing. C2 then reused that factory for the cancellation notice, which is
 * the correct thing to do with a factory — and every cancellation that could
 * not be sent was reported as a failed *confirmation*, under the confirmation's
 * operation name.
 *
 * That is not a cosmetic mislabel. `booking-confirmation-email` requires every
 * send attempt to be logged "under an operation name that identifies this
 * capability", and an operator filtering on `email.bookingCancellation` saw a
 * bare `rejected` with no cause, while one filtering on
 * `email.bookingConfirmation` counted cancellations as confirmations.
 *
 * **So the name is a value now, not a literal.** The application service that
 * logs the outcome and the infrastructure sender that logs the missing
 * configuration read the same object, which is what makes them impossible to
 * disagree. A third message type gets a constant here and cannot inherit
 * somebody else's identity by default — the factory takes this argument and has
 * no fallback, for the reason T57 gives about optional dependencies.
 *
 * It lives in the domain because both layers may import it and neither may
 * import the other.
 */

export interface EmailCapability {
  /**
   * The `operation` field on every log line about this message.
   *
   * The value an operator greps for, so it is written out in full rather than
   * composed from a prefix: a name assembled at two call sites is a name that
   * can be assembled differently at a third.
   */
  readonly operation: string;
  /**
   * What was not sent, as the subject of an English log sentence.
   *
   * Deliberately not the Spanish the client sees. Log messages are technical
   * artifacts and `base-standards.md` §2 keeps those in English.
   */
  readonly subject: string;
}

/** The message that tells a client their appointment is real (N1). */
export const BOOKING_CONFIRMATION_EMAIL: EmailCapability = {
  operation: 'email.bookingConfirmation',
  subject: 'Confirmation email',
};

/** The message that tells a client the shop ended their appointment (C2). */
export const BOOKING_CANCELLATION_EMAIL: EmailCapability = {
  operation: 'email.bookingCancellation',
  subject: 'Cancellation notice',
};
