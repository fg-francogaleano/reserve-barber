import type { IBookingRepository } from '@/server/domain/repositories/IBookingRepository';
import type { IClock } from '@/server/domain/repositories/IClock';
import type { ILogger } from '@/server/domain/repositories/ILogger';
import type { BookingCancellationNotificationService } from './BookingCancellationNotificationService';

/**
 * The owner cancels a booking (C2).
 *
 * **Nothing here decides whether a booking may be cancelled.** The domain
 * predicate answers that for the row rendering the control, and the repository's
 * guarded update answers it again against the database — which is the answer
 * that counts, because only it is taken under the same statement that writes.
 * A third opinion in this service would be a third chance to disagree.
 *
 * What this layer owns is the vocabulary the dashboard renders and the log line
 * an operator reads.
 */

/**
 * What the owner's surface needs to know, and deliberately not what the
 * repository returns.
 *
 * The repository's `applied` result carries `depositApproved`, which exists for
 * the client's notice and is this service's business rather than the
 * dashboard's. Passing the repository's type straight through would put a field
 * in front of the UI that a later change could render by accident — and "the
 * client's deposit was approved" is not a fact the cancellation confirmation
 * should be tempted to restate.
 */
export type BookingCancellationResult =
  | { readonly outcome: 'cancelled' }
  /** The booking moved between the read and the write; this is what it became. */
  | { readonly outcome: 'notCancellable'; readonly status: string }
  /** Outside this owner's scope, or gone. The two are one answer. */
  | { readonly outcome: 'notFound' };

export class BookingCancellationService {
  constructor(
    private readonly bookings: IBookingRepository,
    private readonly clock: IClock,
    private readonly logger: ILogger,
    /**
     * Telling the client (C2 design D5). Required, not optional (T57).
     *
     * **This is the notice N1 did not have a reason to send.** T72 records the
     * asymmetry: the product emails when nothing is wrong and goes quiet when
     * something is. Here the cause is a deliberate decision by the shop, and
     * the client has no other channel — the page only helps if they still have
     * the link and think to open it.
     */
    private readonly notifications: BookingCancellationNotificationService
  ) {}

  async cancel(bookingId: string, ownerId: string): Promise<BookingCancellationResult> {
    const result = await this.bookings.cancelByOwner({
      bookingId,
      ownerId,
      now: new Date(this.clock.now()),
    });

    switch (result.outcome) {
      case 'applied':
        this.log('cancelled', bookingId);
        /**
         * **Only from this branch**, which the guarded write reaches once per
         * booking. Keyed on the booking merely *being* `CANCELLED`, a second
         * submission would announce the same cancellation again — the rule the
         * confirmation follows, for the same reason.
         *
         * After the transaction, never inside it, and `depositApproved` comes
         * from the write rather than a second read: the transaction is the only
         * place that question has no race.
         */
        await this.notifyCancelled(bookingId, result.depositApproved);
        return { outcome: 'cancelled' };

      case 'notCancellable':
        // Not an error. An owner who double-clicks, and a booking a
        // notification confirmed a moment earlier, both land here and neither
        // is a fault — the guard doing its job is the system working.
        this.log('notCancellable', bookingId, { status: result.status });
        return { outcome: 'notCancellable', status: result.status };

      case 'notFound':
        // Also not an error, and for the reason the receipt review records:
        // from outside, another owner's booking and one that never existed are
        // the same answer, so logging this loudly would make the server's own
        // noise the oracle the response refuses to be.
        this.log('notFound', bookingId);
        return { outcome: 'notFound' };
    }
  }

  /**
   * The notice, behind a `catch` this service should never need.
   *
   * `BookingCancellationNotificationService` is specified never to throw and is
   * tested for it. The guard exists because of what is on the other side: an
   * exception here would surface to the owner as a failed cancellation over a
   * booking the database has already cancelled — and their sensible response,
   * retrying, would match zero rows and report it as no longer cancellable.
   */
  private async notifyCancelled(bookingId: string, depositApproved: boolean): Promise<void> {
    try {
      await this.notifications.notifyCancelled(bookingId, depositApproved);
    } catch (error) {
      this.logger.error('Cancellation notice failed after the booking was cancelled', {
        operation: 'booking.cancel',
        bookingId,
        reason: error instanceof Error ? error.name : 'unknown',
      });
    }
  }

  /**
   * A decision, identified by booking and outcome.
   *
   * **No client name, email, phone or cancellation token** — and structurally
   * so, rather than by care: this service is handed two identifiers and never
   * requests a projection carrying any of them, so there is nothing here for a
   * later change to log by accident.
   */
  private log(
    outcome: BookingCancellationResult['outcome'],
    bookingId: string,
    extra: Record<string, unknown> = {}
  ): void {
    this.logger.info('Booking cancellation attempted by owner', {
      operation: 'booking.cancel',
      bookingId,
      outcome,
      ...extra,
    });
  }
}
