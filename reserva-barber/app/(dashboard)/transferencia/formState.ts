import { COPY } from '@/lib/copy';
import type {
  TransferFieldError,
  TransferFieldErrors,
} from '@/server/application/paymentConfig/transferDetailsSchema';
import type { TransferDetails } from '@/server/domain/models/PaymentConfig';

/**
 * Everything the owner typed, echoed back verbatim.
 *
 * React 19 resets uncontrolled forms when an action resolves, so a rejected
 * save hands back an empty form unless every field survives here. On this form
 * that matters more than most: losing a 22-digit destination the owner just
 * copied out of their home banking is a worse outcome than the error being
 * reported.
 */
export interface TransferFormValues {
  cbuCvu: string;
  alias: string;
  holderName: string;
}

export interface TransferFormState {
  error: string | null;
  fieldErrors: {
    cbuCvu?: string;
    alias?: string;
    holderName?: string;
    form?: string;
  };
  values: TransferFormValues;
  /** Drives the success state. Never true alongside an error. */
  saved: boolean;
  /**
   * Set when the save left the business with no configured payment method
   * (design D16). Computed on the server, because only it knows whether PC2
   * configured Mercado Pago — and because the warning must work before
   * hydration. Shown **alongside** the success, never instead of it.
   */
  noPaymentMethod: boolean;
  /**
   * Present when the submission would change an already-stored destination and
   * has not been confirmed (design D14). Nothing was written.
   *
   * Carries the **normalized** value: confirming what the owner typed rather
   * than what would be stored would confirm the wrong thing.
   */
  pendingConfirmation: TransferDetails | null;
}

export const EMPTY_TRANSFER_FORM_VALUES: TransferFormValues = {
  cbuCvu: '',
  alias: '',
  holderName: '',
};

export const INITIAL_TRANSFER_FORM_STATE: TransferFormState = {
  error: null,
  fieldErrors: {},
  values: EMPTY_TRANSFER_FORM_VALUES,
  saved: false,
  noPaymentMethod: false,
  pendingConfirmation: null,
};

/**
 * The destination parser distinguishes three rejection reasons and each gets
 * its own message. Collapsing them would tell an owner who typed 21 digits that
 * their CBU "is not valid", which describes a different mistake than the one
 * they made.
 */
function cbuMessage(code: TransferFieldError): string {
  switch (code) {
    case 'invalid_length':
      return COPY.transfer.cbuInvalidLength;
    case 'invalid_chars':
      return COPY.transfer.cbuInvalidChars;
    default:
      return COPY.transfer.cbuInvalidChecksum;
  }
}

function aliasMessage(code: TransferFieldError): string {
  return code === 'invalid_length'
    ? COPY.transfer.aliasInvalidLength
    : COPY.transfer.aliasInvalidChars;
}

function holderMessage(code: TransferFieldError): string {
  switch (code) {
    case 'holder_required':
      return COPY.transfer.holderRequired;
    case 'invalid_length':
      return COPY.transfer.holderInvalidLength;
    default:
      return COPY.transfer.holderInvalidChars;
  }
}

export function toFormState(
  fieldErrors: TransferFieldErrors,
  values: TransferFormValues
): TransferFormState {
  return {
    ...INITIAL_TRANSFER_FORM_STATE,
    fieldErrors: {
      ...(fieldErrors.cbuCvu ? { cbuCvu: cbuMessage(fieldErrors.cbuCvu) } : {}),
      ...(fieldErrors.alias ? { alias: aliasMessage(fieldErrors.alias) } : {}),
      ...(fieldErrors.holderName ? { holderName: holderMessage(fieldErrors.holderName) } : {}),
      ...(fieldErrors.form ? { form: COPY.transfer.noDestination } : {}),
    },
    values,
  };
}
