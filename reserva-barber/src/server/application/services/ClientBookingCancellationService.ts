import type {
  ClientCancellationRefusal,
  IBookingRepository,
} from '@/server/domain/repositories/IBookingRepository';
import type { IClock } from '@/server/domain/repositories/IClock';
import type { ILogger } from '@/server/domain/repositories/ILogger';

/**
 * The client cancels their own booking (C1).
 *
 * **A separate class from `BookingCancellationService`, not a second method on
 * it.** They share a port and a rule and nothing else: this one has no owner to
 * scope by, a different vocabulary of outcomes, and it returns a slug because
 * its caller has to send a browser somewhere. Merging them would produce a
 * method that takes "an owner or a token", which is one edit away from
 * accepting neither — on the write that destroys a confirmed appointment.
 *
 * **Nothing here decides whether a booking may be cancelled.** The domain
 * predicate answers that for the control that renders, and the repository asks
 * it again before the write and guards the write on what it read. A third
 * opinion in this service would be a third chance to disagree.
 *
 * **It sends no message.** The client pressed the button and is looking at the
 * page that reports the result, so the notice C2 sends has no counterpart here;
 * and the owner learns from the dashboard, which counts this cancellation the
 * moment `cancelledAt` is written and names the client on the row. Both
 * silences are decisions, recorded in `tech-debt.md` with their triggers.
 */

export type ClientCancellationResult =
  | { readonly outcome: 'cancelled'; readonly slug: string }
  /**
   * Refused, with the reason the client can act on — never the status.
   *
   * The repository reports the status so an operator can read it in a log line;
   * the client is told what to do about it. Passing the status through to the
   * caller would put a database value one edit away from being rendered.
   */
  | {
      readonly outcome: 'notCancellable';
      readonly slug: string;
      readonly reason: ClientCancellationRefusal;
    }
  /** The token matched nothing. No destination, because there is none. */
  | { readonly outcome: 'notFound' };

export class ClientBookingCancellationService {
  constructor(
    private readonly bookings: IBookingRepository,
    private readonly clock: IClock,
    private readonly logger: ILogger
  ) {}

  async cancel(cancellationToken: string): Promise<ClientCancellationResult> {
    const result = await this.bookings.cancelByToken({
      cancellationToken,
      now: new Date(this.clock.now()),
    });

    switch (result.outcome) {
      case 'applied':
        this.log('cancelled', result.bookingId);
        return { outcome: 'cancelled', slug: result.slug };

      case 'notCancellable':
        // Not an error. A client who double-taps, a booking a notification
        // confirmed a moment earlier, and an appointment that began while the
        // confirmation was on screen all land here, and none is a fault — the
        // guard doing its job is the system working.
        this.log('notCancellable', result.bookingId, {
          status: result.status,
          reason: result.reason,
        });
        return { outcome: 'notCancellable', slug: result.slug, reason: result.reason };

      case 'notFound':
        /**
         * **Deliberately silent, and this is the one decision in this file
         * worth arguing about.**
         *
         * Every other outcome requires a real 256-bit token, so only somebody
         * holding a credential can produce those lines. This one is what an
         * anonymous caller reaches, on a public unmetered endpoint, as often as
         * they like — and a line per request would make the log volume of this
         * product something a stranger controls. That is exactly the defect
         * N1's review found one story earlier, beside a comment asserting the
         * opposite.
         *
         * Nothing is lost by the silence: a token that resolves nothing gives
         * an operator nothing to act on, and the response itself is the record.
         */
        return { outcome: 'notFound' };
    }
  }

  /**
   * A decision, identified by booking and outcome.
   *
   * **No token, no slug, no client name, email or phone** — and structurally so
   * rather than by care: this service is handed one string it never logs, and
   * the result it acts on carries no contact detail, so there is nothing here
   * for a later change to log by accident.
   */
  private log(
    outcome: 'cancelled' | 'notCancellable',
    bookingId: string,
    extra: Record<string, unknown> = {}
  ): void {
    this.logger.info('Booking cancellation attempted by client', {
      operation: 'booking.cancelByClient',
      bookingId,
      outcome,
      ...extra,
    });
  }
}
