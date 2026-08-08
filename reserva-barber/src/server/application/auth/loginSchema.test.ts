import { describe, it, expect } from 'vitest';
import { loginSchema } from './loginSchema';

describe('loginSchema', () => {
  it('should_accept_a_valid_email_and_password', () => {
    const result = loginSchema.safeParse({ email: 'owner@example.com', password: 'correct-password' });

    expect(result.success).toBe(true);
  });

  it('should_trim_and_lowercase_the_email', () => {
    const result = loginSchema.safeParse({ email: '  Owner@Example.com  ', password: 'correct-password' });

    expect(result.success).toBe(true);
    expect(result.success && result.data.email).toBe('owner@example.com');
  });

  it('should_reject_a_malformed_email', () => {
    const result = loginSchema.safeParse({ email: 'not-an-email', password: 'correct-password' });

    expect(result.success).toBe(false);
  });

  it('should_reject_an_empty_email', () => {
    const result = loginSchema.safeParse({ email: '', password: 'correct-password' });

    expect(result.success).toBe(false);
  });

  it('should_reject_an_empty_password', () => {
    const result = loginSchema.safeParse({ email: 'owner@example.com', password: '' });

    expect(result.success).toBe(false);
  });

  it('should_reject_a_missing_password', () => {
    const result = loginSchema.safeParse({ email: 'owner@example.com' });

    expect(result.success).toBe(false);
  });
});
