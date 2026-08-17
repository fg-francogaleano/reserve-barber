import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PrismaBarberAvailabilityRepository } from './PrismaBarberAvailabilityRepository';
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
    expect(select.timeOffs.where).toEqual({
      startsAt: { lt: RANGE.end },
      endsAt: { gt: RANGE.start },
    });
    expect(select.bookings.where).toMatchObject({
      startTime: { lt: RANGE.end },
      endTime: { gt: RANGE.start },
    });
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
