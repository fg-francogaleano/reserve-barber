import type { BookingStatus } from '@/server/domain/models/Booking';
import type {
  ExpirableBooking,
  ExpiredBookingWithApprovedPayment,
  IExpiredHoldRepository,
} from '@/server/domain/repositories/IExpiredHoldRepository';
import type { PrismaClient } from '@/generated/prisma/client';
import { toCanonicalDecimal } from './canonicalDecimal';

/**
 * The four columns the blocking predicate reads, plus the id the sweep writes.
 *
 * Deliberately not one more. This is the only repository in the project whose
 * reads are not confined to one owner, so its projection is doing work the
 * `ownerId` predicate does everywhere else: nothing here can carry a client's
 * name, a cancellation token or a price into a log line, because it never
 * selects them.
 */
const CANDIDATE_PROJECTION = {
  id: true,
  status: true,
  startTime: true,
  endTime: true,
  holdExpiresAt: true,
} as const;

interface CandidateRow {
  id: string;
  status: string;
  startTime: Date;
  endTime: Date;
  holdExpiresAt: Date | null;
}

function toExpirable(row: CandidateRow): ExpirableBooking {
  return {
    id: row.id,
    status: row.status as BookingStatus,
    startTime: row.startTime,
    endTime: row.endTime,
    holdExpiresAt: row.holdExpiresAt,
  };
}

/**
 * The sweep's data access.
 *
 * **Three things this repository deliberately does not do**, each of which is
 * correct here and would be wrong in the booking write:
 *
 * 1. **No transaction.** Each batch is a single statement, and a single
 *    statement is already atomic. Wrapping it would hold a connection from a
 *    pool capped at five — shared with the owner's dashboard and the public
 *    booking write — across a decision made in application code.
 * 2. **No advisory lock.** Every caller of that lock *places* a booking into a
 *    slot, and the lock exists so two of them cannot choose the same one. A
 *    sweep only releases, and a release cannot double-book. The same reasoning
 *    the receipt rejection path records.
 * 3. **No blocking rule in SQL.** The queries narrow by status and by one
 *    instant column; `blocksAvailability` decides above this layer. A copy of
 *    that rule here would drift from the availability read the first time
 *    either was refined.
 *
 * The queries are **not owner-scoped**, which is the exception
 * `IExpiredHoldRepository` documents. Both are served by partial indexes added
 * in `b7_expired_hold_indexes`: `(holdExpiresAt) WHERE status =
 * 'PENDING_PAYMENT'` and `(startTime) WHERE status = 'PENDING_APPROVAL'`. The
 * table's other index is `(barberId, startTime)`, which neither query can use,
 * because neither names a barber.
 */
export class PrismaExpiredHoldRepository implements IExpiredHoldRepository {
  constructor(private readonly db: PrismaClient) {}

  async findLapsedHolds(input: { cutoff: Date; limit: number }): Promise<ExpirableBooking[]> {
    const rows = (await this.db.booking.findMany({
      where: {
        status: 'PENDING_PAYMENT',
        // Strictly before the cutoff: a hold sitting exactly on it survives one
        // more run, the conservative direction the domain rule states.
        holdExpiresAt: { lt: input.cutoff },
      },
      select: CANDIDATE_PROJECTION,
      // Oldest first, so a backlog drains in the order it accumulated rather
      // than re-reading one page while later rows wait behind it.
      orderBy: { holdExpiresAt: 'asc' },
      take: input.limit,
    })) as CandidateRow[];

    return rows.map(toExpirable);
  }

  async findUnansweredReceipts(input: { now: Date; limit: number }): Promise<ExpirableBooking[]> {
    const rows = (await this.db.booking.findMany({
      where: {
        status: 'PENDING_APPROVAL',
        // **`startTime`, and never `holdExpiresAt`.** That column is the
        // deadline for uploading a receipt, not for answering one; a receipt
        // whose upload window lapsed weeks ago still holds a future
        // appointment, and releasing it would sell the slot underneath a
        // transfer the owner is about to approve.
        startTime: { lt: input.now },
      },
      select: CANDIDATE_PROJECTION,
      orderBy: { startTime: 'asc' },
      take: input.limit,
    })) as CandidateRow[];

    return rows.map(toExpirable);
  }

  async expire(input: { ids: readonly string[]; expectedStatus: BookingStatus }): Promise<number> {
    if (input.ids.length === 0) {
      return 0;
    }

    const { count } = await this.db.booking.updateMany({
      // **The status is the guard, not a filter.** A booking that moved
      // underneath the run — a receipt attached, a payment confirmed, an
      // owner's decision recorded — matches zero rows rather than having
      // `EXPIRED` written over a newer truth. It is also what makes a second
      // run, and two overlapping invocations, idempotent.
      where: { id: { in: [...input.ids] }, status: input.expectedStatus },
      // One key. `Payment` keeps its own history so a late notification can
      // still complete it; `cancelledAt`/`cancelledBy` stay null because
      // `CancelledBy` admits only `OWNER` and `CLIENT` and a deadline is not a
      // decision; `holdExpiresAt` survives as the evidence of why this ended.
      data: { status: 'EXPIRED' },
    });

    return count;
  }

  async findApprovedPaymentsFor(
    bookingIds: readonly string[]
  ): Promise<ExpiredBookingWithApprovedPayment[]> {
    if (bookingIds.length === 0) {
      return [];
    }

    const rows = (await this.db.payment.findMany({
      where: {
        bookingId: { in: [...bookingIds] },
        status: 'APPROVED',
        // The caller can only offer the ids it *tried* to expire. A booking
        // that raced to `CONFIRMED` between the read and the write is in that
        // set and has an approved payment for the entirely ordinary reason
        // that somebody paid for an appointment they still have.
        booking: { status: 'EXPIRED' },
      },
      select: { id: true, bookingId: true, amount: true },
    })) as { id: string; bookingId: string; amount: unknown }[];

    return rows.map((row) => ({
      bookingId: row.bookingId,
      paymentId: row.id,
      amount: toCanonicalDecimal(row.amount),
    }));
  }
}
