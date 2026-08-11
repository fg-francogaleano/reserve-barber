import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TimeOffForm, type TimeOffFormAction } from './TimeOffForm';
import { EMPTY_TIME_OFF_VALUES, type TimeOffFormState } from './formState';
import { COPY } from '@/lib/copy';

const C = COPY.timeOff;
const BARBER = 'barber-1';

/** Mirrors the real action: every rejection echoes the submitted values back. */
function rejectWith(
  fieldErrors: TimeOffFormState['fieldErrors'],
  formError: string | null = null
): TimeOffFormAction {
  return vi.fn(async (_prev: TimeOffFormState, formData: FormData): Promise<TimeOffFormState> => ({
    error: formError,
    fieldErrors,
    values: {
      startDate: String(formData.get('startDate') ?? ''),
      endDate: String(formData.get('endDate') ?? ''),
      startTime: String(formData.get('startTime') ?? ''),
      endTime: String(formData.get('endTime') ?? ''),
      reason: String(formData.get('reason') ?? ''),
    },
  })) as unknown as TimeOffFormAction;
}

/**
 * The date fields carry `required`, so the browser blocks a submit while they
 * are empty and the action never runs. Filling them is what makes the submit
 * real — the same guard a user meets. `required` is retained here because,
 * unlike `min`/`max`/`step`, it never alters a submitted value.
 */
async function fillRequiredDates(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(C.startDateLabel), '2026-08-11');
  await user.type(screen.getByLabelText(C.endDateLabel), '2026-08-11');
}

beforeEach(() => vi.clearAllMocks());

describe('TimeOffForm - shape', () => {
  it('should_require_the_dates_and_leave_the_times_optional', () => {
    render(<TimeOffForm action={rejectWith({})} barberId={BARBER} />);

    expect(screen.getByLabelText(C.startDateLabel)).toBeRequired();
    expect(screen.getByLabelText(C.endDateLabel)).toBeRequired();
    expect(screen.getByLabelText(C.startTimeLabel)).not.toBeRequired();
    expect(screen.getByLabelText(C.endTimeLabel)).not.toBeRequired();
  });

  it('should_state_that_the_end_date_is_inclusive_for_whole_days', () => {
    render(<TimeOffForm action={rejectWith({})} barberId={BARBER} />);

    // A rule the owner can only discover by losing a day is a rule stated badly.
    expect(screen.getByText(C.wholeDayHint)).toBeInTheDocument();
  });

  it('should_carry_the_barber_id_in_the_submission', async () => {
    const action = rejectWith({});
    const user = userEvent.setup();
    render(<TimeOffForm action={action} barberId={BARBER} />);

    await fillRequiredDates(user);
    await user.click(screen.getByRole('button', { name: C.submit }));
    await screen.findByRole('alert').catch(() => null);

    const formData = (action as ReturnType<typeof vi.fn>).mock.calls[0][1] as FormData;
    expect(formData.get('barberId')).toBe(BARBER);
  });

  it('should_carry_no_step_min_or_max_on_any_control', () => {
    const { container } = render(<TimeOffForm action={rejectWith({})} barberId={BARBER} />);

    // Those attributes let the browser block a submission with a message in its
    // own locale, from a string that exists nowhere in the copy module.
    for (const input of container.querySelectorAll('input')) {
      expect(input.hasAttribute('step')).toBe(false);
      expect(input.hasAttribute('min')).toBe(false);
      expect(input.hasAttribute('max')).toBe(false);
    }
  });
});

describe('TimeOffForm - rejection', () => {
  it('should_mark_the_offending_field_and_leave_the_others_alone', async () => {
    const user = userEvent.setup();
    render(
      <TimeOffForm action={rejectWith({ endTime: C.incompleteTimes })} barberId={BARBER} />
    );

    await fillRequiredDates(user);
    await user.click(screen.getByRole('button', { name: C.submit }));

    expect(await screen.findByRole('alert')).toHaveTextContent(C.incompleteTimes);
    expect(screen.getByLabelText(C.endTimeLabel)).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText(C.startDateLabel)).not.toHaveAttribute('aria-invalid');
  });

  it('should_return_the_submitted_values_rather_than_clearing_them', async () => {
    const user = userEvent.setup();
    render(<TimeOffForm action={rejectWith({ endTime: C.incompleteTimes })} barberId={BARBER} />);

    await user.type(screen.getByLabelText(C.reasonLabel), 'Vacaciones');
    await fillRequiredDates(user);
    await user.click(screen.getByRole('button', { name: C.submit }));
    await screen.findByRole('alert');

    expect(screen.getByLabelText(C.reasonLabel)).toHaveValue('Vacaciones');
  });

  it('should_move_focus_to_the_first_offending_field', async () => {
    const user = userEvent.setup();
    render(<TimeOffForm action={rejectWith({ endTime: C.incompleteTimes })} barberId={BARBER} />);

    await fillRequiredDates(user);
    await user.click(screen.getByRole('button', { name: C.submit }));
    await screen.findByRole('alert');

    // Regression guard: focusing and remounting in one effect loses the focus,
    // because the remount destroys the element just focused (found in M5a).
    await waitFor(() => {
      expect(document.activeElement?.hasAttribute('data-field-error')).toBe(true);
    });
  });

  it('should_fall_back_to_the_form_level_error_when_no_field_is_named', async () => {
    const user = userEvent.setup();
    render(<TimeOffForm action={rejectWith({}, C.limitReached)} barberId={BARBER} />);

    await fillRequiredDates(user);
    await user.click(screen.getByRole('button', { name: C.submit }));
    await screen.findByRole('alert');

    await waitFor(() => {
      expect(document.activeElement?.hasAttribute('data-form-error')).toBe(true);
    });
  });
});

describe('TimeOffForm - submission in flight', () => {
  it('should_disable_every_field_not_just_the_button', async () => {
    let release!: () => void;
    const settled = new Promise<void>((resolve) => {
      release = resolve;
    });
    const action = vi.fn(async (): Promise<TimeOffFormState> => {
      await settled;
      return { error: null, fieldErrors: {}, values: EMPTY_TIME_OFF_VALUES };
    }) as unknown as TimeOffFormAction;

    const user = userEvent.setup();
    const { container } = render(<TimeOffForm action={action} barberId={BARBER} />);

    await fillRequiredDates(user);
    await user.click(screen.getByRole('button', { name: C.submit }));

    await waitFor(() => {
      expect(container.querySelector('fieldset')).toBeDisabled();
    });
    expect(screen.getByRole('button', { name: C.submitting })).toBeDisabled();
    release();
  });
});

describe('TimeOffForm - narrow-viewport layout', () => {
  it('should_clear_min_width_on_the_fieldset', () => {
    // <fieldset> carries `min-width: min-content` from the UA stylesheet, so it
    // refuses to shrink below its widest row. jsdom does not lay out, so this
    // asserts the class that produces the behaviour.
    const { container } = render(<TimeOffForm action={rejectWith({})} barberId={BARBER} />);

    expect(container.querySelector('fieldset')?.className).toContain('min-w-0');
  });
});
