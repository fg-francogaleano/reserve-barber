import { COPY } from '@/lib/copy';
import type { BarberFieldError, BarberFieldErrors } from '@/server/application/barbers/barberSchema';

export type BarberFormState = {
  error: string | null;
  fieldErrors: { displayName?: string; locationId?: string; bio?: string };
  /**
   * Echoed back verbatim so a rejected form is not handed back empty.
   * React 19 resets uncontrolled forms on resolve — echoing ensures the
   * selected location is also preserved across a rejected submit.
   */
  values: { displayName: string; locationId: string; bio: string };
  /** Carries the destination location name when a duplicate error needs it. */
  duplicateLocationName?: string;
};

export const INITIAL_BARBER_FORM_STATE: BarberFormState = {
  error: null,
  fieldErrors: {},
  values: { displayName: '', locationId: '', bio: '' },
};

function displayNameMessage(code: BarberFieldError): string {
  return code === 'required'
    ? COPY.barbers.form.nameRequired
    : COPY.barbers.form.nameLength;
}

export function toFormState(
  fieldErrors: BarberFieldErrors,
  values: BarberFormState['values']
): BarberFormState {
  if (fieldErrors.id) {
    return { error: COPY.barbers.notFound, fieldErrors: {}, values };
  }
  return {
    error: null,
    fieldErrors: {
      ...(fieldErrors.displayName ? { displayName: displayNameMessage(fieldErrors.displayName) } : {}),
      ...(fieldErrors.locationId ? { locationId: COPY.barbers.form.locationRequired } : {}),
      ...(fieldErrors.bio ? { bio: COPY.barbers.form.bioTooLong } : {}),
    },
    values,
  };
}
