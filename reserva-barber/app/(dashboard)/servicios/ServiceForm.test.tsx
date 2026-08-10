import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ServiceForm, type ServiceFormAction } from './ServiceForm';
import { INITIAL_SERVICE_FORM_STATE, type ServiceFormState } from './formState';
import { COPY } from '@/lib/copy';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const F = COPY.services.form;

/** Mirrors the real actions: every rejection echoes the submitted values back. */
function rejectWith(state: Pick<ServiceFormState, 'fieldErrors'> & { error?: string | null }) {
  return vi.fn(
    async (_prev: ServiceFormState, formData: FormData): Promise<ServiceFormState> => ({
      error: null,
      values: {
        name: String(formData.get('name') ?? ''),
        price: String(formData.get('price') ?? ''),
        durationMinutes: String(formData.get('durationMinutes') ?? ''),
        description: String(formData.get('description') ?? ''),
      },
      ...state,
    })
  );
}

async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(F.nameLabel), 'Corte Clásico');
  await user.type(screen.getByLabelText(F.priceLabel), '4500,50');
  await user.type(screen.getByLabelText(F.durationLabel), '30');
  await user.type(screen.getByLabelText(F.descriptionLabel), 'Corte con máquina y tijera');
  await user.click(screen.getByRole('button', { name: F.submit }));
}

beforeEach(() => vi.clearAllMocks());

// ─── 9.1 — All four values preserved after rejection ─────────────────────────

describe('ServiceForm — rejected submit preserves all values', () => {
  it('should_keep_all_four_typed_values_after_rejection', async () => {
    const user = userEvent.setup();
    render(<ServiceForm action={rejectWith({ fieldErrors: { name: F.nameRequired } })} />);

    await fillAndSubmit(user);
    await screen.findByRole('alert');

    expect(screen.getByLabelText(F.nameLabel)).toHaveValue('Corte Clásico');
    expect(screen.getByLabelText(F.priceLabel)).toHaveValue('4500,50');
    expect(screen.getByLabelText(F.durationLabel)).toHaveValue('30');
    expect(screen.getByLabelText(F.descriptionLabel)).toHaveValue('Corte con máquina y tijera');
  });

  it('should_keep_the_rejected_price_exactly_as_typed', async () => {
    // The whole point of design D7: with type="number" the browser would submit
    // an empty string for "4.500", so there would be nothing to echo back and
    // the owner would lose what they wrote along with the reason why.
    const user = userEvent.setup();
    render(
      <ServiceForm action={rejectWith({ fieldErrors: { price: F.priceThousandsSeparator } })} />
    );

    await user.type(screen.getByLabelText(F.nameLabel), 'Corte');
    await user.type(screen.getByLabelText(F.priceLabel), '4.500');
    await user.type(screen.getByLabelText(F.durationLabel), '30');
    await user.click(screen.getByRole('button', { name: F.submit }));

    await screen.findByRole('alert');
    expect(screen.getByLabelText(F.priceLabel)).toHaveValue('4.500');
  });
});

// ─── 9.2 — Field errors on the correct control, aria-invalid, focus ──────────

describe('ServiceForm — field errors and focus', () => {
  it.each([
    ['name', F.nameLabel, F.nameRequired],
    ['price', F.priceLabel, F.priceThousandsSeparator],
    ['durationMinutes', F.durationLabel, F.durationNotMultiple],
    ['description', F.descriptionLabel, F.descriptionTooLong],
  ])('should_render_the_%s_error_on_its_own_control', async (field, label, message) => {
    const user = userEvent.setup();
    render(<ServiceForm action={rejectWith({ fieldErrors: { [field]: message } })} />);

    await fillAndSubmit(user);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(message);
    expect(screen.getByLabelText(label)).toHaveAttribute('aria-invalid', 'true');
  });

  it('should_move_focus_to_the_error_region', async () => {
    const user = userEvent.setup();
    render(<ServiceForm action={rejectWith({ fieldErrors: { price: F.priceInvalid } })} />);

    await fillAndSubmit(user);

    const alert = await screen.findByRole('alert');
    await waitFor(() => expect(alert).toHaveFocus());
  });

  it('should_focus_the_first_error_in_the_declared_field_order', async () => {
    const user = userEvent.setup();
    render(
      <ServiceForm
        action={rejectWith({
          fieldErrors: {
            durationMinutes: F.durationNotMultiple,
            price: F.priceInvalid,
            name: F.nameRequired,
          },
        })}
      />
    );

    await fillAndSubmit(user);

    // name → price → durationMinutes → description: the name error is first in
    // the DOM and must take focus regardless of key order in the state object.
    const alerts = await screen.findAllByRole('alert');
    expect(alerts[0]).toHaveTextContent(F.nameRequired);
    await waitFor(() => expect(alerts[0]).toHaveFocus());
  });

  it('should_show_the_form_level_error_when_no_field_is_at_fault', async () => {
    const user = userEvent.setup();
    render(
      <ServiceForm
        action={vi.fn(async (): Promise<ServiceFormState> => ({
          error: F.limitReached,
          fieldErrors: {},
          values: INITIAL_SERVICE_FORM_STATE.values,
        }))}
      />
    );

    await fillAndSubmit(user);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(F.limitReached);
  });
});

// ─── 9.3 — Submit disabled while pending ─────────────────────────────────────

describe('ServiceForm — pending state', () => {
  it('should_disable_the_submit_button_while_the_action_is_running', async () => {
    const user = userEvent.setup();
    let release: (state: ServiceFormState) => void = () => {};
    const action = vi.fn(
      () =>
        new Promise<ServiceFormState>((resolve) => {
          release = resolve;
        })
    );
    render(<ServiceForm action={action} />);

    await fillAndSubmit(user);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: F.submitting })).toBeDisabled()
    );

    release(INITIAL_SERVICE_FORM_STATE);
    await waitFor(() => expect(screen.getByRole('button', { name: F.submit })).toBeEnabled());
  });
});

// ─── 9.4 — Labels bound, description optional, hints present when idle ───────

describe('ServiceForm — labels and idle-state hints', () => {
  it('should_bind_labels_to_all_four_controls', () => {
    render(<ServiceForm action={vi.fn()} />);

    expect(screen.getByLabelText(F.nameLabel)).toHaveAttribute('name', 'name');
    expect(screen.getByLabelText(F.priceLabel)).toHaveAttribute('name', 'price');
    expect(screen.getByLabelText(F.durationLabel)).toHaveAttribute('name', 'durationMinutes');
    expect(screen.getByLabelText(F.descriptionLabel)).toHaveAttribute('name', 'description');
  });

  it('should_mark_the_description_as_optional', () => {
    // Asserting the copy itself carries the word ensures a future edit of the
    // label cannot silently drop the optional marker.
    expect(F.descriptionLabel).toMatch(/opcional/i);
  });

  it('should_state_the_price_format_and_the_granularity_before_any_error', () => {
    // A rule the owner can only discover by breaking it is a rule stated badly.
    render(<ServiceForm action={vi.fn()} />);

    expect(screen.getByText(F.priceHint)).toBeInTheDocument();
    expect(screen.getByText(F.durationHint)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('should_describe_the_price_control_by_its_hint_when_idle_and_by_its_error_when_invalid', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<ServiceForm action={vi.fn()} />);

    expect(screen.getByLabelText(F.priceLabel)).toHaveAttribute('aria-describedby', 'price-hint');

    rerender(<ServiceForm action={rejectWith({ fieldErrors: { price: F.priceInvalid } })} />);
    await fillAndSubmit(user);
    await screen.findByRole('alert');

    expect(screen.getByLabelText(F.priceLabel)).toHaveAttribute('aria-describedby', 'price-error');
  });

  it('should_carry_the_service_id_in_a_hidden_field_when_editing', () => {
    const { container } = render(<ServiceForm action={vi.fn()} serviceId="svc-1" />);
    expect(container.querySelector('input[name="id"]')).toHaveValue('svc-1');
  });

  it('should_not_render_an_id_field_when_creating', () => {
    const { container } = render(<ServiceForm action={vi.fn()} />);
    expect(container.querySelector('input[name="id"]')).toBeNull();
  });
});

// ─── 9.5 — Regression guard on the input contract (design D7) ────────────────

describe('ServiceForm — no attribute may block submission or alter a value', () => {
  it('should_not_use_a_number_input_for_the_price', () => {
    // A number input submits an EMPTY STRING when its parser rejects the value,
    // which is what "4500,50" produces in Chrome under an es-AR keyboard.
    render(<ServiceForm action={vi.fn()} />);
    expect(screen.getByLabelText(F.priceLabel)).toHaveAttribute('type', 'text');
  });

  it('should_offer_a_numeric_keypad_on_touch_devices', () => {
    render(<ServiceForm action={vi.fn()} />);
    expect(screen.getByLabelText(F.priceLabel)).toHaveAttribute('inputmode', 'decimal');
    expect(screen.getByLabelText(F.durationLabel)).toHaveAttribute('inputmode', 'numeric');
  });

  it.each([F.priceLabel, F.durationLabel])(
    'should_carry_no_constraint_attribute_on_%s',
    (label) => {
      // min/max/step/pattern let the browser block the submit with a message in
      // the browser's locale that exists nowhere in the copy module — and the
      // server-side rule would then never run.
      render(<ServiceForm action={vi.fn()} />);
      const control = screen.getByLabelText(label);

      for (const attribute of ['min', 'max', 'step', 'pattern']) {
        expect(control).not.toHaveAttribute(attribute);
      }
      expect(control).not.toHaveAttribute('type', 'number');
    }
  );

  it('should_accept_a_comma_decimal_separator_as_typed_text', async () => {
    const user = userEvent.setup();
    // Typed through ServiceFormAction rather than with unused named parameters,
    // so the signature is asserted without tripping the unused-vars rule.
    const action: ServiceFormAction = vi.fn(async () => INITIAL_SERVICE_FORM_STATE);
    render(<ServiceForm action={action} />);

    await fillAndSubmit(user);

    await waitFor(() => expect(action).toHaveBeenCalled());
    const formData = vi.mocked(action).mock.calls[0][1];
    // The literal string reaches the server — not "" as a number input would send.
    expect(formData.get('price')).toBe('4500,50');
  });
});
