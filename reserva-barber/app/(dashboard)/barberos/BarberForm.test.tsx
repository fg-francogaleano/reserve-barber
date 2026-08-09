import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BarberForm } from './BarberForm';
import { INITIAL_BARBER_FORM_STATE, type BarberFormState } from './formState';
import { COPY } from '@/lib/copy';
import type { LocationOption } from './BarberForm';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const LOCATIONS: LocationOption[] = [
  { id: 'loc-1', name: 'Sucursal Centro', isActive: true },
  { id: 'loc-2', name: 'Sucursal Norte', isActive: true },
];

/** Mirrors the real actions: every rejection echoes the submitted values back. */
function rejectWith(state: Pick<BarberFormState, 'fieldErrors'> & { error?: string | null }) {
  return vi.fn(
    async (_prev: BarberFormState, formData: FormData): Promise<BarberFormState> => ({
      error: null,
      values: {
        displayName: String(formData.get('displayName') ?? ''),
        locationId: String(formData.get('locationId') ?? ''),
        bio: String(formData.get('bio') ?? ''),
      },
      ...state,
    })
  );
}

beforeEach(() => vi.clearAllMocks());

// ─── 9.1 — Values preserved after rejection ───────────────────────────────────

describe('BarberForm — rejected submit preserves all values', () => {
  it('should_keep_the_typed_name_and_bio_after_rejection', async () => {
    const user = userEvent.setup();
    const action = rejectWith({ fieldErrors: { displayName: COPY.barbers.form.nameRequired } });
    render(<BarberForm action={action} locations={LOCATIONS} />);

    await user.type(screen.getByLabelText(COPY.barbers.form.nameLabel), 'Juan Pérez');
    await user.selectOptions(screen.getByLabelText(COPY.barbers.form.locationLabel), 'loc-2');
    await user.type(
      screen.getByLabelText(COPY.barbers.form.bioLabel),
      'Especialista en cortes clásicos'
    );
    await user.click(screen.getByRole('button', { name: COPY.barbers.form.submit }));

    await screen.findByRole('alert');

    expect(screen.getByLabelText(COPY.barbers.form.nameLabel)).toHaveValue('Juan Pérez');
    expect(screen.getByLabelText(COPY.barbers.form.bioLabel)).toHaveValue(
      'Especialista en cortes clásicos'
    );
  });

  it('should_apply_the_echoed_locationId_as_the_select_default_when_provided_as_prop', () => {
    // Tests the select's `defaultValue` mechanism (the same path as echoing after
    // rejection). jsdom's form.reset() does not update uncontrolled selects to
    // their React-managed defaultValue; that path is covered in browser section 10.
    render(
      <BarberForm
        action={vi.fn()}
        defaultLocationId="loc-2"
        locations={LOCATIONS}
      />
    );

    const select = screen.getByLabelText(
      COPY.barbers.form.locationLabel
    ) as HTMLSelectElement;
    expect(select.value).toBe('loc-2');
  });
});

// ─── 9.2 — Field errors render on the correct control with aria-invalid ───────

describe('BarberForm — field errors and focus', () => {
  it('should_render_the_displayName_error_on_the_name_input_and_move_focus_to_it', async () => {
    const user = userEvent.setup();
    const action = rejectWith({ fieldErrors: { displayName: COPY.barbers.form.nameRequired } });
    render(<BarberForm action={action} locations={LOCATIONS} />);

    await user.type(screen.getByLabelText(COPY.barbers.form.nameLabel), 'x');
    await user.selectOptions(screen.getByLabelText(COPY.barbers.form.locationLabel), 'loc-1');
    await user.click(screen.getByRole('button', { name: COPY.barbers.form.submit }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(COPY.barbers.form.nameRequired);
    expect(screen.getByLabelText(COPY.barbers.form.nameLabel)).toHaveAttribute(
      'aria-invalid',
      'true'
    );
    await waitFor(() => expect(alert).toHaveFocus());
  });

  it('should_render_the_locationId_error_on_the_select_and_move_focus_to_the_error_region', async () => {
    const user = userEvent.setup();
    const action = rejectWith({
      fieldErrors: { locationId: COPY.barbers.form.locationRequired },
    });
    render(<BarberForm action={action} locations={LOCATIONS} />);

    await user.type(screen.getByLabelText(COPY.barbers.form.nameLabel), 'Juan');
    await user.selectOptions(screen.getByLabelText(COPY.barbers.form.locationLabel), 'loc-1');
    await user.click(screen.getByRole('button', { name: COPY.barbers.form.submit }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(COPY.barbers.form.locationRequired);
    expect(screen.getByLabelText(COPY.barbers.form.locationLabel)).toHaveAttribute(
      'aria-invalid',
      'true'
    );
    await waitFor(() => expect(alert).toHaveFocus());
  });

  it('should_render_the_bio_error_on_the_textarea', async () => {
    const user = userEvent.setup();
    const action = rejectWith({ fieldErrors: { bio: COPY.barbers.form.bioTooLong } });
    render(<BarberForm action={action} locations={LOCATIONS} />);

    await user.type(screen.getByLabelText(COPY.barbers.form.nameLabel), 'Juan');
    await user.selectOptions(screen.getByLabelText(COPY.barbers.form.locationLabel), 'loc-1');
    await user.click(screen.getByRole('button', { name: COPY.barbers.form.submit }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(COPY.barbers.form.bioTooLong);
    expect(screen.getByLabelText(COPY.barbers.form.bioLabel)).toHaveAttribute(
      'aria-invalid',
      'true'
    );
  });

  it('should_focus_the_displayName_error_before_the_locationId_error', async () => {
    const user = userEvent.setup();
    const action = rejectWith({
      fieldErrors: {
        displayName: COPY.barbers.form.nameRequired,
        locationId: COPY.barbers.form.locationRequired,
      },
    });
    render(<BarberForm action={action} locations={LOCATIONS} />);

    // Fill valid values so native required-validation does not block submission.
    // The action itself is what returns both field errors.
    await user.type(screen.getByLabelText(COPY.barbers.form.nameLabel), 'x');
    await user.selectOptions(screen.getByLabelText(COPY.barbers.form.locationLabel), 'loc-1');
    await user.click(screen.getByRole('button', { name: COPY.barbers.form.submit }));

    const alerts = await screen.findAllByRole('alert');
    // The displayName error is first in the DOM — it must receive focus.
    await waitFor(() => expect(alerts[0]).toHaveFocus());
  });
});

// ─── 9.3 — Submit disabled while pending ─────────────────────────────────────

describe('BarberForm — pending state', () => {
  it('should_disable_the_submit_button_while_the_action_is_running', async () => {
    const user = userEvent.setup();
    let release: (state: BarberFormState) => void = () => {};
    const action = vi.fn(
      () =>
        new Promise<BarberFormState>((resolve) => {
          release = resolve;
        })
    );
    render(<BarberForm action={action} locations={LOCATIONS} />);

    await user.type(screen.getByLabelText(COPY.barbers.form.nameLabel), 'Juan');
    await user.selectOptions(screen.getByLabelText(COPY.barbers.form.locationLabel), 'loc-1');
    await user.click(screen.getByRole('button', { name: COPY.barbers.form.submit }));

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: COPY.barbers.form.submitting })
      ).toBeDisabled()
    );

    release(INITIAL_BARBER_FORM_STATE);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: COPY.barbers.form.submit })).toBeEnabled()
    );
  });
});

// ─── 9.4 — Labels bound to all three controls, bio presented as optional ──────

describe('BarberForm — label bindings', () => {
  it('should_bind_labels_to_all_three_controls_and_mark_bio_as_optional', () => {
    render(<BarberForm action={vi.fn()} locations={LOCATIONS} />);

    expect(screen.getByLabelText(COPY.barbers.form.nameLabel)).toHaveAttribute(
      'name',
      'displayName'
    );
    expect(screen.getByLabelText(COPY.barbers.form.locationLabel)).toHaveAttribute(
      'name',
      'locationId'
    );
    expect(screen.getByLabelText(COPY.barbers.form.bioLabel)).toHaveAttribute('name', 'bio');

    // Bio label must communicate it is optional — asserting the copy itself
    // carries the word ensures any future edit of COPY.barbers.form.bioLabel
    // does not silently drop the optional marker.
    expect(COPY.barbers.form.bioLabel).toMatch(/opcional/i);
  });

  it('should_carry_the_barber_id_in_a_hidden_field_when_editing', () => {
    const { container } = render(
      <BarberForm
        action={vi.fn()}
        barberId="barber-1"
        defaultDisplayName="Juan Pérez"
        defaultLocationId="loc-1"
        locations={LOCATIONS}
      />
    );

    expect(container.querySelector('input[name="id"]')).toHaveValue('barber-1');
  });

  it('should_not_render_an_id_field_when_creating', () => {
    const { container } = render(<BarberForm action={vi.fn()} locations={LOCATIONS} />);

    expect(container.querySelector('input[name="id"]')).toBeNull();
  });
});

// ─── 9.5 — Inactive current location appears marked and selected ──────────────

describe('BarberForm — inactive current location (design D5)', () => {
  it('should_include_the_inactive_location_in_the_select_marked_and_selected', () => {
    const locationsWithInactive: LocationOption[] = [
      { id: 'loc-active', name: 'Sucursal Norte', isActive: true },
      { id: 'loc-inactive', name: 'Sucursal Cerrada', isActive: false },
    ];

    render(
      <BarberForm
        action={vi.fn()}
        barberId="barber-1"
        defaultLocationId="loc-inactive"
        locations={locationsWithInactive}
      />
    );

    const select = screen.getByLabelText(
      COPY.barbers.form.locationLabel
    ) as HTMLSelectElement;

    // The inactive location must appear in the option set.
    const inactiveOption = screen.getByRole('option', {
      name: `Sucursal Cerrada ${COPY.barbers.form.inactiveLocationMarker}`,
    });
    expect(inactiveOption).toBeInTheDocument();

    // It must be the selected value.
    expect(select.value).toBe('loc-inactive');
  });

  it('should_not_show_the_inactive_marker_on_active_locations', () => {
    const locationsWithInactive: LocationOption[] = [
      { id: 'loc-active', name: 'Sucursal Norte', isActive: true },
      { id: 'loc-inactive', name: 'Sucursal Cerrada', isActive: false },
    ];

    render(<BarberForm action={vi.fn()} locations={locationsWithInactive} />);

    const activeOption = screen.getByRole('option', { name: 'Sucursal Norte' });
    expect(activeOption).toBeInTheDocument();
    expect(activeOption.textContent).not.toContain(COPY.barbers.form.inactiveLocationMarker);
  });
});
