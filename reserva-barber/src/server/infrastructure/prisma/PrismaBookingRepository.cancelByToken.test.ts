import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PrismaBookingRepository } from './PrismaBookingRepository';
import { readFileSync } from 'node:fs';
import type { PrismaClient } from '@/generated/prisma/client';

const TOKEN = 'tok-abc';
const BOOKING = 'bkg-1';
const SLUG = 'barberia-uno';
const NOW = new Date('2026-08-27T12:00:00.000Z');
const TOMORROW = new Date('2026-08-28T13:00:00.000Z');
const YESTERDAY = new Date('2026-08-26T13:00:00.000Z');

interface ResolvedRow {
  id: string;
  status: string;
  startTime: Date;
  endTime: Date;
  holdExpiresAt: Date | null;
  barber: { location: { owner: { businessProfile: { publicSlug: string } | null } } };
}

/**
 * The transaction stub **deliberately exposes no `$executeRaw`**, for the reason
 * `cancelByOwner`'s own test records: this capability is specified to take no
 * lock, so the stub offers no way to take one and an implementation that tried
 * would fail as "not a function" rather than pass unnoticed.
 *
 * It also exposes no `transferReceipt`. C1 is specified to write no receipt in
 * any state, and that absence is what proves it.
 */
function createDb(
  options: {
    resolved?: ResolvedRow | null;
    cancelledCount?: number;
    actualStatus?: string;
    approvedPayment?: boolean;
  } = {}
) {
  const bookingUpdateMany = vi.fn().mockResolvedValue({ count: options.cancelledCount ?? 1 });
  const bookingFindUnique = vi
    .fn()
    .mockResolvedValue({ status: options.actualStatus ?? 'CONFIRMED' });
  const paymentUpdateMany = vi.fn().mockResolvedValue({ count: 0 });
  const paymentFindFirst = vi
    .fn()
    .mockResolvedValue(options.approvedPayment ? { id: 'pay-1' } : null);

  const tx = {
    booking: { updateMany: bookingUpdateMany, findUnique: bookingFindUnique },
    payment: { updateMany: paymentUpdateMany, findFirst: paymentFindFirst },
  };

  const defaultRow: ResolvedRow = {
    id: BOOKING,
    status: 'CONFIRMED',
    startTime: TOMORROW,
    endTime: new Date(TOMORROW.getTime() + 30 * 60_000),
    holdExpiresAt: null,
    barber: { location: { owner: { businessProfile: { publicSlug: SLUG } } } },
  };

  const bookingFindUniqueOuter = vi
    .fn()
    .mockResolvedValue(options.resolved === undefined ? defaultRow : options.resolved);

  const db = {
    booking: { findUnique: bookingFindUniqueOuter },
    $transaction: vi.fn(async (fn: (client: unknown) => unknown) => fn(tx)),
  } as unknown as PrismaClient;

  return {
    db,
    bookingFindUniqueOuter,
    bookingUpdateMany,
    bookingFindUnique,
    paymentUpdateMany,
    paymentFindFirst,
    tx,
    transaction: (db as unknown as { $transaction: ReturnType<typeof vi.fn> }).$transaction,
  };
}

const cancel = (db: PrismaClient) =>
  new PrismaBookingRepository(db).cancelByToken({ cancellationToken: TOKEN, now: NOW });

const rowWith = (overrides: {
  status?: string;
  startTime?: Date;
  holdExpiresAt?: Date | null;
}): ResolvedRow => ({
  id: BOOKING,
  status: overrides.status ?? 'CONFIRMED',
  startTime: overrides.startTime ?? TOMORROW,
  endTime: new Date((overrides.startTime ?? TOMORROW).getTime() + 30 * 60_000),
  holdExpiresAt: overrides.holdExpiresAt ?? null,
  barber: { location: { owner: { businessProfile: { publicSlug: SLUG } } } },
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PrismaBookingRepository.cancelByToken - resolution', () => {
  it('should_resolve_the_booking_by_its_cancellation_token', async () => {
    const { db, bookingFindUniqueOuter } = createDb();

    await cancel(db);

    const args = bookingFindUniqueOuter.mock.calls[0]?.[0] as {
      where: { cancellationToken: string };
    };
    expect(args.where.cancellationToken).toBe(TOKEN);
  });

  it('should_answer_notFound_for_a_token_matching_nothing', async () => {
    const { db } = createDb({ resolved: null });

    await expect(cancel(db)).resolves.toEqual({ outcome: 'notFound' });
  });

  it('should_not_open_a_transaction_for_a_token_matching_nothing', async () => {
    // The cheap rejection. A forged token must not cost a transaction on a
    // public endpoint anybody can post to.
    const { db, transaction } = createDb({ resolved: null });

    await cancel(db);

    expect(transaction).not.toHaveBeenCalled();
  });

  it('should_answer_notFound_when_the_shop_has_no_public_profile', async () => {
    // Unreachable through the flow, which is entered by slug. Reported rather
    // than papered over with a redirect that would 404 after a real write.
    const { db } = createDb({
      resolved: {
        ...rowWith({}),
        barber: { location: { owner: { businessProfile: null } } },
      },
    });

    await expect(cancel(db)).resolves.toEqual({ outcome: 'notFound' });
  });
});

describe('PrismaBookingRepository.cancelByToken - eligibility', () => {
  it('should_refuse_an_appointment_that_already_started_and_say_so', async () => {
    const { db, transaction } = createDb({ resolved: rowWith({ startTime: YESTERDAY }) });

    await expect(cancel(db)).resolves.toEqual({
      outcome: 'notCancellable',
      bookingId: BOOKING,
      slug: SLUG,
      status: 'CONFIRMED',
      reason: 'alreadyStarted',
    });
    expect(transaction).not.toHaveBeenCalled();
  });

  it('should_refuse_a_receipt_under_review_as_no_longer_cancellable', async () => {
    const { db } = createDb({ resolved: rowWith({ status: 'PENDING_APPROVAL' }) });

    await expect(cancel(db)).resolves.toMatchObject({
      outcome: 'notCancellable',
      bookingId: BOOKING,
      reason: 'noLongerCancellable',
    });
  });

  it('should_refuse_a_booking_whose_hold_has_lapsed', async () => {
    const { db } = createDb({
      resolved: rowWith({
        status: 'PENDING_PAYMENT',
        holdExpiresAt: new Date(NOW.getTime() - 60_000),
      }),
    });

    await expect(cancel(db)).resolves.toMatchObject({ reason: 'noLongerCancellable' });
  });

  it.each(['CANCELLED', 'EXPIRED'])('should_refuse_the_terminal_status_%s', async (status) => {
    const { db } = createDb({ resolved: rowWith({ status }) });

    await expect(cancel(db)).resolves.toMatchObject({
      outcome: 'notCancellable',
      bookingId: BOOKING,
      status,
      reason: 'noLongerCancellable',
    });
  });

  it('should_carry_the_slug_on_a_refusal_so_the_client_can_be_returned_to_their_page', async () => {
    const { db } = createDb({ resolved: rowWith({ status: 'CANCELLED' }) });

    await expect(cancel(db)).resolves.toMatchObject({ slug: SLUG });
  });

  it('should_prefer_the_started_reason_over_the_generic_one', async () => {
    // Both are true of a terminal booking in the past. The client can act on
    // "it already started" and cannot act on the other, so it wins.
    const { db } = createDb({ resolved: rowWith({ status: 'CONFIRMED', startTime: YESTERDAY }) });

    await expect(cancel(db)).resolves.toMatchObject({ reason: 'alreadyStarted' });
  });
});

describe('PrismaBookingRepository.cancelByToken - the write', () => {
  it('should_record_the_client_as_the_canceller', async () => {
    const { db, bookingUpdateMany } = createDb();

    await cancel(db);

    const args = bookingUpdateMany.mock.calls[0]?.[0] as {
      data: { status: string; cancelledAt: Date; cancelledBy: string; holdExpiresAt: null };
    };
    expect(args.data).toEqual({
      status: 'CANCELLED',
      cancelledAt: NOW,
      cancelledBy: 'CLIENT',
      holdExpiresAt: null,
    });
  });

  it('should_guard_the_update_on_the_status_it_read', async () => {
    // Not on a status list: on the exact status the eligibility decision was
    // made against, so a booking that moved underneath matches zero rows.
    const { db, bookingUpdateMany } = createDb();

    await cancel(db);

    const args = bookingUpdateMany.mock.calls[0]?.[0] as { where: { id: string; status: string } };
    expect(args.where).toEqual({ id: BOOKING, status: 'CONFIRMED' });
  });

  it('should_report_what_the_booking_became_when_the_guard_matches_nothing', async () => {
    const { db } = createDb({ cancelledCount: 0, actualStatus: 'CONFIRMED' });

    await expect(cancel(db)).resolves.toEqual({
      outcome: 'notCancellable',
      bookingId: BOOKING,
      slug: SLUG,
      status: 'CONFIRMED',
      reason: 'noLongerCancellable',
    });
  });

  it('should_reject_only_a_pending_payment', async () => {
    // Guarded, not branched. An APPROVED payment matches zero rows here, which
    // is stronger than an `if` a later edit could invert.
    const { db, paymentUpdateMany } = createDb();

    await cancel(db);

    const args = paymentUpdateMany.mock.calls[0]?.[0] as {
      where: { bookingId: string; status: string };
      data: { status: string };
    };
    expect(args.where).toEqual({ bookingId: BOOKING, status: 'PENDING' });
    expect(args.data).toEqual({ status: 'REJECTED' });
  });

  it('should_not_touch_the_payment_when_the_booking_was_not_cancelled', async () => {
    const { db, paymentUpdateMany } = createDb({ cancelledCount: 0 });

    await cancel(db);

    expect(paymentUpdateMany).not.toHaveBeenCalled();
  });

  it('should_report_an_approved_deposit_from_inside_the_transaction', async () => {
    const { db } = createDb({ approvedPayment: true });

    await expect(cancel(db)).resolves.toEqual({
      outcome: 'applied',
      bookingId: BOOKING,
      slug: SLUG,
      depositApproved: true,
    });
  });

  it('should_report_no_deposit_when_none_was_approved', async () => {
    const { db } = createDb({ approvedPayment: false });

    await expect(cancel(db)).resolves.toMatchObject({ depositApproved: false });
  });

  it('should_write_no_receipt_in_any_state', async () => {
    // Structural: the transaction stub offers no `transferReceipt` at all, so
    // an implementation that wrote one would fail rather than pass unnoticed.
    const { db, tx } = createDb();

    await cancel(db);

    expect('transferReceipt' in tx).toBe(false);
  });

  it('should_take_no_advisory_lock', async () => {
    // The stub exposes no `$executeRaw`. A release cannot double-book, so the
    // per-barber lock the booking write takes has nothing to protect here.
    const { db, tx } = createDb();

    await cancel(db);

    expect('$executeRaw' in tx).toBe(false);
  });

  it('should_do_all_of_it_in_one_transaction', async () => {
    const { db, transaction } = createDb();

    await cancel(db);

    expect(transaction).toHaveBeenCalledTimes(1);
  });
});

/**
 * The claim `booking-cancellation` makes and nothing else asserted: nothing on
 * this path refunds anything, or records that a refund is owed.
 *
 * A test over the source rather than over behaviour, because the guarantee is
 * an **absence** — and an absence is exactly what a behavioural test cannot
 * see. `tech-debt.md` T74 is the entry this keeps honest: three surfaces say
 * the money is not returned here, and the day one of them stops being true it
 * should be because somebody decided, not because a field was added.
 */
describe('PrismaBookingRepository.cancelByToken - it refunds nothing', () => {
  const source = readFileSync(
    new URL('./PrismaBookingRepository.ts', import.meta.url),
    'utf8'
  );
  const method = source.slice(source.indexOf('async cancelByToken('));

  it('should_write_no_refund_column_and_name_no_refund_concept', () => {
    const body = method.slice(0, method.indexOf('\n  }\n'));

    expect(body).not.toMatch(/refund|refunded|reembolso/i);
  });

  it('should_write_only_the_two_tables_this_capability_admits', () => {
    const body = method.slice(0, method.indexOf('\n  }\n'));
    const written = [...body.matchAll(/tx\.(\w+)\./g)].map((m) => m[1]);

    expect([...new Set(written)].sort()).toEqual(['booking', 'payment']);
  });
});
