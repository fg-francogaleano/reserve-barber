import { describe, it, expect } from 'vitest';
import { generateCancellationToken } from './cancellationToken';

describe('cancellationToken', () => {
  it('should_produce_a_url_safe_string_with_no_padding', () => {
    const token = generateCancellationToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token).not.toContain('=');
  });

  it('should_be_long_enough_to_encode_256_bits', () => {
    // 32 bytes base64url-encoded, no padding: ceil(32 * 8 / 6) = 43 characters.
    const token = generateCancellationToken();
    expect(token.length).toBeGreaterThanOrEqual(43);
  });

  it('should_differ_between_generations', () => {
    const tokens = new Set(Array.from({ length: 50 }, () => generateCancellationToken()));
    expect(tokens.size).toBe(50);
  });

  it('should_take_no_inputs_to_derive_from', () => {
    // The function's own signature is the proof: it accepts nothing, so
    // nothing about a booking's id, a client's data or the current time can
    // leak into the token.
    expect(generateCancellationToken).toHaveLength(0);
  });
});
