import { describe, it, expect, vi, beforeEach } from 'vitest';
import { INITIAL_MERCADO_PAGO_STATE } from './formState';
import { COPY } from '@/lib/copy';

const TOKEN = 'APP_USR-4934588586838432-081312-abcdef0123456789abcdef0123456789-241983636';
const KEY = 'APP_USR-d0a26210-1f4b-4c3a-9e21-479f0400869e';
const OTHER_KEY = 'APP_USR-aaaaaaaa-1111-2222-3333-bbbbbbbbbbbb';

const requireOwner = vi.fn(async () => ({
  id: 'owner-root',
  email: 'owner@example.com',
  authUserId: 'auth-uuid',
}));

const getMercadoPagoView = vi.fn();
const saveMercadoPagoCredentials = vi.fn();
const removeMercadoPagoCredentials = vi.fn();
const encrypt = vi.fn(async () => 'v1.aXY.Y3Q');
const decrypt = vi.fn(async () => JSON.stringify({ accessToken: TOKEN, publicKey: KEY }));

const cookieJar = new Map<string, { value: string }>();
const cookieStore = {
  get: (name: string) => cookieJar.get(name),
  set: (name: string, value: string) => cookieJar.set(name, { value }),
  delete: (name: string) => cookieJar.delete(name),
};

const logs: { level: string; message: string; context?: Record<string, unknown> }[] = [];

vi.mock('@/server/infrastructure/supabase/requireOwner', () => ({
  requireOwner: () => requireOwner(),
}));
vi.mock('next/headers', () => ({ cookies: async () => cookieStore }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('./paymentConfigService', () => ({
  mercadoPagoConfigService: () => ({
    getMercadoPagoView,
    saveMercadoPagoCredentials,
    removeMercadoPagoCredentials,
  }),
  credentialCipher: () => ({ encrypt, decrypt }),
}));
vi.mock('@/server/infrastructure/logger', () => ({
  logger: {
    info: (message: string, context?: Record<string, unknown>) =>
      logs.push({ level: 'info', message, context }),
    error: (message: string, context?: Record<string, unknown>) =>
      logs.push({ level: 'error', message, context }),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

const { saveMercadoPagoCredentialsAction } = await import('./actions');

function formData(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    data.append(k, v);
  }
  return data;
}

/**
 * Exactly what the confirmation screen submits: the pressed control's `intent`
 * and nothing else. It renders no credential fields at all — that is what keeps
 * the token out of the DOM — so any test that adds one is testing a form that
 * does not exist.
 */
const CONFIRMATION_FORM_DATA = (): FormData => formData({ intent: 'mp-confirm' });

const VIEW_CONFIGURED = {
  configured: true,
  publicKey: KEY,
  environment: null,
  lastFour: '3636',
  changedAt: new Date('2026-08-13T21:14:00Z'),
  unreadable: false,
};

const VIEW_EMPTY = { ...VIEW_CONFIGURED, configured: false, publicKey: null, lastFour: null };

const PENDING = {
  environment: null,
  lastFour: '3636',
  displayName: 'BARBERIA',
  storedLastFour: '3636',
  storedEnvironment: null,
  verified: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  cookieJar.clear();
  logs.length = 0;
  getMercadoPagoView.mockResolvedValue(VIEW_CONFIGURED);
  saveMercadoPagoCredentials.mockResolvedValue({
    status: 'saved',
    verified: true,
    leavesNoPaymentMethod: false,
  });
  removeMercadoPagoCredentials.mockResolvedValue({
    status: 'removed',
    leavesNoPaymentMethod: false,
  });
});

describe('saveMercadoPagoCredentialsAction - authorization', () => {
  it('should_require_an_owner_before_doing_anything', async () => {
    await saveMercadoPagoCredentialsAction(
      INITIAL_MERCADO_PAGO_STATE,
      formData({ accessToken: TOKEN, publicKey: KEY })
    );

    expect(requireOwner).toHaveBeenCalled();
  });

  it('should_not_reach_the_service_when_the_owner_check_throws', async () => {
    // Middleware passes `next-action` through, so this call is the entire
    // authorization boundary — and it must precede any outbound Mercado Pago
    // request the service would make.
    requireOwner.mockRejectedValueOnce(new Error('NEXT_REDIRECT'));

    await expect(
      saveMercadoPagoCredentialsAction(
        INITIAL_MERCADO_PAGO_STATE,
        formData({ accessToken: TOKEN, publicKey: KEY })
      )
    ).rejects.toThrow();
    expect(saveMercadoPagoCredentials).not.toHaveBeenCalled();
    expect(getMercadoPagoView).not.toHaveBeenCalled();
  });
});

describe('saveMercadoPagoCredentialsAction - the pending cookie (design D7)', () => {
  /*
   * These use CONFIRMATION_FORM_DATA — the FormData the confirmation screen
   * actually emits, which carries `intent` and nothing else.
   *
   * An earlier version of this suite hand-fed `publicKey` alongside the intent.
   * It passed, and it was wrong: the real screen renders no credential fields,
   * so the action received an empty public key and rejected every confirmation
   * as an incomplete pair. Replacing stored credentials was impossible, and
   * this test asserted that it worked. A fixture the UI cannot produce proves
   * nothing about the UI.
   */

  it('should_store_both_credentials_encrypted_when_confirmation_is_needed', async () => {
    saveMercadoPagoCredentials.mockResolvedValue({
      status: 'needs_confirmation',
      pending: PENDING,
    });

    const state = await saveMercadoPagoCredentialsAction(
      INITIAL_MERCADO_PAGO_STATE,
      formData({ accessToken: TOKEN, publicKey: KEY })
    );

    expect(encrypt).toHaveBeenCalledWith(
      JSON.stringify({ accessToken: TOKEN, publicKey: KEY }),
      'owner-root',
      'mp-pending-confirmation'
    );
    expect(state.pendingConfirmation).toEqual(PENDING);
    // The returned state crosses to the browser; the token must not ride along.
    expect(JSON.stringify(state)).not.toContain(TOKEN);
  });

  it('should_confirm_using_only_what_the_confirmation_form_submits', async () => {
    cookieJar.set('mp_pending', { value: 'v1.aXY.Y3Q' });

    await saveMercadoPagoCredentialsAction(INITIAL_MERCADO_PAGO_STATE, CONFIRMATION_FORM_DATA());

    expect(decrypt).toHaveBeenCalledWith('v1.aXY.Y3Q', 'owner-root', 'mp-pending-confirmation');
    expect(saveMercadoPagoCredentials).toHaveBeenCalledWith(
      'owner-root',
      { accessToken: TOKEN, publicKey: KEY },
      { confirmed: true }
    );
  });

  it('should_store_the_pair_that_was_verified_not_one_resubmitted_by_the_form', async () => {
    // The guarantee the confirmation exists for. Even if a public key were
    // injected into the confirmation POST, the stored pair is the one whose
    // account the owner was shown.
    cookieJar.set('mp_pending', { value: 'v1.aXY.Y3Q' });
    const tampered = CONFIRMATION_FORM_DATA();
    tampered.append('publicKey', OTHER_KEY);

    await saveMercadoPagoCredentialsAction(INITIAL_MERCADO_PAGO_STATE, tampered);

    expect(saveMercadoPagoCredentials).toHaveBeenCalledWith(
      'owner-root',
      { accessToken: TOKEN, publicKey: KEY },
      { confirmed: true }
    );
  });

  it('should_return_to_the_editor_when_the_pending_cookie_is_gone', async () => {
    const state = await saveMercadoPagoCredentialsAction(
      INITIAL_MERCADO_PAGO_STATE,
      CONFIRMATION_FORM_DATA()
    );

    expect(state.pendingConfirmation).toBeNull();
    expect(saveMercadoPagoCredentials).not.toHaveBeenCalled();
    // And not with a blanked public key field.
    expect(state.values.publicKey).toBe(KEY);
  });

  it('should_clear_the_cookie_when_the_owner_declines', async () => {
    cookieJar.set('mp_pending', { value: 'v1.aXY.Y3Q' });

    const state = await saveMercadoPagoCredentialsAction(
      INITIAL_MERCADO_PAGO_STATE,
      formData({ intent: 'mp-edit' })
    );

    expect(cookieJar.has('mp_pending')).toBe(false);
    expect(saveMercadoPagoCredentials).not.toHaveBeenCalled();
    // Restored from the database: the confirmation screen submits no fields, so
    // echoing the submission back would blank a value the owner never cleared.
    expect(state.values.publicKey).toBe(KEY);
  });

  it('should_clear_the_cookie_after_a_completed_save', async () => {
    cookieJar.set('mp_pending', { value: 'v1.aXY.Y3Q' });

    await saveMercadoPagoCredentialsAction(INITIAL_MERCADO_PAGO_STATE, CONFIRMATION_FORM_DATA());

    expect(cookieJar.has('mp_pending')).toBe(false);
  });

  it('should_clear_the_cookie_when_validation_fails', async () => {
    cookieJar.set('mp_pending', { value: 'v1.aXY.Y3Q' });

    await saveMercadoPagoCredentialsAction(
      INITIAL_MERCADO_PAGO_STATE,
      formData({ accessToken: KEY, publicKey: TOKEN })
    );

    expect(cookieJar.has('mp_pending')).toBe(false);
  });
});

describe('saveMercadoPagoCredentialsAction - outcomes', () => {
  it('should_report_a_mercado_pago_rejection_without_writing', async () => {
    saveMercadoPagoCredentials.mockResolvedValue({ status: 'rejected' });

    const state = await saveMercadoPagoCredentialsAction(
      INITIAL_MERCADO_PAGO_STATE,
      formData({ accessToken: TOKEN, publicKey: KEY })
    );

    expect(state.error).toBe(COPY.mercadoPago.rejected);
    expect(state.saved).toBe(false);
  });

  it('should_flag_a_save_that_could_not_be_verified', async () => {
    saveMercadoPagoCredentials.mockResolvedValue({
      status: 'saved',
      verified: false,
      leavesNoPaymentMethod: false,
    });

    const state = await saveMercadoPagoCredentialsAction(
      INITIAL_MERCADO_PAGO_STATE,
      formData({ accessToken: TOKEN, publicKey: KEY })
    );

    expect(state).toMatchObject({ saved: true, unverified: true });
  });

  it('should_treat_an_empty_submission_as_unchanged_rather_than_a_clear', async () => {
    const state = await saveMercadoPagoCredentialsAction(
      INITIAL_MERCADO_PAGO_STATE,
      formData({ accessToken: '', publicKey: KEY })
    );

    expect(state.saved).toBe(true);
    expect(saveMercadoPagoCredentials).not.toHaveBeenCalled();
  });

  it('should_reject_a_changed_public_key_with_an_empty_token', async () => {
    const state = await saveMercadoPagoCredentialsAction(
      INITIAL_MERCADO_PAGO_STATE,
      formData({ accessToken: '', publicKey: OTHER_KEY })
    );

    expect(state.fieldErrors.form).toBe(COPY.mercadoPago.tokenRequiredForKeyChange);
    expect(saveMercadoPagoCredentials).not.toHaveBeenCalled();
  });

  it('should_reject_a_swapped_pair_before_the_service_is_reached', async () => {
    const state = await saveMercadoPagoCredentialsAction(
      INITIAL_MERCADO_PAGO_STATE,
      formData({ accessToken: KEY, publicKey: TOKEN })
    );

    expect(state.fieldErrors.form).toBe(COPY.mercadoPago.looksSwapped);
    expect(saveMercadoPagoCredentials).not.toHaveBeenCalled();
  });

  it('should_gate_a_removal_on_confirmation', async () => {
    removeMercadoPagoCredentials.mockResolvedValue({
      status: 'needs_confirmation',
      pending: PENDING,
    });

    const state = await saveMercadoPagoCredentialsAction(
      INITIAL_MERCADO_PAGO_STATE,
      formData({ intent: 'mp-remove' })
    );

    expect(state.pendingIntent).toBe('remove');
    expect(state.removed).toBe(false);
  });

  it('should_carry_the_no_payment_method_warning_alongside_a_removal', async () => {
    removeMercadoPagoCredentials.mockResolvedValue({
      status: 'removed',
      leavesNoPaymentMethod: true,
    });

    const state = await saveMercadoPagoCredentialsAction(
      INITIAL_MERCADO_PAGO_STATE,
      formData({ intent: 'mp-confirm-remove' })
    );

    expect(state).toMatchObject({ removed: true, noPaymentMethod: true });
  });
});

describe('saveMercadoPagoCredentialsAction - logging never exposes a credential', () => {
  it('should_log_presence_and_last_four_only', async () => {
    await saveMercadoPagoCredentialsAction(
      INITIAL_MERCADO_PAGO_STATE,
      formData({ accessToken: TOKEN, publicKey: KEY })
    );

    const entry = logs.find((l) => l.message === 'Mercado Pago credentials updated');
    expect(entry?.context).toMatchObject({
      ownerId: 'owner-root',
      tokenLastFour: '3636',
      previousTokenLastFour: '3636',
      verified: true,
    });
    expect(JSON.stringify(entry)).not.toContain(TOKEN);
  });

  // `toErrorLogContext` deliberately keeps the message of an unrecognized error
  // so failures stay diagnosable — and that exception is exactly how a bearer
  // token could reach the log stream.
  it('should_redact_a_token_echoed_by_a_failure', async () => {
    saveMercadoPagoCredentials.mockRejectedValue(
      new Error(`upstream refused ${TOKEN} for key ${KEY}`)
    );

    const state = await saveMercadoPagoCredentialsAction(
      INITIAL_MERCADO_PAGO_STATE,
      formData({ accessToken: TOKEN, publicKey: KEY })
    );

    expect(state.error).toBe(COPY.mercadoPago.infrastructureError);
    const emitted = JSON.stringify(logs);
    expect(emitted).not.toContain(TOKEN);
    expect(emitted).not.toContain(KEY);
    expect(emitted).toContain('upstream refused');
  });

  it('should_not_leak_the_token_through_the_returned_state_on_failure', async () => {
    saveMercadoPagoCredentials.mockRejectedValue(new Error('boom'));

    const state = await saveMercadoPagoCredentialsAction(
      INITIAL_MERCADO_PAGO_STATE,
      formData({ accessToken: TOKEN, publicKey: KEY })
    );

    expect(JSON.stringify(state)).not.toContain(TOKEN);
  });
});

describe('saveMercadoPagoCredentialsAction - first configuration', () => {
  it('should_not_ask_for_confirmation_when_nothing_is_stored', async () => {
    getMercadoPagoView.mockResolvedValue(VIEW_EMPTY);

    const state = await saveMercadoPagoCredentialsAction(
      INITIAL_MERCADO_PAGO_STATE,
      formData({ accessToken: TOKEN, publicKey: KEY })
    );

    expect(saveMercadoPagoCredentials).toHaveBeenCalledWith(
      'owner-root',
      { accessToken: TOKEN, publicKey: KEY },
      { confirmed: false }
    );
    expect(state.saved).toBe(true);
  });
});
