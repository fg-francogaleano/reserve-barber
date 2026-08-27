import { describe, it, expect } from 'vitest';
import {
  CANCEL_CONFIRM_PARAM,
  isCancellationConfirmationRequested,
} from './cancellationConfirmation';

/**
 * C1: the parameter that opens the confirmation panel.
 *
 * Strict, and for the reason T62 learned the hard way: a repeated
 * `?intento=2&intento=2` restarted the refresh counter because the page
 * flattened an array before the rule meant to judge it ever saw one. The raw
 * framework value reaches this function, and everything that is not exactly the
 * expected single string renders the ordinary page.
 */
describe('isCancellationConfirmationRequested', () => {
  it('should_be_true_for_the_expected_value', () => {
    expect(isCancellationConfirmationRequested('1')).toBe(true);
  });

  it('should_be_false_when_absent', () => {
    expect(isCancellationConfirmationRequested(undefined)).toBe(false);
  });

  it('should_be_false_for_an_empty_value', () => {
    expect(isCancellationConfirmationRequested('')).toBe(false);
  });

  it.each(['0', 'true', 'si', 'yes', '01', ' 1', '1 ', '2'])(
    'should_be_false_for_the_truthy_looking_value_%s',
    (raw) => {
      // Not a truthiness test. A parameter that opens a panel about an
      // irreversible action is matched, never interpreted.
      expect(isCancellationConfirmationRequested(raw)).toBe(false);
    }
  );

  it('should_be_false_for_a_repeated_parameter', () => {
    // This page emits exactly one, so an array was not produced here and is not
    // a value to interpret — it is the obvious way somebody would probe it.
    expect(isCancellationConfirmationRequested(['1', '1'])).toBe(false);
  });

  it('should_be_false_for_an_array_carrying_the_expected_value_once', () => {
    expect(isCancellationConfirmationRequested(['1'])).toBe(false);
  });

  it('should_be_false_for_an_oversized_value', () => {
    expect(isCancellationConfirmationRequested('1'.repeat(1000))).toBe(false);
  });

  it('should_name_its_parameter_in_spanish_like_the_others', () => {
    expect(CANCEL_CONFIRM_PARAM).toBe('cancelar');
  });
});
