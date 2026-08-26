import { describe, it, expect, vi } from 'vitest';
import { PrismaTransferReceiptRepository } from './PrismaTransferReceiptRepository';
import type { PrismaClient } from '@/generated/prisma/client';

const BOOKING = 'bkg-1';
const PAYMENT = 'pay-1';
const RECEIPT = 'rcp-1';
const BARBER = 'bar-1';
const OWNER = 'own-1';
const NOW = new Date('2026-08-22T12:00:00.000Z');
const START = new Date('2026-08-23T13:00:00.000Z');
const END = new Date('2026-08-23T13:30:00.000Z');
const LIVE_HOLD = new Date('2026-08-22T12:30:00.000Z');

const ATTACH_INPUT = {
  bookingId: BOOKING,
  paymentId: PAYMENT,
  filePath: `auth-1/${BOOKING}/1755864000000.jpg`,
  barberId: BARBER,
  startTime: START,
  endTime: END,
  now: NOW,
};

function heldBooking(overrides: Record<string, unknown> = {}) {
  return {
    status: 'PENDING_PAYMENT',
    holdExpiresAt: LIVE_HOLD,
    startTime: START,
    endTime: END,
    ...overrides,
  };
}

/**
 * A transaction client exposing **only** what the real one provides for these
 * paths.
 *
 * B4's lesson as code: its repository test mocked `$queryRaw` and asserted the
 * call, certifying the exact thing that cannot work against the pg driver
 * adapter. Anything reached for that is not here fails as "not a function"
 * rather than silently passing (T58).
 */
function createTx() {
  return {
    $executeRaw: vi.fn().mockResolvedValue(1),
    booking: {
      findUnique: vi.fn().mockResolvedValue(heldBooking()),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    payment: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    transferReceipt: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: RECEIPT }),
      update: vi.fn().mockResolvedValue({ id: RECEIPT }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  };
}

function createDb(tx = createTx()) {
  const db = {
    transferReceipt: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
    $transaction: vi.fn(async (fn: (t: unknown) => unknown) => fn(tx)),
  };
  return { db: db as unknown as PrismaClient, raw: db, tx };
}

describe('attachReceipt', () => {
  it('takes the per-barber advisory lock with a statement, never a query', async () => {
    const { db, tx } = createDb();

    await new PrismaTransferReceiptRepository(db).attachReceipt(ATTACH_INPUT);

    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    // `pg_advisory_xact_lock` returns void, which the adapter cannot
    // deserialize — the defect that silently failed every booking write in B4.
    expect(tx).not.toHaveProperty('$queryRaw');
  });

  it('creates the receipt and moves the booking to PENDING_APPROVAL', async () => {
    const { db, tx } = createDb();

    const result = await new PrismaTransferReceiptRepository(db).attachReceipt(ATTACH_INPUT);

    expect(result).toEqual({ outcome: 'created', receiptId: RECEIPT });
    expect(tx.booking.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: BOOKING, status: 'PENDING_PAYMENT' },
        data: { status: 'PENDING_APPROVAL' },
      })
    );
  });

  // Conditional, so a concurrent transition matches zero rows rather than
  // being overwritten.
  it('reports the status it actually found when the guarded update matches nothing', async () => {
    const { db, tx } = createDb();
    tx.booking.updateMany.mockResolvedValue({ count: 0 });
    tx.booking.findUnique
      .mockResolvedValueOnce(heldBooking())
      .mockResolvedValueOnce({ status: 'CANCELLED' });

    const result = await new PrismaTransferReceiptRepository(db).attachReceipt(ATTACH_INPUT);

    expect(result).toEqual({ outcome: 'notPending', bookingStatus: 'CANCELLED' });
  });

  it('refuses over a booking that is already confirmed', async () => {
    const { db, tx } = createDb();
    tx.booking.findUnique.mockResolvedValue(heldBooking({ status: 'CONFIRMED' }));

    const result = await new PrismaTransferReceiptRepository(db).attachReceipt(ATTACH_INPUT);

    expect(result).toEqual({ outcome: 'notPending', bookingStatus: 'CONFIRMED' });
    expect(tx.transferReceipt.create).not.toHaveBeenCalled();
  });

  /**
   * The defining case: the client transferred real money and came back late.
   * If nobody took the slot they keep it — the same decision B5 made for a late
   * Mercado Pago approval, and here it matters more, because no gateway could
   * tell us afterwards whether the money moved.
   */
  it('accepts a late receipt when the slot is still free', async () => {
    const { db, tx } = createDb();
    tx.booking.findUnique.mockResolvedValue(
      heldBooking({ holdExpiresAt: new Date('2026-08-22T11:00:00.000Z') })
    );

    const result = await new PrismaTransferReceiptRepository(db).attachReceipt(ATTACH_INPUT);

    expect(result.outcome).toBe('created');
  });

  it('reports a lost slot as its own outcome rather than an error', async () => {
    const { db, tx } = createDb();
    tx.booking.findMany.mockResolvedValue([
      { startTime: START, endTime: END, status: 'CONFIRMED', holdExpiresAt: null },
    ]);

    const result = await new PrismaTransferReceiptRepository(db).attachReceipt(ATTACH_INPUT);

    expect(result).toEqual({ outcome: 'slotLost' });
    expect(tx.transferReceipt.create).not.toHaveBeenCalled();
    expect(tx.booking.updateMany).not.toHaveBeenCalled();
  });

  // The overlap re-check uses the shared predicate, so a booking the read side
  // considers free must not block here either.
  it('ignores an overlapping booking whose own hold has lapsed', async () => {
    const { db, tx } = createDb();
    tx.booking.findMany.mockResolvedValue([
      {
        startTime: START,
        endTime: END,
        status: 'PENDING_PAYMENT',
        holdExpiresAt: new Date('2026-08-22T11:00:00.000Z'),
      },
    ]);

    const result = await new PrismaTransferReceiptRepository(db).attachReceipt(ATTACH_INPUT);

    expect(result.outcome).toBe('created');
  });

  it('does not treat a non-overlapping booking as contention', async () => {
    const { db, tx } = createDb();
    tx.booking.findMany.mockResolvedValue([
      {
        startTime: new Date('2026-08-23T14:00:00.000Z'),
        endTime: new Date('2026-08-23T14:30:00.000Z'),
        status: 'CONFIRMED',
        holdExpiresAt: null,
      },
    ]);

    const result = await new PrismaTransferReceiptRepository(db).attachReceipt(ATTACH_INPUT);

    expect(result.outcome).toBe('created');
  });
});

describe('attachReceipt - replacement', () => {
  function pendingReceipt(overrides: Record<string, unknown> = {}) {
    return {
      id: RECEIPT,
      status: 'PENDING',
      filePath: `auth-1/${BOOKING}/1755000000000.jpg`,
      uploadCount: 1,
      ...overrides,
    };
  }

  it('updates the same row and reports the key it displaced', async () => {
    const { db, tx } = createDb();
    tx.booking.findUnique.mockResolvedValue(heldBooking({ status: 'PENDING_APPROVAL' }));
    tx.transferReceipt.findUnique.mockResolvedValue(pendingReceipt());

    const result = await new PrismaTransferReceiptRepository(db).attachReceipt(ATTACH_INPUT);

    expect(result).toEqual({
      outcome: 'replaced',
      receiptId: RECEIPT,
      previousPath: `auth-1/${BOOKING}/1755000000000.jpg`,
    });
    // One receipt per payment: the unique constraint holds because this is an
    // update, never a second insert.
    expect(tx.transferReceipt.create).not.toHaveBeenCalled();
  });

  it('guards the update on the count it read, so two replacements cannot both pass', async () => {
    const { db, tx } = createDb();
    tx.booking.findUnique.mockResolvedValue(heldBooking({ status: 'PENDING_APPROVAL' }));
    tx.transferReceipt.findUnique.mockResolvedValue(pendingReceipt({ uploadCount: 2 }));
    tx.transferReceipt.updateMany.mockResolvedValue({ count: 0 });

    const result = await new PrismaTransferReceiptRepository(db).attachReceipt(ATTACH_INPUT);

    expect(result).toEqual({ outcome: 'capped' });
  });

  it('refuses once the per-booking cap is reached', async () => {
    const { db, tx } = createDb();
    tx.booking.findUnique.mockResolvedValue(heldBooking({ status: 'PENDING_APPROVAL' }));
    tx.transferReceipt.findUnique.mockResolvedValue(pendingReceipt({ uploadCount: 3 }));

    const result = await new PrismaTransferReceiptRepository(db).attachReceipt(ATTACH_INPUT);

    expect(result).toEqual({ outcome: 'capped' });
    expect(tx.transferReceipt.updateMany).not.toHaveBeenCalled();
  });

  // An approved receipt has already confirmed the booking and a rejected one
  // has cancelled it. Neither is a state a new photo can reopen.
  it('refuses to replace a receipt that has already been decided', async () => {
    const { db, tx } = createDb();
    tx.booking.findUnique.mockResolvedValue(heldBooking({ status: 'PENDING_APPROVAL' }));
    tx.transferReceipt.findUnique.mockResolvedValue(pendingReceipt({ status: 'APPROVED' }));

    const result = await new PrismaTransferReceiptRepository(db).attachReceipt(ATTACH_INPUT);

    expect(result).toEqual({ outcome: 'notPending', bookingStatus: 'RECEIPT_APPROVED' });
  });
});

describe('approve', () => {
  function ownedReceipt() {
    return {
      payment: { id: PAYMENT, booking: { id: BOOKING, barberId: BARBER } },
    };
  }

  it('confirms the booking, approves the payment and marks the receipt', async () => {
    const { db, raw, tx } = createDb();
    raw.transferReceipt.findFirst.mockResolvedValue(ownedReceipt());

    const result = await new PrismaTransferReceiptRepository(db).approve({
      receiptId: RECEIPT,
      ownerId: OWNER,
      now: NOW,
    });

    // Carries the booking it applied to (N1), so the caller can announce the
    // confirmation against the row this transaction actually confirmed.
    expect(result).toEqual({ outcome: 'applied', bookingId: BOOKING });
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.booking.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: BOOKING, status: 'PENDING_APPROVAL' },
        data: expect.objectContaining({ status: 'CONFIRMED' }),
      })
    );
    expect(tx.payment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'APPROVED' }) })
    );
  });

  // An owner who double-clicks must see the approval, not a failure.
  it('changes nothing on a second approval', async () => {
    const { db, raw, tx } = createDb();
    raw.transferReceipt.findFirst.mockResolvedValue(ownedReceipt());
    tx.booking.updateMany.mockResolvedValue({ count: 0 });
    tx.booking.findUnique.mockResolvedValue({ status: 'CONFIRMED' });

    const result = await new PrismaTransferReceiptRepository(db).approve({
      receiptId: RECEIPT,
      ownerId: OWNER,
      now: NOW,
    });

    expect(result).toEqual({ outcome: 'notPending', bookingStatus: 'CONFIRMED' });
    expect(tx.payment.updateMany).not.toHaveBeenCalled();
  });

  it('scopes the resolution by owner', async () => {
    const { db, raw } = createDb();

    await new PrismaTransferReceiptRepository(db).approve({
      receiptId: RECEIPT,
      ownerId: OWNER,
      now: NOW,
    });

    expect(raw.transferReceipt.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: RECEIPT,
          payment: { booking: { barber: { location: { ownerId: OWNER } } } },
        }),
      })
    );
  });

  // A foreign id and an unknown id must be indistinguishable from outside.
  it('answers notFound for a receipt outside the caller scope', async () => {
    const { db, raw } = createDb();
    raw.transferReceipt.findFirst.mockResolvedValue(null);

    const result = await new PrismaTransferReceiptRepository(db).approve({
      receiptId: RECEIPT,
      ownerId: OWNER,
      now: NOW,
    });

    expect(result).toEqual({ outcome: 'notFound' });
  });
});

describe('reject', () => {
  function ownedReceipt() {
    return { payment: { id: PAYMENT, booking: { id: BOOKING, barberId: BARBER } } };
  }

  it('cancels the booking and releases the slot', async () => {
    const { db, raw, tx } = createDb();
    raw.transferReceipt.findFirst.mockResolvedValue(ownedReceipt());

    const result = await new PrismaTransferReceiptRepository(db).reject({
      receiptId: RECEIPT,
      ownerId: OWNER,
      now: NOW,
    });

    // Carries the booking it applied to (N1), so the caller can announce the
    // confirmation against the row this transaction actually confirmed.
    expect(result).toEqual({ outcome: 'applied', bookingId: BOOKING });
    // CANCELLED, not EXPIRED: a human decided this, and those two statuses are
    // how the product tells a decision apart from a deadline.
    expect(tx.booking.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: BOOKING, status: 'PENDING_APPROVAL' },
        data: expect.objectContaining({ status: 'CANCELLED' }),
      })
    );
  });

  // Freeing a slot can never double-book, so there is nothing to serialize.
  it('takes no advisory lock', async () => {
    const { db, raw, tx } = createDb();
    raw.transferReceipt.findFirst.mockResolvedValue(ownedReceipt());

    await new PrismaTransferReceiptRepository(db).reject({
      receiptId: RECEIPT,
      ownerId: OWNER,
      now: NOW,
    });

    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it('changes nothing on a second rejection', async () => {
    const { db, raw, tx } = createDb();
    raw.transferReceipt.findFirst.mockResolvedValue(ownedReceipt());
    tx.booking.updateMany.mockResolvedValue({ count: 0 });
    tx.booking.findUnique.mockResolvedValue({ status: 'CANCELLED' });

    const result = await new PrismaTransferReceiptRepository(db).reject({
      receiptId: RECEIPT,
      ownerId: OWNER,
      now: NOW,
    });

    expect(result).toEqual({ outcome: 'notPending', bookingStatus: 'CANCELLED' });
    expect(tx.payment.updateMany).not.toHaveBeenCalled();
  });
});

/**
 * The predicate this queue is built on, as the tests expect to see it.
 *
 * **The `PENDING_APPROVAL` clause was added in D1 and this assertion changed
 * with it.** The previous version of this test asserted the receipt status and
 * the owner scope and nothing else, which meant it passed for a query that kept
 * swept bookings in the queue for ever — the test was encoding the defect rather
 * than catching it. Written out once here so the listing and the count are
 * asserted against the same shape.
 */
const PENDING_WHERE = {
  status: 'PENDING',
  payment: {
    booking: {
      status: 'PENDING_APPROVAL',
      barber: { location: { ownerId: OWNER } },
    },
  },
};

describe('findPendingForOwner', () => {
  it('asks for pending receipts of this owner only, oldest first', async () => {
    const { db, raw } = createDb();

    await new PrismaTransferReceiptRepository(db).findPendingForOwner(OWNER);

    expect(raw.transferReceipt.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: PENDING_WHERE,
        orderBy: { uploadedAt: 'asc' },
      })
    );
  });

  // The sweep writes Booking.status and nothing else, so a receipt on an
  // expired booking stays PENDING for ever. Without this clause it sat in the
  // queue under an Aprobar control that could only answer noLongerPending.
  it('excludes a receipt whose booking is no longer awaiting approval', async () => {
    const { db, raw } = createDb();

    await new PrismaTransferReceiptRepository(db).findPendingForOwner(OWNER);

    const { where } = vi.mocked(raw.transferReceipt.findMany).mock.calls[0][0];
    expect(where.payment.booking.status).toBe('PENDING_APPROVAL');
  });

  it('never offers a row the approval path would refuse', async () => {
    const { db, raw } = createDb();

    await new PrismaTransferReceiptRepository(db).findPendingForOwner(OWNER);

    // `approve` guards its booking update on exactly this status. The queue and
    // the guard must name the same one, or the page offers dead decisions.
    const { where } = vi.mocked(raw.transferReceipt.findMany).mock.calls[0][0];
    expect(where.payment.booking.status).toBe('PENDING_APPROVAL');
  });
});

describe('countPendingForOwner', () => {
  it('counts over exactly the predicate the listing uses', async () => {
    const { db, raw } = createDb();

    await new PrismaTransferReceiptRepository(db).countPendingForOwner(OWNER);

    expect(raw.transferReceipt.count).toHaveBeenCalledWith({ where: PENDING_WHERE });
  });

  it('cannot disagree with the listing about which rows are waiting', async () => {
    const { db, raw } = createDb();
    const repository = new PrismaTransferReceiptRepository(db);

    await repository.findPendingForOwner(OWNER);
    await repository.countPendingForOwner(OWNER);

    // One shared definition, asserted as one object rather than as two that
    // happen to match today.
    expect(vi.mocked(raw.transferReceipt.count).mock.calls[0][0].where).toEqual(
      vi.mocked(raw.transferReceipt.findMany).mock.calls[0][0].where
    );
  });

  it('is scoped to this owner', async () => {
    const { db, raw } = createDb();

    await new PrismaTransferReceiptRepository(db).countPendingForOwner(OWNER);

    const { where } = vi.mocked(raw.transferReceipt.count).mock.calls[0][0];
    expect(where.payment.booking.barber.location.ownerId).toBe(OWNER);
  });

  it('returns the count the database reports', async () => {
    const { db, raw } = createDb();
    raw.transferReceipt.count.mockResolvedValue(4);

    await expect(
      new PrismaTransferReceiptRepository(db).countPendingForOwner(OWNER)
    ).resolves.toBe(4);
  });
});

describe('findPendingForOwner - projection', () => {

  // The figure the owner compares against their bank statement. The driver
  // returns a stored 5000.50 as 5000.5.
  it('returns the snapshotted deposit as a canonical two-decimal string', async () => {
    const { db, raw } = createDb();
    raw.transferReceipt.findMany.mockResolvedValue([
      {
        id: RECEIPT,
        filePath: 'auth-1/bkg-1/1.jpg',
        uploadedAt: NOW,
        payment: {
          booking: {
            id: BOOKING,
            startTime: START,
            endTime: END,
            depositAmount: '5000.5',
            client: { name: 'Ana' },
            service: { name: 'Corte' },
            barber: { displayName: 'Leo', location: { name: 'Centro' } },
          },
        },
      },
    ]);

    const [row] = await new PrismaTransferReceiptRepository(db).findPendingForOwner(OWNER);

    expect(row.depositAmount).toBe('5000.50');
    expect(row.clientName).toBe('Ana');
  });
});
