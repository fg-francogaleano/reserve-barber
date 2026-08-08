import { COPY } from '@/lib/copy';
import type {
  LocationFieldError,
  LocationFieldErrors,
} from '@/server/application/locations/locationSchema';

/**
 * What a location form action returns to the client.
 *
 * This module is deliberately separate from `actions.ts`: a `'use server'`
 * module may only export async functions, so the shared constant and the
 * code-to-copy mapping cannot live there.
 */
export type LocationFormState = {
  /** Form-level message, already in Spanish. */
  error: string | null;
  /** Field-level messages, already in Spanish, keyed by input name. */
  fieldErrors: { name?: string; address?: string };
  /**
   * What the owner submitted, echoed back verbatim.
   *
   * This is not redundant with the DOM. React 19 resets an uncontrolled form
   * once its action resolves, so a rejected submission would otherwise hand
   * back an empty form — losing the input while asking the person to fix it.
   * The inputs render `defaultValue` from here, so the reset lands on the
   * values that were typed rather than on blanks.
   */
  values: { name: string; address: string };
};

export const INITIAL_LOCATION_FORM_STATE: LocationFormState = {
  error: null,
  fieldErrors: {},
  values: { name: '', address: '' },
};

/**
 * Translates the application layer's English field codes into user-facing
 * Spanish. The boundary matters: the schema must stay free of copy so it can be
 * logged and tested without leaking user-facing text (`base-standards.md` §2).
 */
function nameMessage(code: LocationFieldError): string {
  return code === 'required' ? COPY.locations.form.nameRequired : COPY.locations.form.nameLength;
}

export function toFormState(
  fieldErrors: LocationFieldErrors,
  values: LocationFormState['values']
): LocationFormState {
  // A rejected `id` means the payload never identified a real location — there
  // is no input to attach it to, so it surfaces as the not-found message.
  if (fieldErrors.id) {
    return { error: COPY.locations.notFound, fieldErrors: {}, values };
  }

  return {
    error: null,
    fieldErrors: {
      ...(fieldErrors.name ? { name: nameMessage(fieldErrors.name) } : {}),
      ...(fieldErrors.address ? { address: COPY.locations.form.addressTooLong } : {}),
    },
    values,
  };
}
