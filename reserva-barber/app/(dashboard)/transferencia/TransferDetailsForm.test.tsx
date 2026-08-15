import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { COPY } from '@/lib/copy';
import { TransferDetailsForm } from './TransferDetailsForm';
import { INITIAL_TRANSFER_FORM_STATE, type TransferFormState } from './formState';

const CBU = '2850590940090418135201';

const EMPTY_DEFAULTS = { cbuCvu: '', alias: '', holderName: '' };

function actionReturning(state: Partial<TransferFormState>) {
  return vi.fn(async () => ({ ...INITIAL_TRANSFER_FORM_STATE, ...state }));
}

describe('TransferDetailsForm - fields', () => {
  it('should_render_the_three_fields_prefilled_from_the_defaults', () => {
    render(
      <TransferDetailsForm
        action={actionReturning({})}
        defaults={{ cbuCvu: '2850 5909', alias: 'mi.barberia', holderName: 'Barberia Franco' }}
      />
    );

    expect(screen.getByLabelText(COPY.transfer.cbuLabel)).toHaveValue('2850 5909');
    expect(screen.getByLabelText(COPY.transfer.aliasLabel)).toHaveValue('mi.barberia');
    expect(screen.getByLabelText(COPY.transfer.holderLabel)).toHaveValue('Barberia Franco');
  });

  it('should_use_a_text_input_for_the_destination_never_a_number_input', () => {
    // A number-typed control submits an empty string when the browser's parser
    // rejects the value, making "missing" indistinguishable from "malformed".
    render(<TransferDetailsForm action={actionReturning({})} defaults={EMPTY_DEFAULTS} />);

    const input = screen.getByLabelText(COPY.transfer.cbuLabel);
    expect(input).toHaveAttribute('type', 'text');
    expect(input).toHaveAttribute('inputMode', 'numeric');
  });

  it('should_not_carry_browser_enforced_constraints_on_any_control', () => {
    // min/max/step/pattern let the browser block the submit with a message in
    // its own locale, from a string that exists nowhere in COPY.
    render(<TransferDetailsForm action={actionReturning({})} defaults={EMPTY_DEFAULTS} />);

    for (const label of [COPY.transfer.cbuLabel, COPY.transfer.aliasLabel, COPY.transfer.holderLabel]) {
      const input = screen.getByLabelText(label);
      expect(input).not.toHaveAttribute('min');
      expect(input).not.toHaveAttribute('max');
      expect(input).not.toHaveAttribute('step');
      expect(input).not.toHaveAttribute('pattern');
    }
  });
});

describe('TransferDetailsForm - submission in flight', () => {
  it('should_disable_the_submit_control_while_a_submission_is_in_flight', async () => {
    // Held open so the pending state can be observed. The server remains the
    // real guard — the write is idempotent — but a control that stays live
    // invites the owner to submit a payment destination twice.
    let release: (state: TransferFormState) => void = () => {};
    const action = vi.fn(
      () =>
        new Promise<TransferFormState>((resolve) => {
          release = resolve;
        })
    );

    render(<TransferDetailsForm action={action} defaults={EMPTY_DEFAULTS} />);

    const button = screen.getByRole('button', { name: COPY.transfer.submit });
    await userEvent.click(button);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: COPY.transfer.submitting })).toBeDisabled();
    });

    release({ ...INITIAL_TRANSFER_FORM_STATE, saved: true });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: COPY.transfer.submit })).toBeEnabled();
    });
  });

  it('should_disable_the_confirm_control_while_the_confirmation_is_in_flight', async () => {
    // The confirmation is the step that actually commits a changed destination,
    // so a double-click here is the one worth preventing.
    let release: (state: TransferFormState) => void = () => {};
    const action = vi
      .fn<() => Promise<TransferFormState>>()
      .mockResolvedValueOnce({
        ...INITIAL_TRANSFER_FORM_STATE,
        pendingConfirmation: { cbuCvu: CBU, alias: null, holderName: 'Barberia Franco' },
      })
      .mockImplementationOnce(
        () =>
          new Promise<TransferFormState>((resolve) => {
            release = resolve;
          })
      );

    render(<TransferDetailsForm action={action} defaults={EMPTY_DEFAULTS} />);

    await userEvent.click(screen.getByRole('button', { name: COPY.transfer.submit }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: COPY.transfer.confirmSubmit })).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: COPY.transfer.confirmSubmit }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: COPY.transfer.submitting })).toBeDisabled();
    });

    release({ ...INITIAL_TRANSFER_FORM_STATE, saved: true });
  });
});

describe('TransferDetailsForm - errors', () => {
  it('should_render_a_field_error_against_its_own_field', async () => {
    render(
      <TransferDetailsForm
        action={actionReturning({ fieldErrors: { cbuCvu: COPY.transfer.cbuInvalidChecksum } })}
        defaults={EMPTY_DEFAULTS}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: COPY.transfer.submit }));

    await waitFor(() => {
      expect(screen.getByText(COPY.transfer.cbuInvalidChecksum)).toBeInTheDocument();
    });
    expect(screen.getByLabelText(COPY.transfer.cbuLabel)).toHaveAttribute('aria-invalid', 'true');
  });

  it('should_render_a_form_level_error_when_no_destination_was_given', async () => {
    render(
      <TransferDetailsForm
        action={actionReturning({ fieldErrors: { form: COPY.transfer.noDestination } })}
        defaults={EMPTY_DEFAULTS}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: COPY.transfer.submit }));

    await waitFor(() => {
      expect(screen.getByText(COPY.transfer.noDestination)).toBeInTheDocument();
    });
  });

  it('should_render_the_reload_instruction_on_an_infrastructure_failure', async () => {
    render(
      <TransferDetailsForm
        action={actionReturning({ error: COPY.transfer.infrastructureError })}
        defaults={EMPTY_DEFAULTS}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: COPY.transfer.submit }));

    await waitFor(() => {
      expect(screen.getByText(COPY.transfer.infrastructureError)).toBeInTheDocument();
    });
  });

  it('should_preserve_what_the_owner_typed_when_the_save_is_rejected', async () => {
    render(
      <TransferDetailsForm
        action={actionReturning({
          fieldErrors: { cbuCvu: COPY.transfer.cbuInvalidLength },
          values: { cbuCvu: '12345', alias: '', holderName: 'Barberia Franco' },
        })}
        defaults={EMPTY_DEFAULTS}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: COPY.transfer.submit }));

    await waitFor(() => {
      expect(screen.getByLabelText(COPY.transfer.cbuLabel)).toHaveValue('12345');
    });
    expect(screen.getByLabelText(COPY.transfer.holderLabel)).toHaveValue('Barberia Franco');
  });
});

describe('TransferDetailsForm - success and warning', () => {
  it('should_confirm_a_successful_save', async () => {
    render(
      <TransferDetailsForm
        action={actionReturning({ saved: true })}
        defaults={EMPTY_DEFAULTS}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: COPY.transfer.submit }));

    await waitFor(() => {
      expect(screen.getByText(COPY.transfer.saved)).toBeInTheDocument();
    });
  });

  it('should_show_the_warning_alongside_the_success_not_instead_of_it', async () => {
    // The save did happen. Replacing the confirmation with a warning would
    // read as a failure.
    render(
      <TransferDetailsForm
        action={actionReturning({ saved: true, noPaymentMethod: true })}
        defaults={EMPTY_DEFAULTS}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: COPY.transfer.submit }));

    await waitFor(() => {
      expect(screen.getByText(COPY.transfer.noMethodWarning)).toBeInTheDocument();
    });
    expect(screen.getByText(COPY.transfer.saved)).toBeInTheDocument();
  });

  it('should_not_warn_when_a_payment_method_remains', async () => {
    render(
      <TransferDetailsForm
        action={actionReturning({ saved: true })}
        defaults={EMPTY_DEFAULTS}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: COPY.transfer.submit }));

    await waitFor(() => {
      expect(screen.getByText(COPY.transfer.saved)).toBeInTheDocument();
    });
    expect(screen.queryByText(COPY.transfer.noMethodWarning)).not.toBeInTheDocument();
  });
});

describe('TransferDetailsForm - confirmation step', () => {
  const pending = { cbuCvu: CBU, alias: null, holderName: 'Barberia Franco' };

  it('should_replace_the_editor_with_the_confirmation_when_one_is_pending', async () => {
    render(
      <TransferDetailsForm
        action={actionReturning({ pendingConfirmation: pending })}
        defaults={EMPTY_DEFAULTS}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: COPY.transfer.submit }));

    await waitFor(() => {
      expect(screen.getByText(COPY.transfer.confirmHeading)).toBeInTheDocument();
    });
    expect(screen.queryByLabelText(COPY.transfer.cbuLabel)).not.toBeInTheDocument();
  });

  it('should_show_the_normalized_value_formatted_for_reading', async () => {
    // Confirming what the owner typed rather than what would be stored would
    // confirm the wrong thing.
    render(
      <TransferDetailsForm
        action={actionReturning({ pendingConfirmation: pending })}
        defaults={EMPTY_DEFAULTS}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: COPY.transfer.submit }));

    await waitFor(() => {
      expect(screen.getByText('2850 5909 4009 0418 1352 01')).toBeInTheDocument();
    });
  });

  it('should_offer_both_confirming_and_going_back', async () => {
    render(
      <TransferDetailsForm
        action={actionReturning({ pendingConfirmation: pending })}
        defaults={EMPTY_DEFAULTS}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: COPY.transfer.submit }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: COPY.transfer.confirmSubmit })).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: COPY.transfer.confirmCancel })).toBeInTheDocument();
  });

  it('should_use_the_clearing_wording_when_the_destination_is_being_removed', async () => {
    render(
      <TransferDetailsForm
        action={actionReturning({
          pendingConfirmation: { cbuCvu: null, alias: null, holderName: null },
        })}
        defaults={EMPTY_DEFAULTS}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: COPY.transfer.submit }));

    await waitFor(() => {
      expect(screen.getByText(COPY.transfer.confirmClearIntro)).toBeInTheDocument();
    });
  });

  it('should_not_commit_the_change_when_the_owner_goes_back_to_edit', async () => {
    // The whole point of the step. If "Volver a editar" commits, the guard is
    // worse than absent: it asks for confirmation and then ignores the answer.
    const action = vi.fn<(s: TransferFormState, f: FormData) => Promise<TransferFormState>>(
      async () => ({
        ...INITIAL_TRANSFER_FORM_STATE,
        pendingConfirmation: { cbuCvu: CBU, alias: null, holderName: 'Barberia Franco' },
      })
    );

    render(<TransferDetailsForm action={action} defaults={EMPTY_DEFAULTS} />);

    await userEvent.click(screen.getByRole('button', { name: COPY.transfer.submit }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: COPY.transfer.confirmCancel })).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: COPY.transfer.confirmCancel }));

    await waitFor(() => {
      expect(action).toHaveBeenCalledTimes(2);
    });
    const submitted = action.mock.calls[1][1];
    expect(submitted.get('confirmed')).not.toBe('true');
  });

  it('should_carry_the_pending_values_forward_as_hidden_fields', async () => {
    const action = actionReturning({ pendingConfirmation: pending });
    const { container } = render(
      <TransferDetailsForm action={action} defaults={EMPTY_DEFAULTS} />
    );

    await userEvent.click(screen.getByRole('button', { name: COPY.transfer.submit }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: COPY.transfer.confirmSubmit })).toHaveAttribute('value', 'transfer-confirm');
    });
    expect(container.querySelector('input[name="cbuCvu"]')).toHaveValue(CBU);
  });
});
