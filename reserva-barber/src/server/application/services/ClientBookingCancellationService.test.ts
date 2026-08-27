import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ClientBookingCancellationService } from './ClientBookingCancellationService';
import type {
  IBookingRepository,
  CancelBookingByTokenResult,
} from '@/server/domain/repositories/IBookingRepository';
import type { ILogger } from '@/server/domain/repositories/ILogger';
import type { IClock } from '@/server/domain/repositories/IClock';

const TOKEN = 'tok-abc123';
const BOOKING = 'bkg-1';
const SLUG = 'barberia-uno';
const NOW = new Date('2026-08-27T12:00:00.000Z');

const APPLIED: CancelBookingByTokenResult = {
  outcome: 'applied',
  bookingId: BOOKING,
  slug: SLUG,
  depositApproved: false,
};

function build(result: CancelBookingByTokenResult = APPLIED) {
  const cancelByToken = vi.fn().mockResolvedValue(result);
  const bookings = { cancelByToken } as unknown as IBookingRepository;

  const logger: ILogger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const clock: IClock = { now: () => NOW.getTime(), sleep: async () => {} };

  return {
    service: new ClientBookingCancellationService(bookings, clock, logger),
    cancelByToken,
    logger,
  };
}

const linesOf = (logger: ILogger) => [
  ...(logger.debug as ReturnType<typeof vi.fn>).mock.calls,
  ...(logger.info as ReturnType<typeof vi.fn>).mock.calls,
  ...(logger.warn as ReturnType<typeof vi.fn>).mock.calls,
  ...(logger.error as ReturnType<typeof vi.fn>).mock.calls,
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ClientBookingCancellationService - what it asks the write for', () => {
  it('should_pass_the_token_and_the_clock_instant', async () => {
    const { service, cancelByToken } = build();

    await service.cancel(TOKEN);

    expect(cancelByToken).toHaveBeenCalledWith({ cancellationToken: TOKEN, now: NOW });
  });

  it('should_not_decide_eligibility_itself', async () => {
    // The domain predicate answers for the page and the repository answers
    // again under the statement that writes. A third opinion here would be a
    // third chance to disagree.
    const { service, cancelByToken } = build({
      outcome: 'notCancellable',
      bookingId: BOOKING,
      slug: SLUG,
      status: 'CONFIRMED',
      reason: 'noLongerCancellable',
    });

    await service.cancel(TOKEN);

    expect(cancelByToken).toHaveBeenCalledTimes(1);
  });
});

describe('ClientBookingCancellationService - the outcomes it reports', () => {
  it('should_report_a_cancellation_with_the_slug_to_return_to', async () => {
    const { service } = build();

    await expect(service.cancel(TOKEN)).resolves.toEqual({ outcome: 'cancelled', slug: SLUG });
  });

  it('should_report_a_started_appointment_as_its_own_refusal', async () => {
    const { service } = build({
      outcome: 'notCancellable',
      bookingId: BOOKING,
      slug: SLUG,
      status: 'CONFIRMED',
      reason: 'alreadyStarted',
    });

    await expect(service.cancel(TOKEN)).resolves.toEqual({
      outcome: 'notCancellable',
      slug: SLUG,
      reason: 'alreadyStarted',
    });
  });

  it('should_report_a_booking_that_moved_as_the_generic_refusal', async () => {
    const { service } = build({
      outcome: 'notCancellable',
      bookingId: BOOKING,
      slug: SLUG,
      status: 'EXPIRED',
      reason: 'noLongerCancellable',
    });

    await expect(service.cancel(TOKEN)).resolves.toEqual({
      outcome: 'notCancellable',
      slug: SLUG,
      reason: 'noLongerCancellable',
    });
  });

  it('should_report_a_token_matching_nothing_without_a_destination', async () => {
    const { service } = build({ outcome: 'notFound' });

    await expect(service.cancel(TOKEN)).resolves.toEqual({ outcome: 'notFound' });
  });

  it('should_not_expose_the_status_it_was_told', async () => {
    // The repository reports the status so an operator can read it; the client
    // is told what they can act on. Leaking it into the caller's result is one
    // edit away from rendering it.
    const { service } = build({
      outcome: 'notCancellable',
      bookingId: BOOKING,
      slug: SLUG,
      status: 'CONFIRMED',
      reason: 'noLongerCancellable',
    });

    const result = await service.cancel(TOKEN);

    expect(result).not.toHaveProperty('status');
  });
});

describe('ClientBookingCancellationService - what it logs', () => {
  it('should_record_one_line_for_an_applied_cancellation', async () => {
    const { service, logger } = build();

    await service.cancel(TOKEN);

    expect(linesOf(logger)).toHaveLength(1);
    expect(logger.info).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ operation: 'booking.cancelByClient', outcome: 'cancelled' })
    );
  });

  it('should_record_one_line_for_a_refusal_and_name_the_status', async () => {
    const { service, logger } = build({
      outcome: 'notCancellable',
      bookingId: BOOKING,
      slug: SLUG,
      status: 'EXPIRED',
      reason: 'noLongerCancellable',
    });

    await service.cancel(TOKEN);

    expect(linesOf(logger)).toHaveLength(1);
    expect(logger.info).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ status: 'EXPIRED', reason: 'noLongerCancellable' })
    );
  });

  /**
   * The cardinality bound, and the reason it exists.
   *
   * This endpoint is public, unauthenticated and unmetered. A line per request
   * is log volume any stranger can generate at will — the defect N1's
   * adversarial pass found on the confirmation-email path one story earlier,
   * beside a comment asserting the opposite. Every other outcome here requires
   * a real, unguessable token; this one is the only one an anonymous caller can
   * reach, so it is the only one that must cost nothing.
   */
  it('should_record_nothing_for_a_token_that_resolves_nothing', async () => {
    const { service, logger } = build({ outcome: 'notFound' });

    await service.cancel(TOKEN);

    expect(linesOf(logger)).toHaveLength(0);
  });

  it('should_not_grow_its_log_volume_with_forged_attempts', async () => {
    const { service, logger } = build({ outcome: 'notFound' });

    for (let i = 0; i < 50; i += 1) {
      await service.cancel(`forged-${i}`);
    }

    expect(linesOf(logger)).toHaveLength(0);
  });

  it('should_never_log_an_error_for_a_resolution_miss', async () => {
    // From outside, a forged token and a deleted booking are the same fact and
    // neither is a fault.
    const { service, logger } = build({ outcome: 'notFound' });

    await service.cancel(TOKEN);

    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('should_never_log_the_token_or_anything_about_the_person', async () => {
    // Structural as much as asserted: this service is handed one string it
    // never logs and a result carrying no contact detail, so there is nothing
    // here for a later change to log by accident.
    const { service, logger } = build();

    await service.cancel(TOKEN);

    const lines = JSON.stringify(linesOf(logger));
    expect(lines).not.toContain(TOKEN);
    expect(lines).not.toContain('Ana Pérez');
    expect(lines).not.toContain('ana@example.com');
  });

  it('should_not_log_the_slug_either', async () => {
    // The slug is a destination, not a fact worth recording, and it identifies
    // the shop on a line that already identifies the booking.
    const { service, logger } = build();

    await service.cancel(TOKEN);

    expect(JSON.stringify(linesOf(logger))).not.toContain(SLUG);
  });
});
