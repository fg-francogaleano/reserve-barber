import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  BarberServicesForm,
  type AssignableService,
  type BarberServicesFormAction,
} from './BarberServicesForm';
import type { BarberServicesFormState } from './formState';
import { COPY } from '@/lib/copy';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const C = COPY.barberServices;
const BARBER = 'barber-1';

const SERVICES: AssignableService[] = [
  { id: 'svc-corte', name: 'Corte', isActive: true },
  { id: 'svc-barba', name: 'Barba', isActive: true },
  { id: 'svc-retired', name: 'Servicio Viejo', isActive: false },
];

/** Mirrors the real action: every rejection echoes the submitted selection back. */
function rejectWith(overrides: Partial<BarberServicesFormState> = {}): BarberServicesFormAction {
  return vi.fn(async (
    _prev: BarberServicesFormState,
    formData: FormData
  ): Promise<BarberServicesFormState> => ({
    error: C.invalidSelection,
    invalidServiceId: null,
    values: {
      serviceIds: formData
        .getAll('serviceIds')
        .filter((value): value is string => typeof value === 'string'),
    },
    ...overrides,
  }));
}

function checkbox(name: string): HTMLInputElement {
  return screen.getByRole('checkbox', { name: new RegExp(name) }) as HTMLInputElement;
}

beforeEach(() => vi.clearAllMocks());

describe('BarberServicesForm - initial state', () => {
  it('should_pre_check_the_services_already_assigned', () => {
    render(
      <BarberServicesForm
        action={rejectWith()}
        barberId={BARBER}
        services={SERVICES}
        assignedIds={['svc-barba']}
      />
    );

    expect(checkbox('Corte').checked).toBe(false);
    expect(checkbox('Barba').checked).toBe(true);
  });

  it('should_mark_an_inactive_service_without_hiding_it', () => {
    render(
      <BarberServicesForm
        action={rejectWith()}
        barberId={BARBER}
        services={SERVICES}
        assignedIds={['svc-retired']}
      />
    );

    expect(checkbox('Servicio Viejo').checked).toBe(true);
    expect(screen.getByText(C.inactiveMarker)).toBeInTheDocument();
  });

  it('should_group_the_controls_in_a_labelled_fieldset', () => {
    render(
      <BarberServicesForm
        action={rejectWith()}
        barberId={BARBER}
        services={SERVICES}
        assignedIds={[]}
      />
    );

    expect(screen.getByRole('group', { name: C.legend })).toBeInTheDocument();
  });
});

describe('BarberServicesForm - the rendered baseline travels with the submission', () => {
  it('should_emit_a_hidden_baseline_input_for_every_rendered_service', () => {
    const { container } = render(
      <BarberServicesForm
        action={rejectWith()}
        barberId={BARBER}
        services={SERVICES}
        assignedIds={[]}
      />
    );

    const rendered = container.querySelectorAll('input[name="renderedServiceIds"]');
    expect(Array.from(rendered).map((node) => (node as HTMLInputElement).value)).toEqual([
      'svc-corte',
      'svc-barba',
      'svc-retired',
    ]);
  });

  it('should_submit_the_baseline_even_when_nothing_is_checked', async () => {
    const action = rejectWith();
    const user = userEvent.setup();
    render(
      <BarberServicesForm
        action={action}
        barberId={BARBER}
        services={SERVICES}
        assignedIds={[]}
      />
    );

    await user.click(screen.getByRole('button', { name: C.submit }));
    await screen.findByRole('alert');

    const formData = (action as ReturnType<typeof vi.fn>).mock.calls[0][1] as FormData;
    expect(formData.getAll('serviceIds')).toEqual([]);
    expect(formData.getAll('renderedServiceIds')).toHaveLength(3);
    expect(formData.get('barberId')).toBe(BARBER);
  });
});

describe('BarberServicesForm - rejection', () => {
  it('should_return_the_submitted_selection_not_the_stored_one', async () => {
    const user = userEvent.setup();
    render(
      <BarberServicesForm
        action={rejectWith()}
        barberId={BARBER}
        services={SERVICES}
        // Stored: Barba. The owner unchecks it and checks Corte instead.
        assignedIds={['svc-barba']}
      />
    );

    await user.click(checkbox('Barba'));
    await user.click(checkbox('Corte'));
    await user.click(screen.getByRole('button', { name: C.submit }));
    await screen.findByRole('alert');

    expect(checkbox('Corte').checked).toBe(true);
    expect(checkbox('Barba').checked).toBe(false);
  });

  it('should_show_the_error_in_an_alert', async () => {
    const user = userEvent.setup();
    render(
      <BarberServicesForm
        action={rejectWith({ error: C.serviceUnavailable('Servicio Viejo') })}
        barberId={BARBER}
        services={SERVICES}
        assignedIds={[]}
      />
    );

    await user.click(screen.getByRole('button', { name: C.submit }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Servicio Viejo');
  });

  it('should_mark_the_offending_checkbox_inline', async () => {
    const user = userEvent.setup();
    render(
      <BarberServicesForm
        action={rejectWith({
          error: C.serviceUnavailable('Servicio Viejo'),
          invalidServiceId: 'svc-retired',
        })}
        barberId={BARBER}
        services={SERVICES}
        assignedIds={[]}
      />
    );

    await user.click(screen.getByRole('button', { name: C.submit }));
    await screen.findByRole('alert');

    expect(checkbox('Servicio Viejo')).toHaveAttribute('aria-invalid', 'true');
    expect(checkbox('Corte')).not.toHaveAttribute('aria-invalid');
  });
});

describe('BarberServicesForm - narrow-viewport layout', () => {
  it('should_clear_min_width_on_the_fieldset_the_rows_and_the_labels', () => {
    // Regression guard for a defect found only in a real browser: <fieldset>
    // carries `min-width: min-content` from the UA stylesheet, so it refuses to
    // shrink below its widest label and the page scrolls sideways. Measured at
    // a 360px container with a 120-character service name: 882px of scroll
    // width before, 360px after. jsdom does not lay out, so this asserts the
    // classes that produce the behaviour — the same compromise the services
    // list uses for T18.
    const { container } = render(
      <BarberServicesForm
        action={rejectWith()}
        barberId={BARBER}
        services={[{ id: 'svc-long', name: 'W'.repeat(120), isActive: true }]}
        assignedIds={[]}
      />
    );

    const fieldset = container.querySelector('fieldset');
    expect(fieldset?.className).toContain('min-w-0');

    const row = fieldset?.querySelector('div');
    expect(row?.className).toContain('min-w-0');

    const label = fieldset?.querySelector('label');
    expect(label?.className).toContain('min-w-0');
    expect(label?.className).toContain('break-words');
  });
});

describe('BarberServicesForm - submission in flight', () => {
  /** An action that never settles, so the pending state stays observable. */
  function hangingAction(): {
    action: BarberServicesFormAction;
    calls: () => number;
    release: () => void;
  } {
    let release!: () => void;
    const settled = new Promise<void>((resolve) => {
      release = resolve;
    });
    const action = vi.fn(async (): Promise<BarberServicesFormState> => {
      await settled;
      return { error: null, invalidServiceId: null, values: { serviceIds: [] } };
    });
    return { action, calls: () => action.mock.calls.length, release };
  }

  it('should_disable_the_whole_group_not_just_the_submit_button', async () => {
    const { action } = hangingAction();
    const user = userEvent.setup();
    const { container } = render(
      <BarberServicesForm
        action={action}
        barberId={BARBER}
        services={SERVICES}
        assignedIds={[]}
      />
    );

    await user.click(screen.getByRole('button', { name: C.submit }));

    // The button alone is not enough: React resets uncontrolled inputs when the
    // action resolves, so a checkbox toggled mid-flight would be discarded with
    // no message. Disabling the fieldset is what prevents that.
    await vi.waitFor(() => {
      expect(container.querySelector('fieldset')).toBeDisabled();
    });
    expect(screen.getByRole('button', { name: C.submitting })).toBeDisabled();
  });

  it('should_fire_one_action_for_a_double_click_on_submit', async () => {
    const { action, calls } = hangingAction();
    const user = userEvent.setup();
    render(
      <BarberServicesForm
        action={action}
        barberId={BARBER}
        services={SERVICES}
        assignedIds={[]}
      />
    );

    const submit = screen.getByRole('button', { name: C.submit });
    await user.click(submit);
    await user.click(submit);

    // Post-hydration guard only. Before hydration the button is not yet
    // disabled, which is why the write must also be idempotent at the database
    // (`skipDuplicates`, proven by the repository test and gate probe A).
    expect(calls()).toBe(1);
  });
});
