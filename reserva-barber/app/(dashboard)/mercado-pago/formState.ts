import { COPY } from '@/lib/copy';
import type {
  CredentialFieldErrors,
  CredentialFieldError,
  CredentialFormError,
} from '@/server/application/paymentConfig/mercadoPagoCredentialsSchema';
import type { PendingCredentialsSummary } from '@/server/application/services/PaymentConfigService';

/**
 * What the owner typed, echoed back — **except the access token**.
 *
 * React 19 resets uncontrolled forms when an action resolves, so a rejected
 * save hands back an empty form unless the values survive here. The token is
 * the deliberate exception: this state is serialized into the payload sent to
 * the browser, so keeping it would undo the guarantee that the token never
 * reaches the page (design D15).
 *
 * Re-entering it is the cost, and the copy says so — otherwise the emptied
 * field reads as the form losing the owner's work.
 */
export interface MercadoPagoFormValues {
  publicKey: string;
}

export interface MercadoPagoFormState {
  error: string | null;
  fieldErrors: {
    accessToken?: string;
    publicKey?: string;
    form?: string;
  };
  values: MercadoPagoFormValues;
  /** Drives the success state. Never true alongside an error. */
  saved: boolean;
  removed: boolean;
  /**
   * The save happened but Mercado Pago could not confirm the credentials
   * (design D5). Shown alongside the success, never instead of it.
   */
  unverified: boolean;
  /** Set when the change left the business with no payment method at all. */
  noPaymentMethod: boolean;
  /**
   * Present when the submission would replace or remove stored credentials and
   * has not been confirmed. Nothing was written.
   *
   * Carries only non-secret facts — environment, last four, account identity.
   * The token itself waits in an encrypted `httpOnly` cookie (design D7), never
   * in this object, which crosses to the browser.
   */
  pendingConfirmation: PendingCredentialsSummary | null;
  /** Distinguishes a pending removal from a pending replacement. */
  pendingIntent: 'save' | 'remove' | null;
}

export const EMPTY_MERCADO_PAGO_VALUES: MercadoPagoFormValues = { publicKey: '' };

export const INITIAL_MERCADO_PAGO_STATE: MercadoPagoFormState = {
  error: null,
  fieldErrors: {},
  values: EMPTY_MERCADO_PAGO_VALUES,
  saved: false,
  removed: false,
  unverified: false,
  noPaymentMethod: false,
  pendingConfirmation: null,
  pendingIntent: null,
};

function fieldMessage(code: CredentialFieldError, field: 'accessToken' | 'publicKey'): string {
  // One code today, but switched rather than returned directly: a second code
  // added later must not silently inherit this message.
  switch (code) {
    default:
      return field === 'accessToken'
        ? COPY.mercadoPago.tokenInvalid
        : COPY.mercadoPago.publicKeyInvalid;
  }
}

/**
 * Each of the four form-level rejections names its own mistake. Telling an
 * owner who transposed two fields that their pair is "incomplete" describes
 * something they did not do.
 */
function formMessage(code: CredentialFormError): string {
  switch (code) {
    case 'looks_swapped':
      return COPY.mercadoPago.looksSwapped;
    case 'environment_mismatch':
      return COPY.mercadoPago.environmentMismatch;
    case 'token_required_for_key_change':
      return COPY.mercadoPago.tokenRequiredForKeyChange;
    default:
      return COPY.mercadoPago.incompletePair;
  }
}

export function toMercadoPagoFormState(
  fieldErrors: CredentialFieldErrors,
  values: MercadoPagoFormValues
): MercadoPagoFormState {
  return {
    ...INITIAL_MERCADO_PAGO_STATE,
    fieldErrors: {
      ...(fieldErrors.accessToken
        ? { accessToken: fieldMessage(fieldErrors.accessToken, 'accessToken') }
        : {}),
      ...(fieldErrors.publicKey
        ? { publicKey: fieldMessage(fieldErrors.publicKey, 'publicKey') }
        : {}),
      ...(fieldErrors.form ? { form: formMessage(fieldErrors.form) } : {}),
    },
    values,
  };
}
