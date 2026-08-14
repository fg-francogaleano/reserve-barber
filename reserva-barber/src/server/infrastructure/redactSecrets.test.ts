import { describe, it, expect } from 'vitest';
import { redactSecrets } from './redactSecrets';
import { toErrorLogContext } from './errorLogContext';

const TOKEN = 'APP_USR-4934588586838432-081312-abcdef0123456789abcdef0123456789-241983636';
const CBU = '2850590940090418135201';

describe('redactSecrets', () => {
  it('should_remove_a_secret_from_the_cause', () => {
    const context = { operation: 'save', cause: `failed while sending ${TOKEN}` };

    expect(redactSecrets(context, [TOKEN]).cause).toBe('failed while sending [redacted]');
  });

  it('should_remove_every_occurrence', () => {
    const context = { operation: 'save', cause: `${TOKEN} rejected; retry with ${TOKEN}` };

    expect(redactSecrets(context, [TOKEN]).cause).not.toContain(TOKEN);
  });

  it('should_remove_several_secrets', () => {
    const context = { operation: 'save', cause: `${TOKEN} and ${CBU}` };

    const cause = redactSecrets(context, [TOKEN, CBU]).cause ?? '';
    expect(cause).not.toContain(TOKEN);
    expect(cause).not.toContain(CBU);
  });

  it('should_keep_the_rest_of_the_message_diagnosable', () => {
    // Redacting rather than dropping the cause: the operator still sees what
    // failed, and the secret never appears.
    const context = { operation: 'save', cause: `connection reset while sending ${TOKEN}` };

    expect(redactSecrets(context, [TOKEN]).cause).toContain('connection reset');
  });

  it('should_ignore_a_context_with_no_cause', () => {
    const context = { operation: 'save' };

    expect(redactSecrets(context, [TOKEN])).toEqual(context);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty', ''],
    ['too short to be a secret', 'ab'],
  ])('should_ignore_a_%s_value_rather_than_blanking_the_message', (_label, secret) => {
    const context = { operation: 'save', cause: 'connection reset' };

    expect(redactSecrets(context, [secret]).cause).toBe('connection reset');
  });

  // The path this helper exists for. `toErrorLogContext` deliberately keeps the
  // message of an UNRECOGNIZED error so failures stay diagnosable, and that is
  // exactly how a bearer token would reach the log stream.
  it('should_redact_a_token_that_survives_the_error_context_builder', () => {
    const context = toErrorLogContext(
      'saveMercadoPagoCredentials',
      new Error(`upstream rejected ${TOKEN}`)
    );

    expect(context.cause).toContain(TOKEN);
    expect(redactSecrets(context, [TOKEN]).cause).not.toContain(TOKEN);
  });

  // Third-party error bodies routinely echo the credential they rejected.
  it('should_redact_a_token_echoed_by_a_third_party_error_body', () => {
    const context = toErrorLogContext(
      'saveMercadoPagoCredentials',
      new Error(JSON.stringify({ message: 'invalid token', token: TOKEN }))
    );

    expect(redactSecrets(context, [TOKEN]).cause).not.toContain(TOKEN);
  });
});
