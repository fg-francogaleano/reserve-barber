import { COPY } from '@/lib/copy';
import type { BarberServicesFieldErrors } from '@/server/application/barberServices/barberServicesSchema';

export type BarberServicesFormState = {
  error: string | null;
  /**
   * The service the failure points at, so the editor can mark that checkbox
   * inline. With up to fifty controls, a form-level banner naming nothing is a
   * message the owner cannot act on.
   */
  invalidServiceId: string | null;
  /**
   * Echoed back verbatim so a rejected save is not handed back the *stored*
   * selection. React 19 resets uncontrolled forms when the action resolves, so
   * what the owner actually checked only survives here.
   */
  values: { serviceIds: string[] };
};

export const INITIAL_BARBER_SERVICES_FORM_STATE: BarberServicesFormState = {
  error: null,
  invalidServiceId: null,
  values: { serviceIds: [] },
};

/**
 * Every parse failure here is unreachable from the rendered form: the barber id
 * is a hidden field, the baseline is emitted by the server, and the cap is
 * bounded by the catalogue. So these messages describe a stale page or a
 * crafted payload, and the remedy offered is a reload rather than a correction.
 */
export function toFormState(
  fieldErrors: BarberServicesFieldErrors,
  values: BarberServicesFormState['values']
): BarberServicesFormState {
  if (fieldErrors.barberId) {
    return { error: COPY.barberServices.barberNotFound, invalidServiceId: null, values };
  }
  if (fieldErrors.serviceIds === 'too_many' || fieldErrors.renderedServiceIds === 'too_many') {
    return { error: COPY.barberServices.tooMany, invalidServiceId: null, values };
  }
  return { error: COPY.barberServices.invalidSelection, invalidServiceId: null, values };
}
