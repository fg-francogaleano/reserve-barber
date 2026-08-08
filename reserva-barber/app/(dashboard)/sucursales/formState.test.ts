import { describe, it, expect } from 'vitest';
import { toFormState, INITIAL_LOCATION_FORM_STATE } from './formState';
import { COPY } from '@/lib/copy';

const values = { name: 'Sucursal Centro', address: 'Av. Corrientes 1234' };

// This file also pins a Vitest configuration property: it is a `.test.ts` under
// `app/`, which matched neither project before the `server` include was widened.
// If that regresses, these tests stop running silently rather than failing.
describe('toFormState', () => {
  it('should_translate_a_missing_name_into_the_required_message', () => {
    expect(toFormState({ name: 'required' }, values)).toEqual({
      error: null,
      fieldErrors: { name: COPY.locations.form.nameRequired },
      values,
    });
  });

  it('should_translate_a_length_problem_into_the_length_message', () => {
    expect(toFormState({ name: 'invalid_length' }, values).fieldErrors.name).toBe(
      COPY.locations.form.nameLength
    );
  });

  it('should_attach_an_address_problem_to_the_address_field_only', () => {
    const state = toFormState({ address: 'too_long' }, values);

    expect(state.fieldErrors).toEqual({ address: COPY.locations.form.addressTooLong });
    expect(state.error).toBeNull();
  });

  it('should_report_both_fields_when_both_are_invalid', () => {
    const state = toFormState({ name: 'required', address: 'too_long' }, values);

    expect(state.fieldErrors).toEqual({
      name: COPY.locations.form.nameRequired,
      address: COPY.locations.form.addressTooLong,
    });
  });

  it('should_surface_a_rejected_id_as_the_not_found_message_with_no_field_errors', () => {
    // A rejected `id` means the payload never identified a real location, so
    // there is no input to attach the error to.
    expect(toFormState({ id: 'required', name: 'required' }, values)).toEqual({
      error: COPY.locations.notFound,
      fieldErrors: {},
      values,
    });
  });

  it('should_always_echo_the_submitted_values_back', () => {
    // The form renders `defaultValue` from state; dropping these would hand the
    // owner an empty form after every rejection (React 19 resets the DOM form).
    expect(toFormState({ name: 'required' }, values).values).toBe(values);
    expect(toFormState({ id: 'required' }, values).values).toBe(values);
  });

  it('should_return_no_errors_when_nothing_is_invalid', () => {
    expect(toFormState({}, values)).toEqual({ error: null, fieldErrors: {}, values });
  });

  it('should_start_from_an_empty_state', () => {
    expect(INITIAL_LOCATION_FORM_STATE).toEqual({
      error: null,
      fieldErrors: {},
      values: { name: '', address: '' },
    });
  });
});
