import { describe, it, expect, vi, beforeEach } from 'vitest';
import { COPY } from '@/lib/copy';
import { BarberNotFoundError } from '@/server/domain/errors/BarberErrors';
import { INITIAL_SCHEDULE_FORM_STATE } from './formState';

const requireOwner = vi.fn(async () => ({ id: 'owner-root', email: 'owner@example.com' }));
const setSchedule = vi.fn(async () => undefined);
const revalidatePath = vi.fn();
const loggerError = vi.fn();
const redirect = vi.fn((path: string): never => {
  // Mirrors Next: redirect() signals by throwing, which is why the real action
  // keeps it outside the try — otherwise a successful save would be caught and
  // reported as an infrastructure failure.
  throw new Error(`NEXT_REDIRECT:${path}`);
});

vi.mock('@/server/infrastructure/supabase/requireOwner', () => ({
  requireOwner: () => requireOwner(),
}));
vi.mock('next/cache', () => ({ revalidatePath: (path: string) => revalidatePath(path) }));
vi.mock('next/navigation', () => ({ redirect: (path: string) => redirect(path) }));
vi.mock('@/server/infrastructure/logger', () => ({
  logger: { error: (...args: unknown[]) => loggerError(...args) },
}));
vi.mock('./scheduleService', () => ({
  scheduleService: () => ({ setSchedule, getEditorData: vi.fn() }),
}));

const { setWorkingHoursAction } = await import('./actions');

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  data.append('barberId', 'barber-1');
  for (let day = 0; day <= 6; day += 1) {
    data.append(`start-${day}`, '');
    data.append(`end-${day}`, '');
  }
  for (const [key, value] of Object.entries(entries)) {
    data.set(key, value);
  }
  return data;
}

const VALID_WEEK = { 'start-1': '09:00', 'end-1': '18:00' };

beforeEach(() => vi.clearAllMocks());

describe('setWorkingHoursAction - authentication precedes parsing', () => {
  it('should_resolve_the_owner_before_touching_the_payload', async () => {
    requireOwner.mockRejectedValueOnce(new Error('no session'));

    await expect(
      setWorkingHoursAction(INITIAL_SCHEDULE_FORM_STATE, form(VALID_WEEK))
    ).rejects.toThrow('no session');

    expect(setSchedule).not.toHaveBeenCalled();
  });
});

describe('setWorkingHoursAction - success path', () => {
  it('should_revalidate_the_barbers_list_before_redirecting', async () => {
    await expect(
      setWorkingHoursAction(INITIAL_SCHEDULE_FORM_STATE, form(VALID_WEEK))
    ).rejects.toThrow('NEXT_REDIRECT:/barberos');

    expect(setSchedule).toHaveBeenCalledWith('owner-root', 'barber-1', [
      { dayOfWeek: 1, startMinute: 540, endMinute: 1080 },
    ]);
    expect(revalidatePath).toHaveBeenCalledWith('/barberos');
  });

  it('should_ignore_an_unknown_weekday_field_and_still_save_the_valid_days', async () => {
    // The action reads exactly one start and one end per weekday 0–6, so the
    // payload is bounded by construction: an injected `start-7` is never read.
    const data = form(VALID_WEEK);
    data.append('start-7', '09:00');
    data.append('end-7', '18:00');

    await expect(setWorkingHoursAction(INITIAL_SCHEDULE_FORM_STATE, data)).rejects.toThrow(
      'NEXT_REDIRECT:/barberos'
    );

    const [, , windows] = setSchedule.mock.calls[0] as unknown as [
      string,
      string,
      { dayOfWeek: number }[],
    ];
    expect(windows).toEqual([{ dayOfWeek: 1, startMinute: 540, endMinute: 1080 }]);
    expect(windows.every((w) => w.dayOfWeek >= 0 && w.dayOfWeek <= 6)).toBe(true);
  });
});

describe('setWorkingHoursAction - rejection', () => {
  it('should_name_the_offending_day_and_not_write', async () => {
    const state = await setWorkingHoursAction(
      INITIAL_SCHEDULE_FORM_STATE,
      form({ 'start-4': '09:00' })
    );

    expect(state.dayErrors[4]).toBe(COPY.workingHours.dayIncomplete);
    expect(setSchedule).not.toHaveBeenCalled();
  });

  it('should_echo_the_submitted_week_back', async () => {
    const state = await setWorkingHoursAction(
      INITIAL_SCHEDULE_FORM_STATE,
      form({ 'start-1': '07:30', 'end-1': '18:00', 'start-4': '09:00' })
    );

    expect(state.values['1']).toEqual({ start: '07:30', end: '18:00' });
  });

  it('should_reject_a_missing_barber_id_without_writing', async () => {
    const data = form(VALID_WEEK);
    data.set('barberId', '   ');

    const state = await setWorkingHoursAction(INITIAL_SCHEDULE_FORM_STATE, data);

    expect(state.error).toBe(COPY.workingHours.barberNotFound);
    expect(setSchedule).not.toHaveBeenCalled();
  });
});

describe('setWorkingHoursAction - infrastructure failure', () => {
  it('should_return_a_failure_as_form_state_rather_than_throwing_to_the_error_boundary', async () => {
    setSchedule.mockRejectedValueOnce(new Error('socket hang up'));

    const state = await setWorkingHoursAction(INITIAL_SCHEDULE_FORM_STATE, form(VALID_WEEK));

    // Throwing would reach the route error boundary, which replaces the page
    // and discards fourteen entered values.
    expect(state.error).toBe(COPY.workingHours.infrastructureError);
    expect(state.values['1']).toEqual({ start: '09:00', end: '18:00' });
  });

  it('should_translate_a_vanished_barber_rather_than_reporting_a_technical_failure', async () => {
    setSchedule.mockRejectedValueOnce(new BarberNotFoundError());

    const state = await setWorkingHoursAction(INITIAL_SCHEDULE_FORM_STATE, form(VALID_WEEK));

    expect(state.error).toBe(COPY.workingHours.barberNotFound);
  });

  it('should_expose_no_internal_detail_in_the_response', async () => {
    setSchedule.mockRejectedValueOnce(
      Object.assign(new Error('Key (barberId, dayOfWeek)=(barber-1, 1) already exists'), {
        code: 'P2002',
      })
    );

    const state = await setWorkingHoursAction(INITIAL_SCHEDULE_FORM_STATE, form(VALID_WEEK));

    const serialized = JSON.stringify(state);
    expect(serialized).not.toContain('P2002');
    expect(serialized).not.toContain('already exists');
    expect(serialized).not.toContain('barberId, dayOfWeek');
  });

  it('should_log_a_recognized_violation_by_code_without_the_driver_message', async () => {
    setSchedule.mockRejectedValueOnce(
      Object.assign(new Error('Key (barberId, dayOfWeek)=(barber-1, 1) already exists'), {
        code: 'P2002',
      })
    );

    await setWorkingHoursAction(INITIAL_SCHEDULE_FORM_STATE, form(VALID_WEEK));

    const [, context] = loggerError.mock.calls[0] as [string, Record<string, unknown>];
    expect(context).toEqual({ operation: 'setWorkingHours', code: 'P2002' });
  });
});
