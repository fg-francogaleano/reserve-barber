import { describe, it, expect, vi } from 'vitest';
import { PrismaPaymentRepository } from './PrismaPaymentRepository';
import type { PrismaClient } from '@/generated/prisma/client';

const BOOKING = 'bkg-1';
const PAYMENT = 'pay-1';
const NOW = new Date('2026-08-19T12:00:00.000Z');

/**
 * A unique violation shaped the way this stack actually produces one.
 *
 * **Not `meta.target`.** `scripts/p1-gate-db.ts` measured that Prisma 7 with
 * `@prisma/adapter-pg` populates
 * `meta.driverAdapterError.cause.constraint.fields`, with column names arriving
 * **already quoted**. A test that mocked `meta.target` would certify a
 * translation that matches nothing against the real database — the T58 failure,
 * in the exact place T15 already burned this codebase once.
 */
function uniqueViolation(...fields: string[]) {
  return Object.assign(new Error('Unique constraint failed'), {
    code: 'P2002',
    meta: {
      driverAdapterError: { cause: { constraint: { fields: fields.map((f) => `"${f}"`) } } },
    },
  });
}

function paymentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: PAYMENT,
    bookingId: BOOKING,
    status: 'PENDING',
    amount: '5000.50',
    mpPreferenceId: null,
    mpInitPoint: null,
    approvedAt: null,
    ...overrides,
  };
}

/**
 * A transaction client exposing **only** the methods the real one provides for
 * this path.
 *
 * B4's lesson, stated as code: its repository test mocked `$queryRaw` and
 * asserted it was called, so the mock certified the exact call that could not
 * work against the pg driver adapter. Anything this repository reaches for that
 * is not here fails as "not a function" rather than silently passing.
 */
function createTx() {
  return {
    $executeRaw: vi.fn().mockResolvedValue(1),
    payment: {
      update: vi.fn().mockResolvedValue(paymentRow({ status: 'APPROVED' })),
      // The late path guards its own write on mpPaymentId being null.
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    booking: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      // Only the late-payment path reads under the lock; it defaults to a free
      // slot so that a test which does not care about contention gets one.
      findMany: vi.fn().mockResolvedValue([]),
      // Read only when the guarded update matched nothing, to report which
      // status it actually found.
      findUnique: vi.fn().mockResolvedValue({ status: 'CONFIRMED' }),
    },
  };
}

function createDb(tx = createTx()) {
  const db = {
    payment: {
      create: vi.fn().mockResolvedValue(paymentRow()),
      update: vi.fn().mockResolvedValue(paymentRow()),
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(null),
    },
    $transaction: vi.fn(async (fn: (t: unknown) => unknown) => fn(tx)),
  };
  return { db: db as unknown as PrismaClient, raw: db, tx };
}

describe('createPendingMercadoPago', () => {
  it('creates a pending payment and returns it', async () => {
    const { db, raw } = createDb();

    const result = await new PrismaPaymentRepository(db).createPendingMercadoPago({
      bookingId: BOOKING,
      amount: '5000.50',
    });

    expect(result.outcome).toBe('created');
    expect(raw.payment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          bookingId: BOOKING,
          method: 'MERCADO_PAGO',
          status: 'PENDING',
          amount: '5000.50',
        }),
      })
    );
  });

  // The measured hazard: the driver returns a stored 5000.50 as 5000.5, and
  // integer-cent arithmetic then reads the lone 5 as five centavos.
  it('returns the amount as a canonical two-decimal string', async () => {
    const { db, raw } = createDb();
    raw.payment.create.mockResolvedValue(paymentRow({ amount: '5000.5' }));

    const result = await new PrismaPaymentRepository(db).createPendingMercadoPago({
      bookingId: BOOKING,
      amount: '5000.50',
    });

    expect(result.payment.amount).toBe('5000.50');
  });

  /**
   * Two concurrent taps both read no existing payment, so only the partial
   * unique index can decide between them. The loser must be handed the winner's
   * payment, not an error — B4 established that a repeat submission is
   * invisible to the person who made it.
   */
  it('translates the live-payment index violation into the existing payment', async () => {
    const { db, raw } = createDb();
    raw.payment.create.mockRejectedValue(uniqueViolation('bookingId'));
    raw.payment.findFirst.mockResolvedValue(paymentRow({ id: 'pay-winner' }));

    const result = await new PrismaPaymentRepository(db).createPendingMercadoPago({
      bookingId: BOOKING,
      amount: '5000.50',
    });

    expect(result).toEqual({
      outcome: 'alreadyLive',
      payment: expect.objectContaining({ id: 'pay-winner' }),
    });
  });

  /**
   * T15 is exactly this defect on another table: an unqualified handler
   * reporting every violation as one business meaning. A violation this method
   * did not cause must surface, not be dressed up as a concurrent tap.
   */
  it('does not swallow a violation on a different constraint', async () => {
    const { db, raw } = createDb();
    raw.payment.create.mockRejectedValue(uniqueViolation('mpPaymentId'));

    await expect(
      new PrismaPaymentRepository(db).createPendingMercadoPago({
        bookingId: BOOKING,
        amount: '5000.50',
      })
    ).rejects.toThrow();
  });

  it('does not swallow a non-unique failure', async () => {
    const { db, raw } = createDb();
    raw.payment.create.mockRejectedValue(new Error('connection reset'));

    await expect(
      new PrismaPaymentRepository(db).createPendingMercadoPago({
        bookingId: BOOKING,
        amount: '5000.50',
      })
    ).rejects.toThrow('connection reset');
  });
});

describe('findLiveByBookingId', () => {
  it('asks only for payments that are not rejected', async () => {
    const { db, raw } = createDb();

    await new PrismaPaymentRepository(db).findLiveByBookingId(BOOKING);

    expect(raw.payment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          bookingId: BOOKING,
          status: { not: 'REJECTED' },
        }),
      })
    );
  });

  it('returns null when the booking has no live payment', async () => {
    const { db } = createDb();

    expect(await new PrismaPaymentRepository(db).findLiveByBookingId(BOOKING)).toBeNull();
  });
});

describe('confirmWithPayment', () => {
  it('guards the booking update on the status still being PENDING_PAYMENT', async () => {
    const { db, tx } = createDb();

    const result = await new PrismaPaymentRepository(db).confirmWithPayment({
      paymentId: PAYMENT,
      bookingId: BOOKING,
      gatewayPaymentId: 'mp-1',
      approvedAt: NOW,
    });

    expect(result).toEqual({ outcome: 'confirmed' });
    expect(tx.booking.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: BOOKING, status: 'PENDING_PAYMENT' },
        data: expect.objectContaining({ status: 'CONFIRMED' }),
      })
    );
  });

  /**
   * A duplicate delivery matches zero rows, and that is the mechanism working.
   * Throwing here would answer Mercado Pago `5xx` and ask for a third delivery.
   */
  it('reports a zero-row update as notPending rather than failing', async () => {
    const tx = createTx();
    tx.booking.updateMany.mockResolvedValue({ count: 0 });
    const { db } = createDb(tx);

    const result = await new PrismaPaymentRepository(db).confirmWithPayment({
      paymentId: PAYMENT,
      bookingId: BOOKING,
      gatewayPaymentId: 'mp-1',
      approvedAt: NOW,
    });

    expect(result).toEqual({ outcome: 'notPending', bookingStatus: 'CONFIRMED' });
  });

  it('does not touch the payment when the booking was not pending', async () => {
    const tx = createTx();
    tx.booking.updateMany.mockResolvedValue({ count: 0 });
    const { db } = createDb(tx);

    await new PrismaPaymentRepository(db).confirmWithPayment({
      paymentId: PAYMENT,
      bookingId: BOOKING,
      gatewayPaymentId: 'mp-1',
      approvedAt: NOW,
    });

    expect(tx.payment.update).not.toHaveBeenCalled();
  });

  // The unique mpPaymentId IS the idempotency guarantee, so tripping it is the
  // mechanism working. It must not reach the caller as an infrastructure error.
  it('translates the gateway-id violation into alreadyProcessed', async () => {
    const tx = createTx();
    tx.payment.update.mockRejectedValue(uniqueViolation('mpPaymentId'));
    const { db } = createDb(tx);

    const result = await new PrismaPaymentRepository(db).confirmWithPayment({
      paymentId: PAYMENT,
      bookingId: BOOKING,
      gatewayPaymentId: 'mp-1',
      approvedAt: NOW,
    });

    expect(result).toEqual({ outcome: 'alreadyProcessed' });
  });

  it('does not translate a violation on a different constraint', async () => {
    const tx = createTx();
    tx.payment.update.mockRejectedValue(uniqueViolation('bookingId'));
    const { db } = createDb(tx);

    await expect(
      new PrismaPaymentRepository(db).confirmWithPayment({
        paymentId: PAYMENT,
        bookingId: BOOKING,
        gatewayPaymentId: 'mp-1',
        approvedAt: NOW,
      })
    ).rejects.toThrow();
  });
});

describe('attachPreference', () => {
  it('stores the preference id and its checkout URL', async () => {
    const { db, raw } = createDb();

    await new PrismaPaymentRepository(db).attachPreference({
      paymentId: PAYMENT,
      preferenceId: 'pref-1',
      initPoint: 'https://mp.example/checkout?pref_id=pref-1',
    });

    expect(raw.payment.update).toHaveBeenCalledWith({
      where: { id: PAYMENT },
      data: {
        mpPreferenceId: 'pref-1',
        mpInitPoint: 'https://mp.example/checkout?pref_id=pref-1',
      },
    });
  });
});

describe('findForNotification', () => {
  function notificationRow() {
    return {
      id: PAYMENT,
      status: 'PENDING',
      amount: '5000.5',
      mpPaymentId: null,
      booking: {
        id: BOOKING,
        status: 'PENDING_PAYMENT',
        holdExpiresAt: new Date('2026-08-19T12:15:00.000Z'),
        startTime: new Date('2026-08-19T14:00:00.000Z'),
        endTime: new Date('2026-08-19T14:30:00.000Z'),
        barberId: 'barber-1',
        barber: { location: { ownerId: 'owner-root' } },
      },
    };
  }

  it('resolves the owner, the booking and the barber in one read', async () => {
    const { db, raw } = createDb();
    raw.payment.findUnique.mockResolvedValue(notificationRow());

    const result = await new PrismaPaymentRepository(db).findForNotification(PAYMENT);

    expect(result).toEqual({
      paymentId: PAYMENT,
      paymentStatus: 'PENDING',
      amount: '5000.50',
      mpPaymentId: null,
      bookingId: BOOKING,
      bookingStatus: 'PENDING_PAYMENT',
      holdExpiresAt: new Date('2026-08-19T12:15:00.000Z'),
      startTime: new Date('2026-08-19T14:00:00.000Z'),
      endTime: new Date('2026-08-19T14:30:00.000Z'),
      barberId: 'barber-1',
      ownerId: 'owner-root',
    });
    expect(raw.payment.findUnique).toHaveBeenCalledTimes(1);
  });

  /**
   * The projection is the guarantee, not a convention anyone has to remember.
   * Nothing on this path renders a person, so the columns it never selects are
   * the ones that cannot reach a log line.
   */
  it('selects no client contact detail and no cancellation token', async () => {
    const { db, raw } = createDb();
    raw.payment.findUnique.mockResolvedValue(notificationRow());

    await new PrismaPaymentRepository(db).findForNotification(PAYMENT);

    const select = JSON.stringify(raw.payment.findUnique.mock.calls[0]?.[0]);
    expect(select).not.toContain('cancellationToken');
    expect(select).not.toContain('client');
    expect(select).not.toContain('email');
    expect(select).not.toContain('phone');
  });

  // A ref that resolves nothing must cost one indexed read and nothing more —
  // it is what keeps an unauthenticated endpoint from being an amplifier.
  it('returns null for a ref that matches no payment', async () => {
    const { db } = createDb();

    expect(await new PrismaPaymentRepository(db).findForNotification('nope')).toBeNull();
  });
});

describe('confirmIfSlotFree', () => {
  const LATE = {
    paymentId: PAYMENT,
    bookingId: BOOKING,
    barberId: 'barber-1',
    startTime: new Date('2026-08-19T14:00:00.000Z'),
    endTime: new Date('2026-08-19T14:30:00.000Z'),
    gatewayPaymentId: 'mp-1',
    approvedAt: NOW,
    now: NOW,
  };

  function blockingBooking(overrides: Record<string, unknown> = {}) {
    return {
      startTime: new Date('2026-08-19T14:00:00.000Z'),
      endTime: new Date('2026-08-19T14:30:00.000Z'),
      status: 'CONFIRMED',
      holdExpiresAt: null,
      ...overrides,
    };
  }

  /**
   * B4 warned that "an advisory lock binds only code that takes it" and named
   * the sweeper and the transfer approval as the callers that must. This is a
   * third, and the first that confirms rather than creates — so the lock is
   * asserted, and asserted as `$executeRaw`.
   *
   * `pg_advisory_xact_lock` returns void and the pg driver adapter cannot
   * deserialize a void column, so `$queryRaw` fails against the real database.
   * B4's own test mocked the wrong one and thereby certified a call that could
   * not work, which is why the transaction double exposes only `$executeRaw`.
   */
  it('takes the per-barber advisory lock before reading', async () => {
    const { db, tx } = createDb();

    await new PrismaPaymentRepository(db).confirmIfSlotFree(LATE);

    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    const invocationOrder =
      tx.$executeRaw.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER;
    const readOrder = tx.booking.findMany.mock.invocationCallOrder[0] ?? 0;
    expect(invocationOrder).toBeLessThan(readOrder);
  });

  it('excludes the booking being confirmed from the overlap read', async () => {
    const { db, tx } = createDb();

    await new PrismaPaymentRepository(db).confirmIfSlotFree(LATE);

    expect(tx.booking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          barberId: 'barber-1',
          id: { not: BOOKING },
        }),
      })
    );
  });

  /**
   * The branch that is easy to lose by omission. A client who paid and whose
   * slot nobody took must not lose their appointment to a clock — B7 does not
   * exist yet, so the booking is still sitting there unexpired.
   */
  it('confirms when the slot is still free, despite the lapsed hold', async () => {
    const { db, tx } = createDb();

    const result = await new PrismaPaymentRepository(db).confirmIfSlotFree(LATE);

    expect(result).toEqual({ outcome: 'confirmed' });
    expect(tx.booking.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: BOOKING, status: 'PENDING_PAYMENT' },
        data: expect.objectContaining({ status: 'CONFIRMED' }),
      })
    );
  });

  it('approves the payment and confirms nothing when the slot was resold', async () => {
    const tx = createTx();
    tx.booking.findMany.mockResolvedValue([blockingBooking()]);
    const { db } = createDb(tx);

    const result = await new PrismaPaymentRepository(db).confirmIfSlotFree(LATE);

    expect(result).toEqual({ outcome: 'slotLost' });
    expect(tx.payment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'APPROVED' }) })
    );
    expect(tx.booking.updateMany).not.toHaveBeenCalled();
  });

  /**
   * The shared predicate, not a status list. Another lapsed hold does not block
   * — if it did, two abandoned checkouts would deadlock a slot for each other.
   */
  it('does not treat another lapsed hold as blocking', async () => {
    const tx = createTx();
    tx.booking.findMany.mockResolvedValue([
      blockingBooking({
        status: 'PENDING_PAYMENT',
        holdExpiresAt: new Date('2026-08-19T11:00:00.000Z'),
      }),
    ]);
    const { db } = createDb(tx);

    expect(await new PrismaPaymentRepository(db).confirmIfSlotFree(LATE)).toEqual({
      outcome: 'confirmed',
    });
  });

  it('treats another live hold as blocking', async () => {
    const tx = createTx();
    tx.booking.findMany.mockResolvedValue([
      blockingBooking({
        status: 'PENDING_PAYMENT',
        holdExpiresAt: new Date('2026-08-19T12:30:00.000Z'),
      }),
    ]);
    const { db } = createDb(tx);

    expect(await new PrismaPaymentRepository(db).confirmIfSlotFree(LATE)).toEqual({
      outcome: 'slotLost',
    });
  });

  // Half-open intervals, like every other boundary in this codebase: a booking
  // that starts exactly when this one ends does not overlap it.
  it('does not treat an adjacent booking as blocking', async () => {
    const tx = createTx();
    tx.booking.findMany.mockResolvedValue([
      blockingBooking({
        startTime: new Date('2026-08-19T14:30:00.000Z'),
        endTime: new Date('2026-08-19T15:00:00.000Z'),
      }),
    ]);
    const { db } = createDb(tx);

    expect(await new PrismaPaymentRepository(db).confirmIfSlotFree(LATE)).toEqual({
      outcome: 'confirmed',
    });
  });

  it('reports a zero-row booking update as notPending', async () => {
    const tx = createTx();
    tx.booking.updateMany.mockResolvedValue({ count: 0 });
    const { db } = createDb(tx);

    expect(await new PrismaPaymentRepository(db).confirmIfSlotFree(LATE)).toEqual({
      outcome: 'notPending',
      bookingStatus: 'CONFIRMED',
    });
  });

  it('keeps the unique-violation translation as a backstop', async () => {
    // The mpPaymentId guard above catches the ordinary repeat. This covers two
    // transactions that both read null and race to write the same gateway id.
    const tx = createTx();
    tx.payment.updateMany.mockRejectedValue(uniqueViolation('mpPaymentId'));
    const { db } = createDb(tx);

    expect(await new PrismaPaymentRepository(db).confirmIfSlotFree(LATE)).toEqual({
      outcome: 'alreadyProcessed',
    });
  });
});

describe('a refusal reports the status it actually found', () => {
  const LATE = {
    paymentId: PAYMENT,
    bookingId: BOOKING,
    barberId: 'barber-1',
    startTime: new Date('2026-08-19T14:00:00.000Z'),
    endTime: new Date('2026-08-19T14:30:00.000Z'),
    gatewayPaymentId: 'mp-1',
    approvedAt: NOW,
    now: NOW,
  };

  /**
   * Without the status, the caller cannot tell a duplicate delivery over a
   * `CONFIRMED` booking from an approved payment over a `CANCELLED` one. From
   * inside the transaction both are "the guarded update matched nothing"; only
   * one of them owes somebody a refund.
   */
  it.each(['CONFIRMED', 'CANCELLED', 'EXPIRED'])(
    'carries %s back with notPending from confirmWithPayment',
    async (status) => {
      const tx = createTx();
      tx.booking.updateMany.mockResolvedValue({ count: 0 });
      tx.booking.findUnique.mockResolvedValue({ status });
      const { db } = createDb(tx);

      expect(
        await new PrismaPaymentRepository(db).confirmWithPayment({
          paymentId: PAYMENT,
          bookingId: BOOKING,
          gatewayPaymentId: 'mp-1',
          approvedAt: NOW,
        })
      ).toEqual({ outcome: 'notPending', bookingStatus: status });
    }
  );

  it('reports MISSING when the booking vanished entirely', async () => {
    const tx = createTx();
    tx.booking.updateMany.mockResolvedValue({ count: 0 });
    tx.booking.findUnique.mockResolvedValue(null);
    const { db } = createDb(tx);

    expect(
      await new PrismaPaymentRepository(db).confirmWithPayment({
        paymentId: PAYMENT,
        bookingId: BOOKING,
        gatewayPaymentId: 'mp-1',
        approvedAt: NOW,
      })
    ).toEqual({ outcome: 'notPending', bookingStatus: 'MISSING' });
  });

  it('carries the status back from the late path too', async () => {
    const tx = createTx();
    tx.booking.updateMany.mockResolvedValue({ count: 0 });
    tx.booking.findUnique.mockResolvedValue({ status: 'CANCELLED' });
    const { db } = createDb(tx);

    expect(await new PrismaPaymentRepository(db).confirmIfSlotFree(LATE)).toEqual({
      outcome: 'notPending',
      bookingStatus: 'CANCELLED',
    });
  });
});

describe('the late path does not let a second gateway id rewrite the first', () => {
  const LATE = {
    paymentId: PAYMENT,
    bookingId: BOOKING,
    barberId: 'barber-1',
    startTime: new Date('2026-08-19T14:00:00.000Z'),
    endTime: new Date('2026-08-19T14:30:00.000Z'),
    gatewayPaymentId: 'mp-2',
    approvedAt: NOW,
    now: NOW,
  };

  /**
   * This is the one path that writes the payment before checking the booking,
   * so the booking's guard cannot protect it. Mercado Pago permits several
   * payment attempts against one preference, and a second approved one would
   * otherwise overwrite the id and the instant of a payment already approved —
   * without tripping the unique constraint, because the new id is new.
   */
  it('guards its own write on mpPaymentId being null', async () => {
    const { db, tx } = createDb();

    await new PrismaPaymentRepository(db).confirmIfSlotFree(LATE);

    expect(tx.payment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: PAYMENT, mpPaymentId: null } })
    );
  });

  it('reports alreadyProcessed rather than rewriting an approved payment', async () => {
    const tx = createTx();
    tx.payment.updateMany.mockResolvedValue({ count: 0 });
    const { db } = createDb(tx);

    expect(await new PrismaPaymentRepository(db).confirmIfSlotFree(LATE)).toEqual({
      outcome: 'alreadyProcessed',
    });
    expect(tx.booking.updateMany).not.toHaveBeenCalled();
  });
});
