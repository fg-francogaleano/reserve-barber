import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MercadoPagoCredentialsForm } from './MercadoPagoCredentialsForm';
import { INITIAL_MERCADO_PAGO_STATE, type MercadoPagoFormState } from './formState';
import { COPY } from '@/lib/copy';

const TOKEN = 'APP_USR-4934588586838432-081312-abcdef0123456789abcdef0123456789-241983636';
const KEY = 'APP_USR-d0a26210-1f4b-4c3a-9e21-479f0400869e';

const PENDING = {
  environment: null,
  lastFour: '8777',
  displayName: 'BARBERIA-FRANCO',
  storedLastFour: '3636',
  storedEnvironment: null,
  verified: true,
};

function actionReturning(state: Partial<MercadoPagoFormState>) {
  return vi.fn(async () => ({ ...INITIAL_MERCADO_PAGO_STATE, ...state }));
}

function renderForm(next: Partial<MercadoPagoFormState> = {}, configured = false, publicKey = '') {
  return render(
    <MercadoPagoCredentialsForm
      action={actionReturning(next)}
      defaults={{ publicKey }}
      configured={configured}
    />
  );
}

/**
 * `useActionState` renders the initial state until the action resolves, so any
 * assertion about a server-returned state has to go through a submission.
 */
async function renderAndSubmit(next: Partial<MercadoPagoFormState>, configured = false) {
  const utils = renderForm(next, configured);
  await userEvent.click(screen.getByRole('button', { name: COPY.mercadoPago.submit }));
  return utils;
}

describe('MercadoPagoCredentialsForm - the access token never reaches the page', () => {
  it('should_render_the_token_field_empty', () => {
    renderForm();

    expect(screen.getByLabelText(COPY.mercadoPago.accessTokenLabel)).toHaveValue('');
  });

  it('should_not_prefill_the_token_field_with_a_mask', () => {
    // A masked default that submits back the mask stores the mask.
    renderForm();

    const field = screen.getByLabelText(COPY.mercadoPago.accessTokenLabel);
    expect(field).toHaveValue('');
    expect(field).toHaveAttribute('autocomplete', 'off');
  });

  // Never type="password": it invites the browser's password manager to save
  // it and, worse, to autofill the owner's login password here on a later visit.
  it('should_not_use_a_password_input_for_the_token', () => {
    renderForm();

    expect(screen.getByLabelText(COPY.mercadoPago.accessTokenLabel)).toHaveAttribute('type', 'text');
  });

  it('should_keep_the_token_out_of_the_markup_after_a_submission', async () => {
    const { container } = renderForm({ saved: true });

    await userEvent.type(screen.getByLabelText(COPY.mercadoPago.accessTokenLabel), TOKEN);
    await userEvent.click(screen.getByRole('button', { name: COPY.mercadoPago.submit }));

    await waitFor(() => {
      expect(screen.getByText(COPY.mercadoPago.saved)).toBeInTheDocument();
    });
    // React 19 resets the uncontrolled form once the action resolves, and the
    // state deliberately does not echo the token back (design D15).
    expect(container.innerHTML).not.toContain(TOKEN);
  });
});

describe('MercadoPagoCredentialsForm - the confirmation step', () => {
  it('should_carry_no_credential_in_the_markup', async () => {
    // Design D6/D7: unlike PC1's confirmation, there are no hidden credential
    // inputs — the token is waiting in an httpOnly cookie instead.
    const { container } = await renderAndSubmit({
      pendingConfirmation: PENDING,
      pendingIntent: 'save',
    });

    await waitFor(() => {
      expect(screen.getByText(COPY.mercadoPago.confirmHeading)).toBeInTheDocument();
    });
    expect(container.innerHTML).not.toContain(TOKEN);
    expect(container.innerHTML).not.toContain(KEY);
    // Scoped to credentials, not to hidden inputs in general. The earlier
    // blanket assertion ("no hidden inputs at all") locked in a blocker: it
    // made the confirmation unable to carry the pair forward by any means, and
    // the pair travels in the encrypted cookie precisely so that neither
    // credential has to.
    expect(container.querySelector('input[name="accessToken"]')).toBeNull();
    expect(container.querySelector('input[name="publicKey"]')).toBeNull();
  });

  it('should_name_the_account_the_credentials_belong_to', async () => {
    await renderAndSubmit({ pendingConfirmation: PENDING, pendingIntent: 'save' });

    await waitFor(() => {
      expect(screen.getByText('BARBERIA-FRANCO')).toBeInTheDocument();
    });
  });

  /*
   * Three tests for the account-switch warning (design D6a) were removed
   * here on 2026-08-13. The warning was withdrawn once a real credential
   * showed the token's trailing segment is not the Mercado Pago account.
   */

  it('should_show_no_account_when_mercado_pago_did_not_name_one', async () => {
    // There is no offline fallback any more — inventing one is what
    // produced the withdrawn warning.
    await renderAndSubmit({
      pendingConfirmation: { ...PENDING, displayName: null },
      pendingIntent: 'save',
    });

    await waitFor(() => {
      expect(screen.getByText(COPY.mercadoPago.confirmHeading)).toBeInTheDocument();
    });
    expect(screen.queryByText(COPY.mercadoPago.accountLabel)).not.toBeInTheDocument();
  });

  it('should_say_when_the_credentials_could_not_be_verified', async () => {
    await renderAndSubmit({
      pendingConfirmation: { ...PENDING, verified: false },
      pendingIntent: 'save',
    });

    await waitFor(() => {
      expect(screen.getByText(COPY.mercadoPago.confirmUnverified)).toBeInTheDocument();
    });
  });

  // The answer must travel only on the pressed control. A hidden field
  // declaring it would win, because FormData.get returns the first value for a
  // name — and "Volver a editar" would commit what the owner declined.
  it('should_carry_the_answer_only_on_the_activated_control', async () => {
    const { container } = await renderAndSubmit({
      pendingConfirmation: PENDING,
      pendingIntent: 'save',
    });

    await waitFor(() => {
      expect(screen.getByText(COPY.mercadoPago.confirmHeading)).toBeInTheDocument();
    });
    expect(container.querySelector('input[name="intent"]')).toBeNull();
    expect(container.querySelector('button[name="intent"][value="mp-confirm"]')).not.toBeNull();
    expect(container.querySelector('button[name="intent"][value="mp-edit"]')).not.toBeNull();
  });

  it('should_offer_a_removal_confirmation_distinct_from_a_replacement', async () => {
    const { container } = await renderAndSubmit({
      pendingConfirmation: PENDING,
      pendingIntent: 'remove',
    });

    await waitFor(() => {
      expect(screen.getByText(COPY.mercadoPago.confirmRemoveIntro)).toBeInTheDocument();
    });
    expect(container.querySelector('button[value="mp-confirm-remove"]')).not.toBeNull();
  });
});

describe('MercadoPagoCredentialsForm - errors', () => {
  it.each([
    ['token', { fieldErrors: { accessToken: COPY.mercadoPago.tokenInvalid } }],
    ['public key', { fieldErrors: { publicKey: COPY.mercadoPago.publicKeyInvalid } }],
    ['swap', { fieldErrors: { form: COPY.mercadoPago.looksSwapped } }],
    ['rejection', { error: COPY.mercadoPago.rejected }],
  ])('should_announce_a_%s_error_to_assistive_technology', async (_label, overrides) => {
    await renderAndSubmit(overrides);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveAttribute('aria-live', 'polite');
    });
  });

  it('should_mark_the_offending_field_invalid_and_describe_it', async () => {
    await renderAndSubmit({ fieldErrors: { accessToken: COPY.mercadoPago.tokenInvalid } });

    await waitFor(() => {
      const field = screen.getByLabelText(COPY.mercadoPago.accessTokenLabel);
      expect(field).toHaveAttribute('aria-invalid', 'true');
      expect(field).toHaveAttribute('aria-describedby', 'accessToken-error');
    });
  });

  it('should_move_focus_to_the_first_error', async () => {
    await renderAndSubmit({
      fieldErrors: {
        accessToken: COPY.mercadoPago.tokenInvalid,
        publicKey: COPY.mercadoPago.publicKeyInvalid,
      },
    });

    await waitFor(() => {
      expect(document.activeElement).toHaveTextContent(COPY.mercadoPago.tokenInvalid);
    });
  });

  it('should_explain_why_the_token_field_is_empty_after_a_rejection', async () => {
    // Without this the emptied field reads as the form losing the owner's work
    // rather than as a deliberate protection.
    await renderAndSubmit({ fieldErrors: { form: COPY.mercadoPago.incompletePair } });

    await waitFor(() => {
      expect(screen.getByText(COPY.mercadoPago.tokenClearedNotice)).toBeInTheDocument();
    });
  });

  it('should_preserve_the_public_key_across_a_rejection', async () => {
    render(
      <MercadoPagoCredentialsForm
        action={actionReturning({
          values: { publicKey: KEY },
          fieldErrors: { form: COPY.mercadoPago.incompletePair },
        })}
        defaults={{ publicKey: KEY }}
        configured={false}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: COPY.mercadoPago.submit }));

    await waitFor(() => {
      expect(screen.getByLabelText(COPY.mercadoPago.publicKeyLabel)).toHaveValue(KEY);
    });
  });
});

describe('MercadoPagoCredentialsForm - success and warnings', () => {
  it('should_show_the_unverified_notice_alongside_the_success_not_instead_of_it', async () => {
    await renderAndSubmit({ saved: true, unverified: true });

    await waitFor(() => {
      expect(screen.getByText(COPY.mercadoPago.saved)).toBeInTheDocument();
    });
    expect(screen.getByText(COPY.mercadoPago.savedUnverified)).toBeInTheDocument();
  });

  it('should_show_the_no_payment_method_warning_alongside_a_removal', async () => {
    await renderAndSubmit({ removed: true, noPaymentMethod: true }, true);

    await waitFor(() => {
      expect(screen.getByText(COPY.mercadoPago.removed)).toBeInTheDocument();
    });
    expect(screen.getByText(COPY.mercadoPago.noMethodWarning)).toBeInTheDocument();
  });
});

describe('MercadoPagoCredentialsForm - the removal control', () => {
  it('should_be_offered_only_when_credentials_are_stored', () => {
    renderForm({}, false);
    expect(screen.queryByText(COPY.mercadoPago.remove)).not.toBeInTheDocument();
  });

  it('should_be_offered_when_credentials_are_stored', () => {
    renderForm({}, true);
    expect(screen.getByText(COPY.mercadoPago.remove)).toBeInTheDocument();
  });

  it('should_be_a_submit_carrying_its_own_intent_rather_than_a_script_handler', () => {
    // Keeps the no-JavaScript path working, which T37 exists to verify.
    const { container } = renderForm({}, true);

    const remove = container.querySelector('button[name="intent"][value="mp-remove"]');
    expect(remove).not.toBeNull();
    expect(remove).toHaveAttribute('type', 'submit');
  });
});

describe('MercadoPagoCredentialsForm - submission in flight', () => {
  it('should_disable_the_secondary_controls_too', async () => {
    // Found in the browser: the removal control stayed live during an in-flight
    // save, so a second click could queue a removal behind it.
    let release: (state: MercadoPagoFormState) => void = () => {};
    const action = vi.fn(
      () =>
        new Promise<MercadoPagoFormState>((resolve) => {
          release = resolve;
        })
    );

    render(
      <MercadoPagoCredentialsForm action={action} defaults={{ publicKey: '' }} configured />
    );

    await userEvent.click(screen.getByRole('button', { name: COPY.mercadoPago.submit }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: COPY.mercadoPago.remove })).toBeDisabled();
    });

    release({ ...INITIAL_MERCADO_PAGO_STATE, saved: true });
  });

  it('should_not_claim_a_mercado_pago_call_while_removing', async () => {
    // A removal contacts nobody, so the button must not say it is verifying.
    let release: (state: MercadoPagoFormState) => void = () => {};
    const action = vi.fn(
      () =>
        new Promise<MercadoPagoFormState>((resolve) => {
          release = resolve;
        })
    );

    render(
      <MercadoPagoCredentialsForm action={action} defaults={{ publicKey: '' }} configured />
    );

    await userEvent.click(screen.getByRole('button', { name: COPY.mercadoPago.remove }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: COPY.mercadoPago.removing })).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: COPY.mercadoPago.verifying })).not.toBeInTheDocument();

    release({ ...INITIAL_MERCADO_PAGO_STATE, removed: true });
  });

  it('should_title_the_removal_confirmation_without_naming_an_account', async () => {
    // No account is involved in a removal; borrowing the replacement heading
    // would assert one.
    await renderAndSubmit({ pendingConfirmation: PENDING, pendingIntent: 'remove' }, true);

    await waitFor(() => {
      expect(screen.getByText(COPY.mercadoPago.confirmRemoveHeading)).toBeInTheDocument();
    });
    expect(screen.queryByText(COPY.mercadoPago.confirmHeading)).not.toBeInTheDocument();
  });

  it('should_disable_the_submit_and_name_the_verification', async () => {
    // A verification may take seconds; the same label as a sub-second write
    // makes a working save look hung, which is what produces the second click.
    let release: (state: MercadoPagoFormState) => void = () => {};
    const action = vi.fn(
      () =>
        new Promise<MercadoPagoFormState>((resolve) => {
          release = resolve;
        })
    );

    render(
      <MercadoPagoCredentialsForm action={action} defaults={{ publicKey: '' }} configured={false} />
    );

    await userEvent.click(screen.getByRole('button', { name: COPY.mercadoPago.submit }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: COPY.mercadoPago.verifying })).toBeDisabled();
    });

    release({ ...INITIAL_MERCADO_PAGO_STATE, saved: true });
  });
});
