import { describe, it, expect, vi, beforeEach } from 'vitest';
import { COPY } from '@/lib/copy';
import type { SaveTransferResult } from '@/server/application/services/PaymentConfigService';
import { INITIAL_TRANSFER_FORM_STATE } from './formState';

const CBU = '2850590940090418135201';
const OTHER_CBU = '0110599520000012345678';

const requireOwner = vi.fn(async () => ({
  id: 'owner-root',
  email: 'owner@example.com',
  authUserId: 'auth-uuid',
}));
// Annotated with the full union rather than letting vi.fn infer it from the
// default: inference narrows to the "saved" branch and the confirmation cases
// below stop type-checking.
const saveTransferDetails = vi.fn<() => Promise<SaveTransferResult>>(async () => ({
  status: 'saved',
  leavesNoPaymentMethod: false,
}));
const revalidatePath = vi.fn();
const loggerError = vi.fn();
const loggerInfo = vi.fn();

vi.mock('@/server/infrastructure/supabase/requireOwner', () => ({
  requireOwner: () => requireOwner(),
}));
vi.mock('next/cache', () => ({ revalidatePath: (path: string) => revalidatePath(path) }));
vi.mock('@/server/infrastructure/logger', () => ({
  logger: {
    error: (...args: unknown[]) => loggerError(...args),
    info: (...args: unknown[]) => loggerInfo(...args),
  },
}));
vi.mock('./paymentConfigService', () => ({
  paymentConfigService: () => ({ saveTransferDetails, getConfig: vi.fn() }),
}));

const { saveTransferDetailsAction } = await import('./actions');

function form(entries: Record<string, string> = {}): FormData {
  const data = new FormData();
  data.append('cbuCvu', CBU);
  data.append('alias', '');
  data.append('holderName', 'Barberia Franco');
  for (const [key, value] of Object.entries(entries)) {
    data.set(key, value);
  }
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  saveTransferDetails.mockResolvedValue({ status: 'saved', leavesNoPaymentMethod: false });
});

describe('saveTransferDetailsAction - authorization', () => {
  it('should_resolve_the_owner_before_parsing_anything', async () => {
    requireOwner.mockRejectedValueOnce(new Error('redirect to login'));

    await expect(
      saveTransferDetailsAction(INITIAL_TRANSFER_FORM_STATE, form())
    ).rejects.toThrow('redirect to login');

    expect(saveTransferDetails).not.toHaveBeenCalled();
  });
});

describe('saveTransferDetailsAction - validation', () => {
  it('should_not_reach_the_service_when_validation_fails', async () => {
    const state = await saveTransferDetailsAction(
      INITIAL_TRANSFER_FORM_STATE,
      form({ cbuCvu: '123' })
    );

    expect(saveTransferDetails).not.toHaveBeenCalled();
    expect(state.fieldErrors.cbuCvu).toBe(COPY.transfer.cbuInvalidLength);
  });

  it('should_echo_back_what_the_owner_typed_when_rejected', async () => {
    const state = await saveTransferDetailsAction(
      INITIAL_TRANSFER_FORM_STATE,
      form({ cbuCvu: '2850 5909 4009 0418 1352 0X' })
    );

    expect(state.values.cbuCvu).toBe('2850 5909 4009 0418 1352 0X');
    expect(state.values.holderName).toBe('Barberia Franco');
  });

  it('should_report_a_missing_holder_name_against_its_own_field', async () => {
    const state = await saveTransferDetailsAction(
      INITIAL_TRANSFER_FORM_STATE,
      form({ holderName: '' })
    );

    expect(state.fieldErrors.holderName).toBe(COPY.transfer.holderRequired);
  });

  it('should_report_a_holder_name_with_no_destination_at_form_level', async () => {
    const state = await saveTransferDetailsAction(
      INITIAL_TRANSFER_FORM_STATE,
      form({ cbuCvu: '', alias: '' })
    );

    expect(state.fieldErrors.form).toBe(COPY.transfer.noDestination);
  });
});

describe('saveTransferDetailsAction - success', () => {
  it('should_pass_the_normalized_destination_to_the_service', async () => {
    await saveTransferDetailsAction(
      INITIAL_TRANSFER_FORM_STATE,
      form({ cbuCvu: '2850 5909 4009 0418 1352 01', alias: 'MI.BARBERIA' })
    );

    expect(saveTransferDetails).toHaveBeenCalledWith(
      'owner-root',
      { cbuCvu: CBU, alias: 'mi.barberia', holderName: 'Barberia Franco' },
      { confirmed: false }
    );
  });

  it('should_revalidate_and_report_success_without_redirecting', async () => {
    const state = await saveTransferDetailsAction(INITIAL_TRANSFER_FORM_STATE, form());

    expect(revalidatePath).toHaveBeenCalledWith('/transferencia');
    expect(state.saved).toBe(true);
    expect(state.error).toBeNull();
  });

  it('should_echo_the_normalized_value_not_what_was_typed', async () => {
    const state = await saveTransferDetailsAction(
      INITIAL_TRANSFER_FORM_STATE,
      form({ cbuCvu: '2850 5909 4009 0418 1352 01' })
    );

    // Grouped, so the field agrees with the stored-values panel beside it.
    expect(state.values.cbuCvu).toBe('2850 5909 4009 0418 1352 01');
  });

  it('should_surface_the_no_payment_method_warning_from_the_server', async () => {
    saveTransferDetails.mockResolvedValue({ status: 'saved', leavesNoPaymentMethod: true });

    const state = await saveTransferDetailsAction(
      INITIAL_TRANSFER_FORM_STATE,
      form({ cbuCvu: '', alias: '', holderName: '' })
    );

    expect(state.saved).toBe(true);
    expect(state.noPaymentMethod).toBe(true);
  });
});

describe('saveTransferDetailsAction - confirmation', () => {
  it('should_return_the_pending_value_without_writing', async () => {
    const pending = { cbuCvu: OTHER_CBU, alias: null, holderName: 'Barberia Franco' };
    saveTransferDetails.mockResolvedValue({ status: 'needs_confirmation', pending });

    const state = await saveTransferDetailsAction(
      INITIAL_TRANSFER_FORM_STATE,
      form({ cbuCvu: OTHER_CBU })
    );

    expect(state.pendingConfirmation).toEqual(pending);
    expect(state.saved).toBe(false);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('should_forward_the_confirmation_when_the_confirm_button_was_pressed', async () => {
    await saveTransferDetailsAction(
      INITIAL_TRANSFER_FORM_STATE,
      form({ cbuCvu: OTHER_CBU, intent: 'confirm' })
    );

    expect(saveTransferDetails).toHaveBeenCalledWith('owner-root', expect.anything(), {
      confirmed: true,
    });
  });

  it('should_treat_a_submission_with_no_intent_as_unconfirmed', async () => {
    await saveTransferDetailsAction(INITIAL_TRANSFER_FORM_STATE, form());

    expect(saveTransferDetails).toHaveBeenCalledWith('owner-root', expect.anything(), {
      confirmed: false,
    });
  });

  it('should_treat_an_unrecognized_intent_as_unconfirmed', async () => {
    // Only the exact value the confirm button carries may confirm. Anything
    // else — a crafted payload, a stale form — must fall back to asking.
    await saveTransferDetailsAction(
      INITIAL_TRANSFER_FORM_STATE,
      form({ cbuCvu: OTHER_CBU, intent: 'true' })
    );

    expect(saveTransferDetails).toHaveBeenCalledWith('owner-root', expect.anything(), {
      confirmed: false,
    });
  });

  it('should_write_nothing_when_the_owner_goes_back_to_edit', async () => {
    // The guard is worse than absent if declining commits the change anyway.
    const state = await saveTransferDetailsAction(
      INITIAL_TRANSFER_FORM_STATE,
      form({ cbuCvu: OTHER_CBU, intent: 'edit' })
    );

    expect(saveTransferDetails).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(state.pendingConfirmation).toBeNull();
    expect(state.saved).toBe(false);
  });

  it('should_return_the_owner_to_the_editor_with_their_values_intact', async () => {
    const state = await saveTransferDetailsAction(
      INITIAL_TRANSFER_FORM_STATE,
      form({ cbuCvu: OTHER_CBU, intent: 'edit' })
    );

    expect(state.values.cbuCvu).toBe(OTHER_CBU);
    expect(state.values.holderName).toBe('Barberia Franco');
  });

  it('should_not_report_validation_errors_when_going_back_to_edit', async () => {
    // The owner is returning to fix a value. Errors about it now are noise on
    // top of a decision they already made.
    const state = await saveTransferDetailsAction(
      INITIAL_TRANSFER_FORM_STATE,
      form({ cbuCvu: '123', intent: 'edit' })
    );

    expect(state.fieldErrors).toEqual({});
  });
});

describe('saveTransferDetailsAction - infrastructure failure', () => {
  it('should_return_the_reload_instruction_rather_than_throwing', async () => {
    saveTransferDetails.mockRejectedValue(new Error('connection terminated'));

    const state = await saveTransferDetailsAction(INITIAL_TRANSFER_FORM_STATE, form());

    expect(state.error).toBe(COPY.transfer.infrastructureError);
    expect(state.saved).toBe(false);
  });

  it('should_preserve_the_typed_values_through_an_infrastructure_failure', async () => {
    saveTransferDetails.mockRejectedValue(new Error('connection terminated'));

    const state = await saveTransferDetailsAction(
      INITIAL_TRANSFER_FORM_STATE,
      form({ alias: 'mi.barberia' })
    );

    expect(state.values.alias).toBe('mi.barberia');
    expect(state.values.holderName).toBe('Barberia Franco');
  });

  it('should_not_log_the_destination_when_a_write_fails', async () => {
    saveTransferDetails.mockRejectedValue(new Error(`insert failed for ${CBU}`));

    await saveTransferDetailsAction(INITIAL_TRANSFER_FORM_STATE, form());

    expect(JSON.stringify(loggerError.mock.calls)).not.toContain(CBU);
  });
});

describe('saveTransferDetailsAction - audit logging', () => {
  it('should_log_only_the_last_four_digits_of_the_destination', async () => {
    await saveTransferDetailsAction(INITIAL_TRANSFER_FORM_STATE, form());

    const [, context] = loggerInfo.mock.calls[0];
    expect(context).toMatchObject({
      operation: 'saveTransferDetails',
      ownerId: 'owner-root',
      hasCbu: true,
      hasAlias: false,
      cbuLastFour: '5201',
    });
  });

  it('should_never_put_the_full_destination_or_the_holder_name_in_the_log', async () => {
    await saveTransferDetailsAction(
      INITIAL_TRANSFER_FORM_STATE,
      form({ alias: 'mi.barberia' })
    );

    const serialized = JSON.stringify(loggerInfo.mock.calls);
    expect(serialized).not.toContain(CBU);
    expect(serialized).not.toContain('mi.barberia');
    expect(serialized).not.toContain('Barberia Franco');
  });

  it('should_not_log_a_success_when_confirmation_is_still_pending', async () => {
    saveTransferDetails.mockResolvedValue({
      status: 'needs_confirmation',
      pending: { cbuCvu: OTHER_CBU, alias: null, holderName: 'Barberia Franco' },
    });

    await saveTransferDetailsAction(INITIAL_TRANSFER_FORM_STATE, form());

    expect(loggerInfo).not.toHaveBeenCalled();
  });
});
