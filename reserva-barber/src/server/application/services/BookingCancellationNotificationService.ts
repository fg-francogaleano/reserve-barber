import type { IBookingRepository } from '@/server/domain/repositories/IBookingRepository';
import type { IEmailSender } from '@/server/domain/repositories/IEmailSender';
import type { ILogger } from '@/server/domain/repositories/ILogger';
import { buildBookingCancellationEmail } from '@/server/domain/models/bookingCancellationEmail';
import { BOOKING_CANCELLATION_EMAIL } from '@/server/domain/models/emailCapability';

/**
 * Telling a client the shop cancelled their appointment (C2).
 *
 * **A separate service from the confirmation's, not a second method on it.**
 * They share the port and the non-fatal rule and nothing else: this one has no
 * origin to resolve, no link to compose and — deliberately — **no clock**,
 * because there is no instant to record. That absence is the design (D5): a
 * confirmation is a promise the product made, so "confirmed and never told" is
 * worth being able to query; a cancellation notice is a courtesy, and a second
 * nullable column with no reader would copy N1's shape without its reason.
 *
 * **Nothing here can fail its caller.** The cancellation has already committed
 * and the slot is already released by the time this runs. A mail provider must
 * not be able to undo a scheduling decision, so every failure becomes a log
 * line and this method always resolves.
 */
export class BookingCancellationNotificationService {
  constructor(
    private readonly bookings: IBookingRepository,
    private readonly sender: IEmailSender,
    private readonly logger: ILogger
  ) {}

  /**
   * Tell the client, for a cancellation that actually applied.
   *
   * Callers MUST invoke this only from the branch where their guarded write
   * matched a row — the same rule the confirmation follows, and for the same
   * reason: keyed on the booking merely *being* `CANCELLED`, a caller could
   * announce the same cancellation repeatedly.
   *
   * It reuses the confirmation's projection rather than adding a second read.
   * That projection is wider than this message needs — it carries a slug and a
   * cancellation token — and the builder's input type omits both, so the extra
   * fields are unreachable from the message rather than merely unused.
   */
  async notifyCancelled(bookingId: string, depositApproved: boolean): Promise<void> {
    try {
      const booking = await this.bookings.findForConfirmationEmail(bookingId);

      if (booking === null) {
        this.logger.error('Cannot compose a cancellation notice: the projection returned nothing', {
          operation: BOOKING_CANCELLATION_EMAIL.operation,
          bookingId,
          reason: 'projectionEmpty',
          cause: 'booking absent, or its shop has no public profile',
        });
        return;
      }

      const { outcome } = await this.sender.send(
        buildBookingCancellationEmail({ booking, depositApproved })
      );

      if (outcome !== 'sent') {
        // Error rather than warn, for the reason the confirmation gives: a
        // client who will arrive to a shop that is not expecting them has not
        // been told, and nothing else in this product will mention it.
        this.logger.error('Could not send a cancellation notice', {
          operation: BOOKING_CANCELLATION_EMAIL.operation,
          bookingId,
          outcome,
        });
        return;
      }

      this.logger.info('Cancellation notice sent', {
        operation: BOOKING_CANCELLATION_EMAIL.operation,
        bookingId,
        outcome,
      });
    } catch (error) {
      // The catch of last resort. Reaching it means the projection read failed,
      // which is exactly the case where the booking is cancelled, the slot is
      // released, and nothing else must be disturbed.
      this.logger.error('Cancellation notice failed unexpectedly', {
        operation: BOOKING_CANCELLATION_EMAIL.operation,
        bookingId,
        reason: error instanceof Error ? error.name : 'unknown',
      });
    }
  }
}
