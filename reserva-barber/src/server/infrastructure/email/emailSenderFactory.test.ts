import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createEmailSender, EMAIL_API_KEY_VAR, EMAIL_FROM_VAR } from './emailSenderFactory';
import { ResendEmailSender } from './ResendEmailSender';
import {
  BOOKING_CANCELLATION_EMAIL,
  BOOKING_CONFIRMATION_EMAIL,
} from '@/server/domain/models/emailCapability';
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
    const sender = createEmailSender(testLogger(), BOOKING_CONFIRMATION_EMAIL);

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
      const result = await createEmailSender(logger, BOOKING_CONFIRMATION_EMAIL).send(MESSAGE);

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
    const result = await createEmailSender(logger, BOOKING_CONFIRMATION_EMAIL).send(MESSAGE);

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
    createEmailSender(logger, BOOKING_CONFIRMATION_EMAIL);
    createEmailSender(logger, BOOKING_CONFIRMATION_EMAIL);
    createEmailSender(logger, BOOKING_CONFIRMATION_EMAIL);

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
    createEmailSender(logger, BOOKING_CONFIRMATION_EMAIL);
    createEmailSender(logger, BOOKING_CONFIRMATION_EMAIL);
    await createEmailSender(logger, BOOKING_CONFIRMATION_EMAIL).send(MESSAGE);

    // Assert
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('should_carry_no_message_content_into_the_log', async () => {
    // Arrange
    configure(undefined, undefined);
    const logger = testLogger();

    // Act
    await createEmailSender(logger, BOOKING_CONFIRMATION_EMAIL).send(MESSAGE);

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
    await createEmailSender(logger, BOOKING_CONFIRMATION_EMAIL).send(MESSAGE);

    // Assert
    const serialized = JSON.stringify((logger.error as ReturnType<typeof vi.fn>).mock.calls);
    expect(serialized).not.toContain('re_super_secret_value');
    expect(serialized).toContain(EMAIL_FROM_VAR);
  });
});

/**
 * Who the line says it is about.
 *
 * **The defect this closes shipped and ran in production.** N1 wrote this
 * factory for one message and hard-coded the confirmation's name into it; C2
 * reused the factory for the cancellation notice, which is what a factory is
 * for. Every cancellation that could not be sent then reported itself as a
 * failed confirmation, under `email.bookingConfirmation` — while the
 * cancellation service's own line, correctly tagged, carried only a bare
 * `rejected` with no cause. Measured against the real factory, not inferred.
 *
 * Nothing covered attribution before, which is exactly why it broke silently:
 * every assertion here was about volume, variable names or leakage, and all of
 * them pass just as well with the wrong capability's name in the line.
 */
describe('createEmailSender - the line names the capability it was built for', () => {
  it('should_report_a_confirmation_under_the_confirmation_operation', async () => {
    // Arrange
    configure(undefined, undefined);
    const logger = testLogger();

    // Act
    await createEmailSender(logger, BOOKING_CONFIRMATION_EMAIL).send(MESSAGE);

    // Assert
    const [message, context] = (logger.error as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(context.operation).toBe('email.bookingConfirmation');
    expect(message).toContain('Confirmation email');
  });

  it('should_report_a_cancellation_under_the_cancellation_operation', async () => {
    // Arrange
    configure(undefined, undefined);
    const logger = testLogger();

    // Act
    await createEmailSender(logger, BOOKING_CANCELLATION_EMAIL).send(MESSAGE);

    // Assert
    const [message, context] = (logger.error as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(context.operation).toBe('email.bookingCancellation');
    expect(message).toContain('Cancellation notice');
  });

  /**
   * The negative half, stated separately because it is the one that failed.
   * A cancellation must not merely *also* be findable — it must not be filed
   * under the other capability at all, or the confirmation's counts include it.
   */
  it('should_never_file_a_cancellation_under_the_confirmation', async () => {
    // Arrange
    configure(undefined, undefined);
    const logger = testLogger();

    // Act
    await createEmailSender(logger, BOOKING_CANCELLATION_EMAIL).send(MESSAGE);

    // Assert
    const serialized = JSON.stringify((logger.error as ReturnType<typeof vi.fn>).mock.calls);
    expect(serialized).not.toContain('email.bookingConfirmation');
    expect(serialized).not.toContain('Confirmation');
  });

  /**
   * The reason the capability is a required argument rather than a defaulted
   * one (T57): a default is how a third message type would silently inherit
   * whichever identity happened to be first, which is the whole defect again.
   */
  it('should_require_the_capability_rather_than_defaulting_it', () => {
    expect(createEmailSender).toHaveLength(2);
  });
});
