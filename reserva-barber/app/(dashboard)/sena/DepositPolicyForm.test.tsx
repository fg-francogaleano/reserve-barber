import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { COPY } from '@/lib/copy';
import { DepositPolicyForm } from './DepositPolicyForm';
import { INITIAL_DEPOSIT_FORM_STATE, type DepositFormState } from './formState';

const EMPTY_DEFAULTS = { type: '', value: '' };
const PERCENT_DEFAULTS = { type: 'PERCENT', value: '30' };

function actionReturning(state: Partial<DepositFormState>) {
  return vi.fn(async () => ({ ...INITIAL_DEPOSIT_FORM_STATE, ...state }));
}

function renderForm(overrides: Partial<Parameters<typeof DepositPolicyForm>[0]> = {}) {
  return render(
    <DepositPolicyForm
      action={actionReturning({})}
      removeAction={actionReturning({})}
      defaults={EMPTY_DEFAULTS}
      configured={false}
      {...overrides}
    />
  );
}

describe('DepositPolicyForm - the type selector', () => {
  it('should_render_both_options_as_a_labelled_radio_group', () => {
    renderForm();

    expect(screen.getByRole('group', { name: COPY.deposit.typeLegend })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: COPY.deposit.typePercent })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: COPY.deposit.typeFixed })).toBeInTheDocument();
  });

  it('should_preselect_the_stored_type', () => {
    renderForm({ defaults: { type: 'FIXED', value: '2000.00' } });

    expect(screen.getByRole('radio', { name: COPY.deposit.typeFixed })).toBeChecked();
  });

  it('should_change_the_value_label_and_help_when_the_type_changes', async () => {
    const user = userEvent.setup();
    renderForm({ defaults: PERCENT_DEFAULTS });

    expect(screen.getByLabelText(COPY.deposit.percentLabel)).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: COPY.deposit.typeFixed }));

    expect(screen.getByLabelText(COPY.deposit.fixedLabel)).toBeInTheDocument();
    expect(screen.getByText(COPY.deposit.fixedHelp)).toBeInTheDocument();
  });
});

describe('DepositPolicyForm - the value field', () => {
  it('should_prefill_from_the_defaults', () => {
    renderForm({ defaults: PERCENT_DEFAULTS });

    expect(screen.getByLabelText(COPY.deposit.percentLabel)).toHaveValue('30');
  });

  /**
   * A number-typed control submits an empty string when the browser's parser
   * rejects the value, making "missing" indistinguishable from "malformed".
   */
  it('should_use_a_text_input_never_a_number_input', () => {
    renderForm({ defaults: PERCENT_DEFAULTS });

    const input = screen.getByLabelText(COPY.deposit.percentLabel);
    expect(input).toHaveAttribute('type', 'text');
    expect(input).toHaveAttribute('inputMode', 'numeric');
  });

  /**
   * min/max/step/pattern let the browser block the submit with a message in its
   * own locale, from a string that exists nowhere in COPY — and the server rule
   * would never run.
   */
  it('should_not_carry_browser_enforced_constraints', () => {
    renderForm({ defaults: PERCENT_DEFAULTS });

    const input = screen.getByLabelText(COPY.deposit.percentLabel);
    for (const attribute of ['min', 'max', 'step', 'pattern', 'required']) {
      expect(input).not.toHaveAttribute(attribute);
    }
  });
});

describe('DepositPolicyForm - errors', () => {
  it('should_render_a_type_error_and_associate_it_with_the_radios', async () => {
    const user = userEvent.setup();
    render(
      <DepositPolicyForm
        action={actionReturning({ fieldErrors: { type: COPY.deposit.typeRequired } })}
        removeAction={actionReturning({})}
        defaults={EMPTY_DEFAULTS}
        configured={false}
      />
    );

    await user.click(screen.getByRole('button', { name: COPY.deposit.submit }));

    const error = await screen.findByText(COPY.deposit.typeRequired);
    expect(error).toHaveAttribute('role', 'alert');
    // Wired to the choice, not to one input: the mistake belongs to the group.
    expect(screen.getByRole('radio', { name: COPY.deposit.typePercent })).toHaveAttribute(
      'aria-describedby',
      error.id
    );
  });

  it('should_not_render_an_error_before_a_submission', () => {
    renderForm();

    expect(screen.queryByText(COPY.deposit.typeRequired)).not.toBeInTheDocument();
    expect(screen.queryByText(COPY.deposit.valueRequired)).not.toBeInTheDocument();
  });

  it('should_associate_a_value_error_with_the_input', async () => {
    const user = userEvent.setup();
    render(
      <DepositPolicyForm
        action={actionReturning({
          fieldErrors: { value: COPY.deposit.percentNotWhole },
          values: PERCENT_DEFAULTS,
        })}
        removeAction={actionReturning({})}
        defaults={PERCENT_DEFAULTS}
        configured
      />
    );

    await user.click(screen.getByRole('button', { name: COPY.deposit.submit }));

    const error = await screen.findByText(COPY.deposit.percentNotWhole);
    expect(error).toHaveAttribute('role', 'alert');
    expect(screen.getByLabelText(COPY.deposit.percentLabel)).toHaveAttribute(
      'aria-describedby',
      error.id
    );
  });

  it('should_render_the_infrastructure_error', async () => {
    const user = userEvent.setup();
    render(
      <DepositPolicyForm
        action={actionReturning({ error: COPY.deposit.infrastructureError })}
        removeAction={actionReturning({})}
        defaults={PERCENT_DEFAULTS}
        configured
      />
    );

    await user.click(screen.getByRole('button', { name: COPY.deposit.submit }));

    expect(await screen.findByText(COPY.deposit.infrastructureError)).toBeInTheDocument();
  });
});

describe('DepositPolicyForm - the confirmation step', () => {
  const pending = {
    policy: { type: 'PERCENT' as const, value: '30' },
    stored: { type: 'PERCENT' as const, value: '3.00' },
    effects: [
      {
        serviceId: 'svc-1',
        serviceName: 'Corte',
        price: '8000.00',
        deposit: '2400.00',
        cappedByPrice: false,
        raisedToMinimum: false,
      },
    ],
  };

  it('should_show_each_service_with_the_deposit_the_policy_would_charge', async () => {
    const user = userEvent.setup();
    render(
      <DepositPolicyForm
        action={actionReturning({ pendingConfirmation: pending })}
        removeAction={actionReturning({})}
        defaults={PERCENT_DEFAULTS}
        configured
      />
    );

    await user.click(screen.getByRole('button', { name: COPY.deposit.submit }));

    expect(await screen.findByText(COPY.deposit.confirmHeading)).toBeInTheDocument();
    expect(screen.getByText('Corte')).toBeInTheDocument();
    expect(screen.getByText('$8.000,00')).toBeInTheDocument();
    expect(screen.getByText('$2.400,00')).toBeInTheDocument();
  });

  /**
   * The answer travels only on the pressed button, and the values are prefixed
   * per form so a second confirming form cannot consume this one's intent (T41).
   */
  it('should_carry_the_prefixed_intent_on_the_buttons', async () => {
    const user = userEvent.setup();
    render(
      <DepositPolicyForm
        action={actionReturning({ pendingConfirmation: pending })}
        removeAction={actionReturning({})}
        defaults={PERCENT_DEFAULTS}
        configured
      />
    );

    await user.click(screen.getByRole('button', { name: COPY.deposit.submit }));

    const confirm = await screen.findByRole('button', { name: COPY.deposit.confirmSubmit });
    expect(confirm).toHaveAttribute('name', 'intent');
    expect(confirm).toHaveAttribute('value', 'deposit-confirm');

    const cancel = screen.getByRole('button', { name: COPY.deposit.confirmCancel });
    expect(cancel).toHaveAttribute('value', 'deposit-edit');
  });

  it('should_carry_the_pending_policy_in_hidden_fields_so_it_survives_the_round_trip', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <DepositPolicyForm
        action={actionReturning({ pendingConfirmation: pending })}
        removeAction={actionReturning({})}
        defaults={PERCENT_DEFAULTS}
        configured
      />
    );

    await user.click(screen.getByRole('button', { name: COPY.deposit.submit }));

    await screen.findByText(COPY.deposit.confirmHeading);
    expect(container.querySelector('input[name="type"][type="hidden"]')).toHaveValue('PERCENT');
    expect(container.querySelector('input[name="value"][type="hidden"]')).toHaveValue('30');
  });

  it('should_render_an_empty_state_when_the_owner_has_no_services', async () => {
    const user = userEvent.setup();
    render(
      <DepositPolicyForm
        action={actionReturning({ pendingConfirmation: { ...pending, effects: [] } })}
        removeAction={actionReturning({})}
        defaults={PERCENT_DEFAULTS}
        configured
      />
    );

    await user.click(screen.getByRole('button', { name: COPY.deposit.submit }));

    expect(await screen.findByText(COPY.deposit.confirmNoServices)).toBeInTheDocument();
  });

  it('should_name_full_prepayment_when_the_pending_policy_is_one_hundred_percent', async () => {
    const user = userEvent.setup();
    render(
      <DepositPolicyForm
        action={actionReturning({
          pendingConfirmation: { ...pending, policy: { type: 'PERCENT', value: '100' } },
        })}
        removeAction={actionReturning({})}
        defaults={PERCENT_DEFAULTS}
        configured
      />
    );

    await user.click(screen.getByRole('button', { name: COPY.deposit.submit }));

    expect(await screen.findByText(COPY.deposit.fullPrepaymentNotice)).toBeInTheDocument();
  });
});

describe('DepositPolicyForm - removal', () => {
  /**
   * Removal is a separate explicit action, never the consequence of an empty
   * field: one keystroke would otherwise unbook the business (design D8).
   */
  it('should_offer_removal_only_when_a_policy_is_stored', () => {
    renderForm({ configured: false });
    expect(screen.queryByRole('button', { name: COPY.deposit.remove })).not.toBeInTheDocument();
  });

  it('should_offer_removal_when_a_policy_is_stored', () => {
    renderForm({ defaults: PERCENT_DEFAULTS, configured: true });
    expect(screen.getByRole('button', { name: COPY.deposit.remove })).toBeInTheDocument();
  });

  it('should_confirm_before_removing', async () => {
    const user = userEvent.setup();
    render(
      <DepositPolicyForm
        action={actionReturning({})}
        removeAction={actionReturning({
          pendingRemoval: { type: 'PERCENT', value: '30.00' },
        })}
        defaults={PERCENT_DEFAULTS}
        configured
      />
    );

    await user.click(screen.getByRole('button', { name: COPY.deposit.remove }));

    expect(await screen.findByText(COPY.deposit.confirmRemoveHeading)).toBeInTheDocument();
    expect(screen.getByText(COPY.deposit.confirmRemoveIntro)).toBeInTheDocument();
  });
});

describe('DepositPolicyForm - success and warnings', () => {
  it('should_report_a_completed_save', async () => {
    const user = userEvent.setup();
    render(
      <DepositPolicyForm
        action={actionReturning({ saved: true, values: PERCENT_DEFAULTS })}
        removeAction={actionReturning({})}
        defaults={PERCENT_DEFAULTS}
        configured
      />
    );

    await user.click(screen.getByRole('button', { name: COPY.deposit.submit }));

    expect(await screen.findByText(COPY.deposit.saved)).toBeInTheDocument();
  });

  /** Shown alongside the success, never instead of it: the save did happen. */
  it('should_show_the_no_payment_method_warning_next_to_the_success', async () => {
    const user = userEvent.setup();
    render(
      <DepositPolicyForm
        action={actionReturning({
          saved: true,
          noPaymentMethod: true,
          values: PERCENT_DEFAULTS,
        })}
        removeAction={actionReturning({})}
        defaults={PERCENT_DEFAULTS}
        configured
      />
    );

    await user.click(screen.getByRole('button', { name: COPY.deposit.submit }));

    expect(await screen.findByText(COPY.deposit.saved)).toBeInTheDocument();
    expect(screen.getByText(COPY.deposit.noMethodWarning)).toBeInTheDocument();
  });

  it('should_name_the_services_a_fixed_deposit_exceeds', async () => {
    const user = userEvent.setup();
    render(
      <DepositPolicyForm
        action={actionReturning({
          saved: true,
          values: { type: 'FIXED', value: '5000.00' },
          servicesBelowDeposit: [
            {
              serviceId: 'svc-1',
              serviceName: 'Corte',
              price: '3000.00',
              deposit: '3000.00',
              cappedByPrice: true,
              raisedToMinimum: false,
            },
          ],
        })}
        removeAction={actionReturning({})}
        defaults={{ type: 'FIXED', value: '5000.00' }}
        configured
      />
    );

    await user.click(screen.getByRole('button', { name: COPY.deposit.submit }));

    expect(await screen.findByText(COPY.deposit.exceedsPricesWarning)).toBeInTheDocument();
    expect(screen.getByText(/Corte/)).toBeInTheDocument();
  });

  it('should_name_the_services_whose_deposit_falls_under_the_minimum', async () => {
    const user = userEvent.setup();
    render(
      <DepositPolicyForm
        action={actionReturning({
          saved: true,
          values: { type: 'PERCENT', value: '1' },
          servicesBelowMinimum: [
            {
              serviceId: 'svc-2',
              serviceName: 'Flequillo',
              price: '50.00',
              deposit: '1.00',
              cappedByPrice: false,
              raisedToMinimum: true,
            },
          ],
        })}
        removeAction={actionReturning({})}
        defaults={{ type: 'PERCENT', value: '1' }}
        configured
      />
    );

    await user.click(screen.getByRole('button', { name: COPY.deposit.submit }));

    expect(await screen.findByText(COPY.deposit.belowMinimumWarning)).toBeInTheDocument();
    expect(screen.getByText(/Flequillo/)).toBeInTheDocument();
  });

  /**
   * Saving and removing are separate action states and neither resets the
   * other, so a stale "guardada" would otherwise survive a removal and leave
   * the page asserting both that no policy is configured and that one was just
   * saved. Caught by driving the real page, not by this suite's first version.
   */
  it('should_not_report_a_save_once_the_policy_has_been_removed', async () => {
    const user = userEvent.setup();
    render(
      <DepositPolicyForm
        action={actionReturning({ saved: true, values: PERCENT_DEFAULTS })}
        removeAction={actionReturning({})}
        defaults={PERCENT_DEFAULTS}
        configured={false}
      />
    );

    await user.click(screen.getByRole('button', { name: COPY.deposit.submit }));

    expect(screen.queryByText(COPY.deposit.saved)).not.toBeInTheDocument();
  });

  it('should_not_keep_a_warning_about_a_policy_that_no_longer_exists', async () => {
    const user = userEvent.setup();
    render(
      <DepositPolicyForm
        action={actionReturning({
          saved: true,
          values: { type: 'FIXED', value: '5000.00' },
          servicesBelowDeposit: [
            {
              serviceId: 'svc-1',
              serviceName: 'Corte',
              price: '3000.00',
              deposit: '3000.00',
              cappedByPrice: true,
              raisedToMinimum: false,
            },
          ],
        })}
        removeAction={actionReturning({})}
        defaults={{ type: 'FIXED', value: '5000.00' }}
        configured={false}
      />
    );

    await user.click(screen.getByRole('button', { name: COPY.deposit.submit }));

    expect(screen.queryByText(COPY.deposit.exceedsPricesWarning)).not.toBeInTheDocument();
  });

  it('should_not_report_a_removal_while_a_policy_is_stored', async () => {
    const user = userEvent.setup();
    render(
      <DepositPolicyForm
        action={actionReturning({})}
        removeAction={actionReturning({ removed: true })}
        defaults={PERCENT_DEFAULTS}
        configured
      />
    );

    await user.click(screen.getByRole('button', { name: COPY.deposit.remove }));

    expect(screen.queryByText(COPY.deposit.removed)).not.toBeInTheDocument();
  });

  it('should_name_full_prepayment_after_saving_one_hundred_percent', async () => {
    const user = userEvent.setup();
    render(
      <DepositPolicyForm
        action={actionReturning({ saved: true, values: { type: 'PERCENT', value: '100' } })}
        removeAction={actionReturning({})}
        defaults={{ type: 'PERCENT', value: '100' }}
        configured
      />
    );

    await user.click(screen.getByRole('button', { name: COPY.deposit.submit }));

    expect(await screen.findByText(COPY.deposit.fullPrepaymentNotice)).toBeInTheDocument();
  });
});
