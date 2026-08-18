import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PrismaBookingRepository } from './PrismaBookingRepository';
import { MAX_DURATION_MINUTES } from '@/server/domain/models/slotGranularity';
import type { ProvisionalBookingInput } from '@/server/domain/repositories/IBookingRepository';
import type { PrismaClient } from '@/generated/prisma/client';

const OWNER = 'owner-root';
const BARBER = 'barber-1';
const CLIENT = 'client-1';

/** Local 09:00–09:30 on Monday 2026-08-17 (UTC-3). */
const START = new Date('2026-08-17T12:00:00.000Z');
const END = new Date('2026-08-17T12:30:00.000Z');
const NOW = new Date('2026-08-17T10:00:00.000Z');

const DAY_RANGE = {
  start: new Date('2026-08-17T03:00:00.000Z'),
  end: new Date('2026-08-18T03:00:00.000Z'),
};

/** A 09:00–18:00 window in wall-clock minutes, which contains the appointment. */
const FULL_DAY_WINDOW = { startMinute: 9 * 60, endMinute: 18 * 60 };

function input(overrides: Partial<ProvisionalBookingInput> = {}): ProvisionalBookingInput {
  return {
    ownerId: OWNER,
    barberId: BARBER,
    serviceId: 'svc-1',
    clientId: CLIENT,
    startTime: START,
    endTime: END,
    priceAtBooking: '4000.00',
    depositAmount: '1000.00',
    cancellationToken: 'tok-new',
    holdExpiresAt: new Date(NOW.getTime() + 15 * 60_000),
    weekday: 1,
    localDate: { year: 2026, month: 8, day: 17 },
    dayRange: DAY_RANGE,
    now: NOW,
    ...overrides,
  };
}

function createDb(
  barberRow: unknown = { workingHours: [FULL_DAY_WINDOW], timeOffs: [], bookings: [] }
) {
  const queryRaw = vi.fn().mockResolvedValue([]);
  const barber = { findFirst: vi.fn().mockResolvedValue(barberRow) };
  const booking = {
    create: vi.fn().mockResolvedValue({
      id: 'bkg-new',
      cancellationToken: 'tok-new',
      startTime: START,
      endTime: END,
      holdExpiresAt: new Date(NOW.getTime() + 15 * 60_000),
      depositAmount: '1000.00',
    }),
    count: vi.fn().mockResolvedValue(0),
    findUnique: vi.fn().mockResolvedValue(null),
  };

  const tx = { $queryRaw: queryRaw, barber, booking };
  const db = {
    $transaction: vi.fn(async (fn: (t: unknown) => unknown) => fn(tx)),
    booking,
  } as unknown as PrismaClient;

  return { db, tx, queryRaw, barber, booking };
}

/** A blocking booking overlapping 09:00–09:30. */
function existing(overrides: Record<string, unknown> = {}) {
  return {
    id: 'bkg-existing',
    clientId: 'someone-else',
    startTime: START,
    endTime: END,
    status: 'CONFIRMED',
    holdExpiresAt: null,
    cancellationToken: 'tok-existing',
    depositAmount: '1000.00',
    ...overrides,
  };
}

beforeEach(() => vi.clearAllMocks());

describe('PrismaBookingRepository - the lock comes first', () => {
  it('should_take_a_barber_scoped_advisory_lock_before_reading_anything', async () => {
    const { db, queryRaw, barber } = createDb();

    await new PrismaBookingRepository(db).createProvisional(input());

    expect(queryRaw).toHaveBeenCalled();
    // Reading before the lock would be reading a state the lock exists to
    // freeze, so the ordering is the rule rather than an implementation detail.
    expect(queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      barber.findFirst.mock.invocationCallOrder[0]!
    );
  });

  it('should_key_the_lock_on_the_barber', async () => {
    const { db, queryRaw } = createDb();

    await new PrismaBookingRepository(db).createProvisional(input());

    // The barber id is interpolated as a parameter, so it arrives in the
    // template's value list rather than in the SQL text.
    expect(queryRaw.mock.calls[0]).toContain(BARBER);
  });

  it('should_run_inside_a_transaction_with_explicit_timeouts', async () => {
    const { db } = createDb();

    await new PrismaBookingRepository(db).createProvisional(input());

    const options = (db.$transaction as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]![1];
    expect(options).toMatchObject({
      maxWait: expect.any(Number),
      timeout: expect.any(Number),
    });
  });
});

describe('PrismaBookingRepository - the shared blocking predicate decides', () => {
  it('should_refuse_when_a_confirmed_booking_overlaps', async () => {
    const { db, booking } = createDb({
      workingHours: [FULL_DAY_WINDOW],
      timeOffs: [],
      bookings: [existing({ status: 'CONFIRMED' })],
    });

    await expect(new PrismaBookingRepository(db).createProvisional(input())).resolves.toEqual({
      outcome: 'slotTaken',
    });
    expect(booking.create).not.toHaveBeenCalled();
  });

  it('should_refuse_when_a_live_pending_payment_hold_overlaps', async () => {
    const { db } = createDb({
      workingHours: [FULL_DAY_WINDOW],
      timeOffs: [],
      bookings: [
        existing({
          status: 'PENDING_PAYMENT',
          holdExpiresAt: new Date(NOW.getTime() + 10 * 60_000),
        }),
      ],
    });

    await expect(new PrismaBookingRepository(db).createProvisional(input())).resolves.toEqual({
      outcome: 'slotTaken',
    });
  });

  it('should_allow_the_write_when_an_expired_hold_overlaps', async () => {
    // The clause B3 wrote and B7 has not yet made redundant: without it every
    // abandoned checkout would block its slot forever.
    const { db, booking } = createDb({
      workingHours: [FULL_DAY_WINDOW],
      timeOffs: [],
      bookings: [
        existing({
          status: 'PENDING_PAYMENT',
          holdExpiresAt: new Date(NOW.getTime() - 60 * 60_000),
        }),
      ],
    });

    const result = await new PrismaBookingRepository(db).createProvisional(input());

    expect(result.outcome).toBe('created');
    expect(booking.create).toHaveBeenCalled();
  });

  it('should_refuse_when_a_pending_approval_overlaps_however_old_its_hold_is', async () => {
    const { db } = createDb({
      workingHours: [FULL_DAY_WINDOW],
      timeOffs: [],
      bookings: [
        existing({
          status: 'PENDING_APPROVAL',
          holdExpiresAt: new Date(NOW.getTime() - 60 * 60_000),
        }),
      ],
    });

    await expect(new PrismaBookingRepository(db).createProvisional(input())).resolves.toEqual({
      outcome: 'slotTaken',
    });
  });

  it.each(['CANCELLED', 'EXPIRED'])('should_allow_the_write_over_a_%s_booking', async (status) => {
    const { db } = createDb({
      workingHours: [FULL_DAY_WINDOW],
      timeOffs: [],
      bookings: [existing({ status })],
    });

    const result = await new PrismaBookingRepository(db).createProvisional(input());

    expect(result.outcome).toBe('created');
  });

  it('should_allow_a_booking_that_starts_exactly_when_another_ends', async () => {
    // Half-open, like every other boundary in this feature.
    const { db } = createDb({
      workingHours: [FULL_DAY_WINDOW],
      timeOffs: [],
      bookings: [
        existing({
          startTime: new Date(START.getTime() - 30 * 60_000),
          endTime: START,
        }),
      ],
    });

    const result = await new PrismaBookingRepository(db).createProvisional(input());

    expect(result.outcome).toBe('created');
  });

  it('should_not_express_the_expired_hold_clause_as_a_sql_filter', async () => {
    // The read filter is deliberately wider than the rule: it fetches every
    // PENDING_PAYMENT row and lets `blocksAvailability` decide. A SQL copy of
    // the deadline check would drift from the availability read.
    const { db, barber } = createDb();

    await new PrismaBookingRepository(db).createProvisional(input());

    const call = barber.findFirst.mock.calls[0]![0] as {
      select: { bookings: { where: Record<string, unknown> } };
    };
    expect(call.select.bookings.where).not.toHaveProperty('holdExpiresAt');
    expect(call.select.bookings.where.status).toEqual({
      in: ['PENDING_PAYMENT', 'PENDING_APPROVAL', 'CONFIRMED'],
    });
  });
});

describe('PrismaBookingRepository - the client own hold is not a conflict', () => {
  it('should_return_the_clients_own_hold_for_the_same_start_rather_than_refusing', async () => {
    // The nastiest bug this story could have shipped: telling the person who
    // just succeeded that their slot belongs to someone else.
    const { db, booking } = createDb({
      workingHours: [FULL_DAY_WINDOW],
      timeOffs: [],
      bookings: [
        existing({
          clientId: CLIENT,
          status: 'PENDING_PAYMENT',
          holdExpiresAt: new Date(NOW.getTime() + 10 * 60_000),
        }),
      ],
    });

    const result = await new PrismaBookingRepository(db).createProvisional(input());

    expect(result).toEqual({
      outcome: 'alreadyHeld',
      booking: expect.objectContaining({ id: 'bkg-existing', cancellationToken: 'tok-existing' }),
    });
    expect(booking.create).not.toHaveBeenCalled();
  });

  it('should_still_refuse_when_the_overlapping_hold_belongs_to_another_client', async () => {
    const { db } = createDb({
      workingHours: [FULL_DAY_WINDOW],
      timeOffs: [],
      bookings: [
        existing({
          clientId: 'someone-else',
          status: 'PENDING_PAYMENT',
          holdExpiresAt: new Date(NOW.getTime() + 10 * 60_000),
        }),
      ],
    });

    await expect(new PrismaBookingRepository(db).createProvisional(input())).resolves.toEqual({
      outcome: 'slotTaken',
    });
  });

  it('should_refuse_when_the_clients_own_hold_is_at_a_different_start_that_still_overlaps', async () => {
    // Their own booking, but not this one — returning it would confirm an
    // appointment at a time they did not ask for.
    const { db } = createDb({
      workingHours: [FULL_DAY_WINDOW],
      timeOffs: [],
      bookings: [
        existing({
          clientId: CLIENT,
          startTime: new Date(START.getTime() - 10 * 60_000),
          endTime: new Date(END.getTime() - 10 * 60_000),
          status: 'CONFIRMED',
        }),
      ],
    });

    await expect(new PrismaBookingRepository(db).createProvisional(input())).resolves.toEqual({
      outcome: 'slotTaken',
    });
  });
});

describe('PrismaBookingRepository - the schedule is re-asserted', () => {
  it('should_refuse_when_the_window_no_longer_contains_the_appointment', async () => {
    // T29's window: the owner narrowed the day after the times were offered.
    const { db, booking } = createDb({
      workingHours: [{ startMinute: 9 * 60, endMinute: 13 * 60 }],
      timeOffs: [],
      bookings: [],
    });

    const result = await new PrismaBookingRepository(db).createProvisional(
      input({
        startTime: new Date('2026-08-17T18:00:00.000Z'), // 15:00 local
        endTime: new Date('2026-08-17T18:30:00.000Z'),
      })
    );

    expect(result).toEqual({ outcome: 'slotTaken' });
    expect(booking.create).not.toHaveBeenCalled();
  });

  it('should_refuse_when_an_absence_now_covers_the_appointment', async () => {
    const { db } = createDb({
      workingHours: [FULL_DAY_WINDOW],
      timeOffs: [{ startsAt: DAY_RANGE.start, endsAt: DAY_RANGE.end }],
      bookings: [],
    });

    await expect(new PrismaBookingRepository(db).createProvisional(input())).resolves.toEqual({
      outcome: 'slotTaken',
    });
  });

  it('should_refuse_when_the_barber_belongs_to_another_owner', async () => {
    const { db } = createDb(null);

    await expect(new PrismaBookingRepository(db).createProvisional(input())).resolves.toEqual({
      outcome: 'slotTaken',
    });
  });

  it('should_scope_the_read_through_the_location_relation', async () => {
    const { db, barber } = createDb();

    await new PrismaBookingRepository(db).createProvisional(input());

    const call = barber.findFirst.mock.calls[0]![0] as { where: Record<string, unknown> };
    expect(call.where).toMatchObject({
      id: BARBER,
      isActive: true,
      location: { ownerId: OWNER },
    });
  });

  it('should_bound_the_booking_read_at_both_ends_so_the_index_is_usable', async () => {
    // Measured by B3 with EXPLAIN: an upper bound alone leaves endTime in
    // Filter and walks every earlier row of that barber.
    const { db, barber } = createDb();

    await new PrismaBookingRepository(db).createProvisional(input());

    const call = barber.findFirst.mock.calls[0]![0] as {
      select: { bookings: { where: { startTime: { gte: Date; lt: Date } } } };
    };
    const expectedFloor = new Date(
      DAY_RANGE.start.getTime() - MAX_DURATION_MINUTES * 60_000
    );

    expect(call.select.bookings.where.startTime.gte).toEqual(expectedFloor);
    expect(call.select.bookings.where.startTime.lt).toEqual(DAY_RANGE.end);
  });

  it('should_omit_the_absence_reason_from_the_projection', async () => {
    // It can hold medical information and this is a public write path.
    const { db, barber } = createDb();

    await new PrismaBookingRepository(db).createProvisional(input());

    const call = barber.findFirst.mock.calls[0]![0] as {
      select: { timeOffs: { select: Record<string, unknown> } };
    };
    expect(call.select.timeOffs.select).not.toHaveProperty('reason');
  });
});

describe('PrismaBookingRepository - the write itself', () => {
  it('should_insert_as_pending_payment_with_its_deadline', async () => {
    const { db, booking } = createDb();

    await new PrismaBookingRepository(db).createProvisional(input());

    expect(booking.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'PENDING_PAYMENT',
          holdExpiresAt: expect.any(Date),
          priceAtBooking: '4000.00',
          depositAmount: '1000.00',
          cancellationToken: 'tok-new',
        }),
      })
    );
  });
});

describe('PrismaBookingRepository - the confirmation read', () => {
  it('should_select_neither_the_clients_email_nor_phone', async () => {
    // The page can be opened by anyone holding the link, so the columns it
    // cannot select are the columns it cannot render.
    const { db, booking } = createDb();

    await new PrismaBookingRepository(db).findByCancellationToken('tok-1');

    const call = booking.findUnique.mock.calls[0]![0] as {
      select: { client: { select: Record<string, unknown> } };
    };
    expect(call.select.client.select).toEqual({ name: true });
    expect(JSON.stringify(call.select)).not.toContain('email');
    expect(JSON.stringify(call.select)).not.toContain('phone');
  });

  it('should_return_null_for_an_unknown_token', async () => {
    const { db } = createDb();

    await expect(
      new PrismaBookingRepository(db).findByCancellationToken('nope')
    ).resolves.toBeNull();
  });
});

describe('PrismaBookingRepository - the live hold count', () => {
  it('should_not_count_a_lapsed_pending_payment_hold', async () => {
    const { db, booking } = createDb();

    await new PrismaBookingRepository(db).countLiveHoldsForClient(CLIENT, NOW);

    const call = booking.count.mock.calls[0]![0] as { where: { OR: unknown[] } };
    expect(call.where.OR).toEqual([
      { status: 'PENDING_APPROVAL' },
      { status: 'PENDING_PAYMENT', holdExpiresAt: null },
      { status: 'PENDING_PAYMENT', holdExpiresAt: { gt: NOW } },
    ]);
  });
});
