import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WeeklyScheduleForm, type WeeklyScheduleFormAction } from './WeeklyScheduleForm';
import { emptyWeek, type ScheduleFormState, type WeekValues } from './formState';
import { COPY } from '@/lib/copy';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const C = COPY.workingHours;
const BARBER = 'barber-1';

function storedWeek(): WeekValues {
  const values = emptyWeek();
  values['1'] = { start: '09:00', end: '18:00' };
  values['4'] = { start: '09:00', end: '18:00' };
  return values;
}

/** Mirrors the real action: every rejection echoes the submitted week back. */
function rejectWith(dayErrors: Record<number, string>, formError: string | null = null) {
  return vi.fn(async (_prev: ScheduleFormState, formData: FormData): Promise<ScheduleFormState> => {
    const values = emptyWeek();
    for (let day = 0; day <= 6; day += 1) {
      values[String(day)] = {
        start: String(formData.get(`start-${day}`) ?? ''),
        end: String(formData.get(`end-${day}`) ?? ''),
      };
    }
    return { error: formError, dayErrors, values };
  }) as unknown as WeeklyScheduleFormAction;
}

function field(day: number, which: 'start' | 'end'): HTMLInputElement {
  const label = which === 'start' ? C.startLabel : C.endLabel;
  return screen.getByLabelText(`${C.dayNames[day]} — ${label}`) as HTMLInputElement;
}

beforeEach(() => vi.clearAllMocks());

describe('WeeklyScheduleForm - week order and initial values', () => {
  it('should_render_monday_first_and_sunday_last', () => {
    render(
      <WeeklyScheduleForm action={rejectWith({})} barberId={BARBER} defaultValues={emptyWeek()} />
    );

    const dayLabels = screen
      .getAllByText(/Lunes|Martes|Miércoles|Jueves|Viernes|Sábado|Domingo/)
      .map((node) => node.textContent);

    expect(dayLabels[0]).toBe('Lunes');
    expect(dayLabels[dayLabels.length - 1]).toBe('Domingo');
  });

  it('should_show_the_stored_week_and_leave_non_working_days_empty', () => {
    render(
      <WeeklyScheduleForm action={rejectWith({})} barberId={BARBER} defaultValues={storedWeek()} />
    );

    expect(field(1, 'start').value).toBe('09:00');
    expect(field(0, 'start').value).toBe('');
  });

  it('should_carry_the_barber_id_in_the_submission', async () => {
    const action = rejectWith({});
    const user = userEvent.setup();
    render(
      <WeeklyScheduleForm action={action} barberId={BARBER} defaultValues={storedWeek()} />
    );

    await user.click(screen.getByRole('button', { name: C.submit }));
    await screen.findByRole('alert').catch(() => null);

    const formData = (action as ReturnType<typeof vi.fn>).mock.calls[0][1] as FormData;
    expect(formData.get('barberId')).toBe(BARBER);
  });
});

describe('WeeklyScheduleForm - rejection', () => {
  it('should_mark_the_offending_day_and_leave_the_others_alone', async () => {
    const user = userEvent.setup();
    render(
      <WeeklyScheduleForm
        action={rejectWith({ 4: C.dayIncomplete })}
        barberId={BARBER}
        defaultValues={storedWeek()}
      />
    );

    await user.click(screen.getByRole('button', { name: C.submit }));

    expect(await screen.findByRole('alert')).toHaveTextContent(C.dayIncomplete);
    expect(field(4, 'start')).toHaveAttribute('aria-invalid', 'true');
    expect(field(1, 'start')).not.toHaveAttribute('aria-invalid');
  });

  it('should_return_the_submitted_week_not_the_stored_one', async () => {
    const user = userEvent.setup();
    render(
      <WeeklyScheduleForm
        action={rejectWith({ 4: C.dayIncomplete })}
        barberId={BARBER}
        defaultValues={storedWeek()}
      />
    );

    await user.clear(field(1, 'start'));
    await user.type(field(1, 'start'), '07:30');
    await user.click(screen.getByRole('button', { name: C.submit }));
    await screen.findByRole('alert');

    // Stored is 09:00. The owner typed 07:30 and must get 07:30 back.
    expect(field(1, 'start').value).toBe('07:30');
  });

  it('should_move_focus_to_the_first_offending_day', async () => {
    const user = userEvent.setup();
    render(
      <WeeklyScheduleForm
        action={rejectWith({ 4: C.dayIncomplete })}
        barberId={BARBER}
        defaultValues={storedWeek()}
      />
    );

    await user.click(screen.getByRole('button', { name: C.submit }));
    await screen.findByRole('alert');

    // Regression guard: focusing and remounting in the same effect silently
    // loses the focus, because the remount destroys the element just focused.
    // Found in a browser, not by a test — this is the test that would have.
    await waitFor(() => {
      expect(document.activeElement?.getAttribute('data-day-error')).toBe('4');
    });
  });

  it('should_fall_back_to_the_form_level_error_when_no_day_is_named', async () => {
    const user = userEvent.setup();
    render(
      <WeeklyScheduleForm
        action={rejectWith({}, C.invalidSelection)}
        barberId={BARBER}
        defaultValues={storedWeek()}
      />
    );

    await user.click(screen.getByRole('button', { name: C.submit }));
    await screen.findByRole('alert');

    await waitFor(() => {
      expect(document.activeElement?.hasAttribute('data-form-error')).toBe(true);
    });
  });
});

describe('WeeklyScheduleForm - submission in flight', () => {
  it('should_disable_every_time_field_not_just_the_button', async () => {
    let release!: () => void;
    const settled = new Promise<void>((resolve) => {
      release = resolve;
    });
    const action = vi.fn(async (): Promise<ScheduleFormState> => {
      await settled;
      return { error: null, dayErrors: {}, values: emptyWeek() };
    }) as unknown as WeeklyScheduleFormAction;

    const user = userEvent.setup();
    const { container } = render(
      <WeeklyScheduleForm action={action} barberId={BARBER} defaultValues={storedWeek()} />
    );

    await user.click(screen.getByRole('button', { name: C.submit }));

    // React resets uncontrolled inputs when the action resolves, so a time
    // edited mid-flight would vanish. With fourteen fields that loss is far
    // more expensive than a single checkbox.
    await waitFor(() => {
      expect(container.querySelector('fieldset')).toBeDisabled();
    });
    expect(screen.getByRole('button', { name: C.submitting })).toBeDisabled();
    release();
  });
});

describe('WeeklyScheduleForm - narrow-viewport layout', () => {
  it('should_clear_min_width_on_the_fieldset', () => {
    // <fieldset> carries `min-width: min-content` from the UA stylesheet, so it
    // refuses to shrink below its widest row and the page scrolls sideways.
    // jsdom does not lay out, so this asserts the class that produces it.
    const { container } = render(
      <WeeklyScheduleForm action={rejectWith({})} barberId={BARBER} defaultValues={storedWeek()} />
    );

    expect(container.querySelector('fieldset')?.className).toContain('min-w-0');
  });
});
