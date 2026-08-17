import { describe, it, expect, vi } from 'vitest';
import { PublicAvailabilityService } from './PublicAvailabilityService';
import { formatSlotTime, type LocalDate } from '@/server/domain/models/bookingCalendar';
import type { IBarberAvailabilityRepository } from '@/server/domain/repositories/IBarberAvailabilityRepository';
import type { IWorkingHoursRepository } from '@/server/domain/repositories/IWorkingHoursRepository';
import type { DayAvailabilityInputs } from '@/server/domain/repositories/IBarberAvailabilityRepository';

const OWNER = 'owner-root';
const BARBER = 'barber-1';
/** Monday. */
const DATE: LocalDate = { year: 2026, month: 8, day: 17 };
/** Two days earlier, so the lead time never interferes with a fixed date. */
const NOW = new Date('2026-08-15T12:00:00.000Z');

const NINE_TO_SIX = [{ startMinute: 9 * 60, endMinute: 18 * 60 }];

function createService(inputs: Partial<DayAvailabilityInputs>, now: Date = NOW) {
  const findDayInputs = vi.fn().mockResolvedValue({
    windows: [],
    absences: [],
    bookings: [],
    ...inputs,
  });
  const availability = { findDayInputs } as unknown as IBarberAvailabilityRepository;
  const schedules = {
    findForBarber: vi.fn().mockResolvedValue([]),
  } as unknown as IWorkingHoursRepository;

  return {
    service: new PublicAvailabilityService(availability, schedules, {
      now: () => now.getTime(),
      sleep: async () => {},
    }),
    findDayInputs,
    schedules,
  };
}

async function times(inputs: Partial<DayAvailabilityInputs>, now?: Date): Promise<string[]> {
  const { service } = createService(inputs, now);
  const slots = await service.slotsFor({
    barberId: BARBER,
    ownerId: OWNER,
    date: DATE,
    durationMinutes: 30,
  });
  return slots.map(formatSlotTime);
}

describe('PublicAvailabilityService - composing the read with the rule', () => {
  it('should_issue_exactly_one_availability_read', async () => {
    const { service, findDayInputs } = createService({ windows: NINE_TO_SIX });

    await service.slotsFor({
      barberId: BARBER,
      ownerId: OWNER,
      date: DATE,
      durationMinutes: 30,
    });

    expect(findDayInputs).toHaveBeenCalledTimes(1);
  });

  it('should_ask_for_the_business_weekday_and_the_local_day_bounds', async () => {
    const { service, findDayInputs } = createService({ windows: NINE_TO_SIX });

    await service.slotsFor({
      barberId: BARBER,
      ownerId: OWNER,
      date: DATE,
      durationMinutes: 30,
    });

    const [barberId, ownerId, weekday, range] = findDayInputs.mock.calls[0]!;
    expect(barberId).toBe(BARBER);
    expect(ownerId).toBe(OWNER);
    expect(weekday).toBe(1);
    // Local midnight to local midnight, which is 03:00Z at UTC−3.
    expect(range.start.toISOString()).toBe('2026-08-17T03:00:00.000Z');
    expect(range.end.toISOString()).toBe('2026-08-18T03:00:00.000Z');
  });

  it('should_convert_wall_clock_windows_into_the_local_times_they_name', async () => {
    const offered = await times({ windows: NINE_TO_SIX });

    expect(offered[0]).toBe('09:00');
    expect(offered.at(-1)).toBe('17:30');
  });

  it('should_offer_nothing_when_the_barber_does_not_work_that_weekday', async () => {
    expect(await times({ windows: [] })).toEqual([]);
  });
});

describe('PublicAvailabilityService - what removes a time from sale', () => {
  it('should_subtract_an_absence', async () => {
    const offered = await times({
      windows: NINE_TO_SIX,
      absences: [
        {
          start: new Date('2026-08-17T16:00:00.000Z'), // 13:00 local
          end: new Date('2026-08-17T19:00:00.000Z'), // 16:00 local
        },
      ],
    });

    expect(offered).toContain('12:30');
    expect(offered).not.toContain('13:00');
    expect(offered).toContain('16:00');
  });

  it('should_subtract_a_confirmed_booking', async () => {
    const offered = await times({
      windows: NINE_TO_SIX,
      bookings: [
        {
          startTime: new Date('2026-08-17T13:00:00.000Z'), // 10:00 local
          endTime: new Date('2026-08-17T13:30:00.000Z'),
          status: 'CONFIRMED',
          holdExpiresAt: null,
        },
      ],
    });

    expect(offered).not.toContain('10:00');
    expect(offered).toContain('10:30');
  });

  it('should_not_subtract_a_booking_whose_hold_has_lapsed', async () => {
    // The B7 gap, exercised through the service rather than only the predicate:
    // an abandoned checkout must not hold a slot until a job that does not exist
    // yet gets around to it.
    const offered = await times({
      windows: NINE_TO_SIX,
      bookings: [
        {
          startTime: new Date('2026-08-17T13:00:00.000Z'),
          endTime: new Date('2026-08-17T13:30:00.000Z'),
          status: 'PENDING_PAYMENT',
          holdExpiresAt: new Date('2026-08-15T11:00:00.000Z'),
        },
      ],
    });

    expect(offered).toContain('10:00');
  });

  it('should_subtract_a_booking_whose_hold_is_still_live', async () => {
    const offered = await times({
      windows: NINE_TO_SIX,
      bookings: [
        {
          startTime: new Date('2026-08-17T13:00:00.000Z'),
          endTime: new Date('2026-08-17T13:30:00.000Z'),
          status: 'PENDING_PAYMENT',
          holdExpiresAt: new Date('2026-08-15T12:30:00.000Z'),
        },
      ],
    });

    expect(offered).not.toContain('10:00');
  });

  it('should_apply_the_lead_time_against_the_injected_clock', async () => {
    // 12:00 local on the day itself, with a 60-minute lead.
    const offered = await times({ windows: NINE_TO_SIX }, new Date('2026-08-17T15:00:00.000Z'));

    expect(offered).not.toContain('12:30');
    expect(offered[0]).toBe('13:00');
  });
});

describe('PublicAvailabilityService - the date step read', () => {
  it('should_report_the_weekdays_the_barber_works', async () => {
    const schedules = {
      findForBarber: vi.fn().mockResolvedValue([
        { dayOfWeek: 1, startMinute: 540, endMinute: 1080 },
        { dayOfWeek: 3, startMinute: 540, endMinute: 1080 },
      ]),
    } as unknown as IWorkingHoursRepository;
    const availability = { findDayInputs: vi.fn() } as unknown as IBarberAvailabilityRepository;
    const service = new PublicAvailabilityService(availability, schedules, {
      now: () => NOW.getTime(),
      sleep: async () => {},
    });

    const weekdays = await service.workingWeekdays(BARBER, OWNER);

    expect([...weekdays].sort()).toEqual([1, 3]);
  });

  it('should_not_read_bookings_or_absences_for_the_date_step', async () => {
    // Sixty availability computations to draw a strip of days is the cost this
    // deliberately refuses to pay (design D8).
    const { service, findDayInputs } = createService({});

    await service.workingWeekdays(BARBER, OWNER);

    expect(findDayInputs).not.toHaveBeenCalled();
  });
});
