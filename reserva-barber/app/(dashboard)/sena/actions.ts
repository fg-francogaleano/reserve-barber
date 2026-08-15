'use server';

import { revalidatePath } from 'next/cache';
import { requireOwner } from '@/server/infrastructure/supabase/requireOwner';
import { parseDepositPolicy } from '@/server/application/paymentConfig/depositPolicySchema';
import { logger } from '@/server/infrastructure/logger';
import { toErrorLogContext } from '@/server/infrastructure/errorLogContext';
import { COPY } from '@/lib/copy';
import { depositPolicyService } from './paymentConfigService';
import {
  toFormState,
  INITIAL_DEPOSIT_FORM_STATE,
  type DepositFormState,
  type DepositFormValues,
} from './formState';

const DEPOSIT_PATH = '/sena';

/**
 * Confirmation answers, namespaced per form (T41, design D16).
 *
 * `FormData.get` returns the **first** value for a repeated name. The transfer
 * and Mercado Pago editors carry their own `transfer-*` and `mp-*` values for
 * the same reason: once two confirming forms can share a page, an unprefixed
 * `confirm` would let one form's answer be consumed by the other's action —
 * and all three of these forms decide where a client's money goes.
 */
const CONFIRM_INTENT = 'deposit-confirm';
const EDIT_INTENT = 'deposit-edit';

function read(formData: FormData, field: string): string {
  const value = formData.get(field);
  return typeof value === 'string' ? value : '';
}

function submittedValues(formData: FormData): DepositFormValues {
  return {
    type: read(formData, 'type'),
    value: read(formData, 'value'),
  };
}

function failure(state: Partial<DepositFormState>, values: DepositFormValues): DepositFormState {
  return { ...INITIAL_DEPOSIT_FORM_STATE, values, ...state };
}

export async function saveDepositPolicyAction(
  _prevState: DepositFormState,
  formData: FormData
): Promise<DepositFormState> {
  // requireOwner() MUST be the first line — middleware passes next-action
  // through, so this is the entire authorization boundary for the action.
  const owner = await requireOwner();
  const values = submittedValues(formData);

  // The confirmation is a round trip through this same action, not a browser
  // dialog: it survives without JavaScript and cannot block the runtime.
  //
  // The answer rides on the pressed button as `intent`, never as a hidden field
  // the other button tries to override — `FormData.get` returns the first value
  // for a name, so a hidden "confirm" would win over a "cancel" button and the
  // guard would commit exactly what the owner just declined.
  const intent = read(formData, 'intent');

  // Going back to the editor writes nothing and validates nothing: the owner is
  // returning to fix a value, and reporting errors about it now would be noise
  // on top of a decision they already made.
  if (intent === EDIT_INTENT) {
    return failure({}, values);
  }

  const parsed = parseDepositPolicy({
    type: formData.get('type'),
    value: formData.get('value'),
  });

  if (!parsed.ok) {
    return toFormState(parsed.fieldErrors, values);
  }

  const service = depositPolicyService();

  // Read before the write so the log line can name what was replaced. The
  // deposit policy is the one value in this feature whose history is worth
  // reconstructing and cheap to record.
  let previous;
  try {
    previous = await service.getDepositPolicy(owner.id);
  } catch {
    // A failed read must not stop the save: the log line is a nicety, the
    // write is the point.
    previous = null;
  }

  let result;
  try {
    result = await service.saveDepositPolicy(owner.id, parsed.data, {
      confirmed: intent === CONFIRM_INTENT,
    });
  } catch (error) {
    logger.error('Deposit policy write failed', toErrorLogContext('saveDepositPolicy', error));
    // The write may have committed before the connection dropped, so the
    // message tells the owner to reload rather than leaving them unable to
    // distinguish "not saved" from "saved and not acknowledged".
    return failure({ error: COPY.deposit.infrastructureError }, values);
  }

  if (result.status === 'needs_confirmation') {
    return failure({ pendingConfirmation: result.pending }, values);
  }

  // Logged in FULL, unredacted — unlike the transfer destination and the access
  // token. The deposit policy is disclosed to every client who books, so there
  // is nothing to protect, and the previous/new pair is what makes a later
  // "when did the deposit change?" answerable from the log stream (design D13).
  logger.info('Deposit policy updated', {
    operation: 'saveDepositPolicy',
    ownerId: owner.id,
    previousType: previous?.type ?? null,
    previousValue: previous?.value ?? null,
    newType: parsed.data.type,
    newValue: parsed.data.value,
    leavesNoPaymentMethod: result.leavesNoPaymentMethod,
    servicesBelowDeposit: result.servicesBelowDeposit.length,
    servicesBelowMinimum: result.servicesBelowMinimum.length,
  });

  // No redirect: this is a singleton settings editor, not a create-then-list
  // form, so there is nowhere to go.
  revalidatePath(DEPOSIT_PATH);

  return {
    ...INITIAL_DEPOSIT_FORM_STATE,
    // Echoed back NORMALIZED, not as typed — the owner's only check that the
    // value they intended is the value the system holds.
    values: { type: parsed.data.type, value: parsed.data.value },
    saved: true,
    noPaymentMethod: result.leavesNoPaymentMethod,
    servicesBelowDeposit: result.servicesBelowDeposit,
    servicesBelowMinimum: result.servicesBelowMinimum,
  };
}

export async function removeDepositPolicyAction(
  _prevState: DepositFormState,
  formData: FormData
): Promise<DepositFormState> {
  const owner = await requireOwner();
  const intent = read(formData, 'intent');

  if (intent === EDIT_INTENT) {
    return failure({}, INITIAL_DEPOSIT_FORM_STATE.values);
  }

  const service = depositPolicyService();

  let previous;
  try {
    previous = await service.getDepositPolicy(owner.id);
  } catch {
    previous = null;
  }

  let result;
  try {
    result = await service.removeDepositPolicy(owner.id, {
      confirmed: intent === CONFIRM_INTENT,
    });
  } catch (error) {
    logger.error('Deposit policy removal failed', toErrorLogContext('removeDepositPolicy', error));
    return failure({ error: COPY.deposit.infrastructureError }, INITIAL_DEPOSIT_FORM_STATE.values);
  }

  if (result.status === 'needs_confirmation') {
    return failure({ pendingRemoval: result.stored }, INITIAL_DEPOSIT_FORM_STATE.values);
  }

  logger.info('Deposit policy removed', {
    operation: 'removeDepositPolicy',
    ownerId: owner.id,
    previousType: previous?.type ?? null,
    previousValue: previous?.value ?? null,
    leavesNoPaymentMethod: result.leavesNoPaymentMethod,
  });

  revalidatePath(DEPOSIT_PATH);

  return {
    ...INITIAL_DEPOSIT_FORM_STATE,
    removed: true,
    noPaymentMethod: result.leavesNoPaymentMethod,
  };
}
