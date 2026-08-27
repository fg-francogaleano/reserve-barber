import type {
  ITransferReceiptRepository,
  PendingReceipt,
  ReviewResult,
} from '@/server/domain/repositories/ITransferReceiptRepository';
import type { IOwnerReceiptStorage } from '@/server/domain/repositories/IReceiptStorage';
import type { IClock } from '@/server/domain/repositories/IClock';
import type { ILogger } from '@/server/domain/repositories/ILogger';
import type { BookingConfirmationNotificationService } from './BookingConfirmationNotificationService';

/**
 * The owner's review queue, and the two decisions it leads to.
 *
 * **Nothing here verifies a payment, and the naming is deliberate about it.**
 * There is no bank integration and a receipt image is trivially fabricated, so
 * this service presents evidence to a person and records what that person
 * decided. It does not "validate", "check" or "confirm" a transfer, and no
 * later reader should be able to infer from a name here that it does.
 */

/** One row of the queue, with a signed address for its file. */
export interface ReviewableReceipt extends PendingReceipt {
  /**
   * A short-lived signed URL, or `null` when one could not be produced.
   *
   * Null rather than a throw: a storage hiccup must not empty a queue the owner
   * needs to work through. The row still renders with its appointment, client
   * and expected amount — everything except the file — and says so.
   */
  readonly fileUrl: string | null;
}

export class ReceiptReviewService {
  constructor(
    private readonly receipts: ITransferReceiptRepository,
    private readonly storage: IOwnerReceiptStorage,
    private readonly clock: IClock,
    private readonly logger: ILogger,
    /**
     * Telling the client their turn is real (N1). Required, not optional (T57).
     *
     * **This is the path where the email is the only channel.** A Mercado Pago
     * client is looking at a page when their booking confirms; this one closed
     * the tab after uploading a receipt and was told a human would decide.
     */
    private readonly notifications: BookingConfirmationNotificationService
  ) {}

  /**
   * The pending queue, oldest first, each row carrying a freshly signed link.
   *
   * **Signed at request time and never persisted.** The column holds an object
   * key, because the bucket is private: no URL resolves without credentials and
   * a stored signature would be wrong within the hour.
   *
   * Signing runs concurrently across the queue rather than in sequence — each
   * is an independent round trip, and a serial loop would make a ten-row queue
   * ten times slower than a one-row one for no reason.
   */
  async listPending(ownerId: string): Promise<readonly ReviewableReceipt[]> {
    const pending = await this.receipts.findPendingForOwner(ownerId);

    return Promise.all(
      pending.map(async (receipt) => ({
        ...receipt,
        fileUrl: await this.signOrReport(receipt),
      }))
    );
  }

  private async signOrReport(receipt: PendingReceipt): Promise<string | null> {
    try {
      const signed = await this.storage.signForOwner(receipt.filePath);
      return signed.url;
    } catch (error) {
      // The key is logged because the owner may need it to find the object by
      // hand; it contains no personal data, only identifiers.
      this.logger.error('Could not sign a receipt for review', {
        operation: 'receipts.sign',
        receiptId: receipt.receiptId,
        cause: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /** Approves: receipt, payment and booking, under the per-barber lock. */
  async approve(receiptId: string, ownerId: string): Promise<ReviewResult> {
    const result = await this.receipts.approve({
      receiptId,
      ownerId,
      now: new Date(this.clock.now()),
    });

    this.logDecision('approve', receiptId, result);

    /**
     * **Only when this call is the one that applied it** (N1).
     *
     * The booking update inside that transaction is conditional on the status
     * it expected, so a second submission — or a booking that moved underneath
     * this one — matches zero rows and reports `notPending` instead. Hanging
     * the email off `applied` rather than off the booking's status is what
     * makes it exactly once, and it is the same rule the notification path
     * follows for the same reason.
     *
     * After the transaction, never inside it: a mail provider's latency must
     * not hold a pooled connection the owner's own dashboard is waiting on.
     */
    if (result.outcome === 'applied') {
      await this.notifyConfirmed(result.bookingId);
    }

    return result;
  }

  /** Rejects: receipt, payment and booking, releasing the slot. */
  async reject(receiptId: string, ownerId: string): Promise<ReviewResult> {
    const result = await this.receipts.reject({
      receiptId,
      ownerId,
      now: new Date(this.clock.now()),
    });

    this.logDecision('reject', receiptId, result);
    return result;
  }

  /**
   * The confirmation email, behind a `catch` this service should never need.
   *
   * The notification service is specified never to throw and is tested for it.
   * The guard exists because of what is on the other side: an exception here
   * would surface to the owner as a failed approval over a booking the database
   * has already confirmed — and the owner's only sensible response, retrying,
   * would match zero rows and report the booking as no longer pending.
   */
  private async notifyConfirmed(bookingId: string): Promise<void> {
    try {
      await this.notifications.notifyConfirmed(bookingId);
    } catch (error) {
      this.logger.error('Confirmation email failed after an approval', {
        operation: 'receipts.review',
        bookingId,
        reason: error instanceof Error ? error.name : 'unknown',
      });
    }
  }

  /**
   * A decision, identified by receipt and outcome.
   *
   * Never the client's name, email or phone; never the uploaded file's path;
   * never the transfer destination. `notFound` is logged at `info` and not as
   * an error: from outside, a receipt belonging to another owner and one that
   * never existed are the same answer, and neither is a fault.
   */
  private logDecision(decision: string, receiptId: string, result: ReviewResult): void {
    this.logger.info('Transfer receipt reviewed', {
      operation: 'receipts.review',
      decision,
      receiptId,
      outcome: result.outcome,
    });
  }
}
