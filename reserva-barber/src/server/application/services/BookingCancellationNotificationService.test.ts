import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BookingCancellationNotificationService } from './BookingCancellationNotificationService';
import type { IBookingRepository } from '@/server/domain/repositories/IBookingRepository';
import type { IEmailSender, EmailSendOutcome } from '@/server/domain/repositories/IEmailSender';
import type { ILogger } from '@/server/domain/repositories/ILogger';

const BOOKING = 'bkg-1';

/**
 * The confirmation's projection, reused rather than duplicated — deliberately
 * wider than the notice needs, carrying a slug and a token the builder's own
 * input type has no field for.
 */
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
    findFails?: boolean;
  } = {}
) {
  const findForConfirmationEmail = options.findFails
    ? vi.fn().mockRejectedValue(new Error('pooler timeout'))
    : vi.fn().mockResolvedValue(options.projection === undefined ? PROJECTION : options.projection);

  const bookings = { findForConfirmationEmail } as unknown as IBookingRepository;

  const send = vi.fn().mockResolvedValue({ outcome: options.outcome ?? 'sent' });
  const sender = { send } as unknown as IEmailSender;

  const logger: ILogger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

  return {
    service: new BookingCancellationNotificationService(bookings, sender, logger),
    send,
    findForConfirmationEmail,
    logger,
  };
}

function loggedText(logger: ILogger): string {
  return JSON.stringify([
    ...(logger.info as ReturnType<typeof vi.fn>).mock.calls,
    ...(logger.error as ReturnType<typeof vi.fn>).mock.calls,
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('BookingCancellationNotificationService - the message', () => {
  it('should_send_one_message_addressed_to_the_client', async () => {
    // Arrange
    const { service, send } = build();

    // Act
    await service.notifyCancelled(BOOKING, false);

    // Assert
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].to).toBe('ana@example.com');
  });

  it('should_carry_no_link_and_no_token_even_though_the_projection_has_one', async () => {
    // Arrange: the projection is the confirmation's and carries both. The
    // builder's input type omits them, so they are unreachable rather than
    // merely unused — a cancelled booking has nothing for its client to do on
    // the page, and that token is a credential (T69).
    const { service, send } = build();

    // Act
    await service.notifyCancelled(BOOKING, false);

    // Assert
    const message = send.mock.calls[0][0];
    expect(message.text).not.toContain('tok-abc123');
    expect(message.html).not.toContain('tok-abc123');
    expect(message.text).not.toContain('barberia-central');
    expect(message.text).not.toMatch(/https?:/);
  });

  it('should_mention_the_deposit_only_when_one_was_approved', async () => {
    // Arrange
    const withMoney = build();
    const withoutMoney = build();

    // Act
    await withMoney.service.notifyCancelled(BOOKING, true);
    await withoutMoney.service.notifyCancelled(BOOKING, false);

    // Assert
    expect(withMoney.send.mock.calls[0][0].text).toContain('2.000,50');
    expect(withoutMoney.send.mock.calls[0][0].text).not.toContain('2.000,50');
  });
});

describe('BookingCancellationNotificationService - failures are never fatal', () => {
  it.each(['rejected', 'throttled', 'retry'] as const)(
    'should_resolve_normally_when_the_provider_reports_%s',
    async (outcome) => {
      // Arrange
      const { service, logger } = build({ outcome });

      // Act & Assert
      await expect(service.notifyCancelled(BOOKING, false)).resolves.toBeUndefined();
      expect(logger.error).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ operation: 'email.bookingCancellation', outcome })
      );
    }
  );

  it('should_swallow_a_failure_of_the_projection_read', async () => {
    // Arrange: the cancellation has already committed and the slot is already
    // released by the time this runs.
    const { service, send } = build({ findFails: true });

    // Act & Assert
    await expect(service.notifyCancelled(BOOKING, false)).resolves.toBeUndefined();
    expect(send).not.toHaveBeenCalled();
  });

  it('should_report_an_empty_projection_without_sending_anything', async () => {
    // Arrange
    const { service, send, logger } = build({ projection: null });

    // Act
    await service.notifyCancelled(BOOKING, false);

    // Assert
    expect(send).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ reason: 'projectionEmpty' })
    );
  });
});

describe('BookingCancellationNotificationService - the observability contract', () => {
  it.each([
    ['a successful send', 'sent'],
    ['a refused send', 'rejected'],
  ] as const)('should_carry_no_personal_data_after_%s', async (_label, outcome) => {
    // Arrange
    const { service, logger } = build({ outcome });

    // Act
    await service.notifyCancelled(BOOKING, true);

    // Assert
    const logged = loggedText(logger);
    for (const secret of ['ana@example.com', 'Ana Pérez', 'tok-abc123', 'barberia-central']) {
      expect(logged).not.toContain(secret);
    }
    expect(logged).toContain(BOOKING);
  });

  /**
   * The absence is the design (D5). A confirmation is a promise the product
   * made, so "confirmed and never told" is worth being able to query; a
   * cancellation notice is a courtesy, and a second nullable column with no
   * reader would copy N1's shape without its reason.
   */
  it('should_record_no_instant_and_need_no_clock', async () => {
    // Arrange
    const { service, findForConfirmationEmail } = build();
    const bookings = findForConfirmationEmail.mock;

    // Act
    await service.notifyCancelled(BOOKING, false);

    // Assert
    expect(bookings.calls).toHaveLength(1);
    expect(BookingCancellationNotificationService.length).toBe(3);
  });
});
