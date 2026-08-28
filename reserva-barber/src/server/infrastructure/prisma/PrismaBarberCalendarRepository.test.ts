import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PrismaBarberCalendarRepository } from './PrismaBarberCalendarRepository';
import { MAX_DURATION_MINUTES } from '@/server/domain/models/slotGranularity';
import { MAX_TIME_OFF_DAYS } from '@/server/application/timeOff/timeOffSchema';
import type { PrismaClient } from '@/generated/prisma/client';

const OWNER = 'owner-root';
const BARBER = 'barber-1';
const TUESDAY = 2;
const RANGE = {
  start: new Date('2026-09-08T03:00:00.000Z'),
  end: new Date('2026-09-09T03:00:00.000Z'),
};

function createDb(row: unknown = null) {
  const barber = { findFirst: vi.fn().mockResolvedValue(row) };
  return { db: { barber } as unknown as PrismaClient, barber };
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: BARBER,
    displayName: 'Nico',
    location: { name: 'Centro' },
    workingHours: [],
    timeOffs: [],
    bookings: [],
    ...overrides,
  };
}

function bookingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'bk-1',
    startTime: new Date('2026-09-08T14:00:00.000Z'),
    endTime: new Date('2026-09-08T14:30:00.000Z'),
    status: 'CONFIRMED',
    holdExpiresAt: null,
    cancelledBy: null,
    client: { name: 'Ana' },
    service: { name: 'Corte' },
    ...overrides,
  };
}

function findDay(db: PrismaClient, ownerId = OWNER) {
  return new PrismaBarberCalendarRepository(db).findDay({
    barberId: BARBER,
    ownerId,
    weekday: TUESDAY,
    range: RANGE,
  });
}

function callArgs(barber: { findFirst: ReturnType<typeof vi.fn> }) {
  return barber.findFirst.mock.calls[0]![0] as {
    where: Record<string, unknown>;
    select: Record<string, { where?: Record<string, unknown>; select?: Record<string, unknown> }>;
  };
}

beforeEach(() => vi.clearAllMocks());

describe('PrismaBarberCalendarRepository - scoping', () => {
  it('should_carry_the_owner_predicate_through_the_location_relation', async () => {
    const { db, barber } = createDb(row());

    await findDay(db);

    expect(callArgs(barber).where).toMatchObject({
      id: BARBER,
      location: { ownerId: OWNER },
    });
  });

  it('should_return_null_for_a_barber_belonging_to_another_owner', async () => {
    // Not empty lists: those would read as "this barber has a free day", which
    // is a claim about someone else's barber that this owner may not make.
    const { db } = createDb(null);

    expect(await findDay(db, 'another-owner')).toBeNull();
  });

  it('should_return_null_for_a_barber_that_exists_nowhere', async () => {
    const { db } = createDb(null);

    expect(await findDay(db)).toBeNull();
  });

  it('should_not_filter_the_barber_by_activity', async () => {
    // A deactivated barber's appointments still happened. Closing their
    // calendar would destroy the history they were deactivated to preserve.
    const { db, barber } = createDb(row());

    await findDay(db);

    expect(callArgs(barber).where).not.toHaveProperty('isActive');
  });

  it('should_issue_exactly_one_query', async () => {
    const { db, barber } = createDb(row());

    await findDay(db);

    expect(barber.findFirst).toHaveBeenCalledTimes(1);
  });
});

describe('PrismaBarberCalendarRepository - what it asks for', () => {
  it('should_ask_for_the_weekday_schedule_only', async () => {
    const { db, barber } = createDb(row());

    await findDay(db);

    expect(callArgs(barber).select.workingHours?.where).toEqual({ dayOfWeek: TUESDAY });
  });

  it('should_match_absences_by_overlap_at_both_ends', async () => {
    const { db, barber } = createDb(row());

    await findDay(db);

    const where = callArgs(barber).select.timeOffs?.where as {
      startsAt: { gte: Date; lt: Date };
      endsAt: { gt: Date };
    };
    expect(where.startsAt.lt).toEqual(RANGE.end);
    expect(where.endsAt.gt).toEqual(RANGE.start);
    // The lower bound is what keeps the index usable; it is safe because an
    // absence has an enforced maximum length.
    expect(where.startsAt.gte).toEqual(
      new Date(RANGE.start.getTime() - MAX_TIME_OFF_DAYS * 24 * 60 * 60_000)
    );
  });

  it('should_match_appointments_by_overlap_at_both_ends', async () => {
    const { db, barber } = createDb(row());

    await findDay(db);

    const where = callArgs(barber).select.bookings?.where as {
      startTime: { gte: Date; lt: Date };
      endTime: { gt: Date };
    };
    expect(where.startTime.lt).toEqual(RANGE.end);
    expect(where.endTime.gt).toEqual(RANGE.start);
    expect(where.startTime.gte).toEqual(
      new Date(RANGE.start.getTime() - MAX_DURATION_MINUTES * 60_000)
    );
  });

  it('should_not_filter_appointments_by_status', async () => {
    // `calendarPresence` is the only rule that decides how a booking appears on
    // a calendar. A status filter here would be a second copy of it in SQL, and
    // it would also hide the cancelled rows the recorded lane exists to show.
    const { db, barber } = createDb(row());

    await findDay(db);

    expect(callArgs(barber).select.bookings?.where).not.toHaveProperty('status');
  });

  it('should_project_no_contact_detail_and_no_money', async () => {
    const { db, barber } = createDb(row());

    await findDay(db);

    const selected = Object.keys(callArgs(barber).select.bookings?.select ?? {});
    for (const forbidden of ['priceAtBooking', 'depositAmount', 'cancellationToken', 'clientId']) {
      expect(selected).not.toContain(forbidden);
    }

    const client = (callArgs(barber).select.bookings?.select as Record<string, unknown>).client as {
      select: Record<string, unknown>;
    };
    expect(Object.keys(client.select)).toEqual(['name']);
  });

  it('should_project_no_absence_reason', async () => {
    const { db, barber } = createDb(row());

    await findDay(db);

    expect(Object.keys(callArgs(barber).select.timeOffs?.select ?? {})).toEqual([
      'startsAt',
      'endsAt',
    ]);
  });
});

describe('PrismaBarberCalendarRepository - what it returns', () => {
  it('should_map_the_barber_and_its_location', async () => {
    const { db } = createDb(row());

    const day = await findDay(db);

    expect(day?.barber).toEqual({ id: BARBER, displayName: 'Nico', locationName: 'Centro' });
  });

  it('should_map_absences_to_intervals', async () => {
    const starts = new Date('2026-09-08T12:00:00.000Z');
    const ends = new Date('2026-09-08T15:00:00.000Z');
    const { db } = createDb(row({ timeOffs: [{ startsAt: starts, endsAt: ends }] }));

    const day = await findDay(db);

    expect(day?.absences).toEqual([{ start: starts, end: ends }]);
  });

  it('should_flatten_the_client_and_service_names_onto_the_appointment', async () => {
    const { db } = createDb(row({ bookings: [bookingRow()] }));

    const day = await findDay(db);

    expect(day?.appointments[0]).toMatchObject({
      id: 'bk-1',
      clientName: 'Ana',
      serviceName: 'Corte',
      status: 'CONFIRMED',
      cancelledBy: null,
    });
  });

  it('should_carry_a_cancellation_actor_when_the_row_has_one', async () => {
    const { db } = createDb(row({ bookings: [bookingRow({ cancelledBy: 'CLIENT' })] }));

    const day = await findDay(db);

    expect(day?.appointments[0]?.cancelledBy).toBe('CLIENT');
  });

  it('should_return_a_barber_whose_day_is_entirely_empty', async () => {
    // An empty day and an absent barber are different answers, and only the
    // second is null.
    const { db } = createDb(row());

    const day = await findDay(db);

    expect(day).not.toBeNull();
    expect(day?.windows).toEqual([]);
    expect(day?.appointments).toEqual([]);
  });
});
