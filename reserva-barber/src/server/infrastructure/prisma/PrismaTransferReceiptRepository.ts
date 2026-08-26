import type {
  AttachReceiptResult,
  ITransferReceiptRepository,
  PendingReceipt,
  ReceiptSummary,
  ReviewResult,
} from '@/server/domain/repositories/ITransferReceiptRepository';
import {
  MAX_RECEIPT_UPLOADS_PER_BOOKING,
  isPendingReview,
  type ReceiptStatus,
} from '@/server/domain/models/TransferReceipt';
// The blocking rule has one home. Both the re-check here and the availability
// read call this same function; a SQL copy would let the read offer a slot the
// write refuses (booking-availability spec).
import { blocksAvailability, type BookingStatus } from '@/server/domain/models/Booking';
import { overlaps } from '@/server/domain/models/availability';
import { MAX_DURATION_MINUTES } from '@/server/domain/models/slotGranularity';
import { toCanonicalDecimal } from './canonicalDecimal';
import type { PrismaClient } from '@/generated/prisma/client';

/**
 * Statuses that can matter, as a READ filter — wider than the blocking rule on
 * purpose, exactly as the payment repository's is. `blocksAvailability` decides.
 */
const POSSIBLY_BLOCKING: BookingStatus[] = ['PENDING_PAYMENT', 'PENDING_APPROVAL', 'CONFIRMED'];

/**
 * How long these transactions may wait for a connection and hold one.
 *
 * The same shape as the payment repository's, and for the same reason: each
 * pins a pooled connection shared with the owner's dashboard. The receipt write
 * is the heavier of the two — a lock, an overlap read, an upsert and a guarded
 * update — but it is still bounded work on indexed columns.
 */
const TRANSACTION_OPTIONS = { maxWait: 5_000, timeout: 10_000 } as const;

interface TxLike {
  $executeRaw(strings: TemplateStringsArray, ...values: unknown[]): Promise<number>;
  booking: {
    findUnique(args: unknown): Promise<Record<string, unknown> | null>;
    findMany(args: unknown): Promise<Record<string, unknown>[]>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
  payment: {
    updateMany(args: unknown): Promise<{ count: number }>;
  };
  transferReceipt: {
    findUnique(args: unknown): Promise<Record<string, unknown> | null>;
    create(args: unknown): Promise<Record<string, unknown>>;
    update(args: unknown): Promise<Record<string, unknown>>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
}

/**
 * What "waiting for the owner's answer" means, in exactly one place.
 *
 * **Both clauses are load-bearing and the second was missing until D1.** A
 * receipt is `PENDING` until somebody reviews it, and the sweep never reviews
 * anything — `IExpiredHoldRepository.expire` writes `Booking.status` and nothing
 * else, deliberately, so a late notification can still complete a payment's own
 * history. So a receipt whose booking was expired once its appointment passed
 * stays `PENDING` for ever. Filtering on the receipt alone left those rows in
 * the queue beneath an **Aprobar** control that could only ever answer
 * `noLongerPending`, because `approve` is guarded on `PENDING_APPROVAL`.
 *
 * **It is a function rather than two copies of an object literal**, and that is
 * the whole point of the extraction: the queue and its counter must never be
 * able to disagree about how many receipts are waiting. This predicate has now
 * changed once; the next change must reach both callers or neither.
 *
 * The scope reaches the owner through barber → location, which is the only path
 * — a booking's location is deliberately not duplicated onto the row.
 *
 * **The alternative was to have the sweep reject the receipt**, and it was
 * rejected: `expire` states it writes one column to one value, and `REJECTED`
 * is a word that means a human looked at something.
 */
function pendingForOwner(ownerId: string) {
  return {
    status: 'PENDING',
    payment: {
      booking: {
        status: 'PENDING_APPROVAL',
        barber: { location: { ownerId } },
      },
    },
  } as const;
}

export class PrismaTransferReceiptRepository implements ITransferReceiptRepository {
  constructor(private readonly db: PrismaClient) {}

  /**
   * Attaches an uploaded receipt and moves the booking to `PENDING_APPROVAL`.
   *
   * The object is already in storage when this runs. An upload that succeeds
   * over a transaction that fails leaves an orphan, which is bounded and
   * logged; the reverse order leaves a row pointing at nothing, which the owner
   * discovers only when they try to open it.
   */
  async attachReceipt(input: {
    bookingId: string;
    paymentId: string;
    filePath: string;
    barberId: string;
    startTime: Date;
    endTime: Date;
    now: Date;
  }): Promise<AttachReceiptResult> {
    return this.db.$transaction(async (client) => {
      const tx = client as unknown as TxLike;

      // `$executeRaw`, never `$queryRaw`: `pg_advisory_xact_lock` returns void,
      // and the pg driver adapter cannot deserialize a void column — the defect
      // that silently failed every booking write in B4's first implementation.
      // It runs for its effect and reads nothing back.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${input.barberId}, 0))`;

      const booking = (await tx.booking.findUnique({
        where: { id: input.bookingId },
        select: { status: true, holdExpiresAt: true, startTime: true, endTime: true },
      })) as {
        status: string;
        holdExpiresAt: Date | null;
        startTime: Date;
        endTime: Date;
      } | null;

      if (booking === null) {
        return { outcome: 'notPending' as const, bookingStatus: 'MISSING' };
      }

      // A replacement: the booking already moved, and the client is correcting
      // a wrong photo before anyone has looked at it.
      if (booking.status === 'PENDING_APPROVAL') {
        return this.replace(tx, input);
      }

      if (booking.status !== 'PENDING_PAYMENT') {
        return { outcome: 'notPending' as const, bookingStatus: booking.status };
      }

      // **A lapsed hold is not by itself a refusal**, and this mirrors the
      // decision B5 made for a late Mercado Pago approval. The client has
      // transferred real money by the time they reach this endpoint; if nobody
      // took the slot while they were at their bank, they keep it. Only an
      // actually-taken slot is a loss, and it is reported as its own outcome
      // rather than swallowed — a human owes that client an explanation.
      const taken = await this.slotIsTaken(tx, input);
      if (taken) {
        return { outcome: 'slotLost' as const };
      }

      const created = await this.createOrReplaceReceipt(tx, input);
      if (created.outcome !== 'created' && created.outcome !== 'replaced') {
        return created;
      }

      // Conditional, so a concurrent transition matches zero rows rather than
      // being overwritten. `holdExpiresAt` is deliberately left in place: it
      // records when the upload deadline was, and `PENDING_APPROVAL` is not
      // governed by it.
      const moved = await tx.booking.updateMany({
        where: { id: input.bookingId, status: 'PENDING_PAYMENT' },
        data: { status: 'PENDING_APPROVAL' },
      });

      if (moved.count === 0) {
        const current = (await tx.booking.findUnique({
          where: { id: input.bookingId },
          select: { status: true },
        })) as { status: string } | null;
        return { outcome: 'notPending' as const, bookingStatus: current?.status ?? 'MISSING' };
      }

      return created;
    }, TRANSACTION_OPTIONS);
  }

  /** Whether somebody else's booking now occupies this slot. */
  private async slotIsTaken(
    tx: TxLike,
    input: { bookingId: string; barberId: string; startTime: Date; endTime: Date; now: Date }
  ): Promise<boolean> {
    const candidates = (await tx.booking.findMany({
      where: {
        barberId: input.barberId,
        id: { not: input.bookingId },
        status: { in: POSSIBLY_BLOCKING },
        // Bounded at both ends, for the reason the availability read measured:
        // without a lower bound `endTime` lands in Filter and the scan walks
        // every earlier row of that barber.
        startTime: {
          gte: new Date(input.startTime.getTime() - MAX_DURATION_MINUTES * 60_000),
          lt: input.endTime,
        },
      },
      select: { startTime: true, endTime: true, status: true, holdExpiresAt: true },
    })) as {
      startTime: Date;
      endTime: Date;
      status: string;
      holdExpiresAt: Date | null;
    }[];

    return candidates.some(
      (candidate) =>
        overlaps(
          { start: input.startTime, end: input.endTime },
          { start: candidate.startTime, end: candidate.endTime }
        ) &&
        blocksAvailability(
          {
            startTime: candidate.startTime,
            endTime: candidate.endTime,
            status: candidate.status as BookingStatus,
            holdExpiresAt: candidate.holdExpiresAt,
          },
          input.now
        )
    );
  }

  private async createOrReplaceReceipt(
    tx: TxLike,
    input: { paymentId: string; filePath: string; now: Date }
  ): Promise<AttachReceiptResult> {
    const existing = (await tx.transferReceipt.findUnique({
      where: { paymentId: input.paymentId },
      select: { id: true, status: true, filePath: true, uploadCount: true },
    })) as { id: string; status: string; filePath: string; uploadCount: number } | null;

    if (existing === null) {
      const row = (await tx.transferReceipt.create({
        data: {
          paymentId: input.paymentId,
          filePath: input.filePath,
          status: 'PENDING',
          uploadedAt: input.now,
        },
        select: { id: true },
      })) as { id: string };

      return { outcome: 'created', receiptId: row.id };
    }

    return this.replaceExisting(tx, existing, input);
  }

  /** The replacement path reached with the booking already `PENDING_APPROVAL`. */
  private async replace(
    tx: TxLike,
    input: { paymentId: string; filePath: string; now: Date }
  ): Promise<AttachReceiptResult> {
    const existing = (await tx.transferReceipt.findUnique({
      where: { paymentId: input.paymentId },
      select: { id: true, status: true, filePath: true, uploadCount: true },
    })) as { id: string; status: string; filePath: string; uploadCount: number } | null;

    // `PENDING_APPROVAL` with no receipt should be unreachable — only this
    // method moves a booking there, and it writes both. Reporting the status
    // rather than inventing a receipt keeps an impossible state visible.
    if (existing === null) {
      return { outcome: 'notPending', bookingStatus: 'PENDING_APPROVAL' };
    }

    return this.replaceExisting(tx, existing, input);
  }

  private async replaceExisting(
    tx: TxLike,
    existing: { id: string; status: string; filePath: string; uploadCount: number },
    input: { filePath: string; now: Date }
  ): Promise<AttachReceiptResult> {
    // A decided receipt is not replaceable. An approved one has already
    // confirmed the booking; a rejected one has cancelled it, and neither is a
    // state a new photo can reopen.
    if (!isPendingReview(existing.status as ReceiptStatus)) {
      return { outcome: 'notPending', bookingStatus: `RECEIPT_${existing.status}` };
    }

    if (existing.uploadCount >= MAX_RECEIPT_UPLOADS_PER_BOOKING) {
      return { outcome: 'capped' };
    }

    // Guarded on the count we read, so two concurrent replacements cannot both
    // pass the cap. The loser matches zero rows and is answered as capped,
    // which is the truthful thing to tell somebody whose submission did not
    // take effect.
    const updated = await tx.transferReceipt.updateMany({
      where: { id: existing.id, status: 'PENDING', uploadCount: existing.uploadCount },
      data: {
        filePath: input.filePath,
        uploadedAt: input.now,
        uploadCount: existing.uploadCount + 1,
      },
    });

    if (updated.count === 0) {
      return { outcome: 'capped' };
    }

    return {
      outcome: 'replaced',
      receiptId: existing.id,
      previousPath: existing.filePath,
    };
  }

  async findByBookingId(bookingId: string): Promise<ReceiptSummary | null> {
    const row = await this.db.transferReceipt.findFirst({
      where: { payment: { bookingId } },
      select: { id: true, status: true, uploadedAt: true, uploadCount: true },
      orderBy: { uploadedAt: 'desc' },
    });

    if (row === null) return null;

    return {
      id: row.id,
      status: row.status as ReceiptStatus,
      uploadedAt: row.uploadedAt,
      uploadCount: row.uploadCount,
    };
  }

  /**
   * The owner's queue, oldest first.
   *
   * Oldest first because the oldest is the one whose appointment is nearest to
   * becoming unanswerable: a `PENDING_APPROVAL` booking stops blocking once its
   * own start time has passed, and by then the answer is worth nothing.
   *
   * Scoped through barber → location → owner, which is the only path — a
   * booking's location is deliberately not duplicated on the row.
   */
  async findPendingForOwner(ownerId: string): Promise<readonly PendingReceipt[]> {
    const rows = await this.db.transferReceipt.findMany({
      where: pendingForOwner(ownerId),
      orderBy: { uploadedAt: 'asc' },
      select: {
        id: true,
        filePath: true,
        uploadedAt: true,
        payment: {
          select: {
            booking: {
              select: {
                id: true,
                startTime: true,
                endTime: true,
                depositAmount: true,
                client: { select: { name: true } },
                service: { select: { name: true } },
                barber: { select: { displayName: true, location: { select: { name: true } } } },
              },
            },
          },
        },
      },
    });

    return rows.map((row) => {
      const booking = row.payment.booking;
      return {
        receiptId: row.id,
        bookingId: booking.id,
        filePath: row.filePath,
        uploadedAt: row.uploadedAt,
        startTime: booking.startTime,
        endTime: booking.endTime,
        // The driver returns a stored 5000.50 as 5000.5, and this figure is the
        // one the owner compares against their bank.
        depositAmount: toCanonicalDecimal(booking.depositAmount),
        clientName: booking.client.name,
        barberDisplayName: booking.barber.displayName,
        serviceName: booking.service.name,
        locationName: booking.barber.location.name,
      };
    });
  }

  /**
   * How many receipts are waiting, over the same predicate the listing uses.
   *
   * A `count` rather than the listing's length: the page that shows this number
   * does not want the rows, and the queue's projection carries a client name and
   * an appointment per row.
   */
  async countPendingForOwner(ownerId: string): Promise<number> {
    return this.db.transferReceipt.count({ where: pendingForOwner(ownerId) });
  }

  /**
   * Approve: receipt, payment and booking, in one transaction under the lock.
   *
   * The lock is taken even though a `PENDING_APPROVAL` booking has been
   * blocking its slot the whole time and cannot have lost it. It is taken so
   * this caller cannot interleave with a write in the middle of taking an
   * adjacent slot for the same barber.
   */
  async approve(input: { receiptId: string; ownerId: string; now: Date }): Promise<ReviewResult> {
    const target = await this.resolveForOwner(input.receiptId, input.ownerId);
    if (target === null) return { outcome: 'notFound' };

    return this.db.$transaction(async (client) => {
      const tx = client as unknown as TxLike;

      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${target.barberId}, 0))`;

      const confirmed = await tx.booking.updateMany({
        where: { id: target.bookingId, status: 'PENDING_APPROVAL' },
        data: { status: 'CONFIRMED', holdExpiresAt: null },
      });

      if (confirmed.count === 0) {
        return this.reportActualStatus(tx, target.bookingId);
      }

      await tx.payment.updateMany({
        where: { id: target.paymentId, status: 'PENDING' },
        data: { status: 'APPROVED', approvedAt: input.now },
      });

      await tx.transferReceipt.updateMany({
        where: { id: input.receiptId, status: 'PENDING' },
        data: { status: 'APPROVED', reviewedAt: input.now },
      });

      return { outcome: 'applied' as const, bookingId: target.bookingId };
    }, TRANSACTION_OPTIONS);
  }

  /**
   * Reject: receipt, payment and booking, releasing the slot.
   *
   * **No lock, and that is not an oversight.** This only frees a slot, and
   * freeing one can never double-book. The booking update is still conditional,
   * so a second rejection matches zero rows instead of reasserting a decision.
   *
   * `CANCELLED` rather than `EXPIRED`: a human decided this, and those two
   * statuses are how the product tells a decision apart from a deadline.
   */
  async reject(input: { receiptId: string; ownerId: string; now: Date }): Promise<ReviewResult> {
    const target = await this.resolveForOwner(input.receiptId, input.ownerId);
    if (target === null) return { outcome: 'notFound' };

    return this.db.$transaction(async (client) => {
      const tx = client as unknown as TxLike;

      const cancelled = await tx.booking.updateMany({
        where: { id: target.bookingId, status: 'PENDING_APPROVAL' },
        data: { status: 'CANCELLED', holdExpiresAt: null },
      });

      if (cancelled.count === 0) {
        return this.reportActualStatus(tx, target.bookingId);
      }

      await tx.payment.updateMany({
        where: { id: target.paymentId, status: 'PENDING' },
        data: { status: 'REJECTED' },
      });

      await tx.transferReceipt.updateMany({
        where: { id: input.receiptId, status: 'PENDING' },
        data: { status: 'REJECTED', reviewedAt: input.now },
      });

      return { outcome: 'applied' as const, bookingId: target.bookingId };
    }, TRANSACTION_OPTIONS);
  }

  /**
   * Resolves a receipt id **within the caller's own scope**.
   *
   * A receipt belonging to another owner and a receipt that does not exist both
   * produce `null`, so the two are indistinguishable from outside — the rule
   * the public routes follow, applied here because a receipt id is guessable in
   * exactly the same way.
   */
  private async resolveForOwner(
    receiptId: string,
    ownerId: string
  ): Promise<{ bookingId: string; paymentId: string; barberId: string } | null> {
    const row = await this.db.transferReceipt.findFirst({
      where: {
        id: receiptId,
        payment: { booking: { barber: { location: { ownerId } } } },
      },
      select: {
        payment: { select: { id: true, booking: { select: { id: true, barberId: true } } } },
      },
    });

    if (row === null) return null;

    return {
      bookingId: row.payment.booking.id,
      paymentId: row.payment.id,
      barberId: row.payment.booking.barberId,
    };
  }

  private async reportActualStatus(tx: TxLike, bookingId: string): Promise<ReviewResult> {
    const current = (await tx.booking.findUnique({
      where: { id: bookingId },
      select: { status: true },
    })) as { status: string } | null;

    return { outcome: 'notPending', bookingStatus: current?.status ?? 'MISSING' };
  }
}
