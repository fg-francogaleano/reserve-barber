import { describe, it, expect, vi, beforeEach } from 'vitest';
import { COPY } from '@/lib/copy';
import { BarberNotFoundError } from '@/server/domain/errors/BarberErrors';
import { TimeOffLimitReachedError } from '@/server/domain/errors/TimeOffErrors';
import { INITIAL_TIME_OFF_FORM_STATE } from './formState';

const requireOwner = vi.fn(async () => ({ id: 'owner-root', email: 'owner@example.com' }));
const recordAbsence = vi.fn(async () => undefined);
const removeAbsence = vi.fn(async () => undefined);
const revalidatePath = vi.fn();
const loggerError = vi.fn();

vi.mock('@/server/infrastructure/supabase/requireOwner', () => ({
  requireOwner: () => requireOwner(),
}));
vi.mock('next/cache', () => ({ revalidatePath: (path: string) => revalidatePath(path) }));
vi.mock('@/server/infrastructure/logger', () => ({
  logger: { error: (...args: unknown[]) => loggerError(...args) },
}));
vi.mock('./timeOffService', () => ({
  timeOffService: () => ({ recordAbsence, removeAbsence, getEditorData: vi.fn() }),
}));

const { recordAbsenceAction, removeAbsenceAction } = await import('./actions');

function form(entries: Record<string, string> = {}): FormData {
  const data = new FormData();
  data.append('barberId', 'barber-1');
  data.append('startDate', '2026-08-11');
  data.append('endDate', '2026-08-11');
  data.append('startTime', '');
  data.append('endTime', '');
  data.append('reason', '');
  for (const [key, value] of Object.entries(entries)) {
    data.set(key, value);
  }
  return data;
}

beforeEach(() => vi.clearAllMocks());

describe('recordAbsenceAction - authentication precedes parsing', () => {
  it('should_resolve_the_owner_before_touching_the_payload', async () => {
    requireOwner.mockRejectedValueOnce(new Error('no session'));

    await expect(recordAbsenceAction(INITIAL_TIME_OFF_FORM_STATE, form())).rejects.toThrow(
      'no session'
    );
    expect(recordAbsence).not.toHaveBeenCalled();
  });
});

describe('recordAbsenceAction - success', () => {
  it('should_record_a_whole_day_absence_and_revalidate_the_editor', async () => {
    await recordAbsenceAction(INITIAL_TIME_OFF_FORM_STATE, form());

    const [ownerId, barberId, data] = recordAbsence.mock.calls[0] as unknown as [
      string,
      string,
      { startsAt: Date; endsAt: Date; reason: string | null },
    ];
    expect(ownerId).toBe('owner-root');
    expect(barberId).toBe('barber-1');
    expect(data.startsAt.toISOString()).toBe('2026-08-11T03:00:00.000Z');
    expect(data.endsAt.toISOString()).toBe('2026-08-12T03:00:00.000Z');
    expect(revalidatePath).toHaveBeenCalledWith('/barberos/barber-1/ausencias');
  });

  it('should_clear_the_form_after_a_successful_add', async () => {
    // The owner usually records several absences in a row; leaving the previous
    // one in the fields invites recording it twice.
    const state = await recordAbsenceAction(INITIAL_TIME_OFF_FORM_STATE, form());

    expect(state.error).toBeNull();
    expect(state.values.startDate).toBe('');
  });
});

describe('recordAbsenceAction - rejection', () => {
  it('should_name_the_offending_field_and_not_write', async () => {
    const state = await recordAbsenceAction(
      INITIAL_TIME_OFF_FORM_STATE,
      form({ startTime: '14:00' })
    );

    expect(state.fieldErrors.endTime).toBe(COPY.timeOff.incompleteTimes);
    expect(recordAbsence).not.toHaveBeenCalled();
  });

  it('should_echo_the_submitted_values_back', async () => {
    const state = await recordAbsenceAction(
      INITIAL_TIME_OFF_FORM_STATE,
      form({ startTime: '14:00', reason: 'Turno médico' })
    );

    expect(state.values.startTime).toBe('14:00');
    expect(state.values.reason).toBe('Turno médico');
  });

  it('should_reject_a_missing_barber_id_without_writing', async () => {
    const state = await recordAbsenceAction(INITIAL_TIME_OFF_FORM_STATE, form({ barberId: '  ' }));

    expect(state.error).toBe(COPY.timeOff.barberNotFound);
    expect(recordAbsence).not.toHaveBeenCalled();
  });
});

describe('recordAbsenceAction - failures are form state, never thrown', () => {
  it('should_return_the_cap_message', async () => {
    recordAbsence.mockRejectedValueOnce(new TimeOffLimitReachedError());

    const state = await recordAbsenceAction(INITIAL_TIME_OFF_FORM_STATE, form());

    expect(state.error).toBe(COPY.timeOff.limitReached);
  });

  it('should_translate_a_vanished_barber', async () => {
    recordAbsence.mockRejectedValueOnce(new BarberNotFoundError());

    const state = await recordAbsenceAction(INITIAL_TIME_OFF_FORM_STATE, form());

    expect(state.error).toBe(COPY.timeOff.barberNotFound);
  });

  it('should_return_an_infrastructure_failure_in_place_with_the_values_intact', async () => {
    recordAbsence.mockRejectedValueOnce(new Error('socket hang up'));

    const state = await recordAbsenceAction(
      INITIAL_TIME_OFF_FORM_STATE,
      form({ reason: 'Vacaciones' })
    );

    // Throwing would reach the error boundary and discard what was typed.
    expect(state.error).toBe(COPY.timeOff.infrastructureError);
    expect(state.values.reason).toBe('Vacaciones');
  });

  it('should_expose_no_internal_detail_in_the_response', async () => {
    recordAbsence.mockRejectedValueOnce(
      Object.assign(new Error('Key (barberId, startsAt, endsAt)=(...) already exists'), {
        code: 'P2002',
      })
    );

    const state = await recordAbsenceAction(INITIAL_TIME_OFF_FORM_STATE, form());

    const serialized = JSON.stringify(state);
    expect(serialized).not.toContain('P2002');
    expect(serialized).not.toContain('already exists');
  });
});

describe('recordAbsenceAction - the reason never reaches the log', () => {
  it('should_log_the_operation_without_any_part_of_the_reason', async () => {
    recordAbsence.mockRejectedValueOnce(new Error('socket hang up'));

    await recordAbsenceAction(
      INITIAL_TIME_OFF_FORM_STATE,
      form({ reason: 'tratamiento oncológico' })
    );

    // The note can hold medical information. It must not reach the log stream
    // under any circumstance.
    const serialized = JSON.stringify(loggerError.mock.calls);
    expect(serialized).not.toContain('oncológico');
    expect(serialized).not.toContain('tratamiento');
  });

  it('should_log_a_recognized_violation_by_code_only', async () => {
    recordAbsence.mockRejectedValueOnce(
      Object.assign(new Error('Key (...) already exists'), { code: 'P2002' })
    );

    await recordAbsenceAction(INITIAL_TIME_OFF_FORM_STATE, form());

    const [, context] = loggerError.mock.calls[0] as [string, Record<string, unknown>];
    expect(context).toEqual({ operation: 'recordAbsence', code: 'P2002' });
  });
});

describe('removeAbsenceAction', () => {
  function removeForm(entries: Record<string, string> = {}): FormData {
    const data = new FormData();
    data.append('timeOffId', 'to-1');
    data.append('barberId', 'barber-1');
    for (const [key, value] of Object.entries(entries)) {
      data.set(key, value);
    }
    return data;
  }

  it('should_remove_the_absence_scoped_to_the_owner_and_revalidate', async () => {
    await removeAbsenceAction(removeForm());

    expect(removeAbsence).toHaveBeenCalledWith('owner-root', 'to-1');
    expect(revalidatePath).toHaveBeenCalledWith('/barberos/barber-1/ausencias');
  });

  it('should_resolve_the_owner_first', async () => {
    requireOwner.mockRejectedValueOnce(new Error('no session'));

    await expect(removeAbsenceAction(removeForm())).rejects.toThrow('no session');
    expect(removeAbsence).not.toHaveBeenCalled();
  });

  it('should_do_nothing_when_no_id_is_supplied', async () => {
    await removeAbsenceAction(removeForm({ timeOffId: '' }));

    expect(removeAbsence).not.toHaveBeenCalled();
  });

  it('should_swallow_a_failure_and_still_revalidate_so_the_list_speaks', async () => {
    removeAbsence.mockRejectedValueOnce(new Error('socket hang up'));

    // A removal has no form to carry an error back to; if the row is still
    // there after the revalidate, the removal visibly failed.
    await expect(removeAbsenceAction(removeForm())).resolves.toBeUndefined();
    expect(revalidatePath).toHaveBeenCalledWith('/barberos/barber-1/ausencias');
    expect(loggerError).toHaveBeenCalledTimes(1);
  });
});
