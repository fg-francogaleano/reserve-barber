import type { IBookingRepository } from '@/server/domain/repositories/IBookingRepository';
import type { IEmailSender } from '@/server/domain/repositories/IEmailSender';
import type { IClock } from '@/server/domain/repositories/IClock';
import type { ILogger } from '@/server/domain/repositories/ILogger';
import { buildBookingConfirmationEmail } from '@/server/domain/models/bookingConfirmationEmail';
import { isPubliclyRoutableHost } from '@/server/domain/models/publicOrigin';
import { BOOKING_CONFIRMATION_EMAIL } from '@/server/domain/models/emailCapability';

/**
 * Telling a client their appointment is real (N1).
 *
 * **One service for both trigger paths**, injected into the Mercado Pago
 * notification's composition root and the receipt review's. The alternative —
 * a copy of "read, build, send, record, log" in each — is two chances to log an
 * address or forget a `try`, on the two paths where nobody is watching.
 *
 * **Nothing here can fail its caller.** Every method resolves, and every
 * failure becomes a log line. Both callers have already committed a
 * transaction by the time this runs: the notification handler answers Mercado
 * Pago `200`, and the owner's approval has already confirmed a booking. A
 * throw from this service would turn a successful confirmation into a `503`
 * requesting a redelivery that — because the send is keyed on the confirming
 * *outcome*, never on the observed status — could never resend the message
 * anyway.
 *
 * **The trigger rule lives at the call sites, not here.** This service does as
 * it is told; it is the callers that must invoke it only for the outcome of a
 * guarded write. That is deliberate: `notifyConfirmed` is a small honest name
 * for what this does, and a service that re-checked the booking's status would
 * be a second, weaker copy of a guarantee the transaction already provides.
 */
export class BookingConfirmationNotificationService {
  constructor(
    private readonly bookings: IBookingRepository,
    private readonly sender: IEmailSender,
    private readonly clock: IClock,
    private readonly logger: ILogger,
    /**
     * The deployment's configured public origin, or `null`.
     *
     * Passed in rather than read here, so this stays testable without an
     * environment and so the composition root remains the one place that reads
     * configuration — the pattern every other service in this layer follows.
     */
    private readonly configuredOrigin: string | null
  ) {}

  /**
   * Compose and send the confirmation for a booking that has just been
   * confirmed.
   *
   * Callers MUST invoke this only from the branch where their guarded write
   * actually applied. Calling it because a booking *is* `CONFIRMED` would make
   * the public notification endpoint a way to send unlimited mail to one real
   * person, since every redelivery re-reaches that state.
   */
  async notifyConfirmed(bookingId: string): Promise<void> {
    try {
      const booking = await this.bookings.findForConfirmationEmail(bookingId);

      if (booking === null) {
        /**
         * The booking confirmed a moment ago, so this is a fault rather than a
         * normal absence — but still nothing to fail: the appointment is real
         * whether or not this read worked.
         *
         * **The reason names what this code can actually distinguish, which is
         * nothing.** The projection answers `null` for two unrelated causes —
         * the booking is gone, or its shop has no `BusinessProfile` and so no
         * slug to build a link on — and they are indistinguishable from here.
         * An earlier version reported `bookingNotFound` for both, which would
         * have sent an operator hunting for a missing row when the real cause
         * was a missing profile. The second cause is unreachable today (the
         * public slug *is* the profile, so a booking cannot exist without one),
         * and a log line that asserts a cause it cannot know is wrong whether
         * or not the branch fires.
         */
        this.logger.error('Cannot compose a confirmation: the projection returned nothing', {
          operation: BOOKING_CONFIRMATION_EMAIL.operation,
          bookingId,
          reason: 'projectionEmpty',
          cause: 'booking absent, or its shop has no public profile',
        });
        return;
      }

      const origin = this.usableOrigin(bookingId);
      const message = buildBookingConfirmationEmail({ booking, origin });

      const { outcome } = await this.sender.send(message);

      if (outcome !== 'sent') {
        // Error rather than warn for all three. A client who paid has not been
        // told, and no other surface in this product will mention it — the same
        // reasoning the slot-lost branch of the notification handler gives.
        this.logger.error('Could not send a booking confirmation', {
          operation: BOOKING_CONFIRMATION_EMAIL.operation,
          bookingId,
          outcome,
        });
        return;
      }

      await this.recordSent(bookingId);

      this.logger.info('Booking confirmation sent', {
        operation: BOOKING_CONFIRMATION_EMAIL.operation,
        bookingId,
        outcome,
      });
    } catch (error) {
      // The catch of last resort. Reaching it means the projection read failed
      // — the database is unreachable — which is exactly the case where the
      // booking is confirmed and nothing else must be disturbed.
      this.logger.error('Booking confirmation failed unexpectedly', {
        operation: BOOKING_CONFIRMATION_EMAIL.operation,
        bookingId,
        reason: error instanceof Error ? error.name : 'unknown',
      });
    }
  }

  /**
   * The origin to build the link on, or `null` when none is usable.
   *
   * **Two checks and not one.** A configured value can be absent, and it can be
   * present and unreachable — a loopback or private address, which is every
   * local run of this project. B5 measured what the second costs on the payment
   * path: Mercado Pago accepted a `localhost` notification URL, the client paid,
   * and nothing in the product ever learned. In an inbox the mistake is worse,
   * because a message cannot be redeployed.
   *
   * Either way the message still goes out, without the link. Logged at error,
   * because the only other symptom is a confirmation nobody can act on.
   */
  private usableOrigin(bookingId: string): string | null {
    const configured = this.configuredOrigin?.trim();

    if (configured) {
      try {
        if (isPubliclyRoutableHost(new URL(configured).host)) {
          return new URL(configured).origin;
        }
      } catch {
        // A malformed value is an absent one, handled below.
      }
    }

    this.logger.error('Sending a confirmation with no link: no usable public origin', {
      operation: BOOKING_CONFIRMATION_EMAIL.operation,
      bookingId,
      reason: 'originMissing',
    });
    return null;
  }

  /**
   * Record that the provider accepted it — and never let that failure matter.
   *
   * Its own `try` rather than relying on the outer one, so a failure here is
   * reported as what it is (the message *was* sent, the bookkeeping was not)
   * rather than as an unexpected failure of the whole notification.
   */
  private async recordSent(bookingId: string): Promise<void> {
    try {
      await this.bookings.markConfirmationEmailSent(bookingId, new Date(this.clock.now()));
    } catch (error) {
      this.logger.error('Confirmation sent but not recorded', {
        operation: BOOKING_CONFIRMATION_EMAIL.operation,
        bookingId,
        reason: error instanceof Error ? error.name : 'unknown',
      });
    }
  }
}
