import { describe, it, expect } from 'vitest';
import {
  parseOutcomeCode,
  parseEcho,
  serializeEcho,
  parsePaymentOutcomeCode,
  BOOKING_OUTCOMES,
  PAYMENT_OUTCOMES,
} from './bookingOutcome';

describe('parseOutcomeCode', () => {
  it.each(BOOKING_OUTCOMES)('should_accept_the_known_code_%s', (code) => {
    expect(parseOutcomeCode(code)).toBe(code);
  });

  it('should_reject_an_unknown_code', () => {
    expect(parseOutcomeCode('whatever')).toBeNull();
  });

  it('should_reject_an_absent_parameter', () => {
    expect(parseOutcomeCode(undefined)).toBeNull();
  });

  it('should_take_the_first_value_of_a_repeated_parameter', () => {
    // The same rule the rest of the flow applies: link shorteners and social
    // networks append parameters, and the first is the one the flow emitted.
    expect(parseOutcomeCode(['datos', 'horario'])).toBe('datos');
  });
});

describe('parseEcho - a cookie is client-controlled and nothing here trusts it', () => {
  it('should_round_trip_what_it_serialized', () => {
    const echo = {
      fieldErrors: { phone: 'invalid_phone' as const },
      submitted: { name: 'Ana Pérez', email: 'ana@mail.com', phone: '555' },
    };

    expect(parseEcho(serializeEcho(echo))).toEqual(echo);
  });

  it('should_return_null_for_an_absent_cookie', () => {
    expect(parseEcho(undefined)).toBeNull();
  });

  it('should_return_null_for_an_empty_cookie', () => {
    expect(parseEcho('')).toBeNull();
  });

  it('should_refuse_an_oversized_value_without_parsing_it', () => {
    // The worst case of a malformed cookie must be a client retyping three
    // fields — never a thrown error on a public page.
    expect(parseEcho('a'.repeat(5_000))).toBeNull();
  });

  it('should_return_null_for_a_value_that_is_not_json', () => {
    expect(parseEcho(encodeURIComponent('not json at all'))).toBeNull();
  });

  it('should_return_null_for_json_that_is_not_an_object', () => {
    expect(parseEcho(encodeURIComponent(JSON.stringify('a string')))).toBeNull();
    expect(parseEcho(encodeURIComponent(JSON.stringify(42)))).toBeNull();
    expect(parseEcho(encodeURIComponent(JSON.stringify(null)))).toBeNull();
  });

  it('should_return_null_when_either_half_is_missing', () => {
    expect(parseEcho(encodeURIComponent(JSON.stringify({ fieldErrors: {} })))).toBeNull();
    expect(parseEcho(encodeURIComponent(JSON.stringify({ submitted: {} })))).toBeNull();
  });

  it('should_drop_fields_that_are_not_strings_rather_than_carrying_them_through', () => {
    // A crafted cookie must not be able to put an object or a function where a
    // rendered value goes.
    const crafted = encodeURIComponent(
      JSON.stringify({
        fieldErrors: { name: { toString: 'nope' }, email: 'invalid_email' },
        submitted: { name: 42, email: 'ana@mail.com', phone: ['x'] },
      })
    );

    expect(parseEcho(crafted)).toEqual({
      fieldErrors: { email: 'invalid_email' },
      submitted: { email: 'ana@mail.com' },
    });
  });

  it('should_ignore_unknown_keys_entirely', () => {
    const crafted = encodeURIComponent(
      JSON.stringify({
        fieldErrors: { slug: 'tampered' },
        submitted: { slug: 'another-shop', name: 'Ana' },
      })
    );

    expect(parseEcho(crafted)).toEqual({
      fieldErrors: {},
      submitted: { name: 'Ana' },
    });
  });
});

/**
 * C1: the two ways a client cancellation can be refused.
 *
 * **Two, not one.** "Your appointment already started" and "this booking moved
 * underneath you" are different facts a client acts on differently, and a
 * single generic refusal would leave them re-submitting a control that will
 * never succeed.
 *
 * **And no success code at all.** The page reads live state, so a cancelled
 * booking renders the cancelled state on its own; a success code could only
 * agree with the database or be ignored.
 */
describe('bookingOutcome - the cancellation refusals', () => {
  it('should_parse_the_started_appointment_refusal', () => {
    expect(parsePaymentOutcomeCode('turno-empezado')).toBe('turno-empezado');
  });

  it('should_parse_the_generic_refusal', () => {
    expect(parsePaymentOutcomeCode('cancelacion-no-posible')).toBe('cancelacion-no-posible');
  });

  it('should_not_carry_a_success_code', () => {
    // Asserted rather than merely omitted: the absence is a decision.
    for (const code of PAYMENT_OUTCOMES) {
      expect(code).not.toBe('turno-cancelado');
      expect(code).not.toBe('cancelacion-ok');
    }
  });

  it('should_still_refuse_a_forged_cancellation_code', () => {
    expect(parsePaymentOutcomeCode('cancelacion-si-posible')).toBeNull();
  });
});
