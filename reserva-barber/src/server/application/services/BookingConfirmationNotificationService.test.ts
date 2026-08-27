import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BookingConfirmationNotificationService } from './BookingConfirmationNotificationService';
import type { IBookingRepository } from '@/server/domain/repositories/IBookingRepository';
import type { IEmailSender, EmailSendOutcome } from '@/server/domain/repositories/IEmailSender';
import type { ILogger } from '@/server/domain/repositories/ILogger';
import type { IClock } from '@/server/domain/repositories/IClock';

const BOOKING = 'bkg-1';
const NOW = new Date('2026-08-25T12:00:00.000Z');
const ORIGIN = 'https://reserva.example.com';

const PROJECTION = {
  clientName: 'Ana Pérez',
  clientEmail: 'ana@example.com',
  shopName: 'Barbería Central',
  shopSlug: 'barberia-central',
  locationName: 'Sucursal Palermo',
  locationAddress: 'Gorriti 4500',
  barberName: 'Nico',
  serviceName: 'Corte y barba',
  startTime: new Date('2026-08-30T18:30:00.000Z'),
  priceAtBooking: '9000.00',
  depositAmount: '2000.50',
  cancellationToken: 'tok-abc123',
};

function build(
  options: {
    projection?: typeof PROJECTION | null;
    outcome?: EmailSendOutcome;
    origin?: string | null;
    markFails?: boolean;
    findFails?: boolean;
  } = {}
) {
  const findForConfirmationEmail = options.findFails
    ? vi.fn().mockRejectedValue(new Error('pooler timeout'))
    : vi.fn().mockResolvedValue(options.projection === undefined ? PROJECTION : options.projection);

  const markConfirmationEmailSent = options.markFails
    ? vi.fn().mockRejectedValue(new Error('pooler timeout'))
    : vi.fn().mockResolvedValue(undefined);

  const bookings = {
    findForConfirmationEmail,
    markConfirmationEmailSent,
  } as unknown as IBookingRepository;

  const send = vi.fn().mockResolvedValue({ outcome: options.outcome ?? 'sent' });
  const sender = { send } as unknown as IEmailSender;

  const logger: ILogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  const clock: IClock = { now: () => NOW.getTime(), sleep: async () => {} };

  const service = new BookingConfirmationNotificationService(
    bookings,
    sender,
    clock,
    logger,
    options.origin === undefined ? ORIGIN : options.origin
  );

  return { service, send, findForConfirmationEmail, markConfirmationEmailSent, logger };
}

/** Everything that must never appear in a log line from this service. */
function assertNoSecrets(logger: ILogger): void {
  const calls = [
    ...(logger.info as ReturnType<typeof vi.fn>).mock.calls,
    ...(logger.warn as ReturnType<typeof vi.fn>).mock.calls,
    ...(logger.error as ReturnType<typeof vi.fn>).mock.calls,
  ];
  const serialized = JSON.stringify(calls);

  for (const secret of [
    'ana@example.com',
    'Ana Pérez',
    'tok-abc123',
    '/reserva/',
    'Barbería Central',
  ]) {
    expect(serialized).not.toContain(secret);
  }
}

describe('BookingConfirmationNotificationService - the happy path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should_send_the_message_composed_from_the_projection', async () => {
    // Arrange
    const { service, send } = build();

    // Act
    await service.notifyConfirmed(BOOKING);

    // Assert
    expect(send).toHaveBeenCalledTimes(1);
    const message = send.mock.calls[0][0];
    expect(message.to).toBe('ana@example.com');
    expect(message.text).toContain(`${ORIGIN}/b/barberia-central/reserva/tok-abc123`);
  });

  it('should_record_the_send_instant_from_the_injected_clock', async () => {
    // Arrange
    const { service, markConfirmationEmailSent } = build();

    // Act
    await service.notifyConfirmed(BOOKING);

    // Assert
    expect(markConfirmationEmailSent).toHaveBeenCalledWith(BOOKING, NOW);
  });

  it('should_log_the_outcome_without_any_personal_data', async () => {
    // Arrange
    const { service, logger } = build();

    // Act
    await service.notifyConfirmed(BOOKING);

    // Assert
    expect(logger.info).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ operation: 'email.bookingConfirmation', bookingId: BOOKING })
    );
    assertNoSecrets(logger);
  });
});

describe('BookingConfirmationNotificationService - failures are never fatal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  for (const outcome of ['rejected', 'throttled', 'retry'] as const) {
    it(`should_not_record_a_send_instant_when_the_provider_reports_${outcome}`, async () => {
      // Arrange
      const { service, markConfirmationEmailSent } = build({ outcome });

      // Act
      await service.notifyConfirmed(BOOKING);

      // Assert
      expect(markConfirmationEmailSent).not.toHaveBeenCalled();
    });

    it(`should_log_${outcome}_as_its_own_distinguishable_outcome`, async () => {
      // Arrange
      const { service, logger } = build({ outcome });

      // Act
      await service.notifyConfirmed(BOOKING);

      // Assert
      expect(logger.error).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ operation: 'email.bookingConfirmation', outcome })
      );
      assertNoSecrets(logger);
    });
  }

  it('should_resolve_normally_when_the_provider_fails', async () => {
    // Arrange: the contract both callers depend on.
    const { service } = build({ outcome: 'retry' });

    // Act & Assert
    await expect(service.notifyConfirmed(BOOKING)).resolves.toBeUndefined();
  });

  it('should_swallow_a_failure_of_the_recording_write', async () => {
    // Arrange: a booking must not become unconfirmed because a bookkeeping
    // write failed.
    const { service, logger } = build({ markFails: true });

    // Act & Assert
    await expect(service.notifyConfirmed(BOOKING)).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalled();
    assertNoSecrets(logger);
  });

  it('should_swallow_a_failure_of_the_projection_read', async () => {
    // Arrange: the transition has already committed by the time this runs.
    const { service, send } = build({ findFails: true });

    // Act & Assert
    await expect(service.notifyConfirmed(BOOKING)).resolves.toBeUndefined();
    expect(send).not.toHaveBeenCalled();
  });

  it('should_report_an_empty_projection_without_sending_anything', async () => {
    // Arrange
    const { service, send, logger } = build({ projection: null });

    // Act
    await service.notifyConfirmed(BOOKING);

    // Assert
    expect(send).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ reason: 'projectionEmpty' })
    );
  });
});

describe('BookingConfirmationNotificationService - the origin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should_still_send_when_no_origin_is_configured', async () => {
    // Arrange: a client who paid is owed the confirmation regardless.
    const { service, send } = build({ origin: null });

    // Act
    await service.notifyConfirmed(BOOKING);

    // Assert
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('should_omit_the_link_and_the_token_when_no_origin_is_configured', async () => {
    // Arrange
    const { service, send } = build({ origin: null });

    // Act
    await service.notifyConfirmed(BOOKING);

    // Assert
    const message = send.mock.calls[0][0];
    expect(message.text).not.toContain('tok-abc123');
    expect(message.html).not.toContain('tok-abc123');
  });

  it('should_log_the_missing_origin_as_its_own_reason', async () => {
    // Arrange
    const { service, logger } = build({ origin: null });

    // Act
    await service.notifyConfirmed(BOOKING);

    // Assert
    expect(logger.error).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ reason: 'originMissing' })
    );
    assertNoSecrets(logger);
  });

  it('should_refuse_a_loopback_origin_and_send_without_a_link', async () => {
    // Arrange: B5 measured what an unreachable origin costs on the payment
    // path. In an inbox the mistake cannot be redeployed away at all.
    const { service, send, logger } = build({ origin: 'http://localhost:8787' });

    // Act
    await service.notifyConfirmed(BOOKING);

    // Assert
    const message = send.mock.calls[0][0];
    expect(message.text).not.toContain('localhost');
    expect(message.text).not.toContain('tok-abc123');
    expect(logger.error).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ reason: 'originMissing' })
    );
  });

  it('should_refuse_a_private_network_origin', async () => {
    // Arrange
    const { service, send } = build({ origin: 'https://192.168.1.10:3000' });

    // Act
    await service.notifyConfirmed(BOOKING);

    // Assert
    expect(send.mock.calls[0][0].text).not.toContain('192.168');
  });
});
