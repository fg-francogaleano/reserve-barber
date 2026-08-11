import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BarberTimeOffService, MAX_TIME_OFF_PER_BARBER } from './BarberTimeOffService';
import { Barber } from '@/server/domain/models/Barber';
import { TimeOff } from '@/server/domain/models/TimeOff';
import { BarberNotFoundError } from '@/server/domain/errors/BarberErrors';
import { TimeOffLimitReachedError } from '@/server/domain/errors/TimeOffErrors';
import type { ITimeOffRepository } from '@/server/domain/repositories/ITimeOffRepository';
import type { IBarberRepository } from '@/server/domain/repositories/IBarberRepository';

const OWNER = 'owner-root';
const BARBER = 'barber-1';

const ABSENCE = {
  startsAt: new Date('2026-08-11T03:00:00.000Z'),
  endsAt: new Date('2026-08-12T03:00:00.000Z'),
  reason: null,
};

function makeService(overrides: { barber?: Barber | null; count?: number } = {}) {
  const timeOff = {
    findForBarber: vi.fn().mockResolvedValue([]),
    findPeriodsForBarber: vi.fn().mockResolvedValue([]),
    countForBarber: vi.fn().mockResolvedValue(overrides.count ?? 0),
    create: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
  } satisfies Record<keyof ITimeOffRepository, ReturnType<typeof vi.fn>>;

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

  const sut = new BarberTimeOffService(
    timeOff as unknown as ITimeOffRepository,
    barbers as unknown as IBarberRepository
  );
  return { sut, timeOff, barbers };
}

beforeEach(() => vi.clearAllMocks());

describe('BarberTimeOffService - ownership', () => {
  it('should_return_null_for_an_unknown_or_foreign_barber', async () => {
    const { sut, timeOff } = makeService({ barber: null });

    await expect(sut.getEditorData(OWNER, BARBER)).resolves.toBeNull();
    // Reading the absences would reveal the barber exists.
    expect(timeOff.findForBarber).not.toHaveBeenCalled();
  });

  it('should_refuse_to_record_for_an_unknown_or_foreign_barber', async () => {
    const { sut, timeOff } = makeService({ barber: null });

    await expect(sut.recordAbsence(OWNER, BARBER, ABSENCE)).rejects.toBeInstanceOf(
      BarberNotFoundError
    );
    expect(timeOff.create).not.toHaveBeenCalled();
    // Not even the count runs: it would leak how many absences exist.
    expect(timeOff.countForBarber).not.toHaveBeenCalled();
  });

  it('should_scope_the_editor_read_to_the_session_owner', async () => {
    const { sut, timeOff } = makeService();

    await sut.getEditorData(OWNER, BARBER);

    expect(timeOff.findForBarber).toHaveBeenCalledWith(BARBER, OWNER);
  });
});

describe('BarberTimeOffService - recording', () => {
  it('should_record_the_absence_for_the_scoped_barber', async () => {
    const { sut, timeOff } = makeService();

    await sut.recordAbsence(OWNER, BARBER, ABSENCE);

    expect(timeOff.create).toHaveBeenCalledWith(BARBER, OWNER, ABSENCE);
  });

  it('should_refuse_once_the_cap_is_reached', async () => {
    const { sut, timeOff } = makeService({ count: MAX_TIME_OFF_PER_BARBER });

    await expect(sut.recordAbsence(OWNER, BARBER, ABSENCE)).rejects.toBeInstanceOf(
      TimeOffLimitReachedError
    );
    expect(timeOff.create).not.toHaveBeenCalled();
  });

  it('should_allow_the_last_absence_below_the_cap', async () => {
    const { sut, timeOff } = makeService({ count: MAX_TIME_OFF_PER_BARBER - 1 });

    await sut.recordAbsence(OWNER, BARBER, ABSENCE);

    expect(timeOff.create).toHaveBeenCalledTimes(1);
  });
});

describe('BarberTimeOffService - removal', () => {
  it('should_pass_the_owner_with_the_delete_rather_than_reading_first', async () => {
    const { sut, timeOff, barbers } = makeService();

    await sut.removeAbsence(OWNER, 'to-1');

    // The ownership predicate travels with the write; a guard read plus an
    // unscoped delete would be two decisions with only one enforced.
    expect(timeOff.remove).toHaveBeenCalledWith('to-1', OWNER);
    expect(barbers.findByIdForOwner).not.toHaveBeenCalled();
  });

  it('should_treat_removing_something_already_gone_as_a_success', async () => {
    const { sut } = makeService();

    await expect(sut.removeAbsence(OWNER, 'already-gone')).resolves.toBeUndefined();
  });
});

describe('BarberTimeOffService - editor data', () => {
  it('should_return_the_barber_and_their_absences', async () => {
    const { sut, timeOff } = makeService();
    timeOff.findForBarber.mockResolvedValue([
      new TimeOff('to-1', ABSENCE.startsAt, ABSENCE.endsAt, 'Vacaciones'),
    ]);

    const data = await sut.getEditorData(OWNER, BARBER);

    expect(data?.barber.displayName).toBe('Ana');
    expect(data?.absences).toHaveLength(1);
  });
});

// ─── Overlaps are allowed, which is a decision and needs a test ──────────────

describe('BarberTimeOffService - overlapping absences', () => {
  it('should_accept_an_absence_that_falls_inside_another', async () => {
    const { sut, timeOff } = makeService({ count: 1 });

    const week = {
      startsAt: new Date('2026-09-01T03:00:00.000Z'),
      endsAt: new Date('2026-09-08T03:00:00.000Z'),
      reason: null,
    };
    const afternoonInside = {
      startsAt: new Date('2026-09-03T17:00:00.000Z'),
      endsAt: new Date('2026-09-03T21:00:00.000Z'),
      reason: null,
    };

    await sut.recordAbsence(OWNER, BARBER, week);
    await sut.recordAbsence(OWNER, BARBER, afternoonInside);

    // Nothing rejects them: they union when availability is computed, and
    // refusing would stop an owner who recorded a holiday from recording a
    // specific appointment inside it.
    expect(timeOff.create).toHaveBeenCalledTimes(2);
  });

  it('should_accept_two_absences_that_partially_overlap', async () => {
    const { sut, timeOff } = makeService();

    await sut.recordAbsence(OWNER, BARBER, {
      startsAt: new Date('2026-09-01T03:00:00.000Z'),
      endsAt: new Date('2026-09-05T03:00:00.000Z'),
      reason: null,
    });
    await sut.recordAbsence(OWNER, BARBER, {
      startsAt: new Date('2026-09-03T03:00:00.000Z'),
      endsAt: new Date('2026-09-07T03:00:00.000Z'),
      reason: null,
    });

    expect(timeOff.create).toHaveBeenCalledTimes(2);
  });
});
