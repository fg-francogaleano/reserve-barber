import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BarberScheduleService } from './BarberScheduleService';
import { Barber } from '@/server/domain/models/Barber';
import { WorkingHours } from '@/server/domain/models/WorkingHours';
import { BarberNotFoundError } from '@/server/domain/errors/BarberErrors';
import type { IWorkingHoursRepository } from '@/server/domain/repositories/IWorkingHoursRepository';
import type { IBarberRepository } from '@/server/domain/repositories/IBarberRepository';

const OWNER = 'owner-root';
const BARBER = 'barber-1';

function makeService(overrides: { barber?: Barber | null; windows?: WorkingHours[] } = {}) {
  const schedule = {
    findForBarber: vi.fn().mockResolvedValue(overrides.windows ?? []),
    replaceForBarber: vi.fn().mockResolvedValue(undefined),
    findBarberIdsWithSchedule: vi.fn().mockResolvedValue(new Set<string>()),
  } satisfies Record<keyof IWorkingHoursRepository, ReturnType<typeof vi.fn>>;

  const barbers = {
    findByIdForOwner: vi
      .fn()
      .mockResolvedValue(
        overrides.barber === undefined ? new Barber(BARBER, 'loc-1', 'Ana', null, true) : overrides.barber
      ),
    findAllByOwner: vi.fn(),
    countByLocation: vi.fn(),
    existsByLocationAndName: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  };

  const sut = new BarberScheduleService(
    schedule as unknown as IWorkingHoursRepository,
    barbers as unknown as IBarberRepository
  );
  return { sut, schedule, barbers };
}

beforeEach(() => vi.clearAllMocks());

describe('BarberScheduleService - ownership', () => {
  it('should_return_null_for_an_unknown_or_foreign_barber', async () => {
    const { sut, schedule } = makeService({ barber: null });

    await expect(sut.getEditorData(OWNER, BARBER)).resolves.toBeNull();
    // The schedule must not even be read: doing so would reveal that the barber
    // exists through timing or logs.
    expect(schedule.findForBarber).not.toHaveBeenCalled();
  });

  it('should_refuse_to_write_for_an_unknown_or_foreign_barber', async () => {
    const { sut, schedule } = makeService({ barber: null });

    await expect(
      sut.setSchedule(OWNER, BARBER, [{ dayOfWeek: 1, startMinute: 540, endMinute: 1080 }])
    ).rejects.toBeInstanceOf(BarberNotFoundError);

    expect(schedule.replaceForBarber).not.toHaveBeenCalled();
  });

  it('should_scope_the_read_to_the_session_owner', async () => {
    const { sut, schedule } = makeService();

    await sut.getEditorData(OWNER, BARBER);

    expect(schedule.findForBarber).toHaveBeenCalledWith(BARBER, OWNER);
  });
});

describe('BarberScheduleService - the submitted week becomes the stored week', () => {
  it('should_replace_the_whole_week_with_the_submission', async () => {
    const { sut, schedule } = makeService();
    const windows = [
      { dayOfWeek: 1 as const, startMinute: 540, endMinute: 1080 },
      { dayOfWeek: 2 as const, startMinute: 600, endMinute: 840 },
    ];

    await sut.setSchedule(OWNER, BARBER, windows);

    expect(schedule.replaceForBarber).toHaveBeenCalledWith(BARBER, OWNER, windows);
  });

  it('should_treat_an_empty_week_as_a_real_save_that_clears_the_schedule', async () => {
    const { sut, schedule } = makeService({
      windows: [new WorkingHours('wh-1', 1, 540, 1080)],
    });

    await sut.setSchedule(OWNER, BARBER, []);

    // Not a no-op: the barber works no days, and whatever was stored must go.
    expect(schedule.replaceForBarber).toHaveBeenCalledWith(BARBER, OWNER, []);
  });

  it('should_still_write_when_the_submission_matches_what_is_stored', async () => {
    const { sut, schedule } = makeService({
      windows: [new WorkingHours('wh-1', 1, 540, 1080)],
    });

    await sut.setSchedule(OWNER, BARBER, [{ dayOfWeek: 1, startMinute: 540, endMinute: 1080 }]);

    // A replacement is already idempotent, so skipping the write would add a
    // second code path to keep correct in exchange for one saved round trip.
    expect(schedule.replaceForBarber).toHaveBeenCalledTimes(1);
  });
});
