import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createEmailSender, EMAIL_API_KEY_VAR, EMAIL_FROM_VAR } from './emailSenderFactory';
import { ResendEmailSender } from './ResendEmailSender';
import type { EmailMessage } from '@/server/domain/repositories/IEmailSender';
import type { ILogger } from '@/server/domain/repositories/ILogger';

const MESSAGE: EmailMessage = {
  to: 'ana@example.com',
  subject: 'Tu turno',
  text: 'https://shop.example/b/x/reserva/tok-abc123',
  html: '<p>Tu turno</p>',
};

function testLogger(): ILogger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

const ORIGINAL = { key: process.env[EMAIL_API_KEY_VAR], from: process.env[EMAIL_FROM_VAR] };

function configure(key: string | undefined, from: string | undefined): void {
  if (key === undefined) delete process.env[EMAIL_API_KEY_VAR];
  else process.env[EMAIL_API_KEY_VAR] = key;
  if (from === undefined) delete process.env[EMAIL_FROM_VAR];
  else process.env[EMAIL_FROM_VAR] = from;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  configure(ORIGINAL.key, ORIGINAL.from);
});

describe('createEmailSender - what it builds', () => {
  it('should_build_the_real_sender_when_both_values_are_present', () => {
    // Arrange
    configure('re_key', 'Shop <turnos@shop.example>');

    // Act
    const sender = createEmailSender(testLogger());

    // Assert
    expect(sender).toBeInstanceOf(ResendEmailSender);
  });

  it.each([
    ['no key', undefined, 'Shop <turnos@shop.example>', [EMAIL_API_KEY_VAR]],
    ['no sender', 're_key', undefined, [EMAIL_FROM_VAR]],
    ['neither', undefined, undefined, [EMAIL_API_KEY_VAR, EMAIL_FROM_VAR]],
    ['blank key', '   ', 'Shop <turnos@shop.example>', [EMAIL_API_KEY_VAR]],
    ['blank sender', 're_key', '   ', [EMAIL_FROM_VAR]],
  ])(
    'should_report_every_missing_variable_by_name_when_there_is_%s',
    async (_label, key, from, expected) => {
      // Arrange
      configure(key, from);
      const logger = testLogger();

      // Act
      const result = await createEmailSender(logger).send(MESSAGE);

      // Assert
      expect(result.outcome).toBe('rejected');
      const context = (logger.error as ReturnType<typeof vi.fn>).mock.calls[0][1];
      for (const name of expected) expect(String(context.missing)).toContain(name);
    }
  );

  it('should_never_default_the_sender_address', async () => {
    // Arrange: a plausible fallback is worse than nothing — a provider's shared
    // onboarding sender delivers only to the account owner, which passes a
    // verification done from that inbox and drops every real client.
    configure('re_key', undefined);
    const logger = testLogger();

    // Act
    const result = await createEmailSender(logger).send(MESSAGE);

    // Assert
    expect(result.outcome).toBe('rejected');
    expect(logger.error).toHaveBeenCalled();
  });
});

/**
 * The cardinality of the missing-configuration line.
 *
 * This is the regression the adversarial pass found: logging at construction
 * put one `error` line on every request to a public, unauthenticated endpoint —
 * volume any stranger could drive — and one on every render of the owner's
 * receipt queue, where nothing was being sent at all.
 */
describe('createEmailSender - the missing-configuration line is bounded by sends', () => {
  it('should_log_nothing_when_it_is_merely_constructed', () => {
    // Arrange: composition roots are per-request functions, so construction
    // happens as often as requests do.
    configure(undefined, undefined);
    const logger = testLogger();

    // Act
    createEmailSender(logger);
    createEmailSender(logger);
    createEmailSender(logger);

    // Assert
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('should_log_once_per_attempted_send_and_not_once_per_request', async () => {
    // Arrange
    configure(undefined, undefined);
    const logger = testLogger();

    // Act: three roots built, one message actually sent.
    createEmailSender(logger);
    createEmailSender(logger);
    await createEmailSender(logger).send(MESSAGE);

    // Assert
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('should_carry_no_message_content_into_the_log', async () => {
    // Arrange
    configure(undefined, undefined);
    const logger = testLogger();

    // Act
    await createEmailSender(logger).send(MESSAGE);

    // Assert
    const serialized = JSON.stringify((logger.error as ReturnType<typeof vi.fn>).mock.calls);
    expect(serialized).not.toContain('ana@example.com');
    expect(serialized).not.toContain('tok-abc123');
    expect(serialized).not.toContain('Tu turno');
  });

  it('should_carry_no_credential_value_into_the_log', async () => {
    // Arrange: the key is present but the sender is not, so the key is in scope.
    configure('re_super_secret_value', undefined);
    const logger = testLogger();

    // Act
    await createEmailSender(logger).send(MESSAGE);

    // Assert
    const serialized = JSON.stringify((logger.error as ReturnType<typeof vi.fn>).mock.calls);
    expect(serialized).not.toContain('re_super_secret_value');
    expect(serialized).toContain(EMAIL_FROM_VAR);
  });
});
