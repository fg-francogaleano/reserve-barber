import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BookingCancellationService } from './BookingCancellationService';
import type { IBookingRepository, CancelBookingResult } from '@/server/domain/repositories/IBookingRepository';
import type { ILogger } from '@/server/domain/repositories/ILogger';
import type { IClock } from '@/server/domain/repositories/IClock';

const BOOKING = 'bkg-1';
const OWNER = 'own-1';
const NOW = new Date('2026-08-26T12:00:00.000Z');

function build(result: CancelBookingResult = { outcome: 'applied', bookingId: BOOKING, depositApproved: false }) {
  const cancelByOwner = vi.fn().mockResolvedValue(result);
  const bookings = { cancelByOwner } as unknown as IBookingRepository;

  const logger: ILogger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const clock: IClock = { now: () => NOW.getTime(), sleep: async () => {} };

  const notifyCancelled = vi.fn().mockResolvedValue(undefined);
  const notifications = { notifyCancelled } as never;

  return {
    service: new BookingCancellationService(bookings, clock, logger, notifications),
    cancelByOwner,
    notifyCancelled,
    logger,
  };
}

/** Everything a log line from this service must never carry. */
function assertNoPersonalData(logger: ILogger): void {
  const calls = JSON.stringify([
    ...(logger.info as ReturnType<typeof vi.fn>).mock.calls,
    ...(logger.warn as ReturnType<typeof vi.fn>).mock.calls,
    ...(logger.error as ReturnType<typeof vi.fn>).mock.calls,
  ]);
  for (const secret of ['Ana Pérez', 'ana@example.com', '+5491133334444', 'tok-abc123']) {
    expect(calls).not.toContain(secret);
  }
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('BookingCancellationService - the applied path', () => {
  it('should_pass_the_owner_scope_and_the_clock_instant_to_the_write', async () => {
    // Arrange
    const { service, cancelByOwner } = build();

    // Act
    await service.cancel(BOOKING, OWNER);

    // Assert
    expect(cancelByOwner).toHaveBeenCalledWith({ bookingId: BOOKING, ownerId: OWNER, now: NOW });
  });

  it('should_report_a_cancellation_the_action_can_render', async () => {
    // Arrange
    const { service } = build();

    // Act
    const result = await service.cancel(BOOKING, OWNER);

    // Assert
    expect(result).toEqual({ outcome: 'cancelled' });
  });

  it('should_not_leak_the_deposit_flag_to_its_caller', async () => {
    // Arrange: `depositApproved` exists for the client's notice, which is this
    // service's business and not the dashboard's. A field the UI does not need
    // is a field a later change can render by accident.
    const { service } = build({ outcome: 'applied', bookingId: BOOKING, depositApproved: true });

    // Act
    const result = await service.cancel(BOOKING, OWNER);

    // Assert
    expect(Object.keys(result)).toEqual(['outcome']);
  });

  it('should_log_the_cancellation_with_the_booking_and_the_outcome', async () => {
    // Arrange
    const { service, logger } = build();

    // Act
    await service.cancel(BOOKING, OWNER);

    // Assert
    expect(logger.info).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ operation: 'booking.cancel', bookingId: BOOKING, outcome: 'cancelled' })
    );
  });
});

describe('BookingCancellationService - the refusals', () => {
  it('should_report_the_status_it_found_when_the_booking_moved', async () => {
    // Arrange: confirmed by a notification between the read and the write.
    const { service } = build({ outcome: 'notCancellable', status: 'CONFIRMED' });

    // Act
    const result = await service.cancel(BOOKING, OWNER);

    // Assert
    expect(result).toEqual({ outcome: 'notCancellable', status: 'CONFIRMED' });
  });

  it('should_report_a_scope_miss_as_notFound', async () => {
    // Arrange
    const { service } = build({ outcome: 'notFound' });

    // Act
    const result = await service.cancel(BOOKING, OWNER);

    // Assert
    expect(result).toEqual({ outcome: 'notFound' });
  });

  /**
   * From outside, a booking belonging to another owner and one that never
   * existed are the same answer, and neither is a fault of this system. Logging
   * a scope miss as an error would make the server's own noise the oracle the
   * response refuses to be — the rule the receipt review already follows.
   */
  it('should_log_a_scope_miss_at_information_level_and_never_as_an_error', async () => {
    // Arrange
    const { service, logger } = build({ outcome: 'notFound' });

    // Act
    await service.cancel(BOOKING, OWNER);

    // Assert
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ operation: 'booking.cancel', outcome: 'notFound' })
    );
  });

  it('should_log_a_guarded_miss_at_information_level_too', async () => {
    // Arrange: an owner double-clicking is not a fault either.
    const { service, logger } = build({ outcome: 'notCancellable', status: 'EXPIRED' });

    // Act
    await service.cancel(BOOKING, OWNER);

    // Assert
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ outcome: 'notCancellable', status: 'EXPIRED' })
    );
  });
});

describe('BookingCancellationService - the observability contract', () => {
  it.each([
    ['applied', { outcome: 'applied', bookingId: BOOKING, depositApproved: true }],
    ['notCancellable', { outcome: 'notCancellable', status: 'CONFIRMED' }],
    ['notFound', { outcome: 'notFound' }],
  ] as const)('should_carry_no_personal_data_on_the_%s_path', async (_label, result) => {
    // Arrange
    const { service, logger } = build(result as CancelBookingResult);

    // Act
    await service.cancel(BOOKING, OWNER);

    // Assert
    assertNoPersonalData(logger);
  });

  it('should_never_read_client_data_at_all', async () => {
    // Arrange: the structural form of the rule above. This service is given a
    // booking id and an owner id, and a projection it never requests cannot be
    // logged by a later change.
    const { service, cancelByOwner } = build();

    // Act
    await service.cancel(BOOKING, OWNER);

    // Assert
    const args = JSON.stringify(cancelByOwner.mock.calls[0][0]);
    expect(args).not.toContain('client');
    expect(args).not.toContain('token');
  });
});

/**
 * The cancellation notice, and the trigger rule it shares with the confirmation.
 */
describe('BookingCancellationService - telling the client', () => {
  it('should_notify_only_when_the_guarded_write_actually_applied', async () => {
    // Arrange
    const { service, notifyCancelled } = build();

    // Act
    await service.cancel(BOOKING, OWNER);

    // Assert
    expect(notifyCancelled).toHaveBeenCalledExactlyOnceWith(BOOKING, false);
  });

  it('should_pass_the_deposit_answer_the_transaction_gave', async () => {
    // Arrange: asked inside the write, where it has no race — the message uses
    // it to decide whether to mention money at all.
    const { service, notifyCancelled } = build({
      outcome: 'applied',
      bookingId: BOOKING,
      depositApproved: true,
    });

    // Act
    await service.cancel(BOOKING, OWNER);

    // Assert
    expect(notifyCancelled).toHaveBeenCalledWith(BOOKING, true);
  });

  it.each([
    ['a booking that moved', { outcome: 'notCancellable', status: 'CONFIRMED' }],
    ['a scope miss', { outcome: 'notFound' }],
  ] as const)('should_notify_nobody_on_%s', async (_label, result) => {
    // Arrange: keyed on the write applying, never on the booking's status —
    // otherwise a second submission would announce the same cancellation again.
    const { service, notifyCancelled } = build(result as CancelBookingResult);

    // Act
    await service.cancel(BOOKING, OWNER);

    // Assert
    expect(notifyCancelled).not.toHaveBeenCalled();
  });

  it('should_still_report_the_cancellation_when_the_provider_is_down', async () => {
    // Arrange: the notification service is specified never to throw; this
    // proves the caller survives if that contract is ever broken. A mail
    // provider must not be able to undo a scheduling decision.
    const { service, notifyCancelled } = build();
    notifyCancelled.mockRejectedValue(new Error('provider down'));

    // Act
    const result = await service.cancel(BOOKING, OWNER);

    // Assert
    expect(result).toEqual({ outcome: 'cancelled' });
  });

  it('should_log_that_failure_without_any_personal_data', async () => {
    // Arrange
    const { service, notifyCancelled, logger } = build();
    notifyCancelled.mockRejectedValue(new Error('ana@example.com was rejected'));

    // Act
    await service.cancel(BOOKING, OWNER);

    // Assert
    expect(logger.error).toHaveBeenCalled();
    assertNoPersonalData(logger);
    expect(JSON.stringify((logger.error as ReturnType<typeof vi.fn>).mock.calls)).not.toContain(
      'ana@example.com'
    );
  });
});
