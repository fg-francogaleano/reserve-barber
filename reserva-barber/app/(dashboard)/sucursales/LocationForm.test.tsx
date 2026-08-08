import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LocationForm } from './LocationForm';
import { INITIAL_LOCATION_FORM_STATE, type LocationFormState } from './formState';
import { COPY } from '@/lib/copy';

// The Cancel control is a `next/link`, which reaches for the App Router context
// that only exists inside a running Next app. These tests are about the form's
// states, so the link is reduced to the anchor it renders as; navigation itself
// is covered by the runtime verification.
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

/** Mirrors the real actions: every rejection echoes the submitted values back. */
function rejectWith(state: Pick<LocationFormState, 'fieldErrors'> & { error?: string | null }) {
  return vi.fn(
    async (_prev: LocationFormState, formData: FormData): Promise<LocationFormState> => ({
      error: null,
      values: {
        name: String(formData.get('name') ?? ''),
        address: String(formData.get('address') ?? ''),
      },
      ...state,
    })
  );
}

describe('LocationForm', () => {
  it('should_keep_the_typed_values_when_the_submission_is_rejected', async () => {
    const user = userEvent.setup();
    const action = rejectWith({ fieldErrors: { name: COPY.locations.form.duplicateName } });
    render(<LocationForm action={action} />);

    const name = screen.getByLabelText(COPY.locations.form.nameLabel);
    const address = screen.getByLabelText(COPY.locations.form.addressLabel);
    await user.type(name, 'Sucursal Centro');
    await user.type(address, 'Av. Corrientes 1234');

    await user.click(screen.getByRole('button', { name: COPY.locations.form.submit }));

    await screen.findByRole('alert');
    // A validation error that clears the form is worse than the error it reports.
    expect(name).toHaveValue('Sucursal Centro');
    expect(address).toHaveValue('Av. Corrientes 1234');
  });

  it('should_render_a_field_error_on_the_name_input_and_move_focus_to_it', async () => {
    const user = userEvent.setup();
    const action = rejectWith({ fieldErrors: { name: COPY.locations.form.duplicateName } });
    render(<LocationForm action={action} />);

    await user.type(screen.getByLabelText(COPY.locations.form.nameLabel), 'Sucursal Centro');
    await user.click(screen.getByRole('button', { name: COPY.locations.form.submit }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(COPY.locations.form.duplicateName);
    expect(screen.getByLabelText(COPY.locations.form.nameLabel)).toHaveAttribute(
      'aria-invalid',
      'true'
    );
    await waitFor(() => expect(alert).toHaveFocus());
  });

  it('should_attach_an_address_error_to_the_address_input_only', async () => {
    const user = userEvent.setup();
    const action = rejectWith({ fieldErrors: { address: COPY.locations.form.addressTooLong } });
    render(<LocationForm action={action} />);

    await user.type(screen.getByLabelText(COPY.locations.form.nameLabel), 'Sucursal Centro');
    await user.click(screen.getByRole('button', { name: COPY.locations.form.submit }));

    await screen.findByRole('alert');
    expect(screen.getByLabelText(COPY.locations.form.addressLabel)).toHaveAttribute(
      'aria-invalid',
      'true'
    );
    expect(screen.getByLabelText(COPY.locations.form.nameLabel)).not.toHaveAttribute('aria-invalid');
  });

  it('should_disable_the_submit_control_while_a_submission_is_pending', async () => {
    const user = userEvent.setup();
    let release: (state: LocationFormState) => void = () => {};
    const action = vi.fn(
      () =>
        new Promise<LocationFormState>((resolve) => {
          release = resolve;
        })
    );
    render(<LocationForm action={action} />);

    await user.type(screen.getByLabelText(COPY.locations.form.nameLabel), 'Sucursal Centro');
    const submit = screen.getByRole('button', { name: COPY.locations.form.submit });
    await user.click(submit);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: COPY.locations.form.submitting })).toBeDisabled()
    );

    release(INITIAL_LOCATION_FORM_STATE);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: COPY.locations.form.submit })).toBeEnabled()
    );
  });

  it('should_bind_labels_to_their_inputs_and_present_the_address_as_optional', () => {
    render(<LocationForm action={vi.fn()} />);

    expect(screen.getByLabelText(COPY.locations.form.nameLabel)).toHaveAttribute('name', 'name');
    expect(screen.getByLabelText(COPY.locations.form.addressLabel)).toHaveAttribute(
      'name',
      'address'
    );
    expect(COPY.locations.form.addressLabel).toMatch(/opcional/i);
  });

  it('should_prefill_the_fields_and_carry_the_id_when_editing', () => {
    const { container } = render(
      <LocationForm
        action={vi.fn()}
        locationId="loc-1"
        defaultName="Sucursal Centro"
        defaultAddress="Av. Corrientes 1234"
      />
    );

    expect(screen.getByLabelText(COPY.locations.form.nameLabel)).toHaveValue('Sucursal Centro');
    expect(screen.getByLabelText(COPY.locations.form.addressLabel)).toHaveValue(
      'Av. Corrientes 1234'
    );
    expect(container.querySelector('input[name="id"]')).toHaveValue('loc-1');
  });

  it('should_not_render_an_id_field_when_creating', () => {
    const { container } = render(<LocationForm action={vi.fn()} />);

    expect(container.querySelector('input[name="id"]')).toBeNull();
  });

  it('should_render_a_form_level_error_when_the_cap_is_reached', async () => {
    const user = userEvent.setup();
    const action = rejectWith({ error: COPY.locations.form.limitReached, fieldErrors: {} });
    render(<LocationForm action={action} />);

    await user.type(screen.getByLabelText(COPY.locations.form.nameLabel), 'Sucursal Centro');
    await user.click(screen.getByRole('button', { name: COPY.locations.form.submit }));

    expect(await screen.findByRole('alert')).toHaveTextContent(COPY.locations.form.limitReached);
  });
});
