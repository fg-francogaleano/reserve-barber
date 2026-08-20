import type {
  BookingForPaymentInitiation,
  IBookingRepository,
} from '@/server/domain/repositories/IBookingRepository';
import type {
  IPaymentRepository,
  PaymentRecord,
} from '@/server/domain/repositories/IPaymentRepository';
import type { IPaymentConfigRepository } from '@/server/domain/repositories/IPaymentConfigRepository';
import type { IPaymentGateway } from '@/server/domain/repositories/IPaymentGateway';
import type { IClock } from '@/server/domain/repositories/IClock';
import type { ILogger } from '@/server/domain/repositories/ILogger';
import { blocksAvailability, type BookingStatus } from '@/server/domain/models/Booking';
import { isPubliclyRoutableHost } from '@/server/domain/models/publicOrigin';
import {
  CredentialDecryptionError,
  CredentialKeyMissingError,
} from '@/server/domain/errors/PaymentConfigErrors';

/**
 * Opens a Mercado Pago checkout for a held booking.
 *
 * **The deposit is read, never computed.** `DepositPolicy` is not imported
 * here and a test asserts it: the amount is the snapshot the booking carries
 * (`data-model.md` §11), and recomputing it would reject a client paying a
 * checkout created moments before the owner edited their policy — the payment
 * correct, and the system calling it wrong.
 *
 * **Nothing the client sends shapes the charge.** The amount, the reference,
 * the expiry and the return URL all come from the booking row. The request
 * supplies one thing: a cancellation token, which identifies the booking and
 * is then deliberately kept out of everything sent to Mercado Pago.
 */

/**
 * Where the client goes, or why they cannot go there.
 *
 * Every refusal carries the `slug`, because every refusal has to render on that
 * shop's confirmation page — a client refused a payment must land back where
 * their turn is, not on an error with no way onward. `notFound` is the one
 * exception: there is no booking, so there is no page to return to.
 *
 * The failure members are separate rather than one `error` because they are
 * different sentences to a person: a shop that has not configured payments, a
 * credential that cannot be read, a deposit the gateway refuses, and a gateway
 * that is simply down are four different things, and only one of them is worth
 * retrying immediately.
 */
export type PaymentInitiationResult =
  | { readonly outcome: 'redirect'; readonly initPoint: string; readonly slug: string }
  | { readonly outcome: 'notFound' }
  | { readonly outcome: 'notPayable'; readonly slug: string }
  | { readonly outcome: 'holdExpired'; readonly slug: string }
  | { readonly outcome: 'notConfigured'; readonly slug: string }
  | { readonly outcome: 'credentialUnreadable'; readonly slug: string }
  | { readonly outcome: 'chargeRefused'; readonly slug: string }
  | { readonly outcome: 'originNotReachable'; readonly slug: string }
  | { readonly outcome: 'credentialRejected'; readonly slug: string }
  | { readonly outcome: 'gatewayUnavailable'; readonly slug: string };

export interface PaymentInitiationRequest {
  readonly cancellationToken: string;
  /** This deployment's own origin, for the two absolute URLs Mercado Pago needs. */
  readonly origin: string;
}

export class PaymentInitiationService {
  /**
   * **No optional parameters on this path** (T57). B4's runtime found a
   * repository wired into one composition root and not the other precisely
   * because an argument was optional, and an omitted optional argument
   * compiles, typechecks and passes every unit test that constructs the service
   * directly.
   */
  constructor(
    private readonly bookings: IBookingRepository,
    private readonly payments: IPaymentRepository,
    private readonly paymentConfig: IPaymentConfigRepository,
    private readonly gateway: IPaymentGateway,
    private readonly clock: IClock,
    private readonly logger: ILogger
  ) {}

  async initiate(request: PaymentInitiationRequest): Promise<PaymentInitiationResult> {
    const booking = await this.bookings.findForPaymentInitiation(request.cancellationToken);

    // A token matching nothing discloses nothing about whether it ever existed.
    if (booking === null) return { outcome: 'notFound' };

    const slug = booking.publicSlug;

    if (booking.status !== 'PENDING_PAYMENT') {
      return { outcome: 'notPayable', slug };
    }

    // The same predicate the availability read and the booking write call. A
    // lapsed hold is a slot already back on sale, and opening a checkout over
    // it would be selling something we no longer have.
    // IClock speaks epoch milliseconds; the blocking predicate speaks instants.
    const now = new Date(this.clock.now());
    const live = blocksAvailability(
      {
        startTime: booking.startTime,
        endTime: booking.endTime,
        status: booking.status as BookingStatus,
        holdExpiresAt: booking.holdExpiresAt,
      },
      now
    );
    if (!live) return { outcome: 'holdExpired', slug };

    // A payment that already has its checkout is the whole answer. Asked before
    // anything else is created or decrypted: a client who double-tapped must
    // reach the same checkout, not a second charge and not an error telling
    // somebody who succeeded that something went wrong.
    const existing = await this.payments.findLiveByBookingId(booking.id);
    if (existing !== null && existing.mpInitPoint !== null) {
      return { outcome: 'redirect', initPoint: existing.mpInitPoint, slug };
    }

    /**
     * **Before anything, because after the charge is too late.**
     *
     * Mercado Pago validates that a callback URL is *well formed*, not that it
     * can be reached — measured, not assumed: a preference addressed to
     * `https://localhost:8787` was accepted, a client paid it, the return died
     * on a connection that does not exist, and the notification went to an
     * address nothing could deliver to. The booking stayed `PENDING_PAYMENT`
     * with a real approved charge against it.
     *
     * Nothing downstream can recover from that, because the only thing that
     * would tell us the payment happened is the notification we just made
     * undeliverable. So the refusal belongs here, before the client is sent
     * anywhere and before a single peso moves.
     */
    if (!isPubliclyRoutableHost(new URL(request.origin).host)) {
      this.logger.error('Refusing to take a payment on an unreachable origin', {
        operation: 'payment.initiate',
        bookingId: booking.id,
        origin: request.origin,
      });
      return { outcome: 'originNotReachable', slug };
    }

    // **Before creating anything.** A shop with no usable credential must not
    // leave an orphan payment row behind, because that row would occupy the
    // booking's single live slot and block the retry that follows the owner
    // fixing their configuration.
    let accessToken: string | null;
    try {
      accessToken = await this.paymentConfig.findMercadoPagoAccessToken(booking.ownerId);
    } catch (error) {
      if (
        error instanceof CredentialDecryptionError ||
        error instanceof CredentialKeyMissingError
      ) {
        // Named, not swallowed: the presence gate the booking flow uses asks
        // the database whether a token exists, and an undecryptable envelope
        // answers yes. This is the only place the difference surfaces, and the
        // owner learns it here or not at all.
        this.logger.error('Mercado Pago credential unreadable', {
          operation: 'payment.initiate',
          bookingId: booking.id,
          ownerId: booking.ownerId,
          reason: error.name,
        });
        return { outcome: 'credentialUnreadable', slug };
      }
      throw error;
    }

    if (accessToken === null) {
      return { outcome: 'notConfigured', slug };
    }

    const payment = existing ?? (await this.openPayment(booking));
    // The database awarded the live slot to a concurrent tap, and that tap had
    // already finished its preference. Same answer as any other repeat.
    if (payment.mpInitPoint !== null) {
      return { outcome: 'redirect', initPoint: payment.mpInitPoint, slug };
    }

    const preference = await this.gateway.createPreference(
      {
        title: booking.serviceName,
        // The snapshot. Never recomputed — see the note on this class.
        amount: booking.depositAmount,
        // The booking id, never the cancellation token (design D3).
        externalReference: booking.id,
        notificationUrl: `${request.origin}/api/webhooks/mercadopago?ref=${payment.id}`,
        /**
         * **A landing route, not the confirmation page.**
         *
         * The confirmation page is addressed by the cancellation token, so
         * naming it here would hand Mercado Pago a live credential — stored in
         * their preference, visible in their dashboard — which is exactly what
         * `external_reference` carrying the booking id already avoids, and what
         * B4's `Referrer-Policy: no-referrer` was added to prevent through the
         * other channel.
         *
         * The two obvious alternatives are both worse. Putting the payment id
         * here and resolving the booking from it would make `ref` authorize
         * something, when its whole safety argument is that it authorizes
         * nothing. Minting a second return-only secret would be two secrets for
         * one holder, which B4 rejected when it chose to address the
         * confirmation page by the token it already had.
         *
         * So the token travels in an httpOnly cookie the initiation sets, and
         * this route reads it back — the same mechanism, and the same
         * `SameSite=Lax` reasoning, that carries B4's rejected form values.
         * Built from the booking's own shop, so a submitted slug cannot steer
         * where a payment returns to.
         */
        backUrl: `${request.origin}/b/${slug}/pago/retorno`,
        // Layer one against the late payment: Mercado Pago refuses a checkout
        // begun after the hold has lapsed. `holdExpiresAt` is non-null here —
        // the status is PENDING_PAYMENT and a check constraint requires it.
        expiresAt: booking.holdExpiresAt ?? booking.startTime,
      },
      accessToken
    );

    switch (preference.status) {
      case 'created':
        await this.payments.attachPreference({
          paymentId: payment.id,
          preferenceId: preference.preferenceId,
          initPoint: preference.initPoint,
        });
        return { outcome: 'redirect', initPoint: preference.initPoint, slug };

      case 'invalid':
        /**
         * The request, not the credential — and **not necessarily the amount**.
         *
         * An earlier version called this `amountRefused` and told the client
         * their deposit had been refused. The preview's first real payment
         * proved that wrong: a $2.000 deposit, far above every published
         * minimum, refused with `invalid_auto_return` because Mercado Pago will
         * not accept a `localhost` return URL. The client was told the amount
         * was the problem and the owner would have been sent to change a
         * deposit policy that was correct.
         *
         * So the cause goes to the log, where it can be acted on, and the
         * client gets the same message as every other shop-side failure —
         * because from where they are standing it *is* the same situation.
         */
        this.logger.error('Mercado Pago refused the preference request', {
          operation: 'payment.initiate',
          bookingId: booking.id,
          paymentId: payment.id,
          amount: booking.depositAmount,
          gatewayError: preference.reason ?? 'unspecified',
        });
        return { outcome: 'chargeRefused', slug };

      case 'rejected':
        this.logger.error('Mercado Pago rejected the stored credential', {
          operation: 'payment.initiate',
          bookingId: booking.id,
          ownerId: booking.ownerId,
        });
        return { outcome: 'credentialRejected', slug };

      case 'unavailable':
        // The payment row is left as it is, with no preference attached, so the
        // next submission retries rather than reporting a payment in progress.
        this.logger.warn('Mercado Pago unavailable while creating a preference', {
          operation: 'payment.initiate',
          bookingId: booking.id,
          paymentId: payment.id,
        });
        return { outcome: 'gatewayUnavailable', slug };
    }
  }

  private async openPayment(booking: BookingForPaymentInitiation): Promise<PaymentRecord> {
    const result = await this.payments.createPendingMercadoPago({
      bookingId: booking.id,
      amount: booking.depositAmount,
    });
    return result.payment;
  }
}
