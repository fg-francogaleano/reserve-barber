import { describe, it, expect } from 'vitest';
import {
  resolveConfirmationRefresh,
  CONFIRMATION_REFRESH_PARAM,
  MAX_REFRESH_ATTEMPTS,
  REFRESH_INTERVAL_SECONDS,
} from './confirmationRefresh';

const BASE = '/b/barberia-central/reserva/tok-abc123?estado=pago-pendiente';

describe('resolveConfirmationRefresh - the bound', () => {
  /**
   * A case table rather than scattered assertions, for the reason
   * `resolvePaymentPageState` gives about itself: the bound is the part that is
   * easy to get wrong, and an unclamped counter is a refresh loop on a public
   * page that anyone can open.
   */
  const cases: ReadonlyArray<[string, string | string[] | undefined, boolean, number | null]> = [
    ['absent, the first arrival', undefined, true, 2],
    ['the second attempt', '2', true, 3],
    ['the last attempt', '3', false, null],
    ['beyond the bound', '4', false, null],
    ['far beyond the bound', '999', false, null],
    ['negative', '-1', false, null],
    ['zero', '0', false, null],
    ['not a number', 'abc', false, null],
    ['empty', '', false, null],
    ['a float', '2.5', false, null],
    ['padded with spaces', ' 2 ', false, null],
    ['scientific notation', '2e0', false, null],
    ['hexadecimal', '0x2', false, null],
  ];

  for (const [label, raw, shouldRefresh, nextAttempt] of cases) {
    it(`should_handle_an_attempt_counter_that_is_${label.replace(/[^a-z]+/gi, '_')}`, () => {
      // Act
      const refresh = resolveConfirmationRefresh({ attempt: raw, currentUrl: BASE });

      // Assert
      expect(refresh === null).toBe(!shouldRefresh);
      if (refresh !== null && nextAttempt !== null) {
        expect(refresh.url).toContain(`${CONFIRMATION_REFRESH_PARAM}=${nextAttempt}`);
      }
    });
  }
});

describe('resolveConfirmationRefresh - the emitted refresh', () => {
  it('should_carry_the_interval_and_the_next_url', () => {
    // Act
    const refresh = resolveConfirmationRefresh({ attempt: undefined, currentUrl: BASE });

    // Assert
    expect(refresh).not.toBeNull();
    expect(refresh?.seconds).toBe(REFRESH_INTERVAL_SECONDS);
    expect(refresh?.url).toContain('estado=pago-pendiente');
  });

  it('should_replace_the_counter_rather_than_appending_a_second_one', () => {
    // Arrange: appending would grow the URL on every hop and leave two values
    // for one parameter, which is how a clamp stops clamping.
    const url = `${BASE}&${CONFIRMATION_REFRESH_PARAM}=2`;

    // Act
    const refresh = resolveConfirmationRefresh({ attempt: '2', currentUrl: url });

    // Assert
    const occurrences = refresh?.url.split(`${CONFIRMATION_REFRESH_PARAM}=`).length ?? 0;
    expect(occurrences - 1).toBe(1);
    expect(refresh?.url).toContain(`${CONFIRMATION_REFRESH_PARAM}=3`);
  });

  it('should_preserve_the_path_and_the_other_parameters', () => {
    // Act
    const refresh = resolveConfirmationRefresh({ attempt: undefined, currentUrl: BASE });

    // Assert
    expect(refresh?.url).toContain('/b/barberia-central/reserva/tok-abc123');
    expect(refresh?.url).toContain('estado=pago-pendiente');
  });

  it('should_emit_a_relative_url_and_never_an_absolute_one', () => {
    // Arrange: an absolute URL here would need an origin, and the one place a
    // host could come from is the request — which this flow does not trust.
    const refresh = resolveConfirmationRefresh({ attempt: undefined, currentUrl: BASE });

    // Assert
    expect(refresh?.url.startsWith('/')).toBe(true);
    expect(refresh?.url).not.toMatch(/^https?:/);
  });

  it('should_bound_the_total_wait_to_roughly_ten_seconds', () => {
    // Arrange: long enough for the ordinary notification delay, short enough
    // that a page whose notification is never coming stops asking.
    const total = (MAX_REFRESH_ATTEMPTS - 1) * REFRESH_INTERVAL_SECONDS;

    // Assert
    expect(total).toBeGreaterThanOrEqual(8);
    expect(total).toBeLessThanOrEqual(15);
  });

  it('should_take_an_array_valued_parameter_as_malformed', () => {
    // Arrange: Next hands a repeated query parameter over as an array, and a
    // repeated `intento` is the obvious way to try to defeat the clamp.
    const refresh = resolveConfirmationRefresh({ attempt: ['2', '2'], currentUrl: BASE });

    // Assert
    expect(refresh).toBeNull();
  });
});
