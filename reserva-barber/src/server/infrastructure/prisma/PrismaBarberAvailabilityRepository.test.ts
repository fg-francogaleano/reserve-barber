import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PrismaBarberAvailabilityRepository } from './PrismaBarberAvailabilityRepository';
import { MAX_DURATION_MINUTES } from '@/server/domain/models/slotGranularity';
import { MAX_TIME_OFF_DAYS } from '@/server/application/timeOff/timeOffSchema';
import type { PrismaClient } from '@/generated/prisma/client';

const OWNER = 'owner-root';
const BARBER = 'barber-1';
const MONDAY = 1;
const RANGE = {
  start: new Date('2026-08-17T03:00:00.000Z'),
  end: new Date('2026-08-18T03:00:00.000Z'),
};

function createDb(row: unknown = null) {
  const barber = { findFirst: vi.fn().mockResolvedValue(row) };
  return { db: { barber } as unknown as PrismaClient, barber };
}

function emptyRow() {
  return { workingHours: [], timeOffs: [], bookings: [] };
}

beforeEach(() => vi.clearAllMocks());

describe('PrismaBarberAvailabilityRepository - scoping', () => {
  it('should_carry_the_owner_predicate_through_the_location_relation', async () => {
    const { db, barber } = createDb(emptyRow());

    await new PrismaBarberAvailabilityRepository(db).findDayInputs(BARBER, OWNER, MONDAY, RANGE);

    const call = barber.findFirst.mock.calls[0]![0] as { where: Record<string, unknown> };
    expect(call.where).toMatchObject({
      id: BARBER,
      isActive: true,
      location: { ownerId: OWNER },
    });
  });

  it('should_return_nothing_for_a_barber_belonging_to_another_owner', async () => {
    // The query returns null, not empty relations. That distinction matters:
    // empty lists would read as "this barber works no days", which is a claim
    // about someone else's barber that this owner is not entitled to make.
    const { db } = createDb(null);

    const inputs = await new PrismaBarberAvailabilityRepository(db).findDayInputs(
      BARBER,
      'another-owner',
      MONDAY,
      RANGE
    );

    expect(inputs).toEqual({ windows: [], absences: [], bookings: [] });
  });

  it('should_issue_exactly_one_query', async () => {
    const { db, barber } = createDb(emptyRow());

    await new PrismaBarberAvailabilityRepository(db).findDayInputs(BARBER, OWNER, MONDAY, RANGE);

    expect(barber.findFirst).toHaveBeenCalledTimes(1);
  });
});

describe('PrismaBarberAvailabilityRepository - the projections', () => {
  it('should_filter_windows_to_the_requested_weekday', async () => {
    const { db, barber } = createDb(emptyRow());

    await new PrismaBarberAvailabilityRepository(db).findDayInputs(BARBER, OWNER, MONDAY, RANGE);

    const select = barber.findFirst.mock.calls[0]![0].select;
    expect(select.workingHours.where).toEqual({ dayOfWeek: MONDAY });
    expect(select.workingHours.select).toEqual({ startMinute: true, endMinute: true });
  });

  it('should_not_select_the_absence_reason', async () => {
    // The strongest form of this guarantee is that the column is not in the
    // projection at all — it cannot leak from a place it was never read.
    const { db, barber } = createDb(emptyRow());

    await new PrismaBarberAvailabilityRepository(db).findDayInputs(BARBER, OWNER, MONDAY, RANGE);

    const select = barber.findFirst.mock.calls[0]![0].select;
    expect(select.timeOffs.select).toEqual({ startsAt: true, endsAt: true });
    expect(select.timeOffs.select).not.toHaveProperty('reason');
  });

  it('should_select_only_the_four_booking_columns_availability_needs', async () => {
    const { db, barber } = createDb(emptyRow());

    await new PrismaBarberAvailabilityRepository(db).findDayInputs(BARBER, OWNER, MONDAY, RANGE);

    const select = barber.findFirst.mock.calls[0]![0].select;
    expect(select.bookings.select).toEqual({
      startTime: true,
      endTime: true,
      status: true,
      holdExpiresAt: true,
    });
    for (const forbidden of ['clientId', 'cancellationToken', 'priceAtBooking', 'depositAmount']) {
      expect(select.bookings.select).not.toHaveProperty(forbidden);
    }
  });

  it('should_use_the_half_open_overlap_predicate_for_both_ranges', async () => {
    const { db, barber } = createDb(emptyRow());

    await new PrismaBarberAvailabilityRepository(db).findDayInputs(BARBER, OWNER, MONDAY, RANGE);

    const select = barber.findFirst.mock.calls[0]![0].select;
    expect(select.timeOffs.where.startsAt.lt).toEqual(RANGE.end);
    expect(select.timeOffs.where.endsAt).toEqual({ gt: RANGE.start });
    expect(select.bookings.where.startTime.lt).toEqual(RANGE.end);
    expect(select.bookings.where.endTime).toEqual({ gt: RANGE.start });
  });

  it('should_bound_the_scan_from_below_so_the_index_is_usable_at_both_ends', async () => {
    // Without this, `EXPLAIN` puts only the upper bound in `Index Cond` and
    // walks every earlier row of the barber into a `Filter` — thousands of rows
    // read to return a handful, once per distinct ?fecha, on a route with no
    // cache and no rate limit. Measured against the live database, not guessed.
    const { db, barber } = createDb(emptyRow());

    await new PrismaBarberAvailabilityRepository(db).findDayInputs(BARBER, OWNER, MONDAY, RANGE);

    const where = barber.findFirst.mock.calls[0]![0].select;
    expect(where.bookings.where.startTime.gte).toBeInstanceOf(Date);
    expect(where.timeOffs.where.startsAt.gte).toBeInstanceOf(Date);
    expect(where.bookings.where.startTime.gte.getTime()).toBeLessThan(RANGE.start.getTime());
    expect(where.timeOffs.where.startsAt.gte.getTime()).toBeLessThan(RANGE.start.getTime());
  });

  it('should_set_each_lower_bound_from_the_maximum_length_its_validator_enforces', async () => {
    // The bound is only safe because a longer row cannot exist: a booking is
    // capped at MAX_DURATION_MINUTES and an absence at MAX_TIME_OFF_DAYS, both
    // enforced on write. Asserting the exact offsets is what would catch someone
    // raising a cap without widening the read — which would silently drop the
    // longest rows out of availability.
    const { db, barber } = createDb(emptyRow());

    await new PrismaBarberAvailabilityRepository(db).findDayInputs(BARBER, OWNER, MONDAY, RANGE);

    const where = barber.findFirst.mock.calls[0]![0].select;
    expect(RANGE.start.getTime() - where.bookings.where.startTime.gte.getTime()).toBe(
      MAX_DURATION_MINUTES * 60_000
    );
    expect(RANGE.start.getTime() - where.timeOffs.where.startsAt.gte.getTime()).toBe(
      MAX_TIME_OFF_DAYS * 24 * 60 * 60_000
    );
  });

  it('should_still_reach_a_row_that_starts_before_the_range_and_ends_inside_it', async () => {
    // The case the lower bound must not exclude: a booking that began the
    // evening before and runs into the day being asked about. Its start is
    // earlier than rangeStart but well inside the bound.
    const { db, barber } = createDb(emptyRow());

    await new PrismaBarberAvailabilityRepository(db).findDayInputs(BARBER, OWNER, MONDAY, RANGE);

    const gte = barber.findFirst.mock.calls[0]![0].select.bookings.where.startTime.gte as Date;
    const startsAnHourBeforeTheDay = new Date(RANGE.start.getTime() - 60 * 60_000);

    expect(startsAnHourBeforeTheDay.getTime()).toBeGreaterThan(gte.getTime());
  });

  it('should_fetch_pending_payment_rows_and_leave_the_expiry_decision_to_the_domain', async () => {
    // If the query filtered on holdExpiresAt, the expired-hold rule would exist
    // twice — here as SQL and in the domain as the predicate B4 must share.
    const { db, barber } = createDb(emptyRow());

    await new PrismaBarberAvailabilityRepository(db).findDayInputs(BARBER, OWNER, MONDAY, RANGE);

    const bookings = barber.findFirst.mock.calls[0]![0].select.bookings.where;
    expect(bookings.status.in).toEqual(['PENDING_PAYMENT', 'PENDING_APPROVAL', 'CONFIRMED']);
    expect(bookings).not.toHaveProperty('holdExpiresAt');
  });
});

describe('PrismaBarberAvailabilityRepository - mapping', () => {
  it('should_map_absences_to_intervals_and_pass_bookings_through', async () => {
    const absenceStart = new Date('2026-08-17T16:00:00.000Z');
    const absenceEnd = new Date('2026-08-17T19:00:00.000Z');
    const { db } = createDb({
      workingHours: [{ startMinute: 540, endMinute: 1080 }],
      timeOffs: [{ startsAt: absenceStart, endsAt: absenceEnd }],
      bookings: [
        {
          startTime: new Date('2026-08-17T13:00:00.000Z'),
          endTime: new Date('2026-08-17T13:30:00.000Z'),
          status: 'CONFIRMED',
          holdExpiresAt: null,
        },
      ],
    });

    const inputs = await new PrismaBarberAvailabilityRepository(db).findDayInputs(
      BARBER,
      OWNER,
      MONDAY,
      RANGE
    );

    expect(inputs.windows).toEqual([{ startMinute: 540, endMinute: 1080 }]);
    expect(inputs.absences).toEqual([{ start: absenceStart, end: absenceEnd }]);
    expect(inputs.bookings[0]!.status).toBe('CONFIRMED');
  });

  it('should_carry_several_windows_so_a_split_shift_survives_the_repository', async () => {
    const { db } = createDb({
      workingHours: [
        { startMinute: 540, endMinute: 780 },
        { startMinute: 960, endMinute: 1200 },
      ],
      timeOffs: [],
      bookings: [],
    });

    const inputs = await new PrismaBarberAvailabilityRepository(db).findDayInputs(
      BARBER,
      OWNER,
      MONDAY,
      RANGE
    );

    expect(inputs.windows).toHaveLength(2);
  });
});
