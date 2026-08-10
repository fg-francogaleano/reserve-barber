import { COPY } from '@/lib/copy';
import type {
  ServiceFieldError,
  ServiceFieldErrors,
} from '@/server/application/servicesCatalog/serviceSchema';

export type ServiceFormState = {
  error: string | null;
  fieldErrors: {
    name?: string;
    price?: string;
    durationMinutes?: string;
    description?: string;
  };
  /**
   * Echoed back verbatim so a rejected form is not handed back empty.
   * React 19 resets uncontrolled forms on resolve, so every field the owner
   * typed — including the price and duration — must survive here or it is lost.
   */
  values: { name: string; price: string; durationMinutes: string; description: string };
};

export const INITIAL_SERVICE_FORM_STATE: ServiceFormState = {
  error: null,
  fieldErrors: {},
  values: { name: '', price: '', durationMinutes: '', description: '' },
};

function nameMessage(code: ServiceFieldError): string {
  return code === 'required'
    ? COPY.services.form.nameRequired
    : COPY.services.form.nameLength;
}

/**
 * The price parser distinguishes four rejection reasons and each gets its own
 * message. Collapsing them would tell an owner who typed a thousands separator
 * that their price is "invalid", which explains the wrong thing.
 */
function priceMessage(code: ServiceFieldError): string {
  switch (code) {
    case 'required':
      return COPY.services.form.priceRequired;
    case 'thousands_separator':
      return COPY.services.form.priceThousandsSeparator;
    case 'too_many_decimals':
      return COPY.services.form.priceTooManyDecimals;
    case 'too_large':
      return COPY.services.form.priceTooLarge;
    default:
      return COPY.services.form.priceInvalid;
  }
}

function durationMessage(code: ServiceFieldError): string {
  switch (code) {
    case 'required':
      return COPY.services.form.durationRequired;
    case 'out_of_range':
      return COPY.services.form.durationOutOfRange;
    case 'not_multiple':
      return COPY.services.form.durationNotMultiple;
    default:
      return COPY.services.form.durationInvalid;
  }
}

export function toFormState(
  fieldErrors: ServiceFieldErrors,
  values: ServiceFormState['values']
): ServiceFormState {
  if (fieldErrors.id) {
    return { error: COPY.services.notFound, fieldErrors: {}, values };
  }
  return {
    error: null,
    fieldErrors: {
      ...(fieldErrors.name ? { name: nameMessage(fieldErrors.name) } : {}),
      ...(fieldErrors.price ? { price: priceMessage(fieldErrors.price) } : {}),
      ...(fieldErrors.durationMinutes
        ? { durationMinutes: durationMessage(fieldErrors.durationMinutes) }
        : {}),
      ...(fieldErrors.description
        ? { description: COPY.services.form.descriptionTooLong }
        : {}),
    },
    values,
  };
}
