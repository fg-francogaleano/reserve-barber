import { describe, it, expect } from 'vitest';
import { formatCurrency } from './formatCurrency';

/**
 * These assert the es-AR *shape*, not an exact byte sequence: the space between
 * the symbol and the digits is a non-breaking space in some ICU builds and an
 * ordinary one in others, and pinning it would make the suite fail on a locale
 * data update that changed nothing the owner can see.
 *
 * The exact rendering on the deployment runtime was measured by the M3 gate and
 * is recorded in `docs/s0-versions-decision.md`.
 */
function normalizeSpaces(value: string): string {
  return value.replace(/ /g, ' ');
}

describe('formatCurrency', () => {
  it('should_use_a_comma_as_the_decimal_separator', () => {
    expect(normalizeSpaces(formatCurrency('4500.50'))).toBe('$ 4.500,50');
  });

  it('should_use_a_dot_as_the_thousands_separator', () => {
    expect(normalizeSpaces(formatCurrency('9999999.99'))).toBe('$ 9.999.999,99');
  });

  it('should_always_render_two_decimals', () => {
    expect(normalizeSpaces(formatCurrency('4500.00'))).toBe('$ 4.500,00');
    expect(normalizeSpaces(formatCurrency('0.00'))).toBe('$ 0,00');
  });

  it('should_render_a_sub_thousand_price_without_a_grouping_separator', () => {
    expect(normalizeSpaces(formatCurrency('500.00'))).toBe('$ 500,00');
  });

  it('should_not_be_degraded_to_an_untranslated_fallback', () => {
    // The failure mode this guards: trimmed ICU silently produces "ARS 4500.00".
    expect(formatCurrency('4500.50')).not.toContain('ARS');
  });
});
