import { describe, it, expect, vi, beforeEach } from 'vitest';
import { COPY } from '@/lib/copy';
import type {
  SaveDepositResult,
  RemoveDepositResult,
} from '@/server/application/services/PaymentConfigService';
import type { DepositPolicySettings } from '@/server/domain/models/PaymentConfig';
import { INITIAL_DEPOSIT_FORM_STATE } from './formState';

const requireOwner = vi.fn(async () => ({
  id: 'owner-root',
  email: 'owner@example.com',
  authUserId: 'auth-uuid',
}));

// Annotated with the full union rather than letting vi.fn infer it from the
// default: inference narrows to the "saved" branch and the confirmation cases
// below stop type-checking.
const saveDepositPolicy = vi.fn<() => Promise<SaveDepositResult>>(async () => ({
  status: 'saved',
  leavesNoPaymentMethod: false,
  servicesBelowDeposit: [],
  servicesBelowMinimum: [],
}));
const removeDepositPolicy = vi.fn<() => Promise<RemoveDepositResult>>(async () => ({
  status: 'removed',
  leavesNoPaymentMethod: false,
}));
// Annotated so the confirmation cases below can hand back a stored policy;
// inference from the default would narrow `value` to null.
const getDepositPolicy = vi.fn<() => Promise<DepositPolicySettings>>(async () => ({
  type: 'PERCENT',
  value: null,
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
  depositPolicyService: () => ({ saveDepositPolicy, removeDepositPolicy, getDepositPolicy }),
}));

const { saveDepositPolicyAction, removeDepositPolicyAction } = await import('./actions');

function form(entries: Record<string, string> = {}): FormData {
  const data = new FormData();
  data.append('type', 'PERCENT');
  data.append('value', '30');
  for (const [key, value] of Object.entries(entries)) {
    data.set(key, value);
  }
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  saveDepositPolicy.mockResolvedValue({
    status: 'saved',
    leavesNoPaymentMethod: false,
    servicesBelowDeposit: [],
    servicesBelowMinimum: [],
  });
  removeDepositPolicy.mockResolvedValue({ status: 'removed', leavesNoPaymentMethod: false });
});

describe('saveDepositPolicyAction - authorization', () => {
  /**
   * Middleware passes next-action through, so this call is the entire
   * authorization boundary for the action.
   */
  it('should_resolve_the_owner_before_touching_the_submission', async () => {
    requireOwner.mockRejectedValueOnce(new Error('not authenticated'));

    await expect(
      saveDepositPolicyAction(INITIAL_DEPOSIT_FORM_STATE, form())
    ).rejects.toThrow('not authenticated');

    expect(saveDepositPolicy).not.toHaveBeenCalled();
  });
});

describe('saveDepositPolicyAction - validation', () => {
  it('should_reject_a_missing_type_without_calling_the_service', async () => {
    const state = await saveDepositPolicyAction(INITIAL_DEPOSIT_FORM_STATE, form({ type: '' }));

    expect(state.fieldErrors.type).toBe(COPY.deposit.typeRequired);
    expect(saveDepositPolicy).not.toHaveBeenCalled();
  });

  it('should_reject_an_unrecognized_type', async () => {
    const state = await saveDepositPolicyAction(
      INITIAL_DEPOSIT_FORM_STATE,
      form({ type: 'PORCENTAJE' })
    );

    expect(state.fieldErrors.type).toBe(COPY.deposit.typeInvalid);
  });

  it('should_reject_an_empty_value_as_required_never_as_a_removal', async () => {
    const state = await saveDepositPolicyAction(INITIAL_DEPOSIT_FORM_STATE, form({ value: '' }));

    expect(state.fieldErrors.value).toBe(COPY.deposit.valueRequired);
    expect(saveDepositPolicy).not.toHaveBeenCalled();
    expect(removeDepositPolicy).not.toHaveBeenCalled();
  });

  it('should_report_a_fractional_percentage_as_such', async () => {
    const state = await saveDepositPolicyAction(INITIAL_DEPOSIT_FORM_STATE, form({ value: '12,5' }));

    expect(state.fieldErrors.value).toBe(COPY.deposit.percentNotWhole);
  });

  /**
   * The same code means different things per type, so the message follows the
   * submitted type rather than the code alone.
   */
  it('should_report_out_of_range_differently_per_type', async () => {
    const percent = await saveDepositPolicyAction(
      INITIAL_DEPOSIT_FORM_STATE,
      form({ type: 'PERCENT', value: '101' })
    );
    const fixed = await saveDepositPolicyAction(
      INITIAL_DEPOSIT_FORM_STATE,
      form({ type: 'FIXED', value: '0' })
    );

    expect(percent.fieldErrors.value).toBe(COPY.deposit.percentOutOfRange);
    expect(fixed.fieldErrors.value).toBe(COPY.deposit.fixedOutOfRange);
  });

  it('should_echo_the_submitted_values_back_on_a_rejection', async () => {
    const state = await saveDepositPolicyAction(
      INITIAL_DEPOSIT_FORM_STATE,
      form({ type: 'FIXED', value: 'abc' })
    );

    expect(state.values).toEqual({ type: 'FIXED', value: 'abc' });
  });
});

describe('saveDepositPolicyAction - the confirmation round trip', () => {
  it('should_carry_the_pending_policy_and_its_effects_into_the_state', async () => {
    saveDepositPolicy.mockResolvedValue({
      status: 'needs_confirmation',
      pending: {
        policy: { type: 'PERCENT', value: '30' },
        stored: { type: 'PERCENT', value: '3.00' },
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
      },
    });

    const state = await saveDepositPolicyAction(INITIAL_DEPOSIT_FORM_STATE, form());

    expect(state.pendingConfirmation?.effects).toHaveLength(1);
    expect(state.saved).toBe(false);
  });

  it('should_pass_the_confirmation_through_to_the_service', async () => {
    await saveDepositPolicyAction(INITIAL_DEPOSIT_FORM_STATE, form({ intent: 'deposit-confirm' }));

    expect(saveDepositPolicy).toHaveBeenCalledWith(
      'owner-root',
      { type: 'PERCENT', value: '30' },
      { confirmed: true }
    );
  });

  /**
   * Going back to the editor writes nothing and validates nothing: the owner is
   * returning to fix a value, and reporting errors about it now would be noise
   * on top of a decision they already made.
   */
  it('should_write_nothing_when_the_owner_returns_to_the_editor', async () => {
    const state = await saveDepositPolicyAction(
      INITIAL_DEPOSIT_FORM_STATE,
      form({ intent: 'deposit-edit', value: '' })
    );

    expect(saveDepositPolicy).not.toHaveBeenCalled();
    expect(state.fieldErrors).toEqual({});
  });

  /**
   * T41. The answer rides on the pressed button, and the values are prefixed so
   * a second confirming form on the same page cannot consume this one's intent.
   */
  it('should_ignore_an_intent_belonging_to_another_form', async () => {
    await saveDepositPolicyAction(INITIAL_DEPOSIT_FORM_STATE, form({ intent: 'mp-confirm' }));

    expect(saveDepositPolicy).toHaveBeenCalledWith(
      'owner-root',
      expect.anything(),
      { confirmed: false }
    );
  });
});

describe('saveDepositPolicyAction - success', () => {
  it('should_report_the_save_and_revalidate_the_page', async () => {
    const state = await saveDepositPolicyAction(INITIAL_DEPOSIT_FORM_STATE, form());

    expect(state.saved).toBe(true);
    expect(revalidatePath).toHaveBeenCalledWith('/sena');
  });

  it('should_echo_the_normalized_value_back', async () => {
    const state = await saveDepositPolicyAction(
      INITIAL_DEPOSIT_FORM_STATE,
      form({ type: 'FIXED', value: '2000' })
    );

    expect(state.values).toEqual({ type: 'FIXED', value: '2000.00' });
  });

  it('should_surface_the_no_payment_method_warning_alongside_the_success', async () => {
    saveDepositPolicy.mockResolvedValue({
      status: 'saved',
      leavesNoPaymentMethod: true,
      servicesBelowDeposit: [],
      servicesBelowMinimum: [],
    });

    const state = await saveDepositPolicyAction(INITIAL_DEPOSIT_FORM_STATE, form());

    expect(state.saved).toBe(true);
    expect(state.noPaymentMethod).toBe(true);
  });

  it('should_carry_the_warning_lists_into_the_state', async () => {
    const effect = {
      serviceId: 'svc-1',
      serviceName: 'Corte',
      price: '3000.00',
      deposit: '3000.00',
      cappedByPrice: true,
      raisedToMinimum: false,
    };
    saveDepositPolicy.mockResolvedValue({
      status: 'saved',
      leavesNoPaymentMethod: false,
      servicesBelowDeposit: [effect],
      servicesBelowMinimum: [],
    });

    const state = await saveDepositPolicyAction(INITIAL_DEPOSIT_FORM_STATE, form());

    expect(state.servicesBelowDeposit).toEqual([effect]);
  });

  /**
   * The deposit policy is not a secret — it is disclosed to every client who
   * books — so it is logged in full. This is the only audit trail the story
   * produces for free (design D13).
   */
  it('should_log_the_previous_and_new_policy_unredacted', async () => {
    getDepositPolicy.mockResolvedValue({ type: 'PERCENT', value: '3.00' });

    await saveDepositPolicyAction(INITIAL_DEPOSIT_FORM_STATE, form());

    expect(loggerInfo).toHaveBeenCalledWith(
      'Deposit policy updated',
      expect.objectContaining({
        operation: 'saveDepositPolicy',
        ownerId: 'owner-root',
        previousType: 'PERCENT',
        previousValue: '3.00',
        newType: 'PERCENT',
        newValue: '30',
      })
    );
  });
});

describe('saveDepositPolicyAction - infrastructure failure', () => {
  /**
   * The write may have committed before the connection dropped, so the message
   * asks the owner to reload rather than leaving them unable to distinguish
   * "not saved" from "saved and not acknowledged".
   */
  it('should_ask_the_owner_to_reload_rather_than_asserting_failure', async () => {
    saveDepositPolicy.mockRejectedValue(new Error('connection lost'));

    const state = await saveDepositPolicyAction(INITIAL_DEPOSIT_FORM_STATE, form());

    expect(state.error).toBe(COPY.deposit.infrastructureError);
    expect(state.saved).toBe(false);
    expect(loggerError).toHaveBeenCalled();
  });

  it('should_keep_the_submitted_values_after_a_failure', async () => {
    saveDepositPolicy.mockRejectedValue(new Error('connection lost'));

    const state = await saveDepositPolicyAction(
      INITIAL_DEPOSIT_FORM_STATE,
      form({ type: 'FIXED', value: '2000' })
    );

    expect(state.values.type).toBe('FIXED');
  });
});

describe('removeDepositPolicyAction', () => {
  it('should_require_the_owner_first', async () => {
    requireOwner.mockRejectedValueOnce(new Error('not authenticated'));

    await expect(
      removeDepositPolicyAction(INITIAL_DEPOSIT_FORM_STATE, new FormData())
    ).rejects.toThrow('not authenticated');

    expect(removeDepositPolicy).not.toHaveBeenCalled();
  });

  it('should_carry_the_pending_removal_into_the_state', async () => {
    removeDepositPolicy.mockResolvedValue({
      status: 'needs_confirmation',
      stored: { type: 'PERCENT', value: '30.00' },
    });

    const state = await removeDepositPolicyAction(INITIAL_DEPOSIT_FORM_STATE, new FormData());

    expect(state.pendingRemoval).toEqual({ type: 'PERCENT', value: '30.00' });
    expect(state.removed).toBe(false);
  });

  it('should_pass_the_confirmation_through_to_the_service', async () => {
    const data = new FormData();
    data.append('intent', 'deposit-confirm');

    await removeDepositPolicyAction(INITIAL_DEPOSIT_FORM_STATE, data);

    expect(removeDepositPolicy).toHaveBeenCalledWith('owner-root', { confirmed: true });
  });

  it('should_report_the_removal_and_revalidate', async () => {
    const state = await removeDepositPolicyAction(INITIAL_DEPOSIT_FORM_STATE, new FormData());

    expect(state.removed).toBe(true);
    expect(revalidatePath).toHaveBeenCalledWith('/sena');
  });

  it('should_warn_when_the_removal_leaves_no_payment_method', async () => {
    removeDepositPolicy.mockResolvedValue({ status: 'removed', leavesNoPaymentMethod: true });

    const state = await removeDepositPolicyAction(INITIAL_DEPOSIT_FORM_STATE, new FormData());

    expect(state.noPaymentMethod).toBe(true);
  });

  it('should_ask_the_owner_to_reload_when_the_write_fails', async () => {
    removeDepositPolicy.mockRejectedValue(new Error('connection lost'));

    const state = await removeDepositPolicyAction(INITIAL_DEPOSIT_FORM_STATE, new FormData());

    expect(state.error).toBe(COPY.deposit.infrastructureError);
  });
});
