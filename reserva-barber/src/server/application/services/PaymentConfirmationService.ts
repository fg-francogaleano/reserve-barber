import type { IPaymentRepository } from '@/server/domain/repositories/IPaymentRepository';
import type { IPaymentConfigRepository } from '@/server/domain/repositories/IPaymentConfigRepository';
import type { IPaymentGateway } from '@/server/domain/repositories/IPaymentGateway';
import type { IClock } from '@/server/domain/repositories/IClock';
import type { ILogger } from '@/server/domain/repositories/ILogger';
import { blocksAvailability, type BookingStatus } from '@/server/domain/models/Booking';
import { verifyGatewayPayment } from '@/server/domain/models/Payment';
import {
  CredentialDecryptionError,
  CredentialKeyMissingError,
} from '@/server/domain/errors/PaymentConfigErrors';
import type { BookingConfirmationNotificationService } from './BookingConfirmationNotificationService';

/**
 * What a Mercado Pago notification does to a booking.
 *
 * **The notification body is a hint; Mercado Pago's own API is the authority**
 * (design D1). The handler resolves the `ref` to a payment row — one indexed
 * read, and the cheap rejection that keeps an unauthenticated endpoint from
 * being an amplifier — then asks Mercado Pago about the payment using *that
 * owner's* access token, and verifies three properties against our row before
 * anything transitions.
 *
 * No signature is validated, deliberately and with the reasoning recorded in
 * `tech-debt.md` T60. A signature proves only that Mercado Pago sent the bytes;
 * the re-fetch proves the payment exists, is approved, is for the right amount,
 * and is bound to our booking.
 */

/**
 * Every distinguishable thing that can happen, because "webhook failed" tells
 * an operator nothing.
 *
 * The split into `retry` and everything else is the response policy: only a
 * genuinely transient failure asks Mercado Pago to deliver again. Retrying a
 * notification we correctly decided to ignore is a self-inflicted load loop on
 * an endpoint that also spends an outbound call.
 */
export type ConfirmationOutcome =
  /** The booking moved to CONFIRMED. */
  | 'confirmed'
  /** Approved after the hold lapsed, and the slot had been resold. */
  | 'slotLost'
  /**
   * Approved against a booking that is no longer bookable — cancelled, or
   * expired. Distinct from `slotLost`: nobody took the slot, the appointment
   * itself went away. Same consequence, and it owes a refund just as loudly.
   */
  | 'bookingUnavailable'
  /** The `ref` resolved nothing. Indistinguishable, to the caller, from below. */
  | 'unresolved'
  /** Mercado Pago does not have this payment. The shape a forgery takes. */
  | 'notAtGateway'
  /** Reference, amount or currency did not match our row. */
  | 'mismatch'
  /** Mercado Pago reports something other than approved. */
  | 'notApproved'
  /** Already handled — a duplicate delivery, or an out-of-order one. */
  | 'alreadyProcessed'
  /** A reversal reported after the booking was confirmed. Changes nothing. */
  | 'reversedAfterConfirmation'
  /** Transient. The only outcome that asks for another delivery. */
  | 'retry';

export interface ConfirmationResult {
  readonly outcome: ConfirmationOutcome;
}

/** Mercado Pago's vocabulary for money that came back. */
const REVERSAL_STATUSES = new Set(['refunded', 'charged_back', 'cancelled']);

export class PaymentConfirmationService {
  constructor(
    private readonly payments: IPaymentRepository,
    private readonly paymentConfig: IPaymentConfigRepository,
    private readonly gateway: IPaymentGateway,
    private readonly clock: IClock,
    private readonly logger: ILogger,
    /**
     * Telling the client (N1). Required, not optional (T57): a confirmation
     * this product does not announce is the defect the story exists to close,
     * and an optional dependency is one a future composition root forgets.
     */
    private readonly notifications: BookingConfirmationNotificationService
  ) {}

  async confirm(input: {
    /** The `ref` from the notification URL. Resolves the owner, nothing more. */
    paymentRef: string;
    /** The payment id the notification named. Verified, never trusted. */
    gatewayPaymentId: string;
  }): Promise<ConfirmationResult> {
    // **First, and cheap.** A ref that resolves nothing costs one indexed read
    // and no outbound call. This ordering is the mitigation T60 leans on while
    // no signature is validated.
    const record = await this.payments.findForNotification(input.paymentRef);
    if (record === null) {
      this.logger.warn('Notification reference resolved nothing', {
        operation: 'payment.confirm',
        reason: 'unresolved',
      });
      return { outcome: 'unresolved' };
    }

    let accessToken: string | null;
    try {
      accessToken = await this.paymentConfig.findMercadoPagoAccessToken(record.ownerId);
    } catch (error) {
      if (
        error instanceof CredentialDecryptionError ||
        error instanceof CredentialKeyMissingError
      ) {
        // Not transient — a retry will fail identically until the owner acts —
        // but it must be loud, because the money has moved and nothing else in
        // the product will mention it.
        this.logger.error('Cannot authenticate a notification: credential unreadable', {
          operation: 'payment.confirm',
          bookingId: record.bookingId,
          paymentId: record.paymentId,
          ownerId: record.ownerId,
          reason: error.name,
        });
        return { outcome: 'unresolved' };
      }
      throw error;
    }

    if (accessToken === null) {
      // A notification for a shop whose credentials were removed mid-flight.
      this.logger.warn('Notification for a shop with no Mercado Pago credential', {
        operation: 'payment.confirm',
        bookingId: record.bookingId,
        paymentId: record.paymentId,
      });
      return { outcome: 'unresolved' };
    }

    const fetched = await this.gateway.getPayment(input.gatewayPaymentId, accessToken);

    switch (fetched.status) {
      case 'notFound':
        // Terminal. A payment the owner's own account does not have is what a
        // forged notification looks like, and asking Mercado Pago to retry it
        // would be asking them to redeliver something that cannot resolve.
        this.logger.warn('Notification names a payment Mercado Pago does not have', {
          operation: 'payment.confirm',
          bookingId: record.bookingId,
          paymentId: record.paymentId,
          reason: 'notAtGateway',
        });
        return { outcome: 'notAtGateway' };

      case 'rejected':
        this.logger.error('Mercado Pago rejected the credential during a notification', {
          operation: 'payment.confirm',
          bookingId: record.bookingId,
          ownerId: record.ownerId,
        });
        return { outcome: 'unresolved' };

      case 'unavailable':
        // The one case a retry can fix.
        return { outcome: 'retry' };
    }

    const payment = fetched.payment;

    // Identity before status: "not our payment" and "our payment, and it
    // failed" demand opposite responses, so they are asked as two questions.
    const verified = verifyGatewayPayment(payment, {
      bookingId: record.bookingId,
      amount: record.amount,
    });

    if (!verified.ok) {
      this.logger.error('Notification failed verification against the stored payment', {
        operation: 'payment.confirm',
        bookingId: record.bookingId,
        paymentId: record.paymentId,
        reason: verified.reason,
        // The two amounts, because an operator cannot act on "mismatch" alone.
        // Money is not personal data; nothing here identifies a client.
        expectedAmount: record.amount,
        reportedAmount: payment.transactionAmount,
      });
      return { outcome: 'mismatch' };
    }

    // A reversal on an already-confirmed booking changes nothing (design D8).
    // Cancelling an appointment because a dispute was *filed* — one the owner
    // may win — would silently empty their agenda and leave a client arriving
    // to nothing. A human owns that call; this makes sure they can learn of it.
    if (REVERSAL_STATUSES.has(payment.status) && record.bookingStatus === 'CONFIRMED') {
      this.logger.warn('Payment reversed after the booking was confirmed', {
        operation: 'payment.confirm',
        bookingId: record.bookingId,
        paymentId: record.paymentId,
        gatewayPaymentId: payment.id,
        gatewayStatus: payment.status,
      });
      return { outcome: 'reversedAfterConfirmation' };
    }

    if (payment.status !== 'approved') {
      this.logger.info('Notification for a payment that is not approved', {
        operation: 'payment.confirm',
        bookingId: record.bookingId,
        paymentId: record.paymentId,
        gatewayStatus: payment.status,
      });
      return { outcome: 'notApproved' };
    }

    const now = new Date(this.clock.now());
    const holdIsLive = blocksAvailability(
      {
        startTime: record.startTime,
        endTime: record.endTime,
        status: record.bookingStatus as BookingStatus,
        holdExpiresAt: record.holdExpiresAt,
      },
      now
    );

    /**
     * **The asymmetry is the design, not an optimization.**
     *
     * A booking still inside its hold is still blocking availability, so nobody
     * else could have been offered its slot — there is nothing to race, and no
     * lock is taken. A booking whose hold lapsed stopped blocking, so the slot
     * may have been sold while the client was at the checkout: that path takes
     * the same per-barber advisory lock the booking write takes, and re-checks.
     */
    const result = holdIsLive
      ? await this.payments.confirmWithPayment({
          paymentId: record.paymentId,
          bookingId: record.bookingId,
          gatewayPaymentId: payment.id,
          approvedAt: now,
        })
      : await this.payments.confirmIfSlotFree({
          paymentId: record.paymentId,
          bookingId: record.bookingId,
          barberId: record.barberId,
          startTime: record.startTime,
          endTime: record.endTime,
          gatewayPaymentId: payment.id,
          approvedAt: now,
          now,
        });

    switch (result.outcome) {
      case 'confirmed':
        this.logger.info('Booking confirmed by payment', {
          operation: 'payment.confirm',
          bookingId: record.bookingId,
          paymentId: record.paymentId,
          gatewayPaymentId: payment.id,
          lateConfirmation: !holdIsLive,
        });
        /**
         * **Tell the client, and only from here** (N1).
         *
         * This branch is reached exactly once per booking, because the write
         * above is a conditional update guarded on the status it expected: a
         * redelivery — which is normal operation for this gateway — matches
         * zero rows and lands in `alreadyProcessed` instead. That is what
         * makes the email at-most-once without a second mechanism, and it is
         * why the send hangs off the *outcome* rather than off the booking
         * being `CONFIRMED`. Keyed on the status, this public and replayable
         * endpoint would become a way to send unlimited mail to one real
         * person.
         *
         * After the transaction, never inside it. The notification service is
         * specified never to throw, and this is still awaited rather than
         * abandoned: the response owes Mercado Pago nothing more, and letting
         * a floating promise outlive the request on a Worker is how it gets
         * cancelled halfway.
         */
        await this.notifyConfirmed(record.bookingId);
        return { outcome: 'confirmed' };

      case 'slotLost':
        // The honest ending. Logged at error because a human owes this client a
        // refund and nothing else in the product is going to say so.
        this.logger.error('Payment approved after the slot was taken', {
          operation: 'payment.confirm',
          bookingId: record.bookingId,
          paymentId: record.paymentId,
          gatewayPaymentId: payment.id,
          amount: record.amount,
        });
        return { outcome: 'slotLost' };

      case 'alreadyProcessed':
        this.logger.info('Notification already handled', {
          operation: 'payment.confirm',
          bookingId: record.bookingId,
          paymentId: record.paymentId,
        });
        return { outcome: 'alreadyProcessed' };

      case 'notPending': {
        /**
         * **Two situations reach here and only one of them is routine.**
         *
         * A booking already `CONFIRMED` is a duplicate delivery — the
         * idempotency mechanism doing its job, worth an `info` and nothing
         * more. A booking that is `CANCELLED` or `EXPIRED` is the opposite:
         * an approved payment against an appointment that no longer exists,
         * which is materially the same as the slot-lost branch and owes
         * somebody a refund.
         *
         * They were collapsed into one `info` line until this was caught in
         * review. The path is unreachable today — nothing writes `CANCELLED`
         * until C1/C2 and nothing writes `EXPIRED` until B7 — which is exactly
         * why it had to be decided now rather than discovered by whichever of
         * those ships first.
         */
        if (result.bookingStatus === 'CONFIRMED') {
          this.logger.info('Notification already handled', {
            operation: 'payment.confirm',
            bookingId: record.bookingId,
            paymentId: record.paymentId,
          });
          return { outcome: 'alreadyProcessed' };
        }

        this.logger.error('Payment approved for a booking that no longer exists', {
          operation: 'payment.confirm',
          bookingId: record.bookingId,
          paymentId: record.paymentId,
          gatewayPaymentId: payment.id,
          bookingStatus: result.bookingStatus,
          amount: record.amount,
        });
        return { outcome: 'bookingUnavailable' };
      }
    }
  }

  /**
   * The confirmation email, behind a `catch` this service should never need.
   *
   * `BookingConfirmationNotificationService` is specified never to throw and is
   * tested for it. This guard exists anyway because of what is on the other
   * side of it: an exception escaping here reaches the route's `catch`, becomes
   * a `503`, and asks Mercado Pago to redeliver a confirmation that already
   * succeeded — a redelivery that reports `alreadyProcessed` and, by the rule
   * above, sends nothing. **The failure would erase its own evidence.**
   *
   * A defended contract is cheap; discovering it was broken by watching a
   * booking's confirmation loop through a gateway's retry schedule is not.
   */
  private async notifyConfirmed(bookingId: string): Promise<void> {
    try {
      await this.notifications.notifyConfirmed(bookingId);
    } catch (error) {
      this.logger.error('Confirmation email failed after the booking was confirmed', {
        operation: 'payment.confirm',
        bookingId,
        reason: error instanceof Error ? error.name : 'unknown',
      });
    }
  }
}
