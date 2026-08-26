import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PrismaBookingRepository } from './PrismaBookingRepository';
import type { PrismaClient } from '@/generated/prisma/client';

const BOOKING = 'bkg-1';
const OWNER = 'own-1';
const NOW = new Date('2026-08-26T12:00:00.000Z');

/**
 * The transaction stub **deliberately exposes no `$executeRaw`**.
 *
 * B4 shipped a defect past a green suite because its test mocked `$queryRaw`
 * and asserted it was called — the mock certified the exact call that could not
 * work. The lesson generalises past that bug: a stub that offers a method makes
 * calling it look correct. This capability is specified to take **no lock**, so
 * the stub offers no way to take one, and an implementation that tried would
 * fail as "not a function" rather than pass unnoticed.
 */
function createDb(
  options: {
    resolved?: { id: string; status: string } | null;
    cancelledCount?: number;
    actualStatus?: string;
    paymentRejectedCount?: number;
    approvedPayment?: boolean;
  } = {}
) {
  const bookingUpdateMany = vi.fn().mockResolvedValue({
    count: options.cancelledCount ?? 1,
  });
  const bookingFindUnique = vi.fn().mockResolvedValue({
    status: options.actualStatus ?? 'CONFIRMED',
  });
  const paymentUpdateMany = vi.fn().mockResolvedValue({
    count: options.paymentRejectedCount ?? 0,
  });
  const paymentFindFirst = vi.fn().mockResolvedValue(
    options.approvedPayment ? { id: 'pay-1' } : null
  );
  const receiptUpdateMany = vi.fn().mockResolvedValue({ count: 0 });

  const tx = {
    booking: { updateMany: bookingUpdateMany, findUnique: bookingFindUnique },
    payment: { updateMany: paymentUpdateMany, findFirst: paymentFindFirst },
    transferReceipt: { updateMany: receiptUpdateMany },
    // No $executeRaw. See the comment above.
  };

  const bookingFindFirst = vi.fn().mockResolvedValue(
    options.resolved === undefined ? { id: BOOKING, status: 'CONFIRMED' } : options.resolved
  );

  const db = {
    booking: { findFirst: bookingFindFirst },
    $transaction: vi.fn(async (fn: (client: unknown) => unknown) => fn(tx)),
  } as unknown as PrismaClient;

  return {
    db,
    bookingFindFirst,
    bookingUpdateMany,
    bookingFindUnique,
    paymentUpdateMany,
    paymentFindFirst,
    receiptUpdateMany,
    transaction: (db as unknown as { $transaction: ReturnType<typeof vi.fn> }).$transaction,
  };
}

function cancel(db: PrismaClient) {
  return new PrismaBookingRepository(db).cancelByOwner({
    bookingId: BOOKING,
    ownerId: OWNER,
    now: NOW,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PrismaBookingRepository.cancelByOwner - scoping', () => {
  it('should_resolve_the_booking_through_the_barber_location_owner', async () => {
    // Arrange: a booking's location is deliberately not duplicated onto the
    // row, so this join is the only path to ownership — and the tenancy
    // boundary itself.
    const { db, bookingFindFirst } = createDb();

    // Act
    await cancel(db);

    // Assert
    const where = bookingFindFirst.mock.calls[0][0].where;
    expect(where.id).toBe(BOOKING);
    expect(JSON.stringify(where)).toContain(OWNER);
    expect(where.barber.location.ownerId).toBe(OWNER);
  });

  it('should_answer_notFound_for_a_booking_outside_the_scope', async () => {
    // Arrange
    const { db, transaction } = createDb({ resolved: null });

    // Act
    const result = await cancel(db);

    // Assert
    expect(result).toEqual({ outcome: 'notFound' });
    expect(transaction).not.toHaveBeenCalled();
  });

  it('should_answer_identically_for_a_booking_that_does_not_exist', async () => {
    // Arrange: from outside, another owner's booking and a missing one are the
    // same answer, and neither is a fault.
    const { db } = createDb({ resolved: null });

    // Act & Assert
    expect(await cancel(db)).toEqual({ outcome: 'notFound' });
  });

  it('should_refuse_a_terminal_booking_without_opening_a_transaction', async () => {
    // Arrange
    const { db, transaction } = createDb({ resolved: { id: BOOKING, status: 'EXPIRED' } });

    // Act
    const result = await cancel(db);

    // Assert
    expect(result).toEqual({ outcome: 'notCancellable', status: 'EXPIRED' });
    expect(transaction).not.toHaveBeenCalled();
  });
});

describe('PrismaBookingRepository.cancelByOwner - the booking write', () => {
  it('should_guard_the_update_on_the_statuses_this_capability_admits', async () => {
    // Arrange
    const { db, bookingUpdateMany } = createDb();

    // Act
    await cancel(db);

    // Assert
    const where = bookingUpdateMany.mock.calls[0][0].where;
    expect(where.id).toBe(BOOKING);
    expect(where.status.in).toEqual(
      expect.arrayContaining(['CONFIRMED', 'PENDING_PAYMENT', 'PENDING_APPROVAL'])
    );
    expect(where.status.in).not.toContain('CANCELLED');
    expect(where.status.in).not.toContain('EXPIRED');
  });

  it('should_record_the_status_the_instant_and_the_canceller', async () => {
    // Arrange
    const { db, bookingUpdateMany } = createDb();

    // Act
    await cancel(db);

    // Assert
    expect(bookingUpdateMany.mock.calls[0][0].data).toEqual({
      status: 'CANCELLED',
      cancelledAt: NOW,
      cancelledBy: 'OWNER',
      holdExpiresAt: null,
    });
  });

  it('should_touch_no_snapshot_no_token_and_no_foreign_key', async () => {
    // Arrange
    const { db, bookingUpdateMany } = createDb();

    // Act
    await cancel(db);

    // Assert
    const data = JSON.stringify(bookingUpdateMany.mock.calls[0][0].data);
    for (const forbidden of [
      'priceAtBooking',
      'depositAmount',
      'startTime',
      'endTime',
      'cancellationToken',
      'clientId',
      'barberId',
      'serviceId',
    ]) {
      expect(data).not.toContain(forbidden);
    }
  });

  it('should_report_the_status_it_actually_found_when_the_guard_matches_nothing', async () => {
    // Arrange: a booking a notification confirmed between the read and the
    // write. It must be reported, never overwritten.
    const { db } = createDb({ cancelledCount: 0, actualStatus: 'CONFIRMED' });

    // Act
    const result = await cancel(db);

    // Assert
    expect(result).toEqual({ outcome: 'notCancellable', status: 'CONFIRMED' });
  });

  it('should_leave_the_payment_and_receipt_alone_when_the_booking_guard_missed', async () => {
    // Arrange
    const { db, paymentUpdateMany, receiptUpdateMany } = createDb({ cancelledCount: 0 });

    // Act
    await cancel(db);

    // Assert
    expect(paymentUpdateMany).not.toHaveBeenCalled();
    expect(receiptUpdateMany).not.toHaveBeenCalled();
  });
});

describe('PrismaBookingRepository.cancelByOwner - the money', () => {
  it('should_guard_the_payment_update_on_PENDING_rather_than_branching', async () => {
    // Arrange: the guard is what protects an approved charge, not a condition
    // in application code that a later edit could invert.
    const { db, paymentUpdateMany } = createDb();

    // Act
    await cancel(db);

    // Assert
    const args = paymentUpdateMany.mock.calls[0][0];
    expect(args.where.status).toBe('PENDING');
    expect(args.data).toEqual({ status: 'REJECTED' });
  });

  it('should_never_write_an_approval_instant_or_a_gateway_id', async () => {
    // Arrange
    const { db, paymentUpdateMany } = createDb();

    // Act
    await cancel(db);

    // Assert
    const data = JSON.stringify(paymentUpdateMany.mock.calls[0][0].data);
    expect(data).not.toContain('approvedAt');
    expect(data).not.toContain('mpPaymentId');
    expect(data).not.toContain('amount');
  });

  it('should_report_that_a_deposit_was_approved', async () => {
    // Arrange: the client's notice needs this to decide whether to mention
    // money, and the transaction is the only authoritative answer.
    const { db } = createDb({ approvedPayment: true });

    // Act
    const result = await cancel(db);

    // Assert
    expect(result).toEqual({ outcome: 'applied', bookingId: BOOKING, depositApproved: true });
  });

  it('should_report_no_approved_deposit_when_there_is_none', async () => {
    // Arrange
    const { db } = createDb({ approvedPayment: false });

    // Act
    const result = await cancel(db);

    // Assert
    expect(result).toEqual({ outcome: 'applied', bookingId: BOOKING, depositApproved: false });
  });
});

/**
 * **C2 deliberately leaves a pending receipt alone**, and its first draft did
 * not. Writing REJECTED here would have made a cancellation byte-identical to
 * a receipt rejection — same status, same receipt state, same canceller — and
 * the client's page distinguishes them to choose between 'la barbería no
 * aprobó tu comprobante' and 'la barbería canceló tu turno'.
 */
describe('PrismaBookingRepository.cancelByOwner - the receipt is left alone', () => {
  it('should_not_touch_the_receipt_at_all', async () => {
    // Arrange
    const { db, receiptUpdateMany } = createDb();

    // Act
    await cancel(db);

    // Assert
    expect(receiptUpdateMany).not.toHaveBeenCalled();
  });
});

describe('PrismaBookingRepository.cancelByOwner - no advisory lock', () => {
  it('should_take_no_lock_because_a_release_cannot_double_book', async () => {
    // Arrange: the stub offers no `$executeRaw`, so an implementation that
    // tried to take one would fail as "not a function" rather than pass.
    const { db } = createDb();

    // Act & Assert
    await expect(cancel(db)).resolves.toMatchObject({ outcome: 'applied' });
  });

  it('should_run_its_writes_inside_one_transaction', async () => {
    // Arrange
    const { db, transaction } = createDb();

    // Act
    await cancel(db);

    // Assert
    expect(transaction).toHaveBeenCalledTimes(1);
  });
});
