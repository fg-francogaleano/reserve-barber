'use server';

import { revalidatePath } from 'next/cache';
import { requireOwner } from '@/server/infrastructure/supabase/requireOwner';
import { parseTransferDetails } from '@/server/application/paymentConfig/transferDetailsSchema';
import { cbuLastFour, formatCbu } from '@/server/domain/models/cbu';
import { logger } from '@/server/infrastructure/logger';
import { toErrorLogContext } from '@/server/infrastructure/errorLogContext';
import { COPY } from '@/lib/copy';
import { paymentConfigService } from './paymentConfigService';
import { redactDestination } from './redactDestination';
import {
  toFormState,
  INITIAL_TRANSFER_FORM_STATE,
  type TransferFormState,
  type TransferFormValues,
} from './formState';

const TRANSFER_PATH = '/transferencia';

function read(formData: FormData, field: string): string {
  const value = formData.get(field);
  return typeof value === 'string' ? value : '';
}

function submittedValues(formData: FormData): TransferFormValues {
  return {
    cbuCvu: read(formData, 'cbuCvu'),
    alias: read(formData, 'alias'),
    holderName: read(formData, 'holderName'),
  };
}

function failure(state: Partial<TransferFormState>, values: TransferFormValues): TransferFormState {
  return { ...INITIAL_TRANSFER_FORM_STATE, values, ...state };
}

export async function saveTransferDetailsAction(
  _prevState: TransferFormState,
  formData: FormData
): Promise<TransferFormState> {
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
  if (intent === 'edit') {
    return failure({}, values);
  }

  const parsed = parseTransferDetails({
    cbuCvu: formData.get('cbuCvu'),
    alias: formData.get('alias'),
    holderName: formData.get('holderName'),
  });

  if (!parsed.ok) {
    return toFormState(parsed.fieldErrors, values);
  }

  const confirmed = intent === 'confirm';

  let result;
  try {
    result = await paymentConfigService().saveTransferDetails(owner.id, parsed.data, {
      confirmed,
    });
  } catch (error) {
    // `toErrorLogContext` drops the message of the Prisma codes known to embed
    // column values, but keeps it for unrecognized errors so they stay
    // diagnosable. That exception is exactly how a bank account could reach the
    // log stream, so the destination is redacted out of whatever survives.
    logger.error(
      'Transfer details write failed',
      redactDestination(toErrorLogContext('saveTransferDetails', error), [
        parsed.data.cbuCvu,
        parsed.data.alias,
        parsed.data.holderName,
      ])
    );
    // The write may have committed before the connection dropped, so the
    // message tells the owner to reload rather than leaving them unable to
    // distinguish "not saved" from "saved and not acknowledged" (design D13).
    return failure({ error: COPY.transfer.infrastructureError }, values);
  }

  if (result.status === 'needs_confirmation') {
    return failure({ pendingConfirmation: result.pending }, values);
  }

  // Presence flags and the last four digits only — never the full destination
  // or the holder name (design D9). The pair is what makes a change
  // reconstructable if deposits later arrive at the wrong account.
  logger.info('Transfer details updated', {
    operation: 'saveTransferDetails',
    ownerId: owner.id,
    hasCbu: parsed.data.cbuCvu !== null,
    hasAlias: parsed.data.alias !== null,
    cbuLastFour: cbuLastFour(parsed.data.cbuCvu),
    leavesNoPaymentMethod: result.leavesNoPaymentMethod,
  });

  // No redirect: this is a singleton settings editor, not a create-then-list
  // form, so there is nowhere to go.
  revalidatePath(TRANSFER_PATH);

  return {
    ...INITIAL_TRANSFER_FORM_STATE,
    // Echoed back NORMALIZED, not as typed — the owner's only defence against a
    // mistyped destination is reading back what was actually stored — and
    // grouped, so the field agrees with the stored-values panel beside it
    // instead of showing 22 unbroken digits on the one screen built for reading
    // them.
    values: {
      cbuCvu: parsed.data.cbuCvu === null ? '' : formatCbu(parsed.data.cbuCvu),
      alias: parsed.data.alias ?? '',
      holderName: parsed.data.holderName ?? '',
    },
    saved: true,
    noPaymentMethod: result.leavesNoPaymentMethod,
  };
}
