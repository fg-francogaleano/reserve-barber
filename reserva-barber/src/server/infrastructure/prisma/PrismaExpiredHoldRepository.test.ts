import { describe, it, expect, vi } from 'vitest';
import { PrismaExpiredHoldRepository } from './PrismaExpiredHoldRepository';
import type { PrismaClient } from '@/generated/prisma/client';

const NOW = new Date('2026-08-23T15:00:00.000Z');
const CUTOFF = new Date('2026-08-23T14:50:00.000Z');

function bookingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'bkg-1',
    status: 'PENDING_PAYMENT',
    startTime: new Date('2026-08-24T13:00:00.000Z'),
    endTime: new Date('2026-08-24T13:30:00.000Z'),
    holdExpiresAt: new Date('2026-08-23T14:30:00.000Z'),
    ...overrides,
  };
}

/**
 * A client exposing **only** what this repository is allowed to reach for.
 *
 * B4's lesson stated as code: a mock that offers more than the real path uses
 * certifies calls nobody made. Anything this repository touches that is not
 * here fails as "not a function" rather than passing quietly — and in
 * particular there is no `$transaction` and no `$executeRaw`, because this
 * repository must take no lock and open no transaction.
 */
function createDb(overrides: Record<string, unknown> = {}) {
  return {
    booking: {
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    payment: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    ...overrides,
  };
}

function repository(db: ReturnType<typeof createDb>) {
  return new PrismaExpiredHoldRepository(db as unknown as PrismaClient);
}

describe('PrismaExpiredHoldRepository - reading lapsed holds', () => {
  it('should_filter_by_status_and_the_grace_cutoff', async () => {
    const db = createDb();
    await repository(db).findLapsedHolds({ cutoff: CUTOFF, limit: 200 });

    const args = db.booking.findMany.mock.calls[0][0];
    expect(args.where).toEqual({
      status: 'PENDING_PAYMENT',
      holdExpiresAt: { lt: CUTOFF },
    });
    expect(args.take).toBe(200);
  });

  // The projection carries the four columns the predicate needs plus the id it
  // will write to. No client, no token, no price, no deposit — a field that
  // does not exist cannot reach a log line.
  it('should_select_only_the_columns_the_predicate_needs', async () => {
    const db = createDb();
    await repository(db).findLapsedHolds({ cutoff: CUTOFF, limit: 200 });

    expect(db.booking.findMany.mock.calls[0][0].select).toEqual({
      id: true,
      status: true,
      startTime: true,
      endTime: true,
      holdExpiresAt: true,
    });
  });

  // Oldest first, so a backlog drains in the order it accumulated and the same
  // page is not re-read while later rows wait behind it.
  it('should_read_the_oldest_lapsed_holds_first', async () => {
    const db = createDb();
    await repository(db).findLapsedHolds({ cutoff: CUTOFF, limit: 200 });

    expect(db.booking.findMany.mock.calls[0][0].orderBy).toEqual({ holdExpiresAt: 'asc' });
  });

  it('should_return_the_rows_as_the_domain_projection', async () => {
    const db = createDb({
      booking: {
        findMany: vi.fn().mockResolvedValue([bookingRow()]),
        updateMany: vi.fn(),
      },
    });

    const rows = await repository(db).findLapsedHolds({ cutoff: CUTOFF, limit: 200 });

    expect(rows).toEqual([
      {
        id: 'bkg-1',
        status: 'PENDING_PAYMENT',
        startTime: new Date('2026-08-24T13:00:00.000Z'),
        endTime: new Date('2026-08-24T13:30:00.000Z'),
        holdExpiresAt: new Date('2026-08-23T14:30:00.000Z'),
      },
    ]);
  });
});

describe('PrismaExpiredHoldRepository - reading unanswered receipts', () => {
  // `holdExpiresAt` is the deadline for uploading a receipt, never for
  // answering one. This query must not mention it.
  it('should_filter_by_status_and_the_appointment_start_only', async () => {
    const db = createDb();
    await repository(db).findUnansweredReceipts({ now: NOW, limit: 200 });

    const args = db.booking.findMany.mock.calls[0][0];
    expect(args.where).toEqual({
      status: 'PENDING_APPROVAL',
      startTime: { lt: NOW },
    });
    expect(args.take).toBe(200);
  });

  it('should_read_the_oldest_appointments_first', async () => {
    const db = createDb();
    await repository(db).findUnansweredReceipts({ now: NOW, limit: 200 });

    expect(db.booking.findMany.mock.calls[0][0].orderBy).toEqual({ startTime: 'asc' });
  });
});

describe('PrismaExpiredHoldRepository - the write', () => {
  // The guard is what makes the sweep safe without a lock: a booking that moved
  // underneath the run matches zero rows instead of having EXPIRED stamped over
  // a newer truth.
  it('should_guard_the_update_on_the_expected_status', async () => {
    const db = createDb();
    await repository(db).expire({ ids: ['a', 'b'], expectedStatus: 'PENDING_PAYMENT' });

    expect(db.booking.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['a', 'b'] }, status: 'PENDING_PAYMENT' },
      data: { status: 'EXPIRED' },
    });
  });

  it('should_return_how_many_rows_actually_moved', async () => {
    const db = createDb({
      booking: {
        findMany: vi.fn(),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    });

    expect(
      await repository(db).expire({ ids: ['a', 'b'], expectedStatus: 'PENDING_PAYMENT' })
    ).toBe(1);
  });

  it('should_not_ask_the_database_anything_for_an_empty_set', async () => {
    const db = createDb();
    expect(await repository(db).expire({ ids: [], expectedStatus: 'PENDING_PAYMENT' })).toBe(0);
    expect(db.booking.updateMany).not.toHaveBeenCalled();
  });

  // The whole point of `data` carrying one key: there is no shape of bug in
  // this repository that can clear a hold deadline, cancel a booking or touch
  // the money.
  it('should_write_the_status_and_nothing_else', async () => {
    const db = createDb();
    await repository(db).expire({ ids: ['a'], expectedStatus: 'PENDING_APPROVAL' });

    expect(Object.keys(db.booking.updateMany.mock.calls[0][0].data)).toEqual(['status']);
  });
});

describe('PrismaExpiredHoldRepository - finding a deposit that was already paid', () => {
  // `ids` is what the caller *tried* to expire, which is a superset of what
  // moved. A booking that raced to CONFIRMED is in that set and has an approved
  // payment for the ordinary reason that somebody paid for an appointment they
  // still have — so the booking's current status is part of the predicate.
  it('should_require_the_booking_to_be_expired_now', async () => {
    const db = createDb();
    await repository(db).findApprovedPaymentsFor(['a', 'b']);

    expect(db.payment.findMany.mock.calls[0][0].where).toEqual({
      bookingId: { in: ['a', 'b'] },
      status: 'APPROVED',
      booking: { status: 'EXPIRED' },
    });
  });

  it('should_not_ask_the_database_anything_for_an_empty_set', async () => {
    const db = createDb();
    expect(await repository(db).findApprovedPaymentsFor([])).toEqual([]);
    expect(db.payment.findMany).not.toHaveBeenCalled();
  });

  // The driver returns a stored 2000.50 as 2000.5, and integer-cent arithmetic
  // then reads the lone 5 as five centavos (measured in PC3).
  it('should_return_the_amount_as_a_canonical_decimal_string', async () => {
    const db = createDb({
      payment: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ id: 'pay-1', bookingId: 'bkg-1', amount: '2000.5' }]),
      },
    });

    expect(await repository(db).findApprovedPaymentsFor(['bkg-1'])).toEqual([
      { bookingId: 'bkg-1', paymentId: 'pay-1', amount: '2000.50' },
    ]);
  });
});
