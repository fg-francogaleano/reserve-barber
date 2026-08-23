import type {
  BookingForTransfer,
  IBookingRepository,
} from '@/server/domain/repositories/IBookingRepository';
import type { IPaymentRepository } from '@/server/domain/repositories/IPaymentRepository';
import type { IPaymentConfigRepository } from '@/server/domain/repositories/IPaymentConfigRepository';
import type { ITransferReceiptRepository } from '@/server/domain/repositories/ITransferReceiptRepository';
import type { IReceiptStorage } from '@/server/domain/repositories/IReceiptStorage';
import type { IClock } from '@/server/domain/repositories/IClock';
import type { ILogger } from '@/server/domain/repositories/ILogger';
import { isTransferOfferableToClient } from '@/server/domain/models/PaymentConfig';
import {
  receiptObjectKey,
  MAX_RECEIPT_UPLOADS_PER_BOOKING,
} from '@/server/domain/models/TransferReceipt';
import { detectReceiptType, MAX_RECEIPT_BYTES } from '@/server/domain/models/receiptFileType';

/**
 * The bank transfer deposit: committing to it, and submitting the proof.
 *
 * **The deposit is read, never computed.** `DepositPolicy` is not imported here
 * and a test asserts it, exactly as on the Mercado Pago path: the amount is the
 * snapshot the booking carries (`data-model.md` §11).
 *
 * **Nothing this service does verifies that money moved.** There is no gateway
 * on this path. It holds a slot honestly while a person decides, and every name
 * in it is chosen so that no later reader mistakes an uploaded file for
 * evidence.
 */

/**
 * What committing produced, or why it could not.
 *
 * Every refusal carries the `slug`, because every refusal has to render on that
 * shop's confirmation page — a client refused here must land back where their
 * turn is. `notFound` is the exception: there is no booking, so there is no
 * page to return to.
 */
export type TransferCommitResult =
  | { readonly outcome: 'committed'; readonly slug: string }
  | { readonly outcome: 'alreadyCommitted'; readonly slug: string }
  | { readonly outcome: 'notFound' }
  | { readonly outcome: 'notPayable'; readonly slug: string }
  | { readonly outcome: 'holdExpired'; readonly slug: string }
  | { readonly outcome: 'notConfigured'; readonly slug: string }
  | { readonly outcome: 'mercadoPagoInFlight'; readonly slug: string };

/** What submitting a receipt produced, or why it could not. */
export type ReceiptSubmissionResult =
  | { readonly outcome: 'received'; readonly slug: string }
  | { readonly outcome: 'notFound' }
  | { readonly outcome: 'notPayable'; readonly slug: string }
  | { readonly outcome: 'notCommitted'; readonly slug: string }
  | { readonly outcome: 'slotLost'; readonly slug: string }
  | { readonly outcome: 'invalidFile'; readonly slug: string }
  | { readonly outcome: 'fileTooLarge'; readonly slug: string }
  | { readonly outcome: 'tooManyAttempts'; readonly slug: string };

export interface ReceiptSubmission {
  readonly cancellationToken: string;
  readonly bytes: Uint8Array;
}

export class TransferPaymentService {
  constructor(
    private readonly bookings: IBookingRepository,
    private readonly payments: IPaymentRepository,
    private readonly paymentConfig: IPaymentConfigRepository,
    private readonly receipts: ITransferReceiptRepository,
    private readonly storage: IReceiptStorage,
    private readonly clock: IClock,
    private readonly logger: ILogger
  ) {}

  /**
   * Opens the transfer payment and extends the hold.
   *
   * The destination is **not** returned here. The page re-reads it on the
   * render that follows, so the only thing that can put a CBU in front of a
   * client is a live committed state in the database — never this response, and
   * never a code in a URL.
   */
  async commit(cancellationToken: string): Promise<TransferCommitResult> {
    const booking = await this.bookings.findForTransfer(cancellationToken);
    if (booking === null) return { outcome: 'notFound' };

    const slug = booking.publicSlug;

    if (booking.status !== 'PENDING_PAYMENT') {
      return { outcome: 'notPayable', slug };
    }

    const readiness = await this.paymentConfig.findPaymentReadinessForPublic(booking.ownerId);
    // Stricter than the bookability gate on purpose: a destination with no
    // holder name is not one a client can safely use, because they cannot
    // confirm from their bank's screen who they are paying.
    if (readiness === null || !isTransferOfferableToClient(readiness.transfer)) {
      return { outcome: 'notConfigured', slug };
    }

    const result = await this.payments.commitBankTransfer({
      bookingId: booking.id,
      amount: booking.depositAmount,
      startTime: booking.startTime,
      now: new Date(this.clock.now()),
    });

    switch (result.outcome) {
      case 'committed':
        this.logger.info('Bank transfer committed', {
          operation: 'transfer.commit',
          bookingId: booking.id,
        });
        return { outcome: 'committed', slug };

      case 'alreadyCommitted':
        return { outcome: 'alreadyCommitted', slug };

      case 'mercadoPagoInFlight':
        return { outcome: 'mercadoPagoInFlight', slug };

      case 'holdExpired':
        return { outcome: 'holdExpired', slug };

      case 'notPending':
        return { outcome: 'notPayable', slug };
    }
  }

  /**
   * Validates the file, stores it, and attaches it to the booking.
   *
   * **The order is upload-then-transaction, and it is not interchangeable.** An
   * upload that succeeds over a transaction that fails leaves an orphaned
   * object, which is bounded and logged; the reverse leaves a row pointing at
   * nothing, which the owner discovers only when they try to open it.
   */
  async submitReceipt(submission: ReceiptSubmission): Promise<ReceiptSubmissionResult> {
    const booking = await this.bookings.findForTransfer(submission.cancellationToken);
    if (booking === null) return { outcome: 'notFound' };

    const slug = booking.publicSlug;

    // Both are states a receipt can arrive into: the first submission finds
    // `PENDING_PAYMENT`, a replacement finds `PENDING_APPROVAL`. Anything else
    // — confirmed, cancelled, expired — is not accepting one.
    if (booking.status !== 'PENDING_PAYMENT' && booking.status !== 'PENDING_APPROVAL') {
      return { outcome: 'notPayable', slug };
    }

    // Re-checked against the real bytes, because `Content-Length` is
    // client-controlled and the route's earlier refusal trusted it.
    if (submission.bytes.byteLength > MAX_RECEIPT_BYTES) {
      this.logRefusal('file_too_large', booking.id);
      return { outcome: 'fileTooLarge', slug };
    }

    // The leading bytes decide. The declared content type and the filename are
    // never consulted, and the filename never reaches this service at all.
    const contentType = detectReceiptType(submission.bytes);
    if (contentType === null) {
      this.logRefusal('unsupported_type', booking.id);
      return { outcome: 'invalidFile', slug };
    }

    // Issued together: neither depends on the other, and both must answer
    // before a single byte reaches the bucket.
    const [payment, existingReceipt] = await Promise.all([
      this.payments.findLiveByBookingId(booking.id),
      this.receipts.findByBookingId(booking.id),
    ]);

    if (payment === null || payment.method !== 'BANK_TRANSFER') {
      // No committed transfer, so no destination was ever shown and there is
      // nothing this file could be proof of. Sending the client back to commit
      // is the only useful answer.
      return { outcome: 'notCommitted', slug };
    }

    // **The cap, checked before the upload and not only inside the
    // transaction.** `attachReceipt` also refuses a capped submission, but by
    // the time it runs the bytes are already stored — so on its own it bounds
    // rows and leaves object storage unbounded: a token holder could push 10 MB
    // per request for as long as their booking sat in `PENDING_APPROVAL`, and
    // every one of those requests would be answered "too many attempts" while
    // quietly keeping the file. Found by an adversarial review, after the
    // change was otherwise complete and after three documents had already
    // claimed this bound held.
    //
    // Both checks stay. This one bounds the ordinary case; the transactional
    // one settles the race two concurrent submissions create, which a read
    // here cannot.
    if (
      existingReceipt !== null &&
      existingReceipt.uploadCount >= MAX_RECEIPT_UPLOADS_PER_BOOKING
    ) {
      this.logRefusal('upload_cap_reached', booking.id);
      return { outcome: 'tooManyAttempts', slug };
    }

    // A booking whose owner has no auth user id cannot have a key composed for
    // it: the leading segment is what the bucket policies compare against a
    // session, and inventing one would place the object where the owner can
    // never read it.
    if (booking.ownerAuthUserId === null) {
      this.logRefusal('owner_has_no_auth_user', booking.id);
      return { outcome: 'notCommitted', slug };
    }

    const now = new Date(this.clock.now());
    const key = receiptObjectKey({
      ownerAuthUserId: booking.ownerAuthUserId,
      bookingId: booking.id,
      uploadedAt: now,
      contentType,
    });

    await this.storage.upload({ key, bytes: submission.bytes, contentType });

    const attached = await this.receipts.attachReceipt({
      bookingId: booking.id,
      paymentId: payment.id,
      filePath: key,
      barberId: booking.barberId,
      startTime: booking.startTime,
      endTime: booking.endTime,
      now,
    });

    return this.reportAttachment(attached, booking, key, slug);
  }

  private reportAttachment(
    attached: Awaited<ReturnType<ITransferReceiptRepository['attachReceipt']>>,
    booking: BookingForTransfer,
    key: string,
    slug: string
  ): ReceiptSubmissionResult {
    switch (attached.outcome) {
      case 'created':
        this.logger.info('Transfer receipt received', {
          operation: 'transfer.receipt',
          bookingId: booking.id,
        });
        return { outcome: 'received', slug };

      case 'replaced':
        // The displaced key is logged rather than deleted: the anonymous
        // uploader holds no delete grant, and granting one would let anybody
        // delete anybody's receipt. Bounded at two orphans per booking by the
        // submission cap, and this line is what a retention rule will follow.
        this.logger.info('Transfer receipt replaced, previous object orphaned', {
          operation: 'transfer.receipt',
          bookingId: booking.id,
          orphanedKey: attached.previousPath,
        });
        return { outcome: 'received', slug };

      case 'capped':
        this.logRefusal('upload_cap_reached', booking.id);
        return { outcome: 'tooManyAttempts', slug };

      case 'slotLost':
        // The honest ending, and the loudest line this service writes. The
        // client may have transferred real money and no gateway exists that
        // could tell us whether they did.
        this.logger.warn('Transfer receipt arrived after the slot was taken', {
          operation: 'transfer.receipt',
          bookingId: booking.id,
          orphanedKey: key,
        });
        return { outcome: 'slotLost', slug };

      case 'notPending':
        this.logger.warn('Transfer receipt over a booking that is not accepting one', {
          operation: 'transfer.receipt',
          bookingId: booking.id,
          bookingStatus: attached.bookingStatus,
          orphanedKey: key,
        });
        return { outcome: 'notPayable', slug };
    }
  }

  /**
   * A refusal, identified by cause and by booking.
   *
   * Never the client's name, email or phone; never the uploaded filename, which
   * is client-controlled and would put arbitrary text into a log line; and
   * never the transfer destination.
   */
  private logRefusal(cause: string, bookingId: string): void {
    this.logger.info('Transfer receipt refused', {
      operation: 'transfer.receipt',
      bookingId,
      cause,
    });
  }
}
