import { describe, it, expect, vi, afterEach } from 'vitest';
import { BarberCalendarService } from './BarberCalendarService';
import { TimezoneUnavailableError } from './PublicAvailabilityService';
import * as businessTime from '@/server/domain/models/businessTime';
import type {
  BarberCalendarDayInputs,
  IBarberCalendarRepository,
} from '@/server/domain/repositories/IBarberCalendarRepository';
import type { IClock } from '@/server/domain/repositories/IClock';
import type { LocalDate } from '@/server/domain/models/bookingCalendar';

const OWNER = 'owner-root';
const BARBER = 'barber-1';

/** Tuesday 8 September 2026. Local 10:00 is 13:00Z (UTC−3, no DST — T28). */
const DATE: LocalDate = { year: 2026, month: 9, day: 8 };
const NOW = new Date('2026-09-08T13:00:00.000Z');

const clock: IClock = { now: () => NOW.getTime(), sleep: async () => {} };

function inputs(overrides: Partial<BarberCalendarDayInputs> = {}): BarberCalendarDayInputs {
  return {
    barber: { id: BARBER, displayName: 'Nico', locationName: 'Centro' },
    windows: [{ startMinute: 9 * 60, endMinute: 18 * 60 }],
    absences: [],
    appointments: [],
    ...overrides,
  };
}

function serviceOver(row: BarberCalendarDayInputs | null) {
  const findDay = vi.fn().mockResolvedValue(row);
  const repository = { findDay } as unknown as IBarberCalendarRepository;
  return { service: new BarberCalendarService(repository, clock), findDay };
}

afterEach(() => vi.restoreAllMocks());

describe('BarberCalendarService - resolving a day', () => {
  it('should_return_nothing_when_the_barber_resolves_to_nothing_in_this_scope', async () => {
    const { service } = serviceOver(null);

    expect(await service.dayFor({ barberId: BARBER, ownerId: OWNER, date: DATE })).toBeNull();
  });

  it('should_read_the_weekday_and_the_day_bounds_the_date_belongs_to', async () => {
    // The conversion from a calendar day to a weekday and an instant range is a
    // domain rule, made here so the repository decides nothing. 8 Sep 2026 is a
    // Tuesday, and the business day starts at 03:00Z.
    const { service, findDay } = serviceOver(inputs());

    await service.dayFor({ barberId: BARBER, ownerId: OWNER, date: DATE });

    expect(findDay).toHaveBeenCalledWith({
      barberId: BARBER,
      ownerId: OWNER,
      weekday: 2,
      range: {
        start: new Date('2026-09-08T03:00:00.000Z'),
        end: new Date('2026-09-09T03:00:00.000Z'),
      },
    });
  });

  it('should_compose_the_day_from_what_the_read_returned', async () => {
    const view = await serviceOver(inputs()).service.dayFor({
      barberId: BARBER,
      ownerId: OWNER,
      date: DATE,
    });

    expect(view?.barber.displayName).toBe('Nico');
    expect(view?.date).toEqual(DATE);
    // Local 09:00–18:00 is 12:00Z–21:00Z. Written out rather than computed, so
    // a broken conversion cannot make the expectation agree with it.
    expect(view?.day.freeIntervals).toEqual([
      {
        start: new Date('2026-09-08T12:00:00.000Z'),
        end: new Date('2026-09-08T21:00:00.000Z'),
      },
    ]);
  });

  it('should_carry_the_business_today_alongside_the_requested_day', async () => {
    // Read once and passed down, so the page cannot ask a second time and land
    // on the other side of midnight from the first.
    const view = await serviceOver(inputs()).service.dayFor({
      barberId: BARBER,
      ownerId: OWNER,
      date: { year: 2026, month: 9, day: 20 },
    });

    expect(view?.today).toEqual(DATE);
  });

  it('should_answer_today_from_the_business_calendar', () => {
    const { service } = serviceOver(inputs());

    expect(service.today()).toEqual(DATE);
  });
});

describe('BarberCalendarService - the timezone invariant', () => {
  it('should_refuse_rather_than_compute_a_day_the_runtime_cannot_place', async () => {
    // A wrong answer here is a plausible number, not a visible failure: the
    // runtime is UTC and the business is at UTC−3.
    vi.spyOn(businessTime, 'hasTimezoneSupport').mockReturnValue(false);
    const { service, findDay } = serviceOver(inputs());

    await expect(
      service.dayFor({ barberId: BARBER, ownerId: OWNER, date: DATE })
    ).rejects.toBeInstanceOf(TimezoneUnavailableError);
    expect(findDay).not.toHaveBeenCalled();
  });

  it('should_refuse_to_answer_today_without_timezone_support', () => {
    vi.spyOn(businessTime, 'hasTimezoneSupport').mockReturnValue(false);
    const { service } = serviceOver(inputs());

    expect(() => service.today()).toThrow(TimezoneUnavailableError);
  });
});
