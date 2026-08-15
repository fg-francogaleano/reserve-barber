import { COPY } from '@/lib/copy';
import { formatAmount } from '@/server/domain/models/money';
import type {
  DepositTypeError,
  DepositValueError,
  DepositFieldErrors,
} from '@/server/application/paymentConfig/depositPolicySchema';
import type {
  DepositEffect,
  PendingDepositPolicy,
} from '@/server/application/services/PaymentConfigService';
import type { DepositPolicySettings } from '@/server/domain/models/PaymentConfig';

/**
 * Everything the owner chose, echoed back.
 *
 * React 19 resets uncontrolled forms when an action resolves, so a rejected
 * save hands back an empty form unless every field survives here. The type
 * matters as much as the value: losing it would drop the owner back onto the
 * default and turn their fixed amount into a percentage on the next submit.
 */
export interface DepositFormValues {
  type: string;
  value: string;
}

export interface DepositFormState {
  error: string | null;
  fieldErrors: {
    type?: string;
    value?: string;
  };
  values: DepositFormValues;
  /** Drives the success state. Never true alongside an error. */
  saved: boolean;
  /** Set when a removal completed, so the page can say so rather than "guardada". */
  removed: boolean;
  /**
   * Set when the save left the business with no configured payment method.
   * Computed on the server, because only it knows whether Mercado Pago or a
   * transfer destination is configured — and because the warning must work
   * before hydration. Shown **alongside** the success, never instead of it.
   */
  noPaymentMethod: boolean;
  /**
   * Present when the submission would replace an already-stored policy and has
   * not been confirmed (design D6). Nothing was written.
   *
   * Carries the effects computed on the server, through the same rule the
   * booking flow uses — so the preview cannot promise an amount the booking
   * would not charge.
   */
  pendingConfirmation: PendingDepositPolicy | null;
  /** Present when a removal needs confirming. Nothing was written. */
  pendingRemoval: DepositPolicySettings | null;
  /** Services the saved policy would have overcharged, capped down to their price. */
  servicesBelowDeposit: DepositEffect[];
  /** Services whose computed deposit had to be raised to the minimum. */
  servicesBelowMinimum: DepositEffect[];
}

export const EMPTY_DEPOSIT_FORM_VALUES: DepositFormValues = {
  type: '',
  value: '',
};

export const INITIAL_DEPOSIT_FORM_STATE: DepositFormState = {
  error: null,
  fieldErrors: {},
  values: EMPTY_DEPOSIT_FORM_VALUES,
  saved: false,
  removed: false,
  noPaymentMethod: false,
  pendingConfirmation: null,
  pendingRemoval: null,
  servicesBelowDeposit: [],
  servicesBelowMinimum: [],
};

/**
 * A stored percentage as the owner wrote it.
 *
 * The column is `Decimal(12, 2)`, so `30` comes back as `30.00`. The trailing
 * decimals are an artefact of the storage, not something the owner typed — and
 * percentages are whole numbers by rule, so showing them is showing precision
 * that cannot exist.
 */
export function displayPercent(value: string): string {
  return String(Number(value));
}

/**
 * `30%` or `$2.000,00` — the policy as the owner reads it.
 *
 * Lives here, used by both the page and the form, because two copies of this
 * drifted the first time it was written: one showed `30%` and the other
 * `30.00%` for the same stored policy.
 */
export function describePolicy(type: string, value: string | null): string {
  if (value === null) return COPY.deposit.confirmNone;
  return type === 'PERCENT' ? `${displayPercent(value)}%` : `$${formatAmount(value)}`;
}

function typeMessage(code: DepositTypeError): string {
  return code === 'required' ? COPY.deposit.typeRequired : COPY.deposit.typeInvalid;
}

/**
 * The value parser distinguishes seven rejections and each gets its own
 * message, because they describe different mistakes.
 *
 * The message depends on the **submitted type**: `out_of_range` means "1 to
 * 100" for a percentage and "greater than zero" for an amount, and reporting
 * the wrong one would send the owner looking for a problem that is not there.
 */
function valueMessage(code: DepositValueError, type: string): string {
  const isPercent = type === 'PERCENT';

  switch (code) {
    case 'required':
      return COPY.deposit.valueRequired;
    case 'not_whole':
      return COPY.deposit.percentNotWhole;
    case 'out_of_range':
      return isPercent ? COPY.deposit.percentOutOfRange : COPY.deposit.fixedOutOfRange;
    case 'too_large':
      return COPY.deposit.fixedTooLarge;
    case 'thousands_separator':
      return COPY.deposit.fixedThousandsSeparator;
    case 'too_many_decimals':
      return COPY.deposit.fixedTooManyDecimals;
    default:
      return isPercent ? COPY.deposit.percentInvalidFormat : COPY.deposit.fixedInvalidFormat;
  }
}

export function toFormState(
  fieldErrors: DepositFieldErrors,
  values: DepositFormValues
): DepositFormState {
  return {
    ...INITIAL_DEPOSIT_FORM_STATE,
    fieldErrors: {
      ...(fieldErrors.type ? { type: typeMessage(fieldErrors.type) } : {}),
      ...(fieldErrors.value ? { value: valueMessage(fieldErrors.value, values.type) } : {}),
    },
    values,
  };
}
