import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  ExpiredHoldSweepService,
  MAX_BATCHES_PER_RULE,
  SWEEP_BATCH_SIZE,
} from './ExpiredHoldSweepService';
import type {
  ExpirableBooking,
  ExpiredBookingWithApprovedPayment,
  IExpiredHoldRepository,
} from '@/server/domain/repositories/IExpiredHoldRepository';
import type { IClock } from '@/server/domain/repositories/IClock';
import type { ILogger } from '@/server/domain/repositories/ILogger';
import { EXPIRY_GRACE_MINUTES } from '@/server/domain/models/bookingHorizon';

const NOW = new Date('2026-08-23T15:00:00.000Z');

const minutesAgo = (n: number): Date => new Date(NOW.getTime() - n * 60_000);
const minutesAhead = (n: number): Date => new Date(NOW.getTime() + n * 60_000);

function lapsedHold(overrides: Partial<ExpirableBooking> = {}): ExpirableBooking {
  return {
    id: 'booking-lapsed',
    status: 'PENDING_PAYMENT',
    startTime: minutesAhead(600),
    endTime: minutesAhead(630),
    holdExpiresAt: minutesAgo(EXPIRY_GRACE_MINUTES + 5),
    ...overrides,
  };
}

function unansweredReceipt(overrides: Partial<ExpirableBooking> = {}): ExpirableBooking {
  return {
    id: 'booking-receipt',
    status: 'PENDING_APPROVAL',
    startTime: minutesAgo(30),
    endTime: minutesAgo(0),
    holdExpiresAt: minutesAgo(500),
    ...overrides,
  };
}

interface Harness {
  service: ExpiredHoldSweepService;
  repository: {
    findLapsedHolds: ReturnType<typeof vi.fn>;
    findUnansweredReceipts: ReturnType<typeof vi.fn>;
    expire: ReturnType<typeof vi.fn>;
    findApprovedPaymentsFor: ReturnType<typeof vi.fn>;
  };
  logger: {
    debug: ReturnType<typeof vi.fn>;
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };
}

function harness(): Harness {
  const repository = {
    findLapsedHolds: vi.fn().mockResolvedValue([]),
    findUnansweredReceipts: vi.fn().mockResolvedValue([]),
    expire: vi.fn().mockImplementation(({ ids }: { ids: readonly string[] }) => ids.length),
    findApprovedPaymentsFor: vi.fn().mockResolvedValue([] as ExpiredBookingWithApprovedPayment[]),
  };
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const clock: IClock = { now: () => NOW.getTime(), sleep: async () => {} };

  return {
    service: new ExpiredHoldSweepService(
      repository as unknown as IExpiredHoldRepository,
      clock,
      logger as unknown as ILogger
    ),
    repository,
    logger,
  };
}

/** The ids handed to the write, flattened across every call. */
function expiredIds(repository: Harness['repository']): string[] {
  return repository.expire.mock.calls.flatMap((call) => [...call[0].ids]);
}

describe('ExpiredHoldSweepService - which bookings it expires', () => {
  let h: Harness;

  beforeEach(() => {
    h = harness();
  });

  // The grace window is the whole reason this story is safe to ship: the
  // Mercado Pago confirmation that rescues a paid booking is guarded on the
  // status this sweep would otherwise have already overwritten.
  it('should_not_expire_a_hold_that_lapsed_inside_the_grace_window', async () => {
    h.repository.findLapsedHolds.mockResolvedValueOnce([
      lapsedHold({ holdExpiresAt: minutesAgo(3) }),
    ]);

    await h.service.sweep();

    expect(h.repository.expire).not.toHaveBeenCalled();
  });

  it('should_expire_a_hold_that_lapsed_before_the_grace_cutoff', async () => {
    h.repository.findLapsedHolds.mockResolvedValueOnce([lapsedHold()]);

    const summary = await h.service.sweep();

    expect(expiredIds(h.repository)).toEqual(['booking-lapsed']);
    expect(summary.expiredPendingPayment).toBe(1);
  });

  it('should_ask_the_repository_for_candidates_using_the_grace_cutoff', async () => {
    await h.service.sweep();

    const { cutoff } = h.repository.findLapsedHolds.mock.calls[0][0];
    expect(NOW.getTime() - cutoff.getTime()).toBe(EXPIRY_GRACE_MINUTES * 60_000);
  });

  it('should_not_expire_a_receipt_whose_appointment_has_not_started', async () => {
    h.repository.findUnansweredReceipts.mockResolvedValueOnce([
      unansweredReceipt({ startTime: minutesAhead(120), endTime: minutesAhead(150) }),
    ]);

    await h.service.sweep();

    expect(h.repository.expire).not.toHaveBeenCalled();
  });

  it('should_expire_a_receipt_whose_appointment_has_passed', async () => {
    h.repository.findUnansweredReceipts.mockResolvedValueOnce([unansweredReceipt()]);

    const summary = await h.service.sweep();

    expect(expiredIds(h.repository)).toEqual(['booking-receipt']);
    expect(summary.expiredPendingApproval).toBe(1);
  });

  // `holdExpiresAt` is the deadline for uploading a receipt, never for
  // answering one. A receipt whose upload window lapsed weeks ago still blocks
  // its slot while the appointment is in the future.
  it('should_never_use_the_upload_deadline_to_expire_a_receipt', async () => {
    h.repository.findUnansweredReceipts.mockResolvedValueOnce([
      unansweredReceipt({ startTime: minutesAhead(60), holdExpiresAt: minutesAgo(10_000) }),
    ]);

    await h.service.sweep();

    expect(h.repository.expire).not.toHaveBeenCalled();
    expect(h.repository.findUnansweredReceipts.mock.calls[0][0].now).toEqual(NOW);
  });

  // The predicate answers `false` for these too, so it is the candidate query's
  // status filter that confines the sweep. If one ever leaked through, the
  // guarded write must still refuse it.
  it.each(['CONFIRMED', 'CANCELLED', 'EXPIRED'] as const)(
    'should_never_expire_a_%s_booking_that_leaked_into_a_candidate_page',
    async (status) => {
      h.repository.findLapsedHolds.mockResolvedValueOnce([
        lapsedHold({ id: `booking-${status}`, status }),
      ]);

      await h.service.sweep();

      expect(expiredIds(h.repository)).not.toContain(`booking-${status}`);
    }
  );

  it('should_write_each_rule_under_the_status_it_expects', async () => {
    h.repository.findLapsedHolds.mockResolvedValueOnce([lapsedHold()]);
    h.repository.findUnansweredReceipts.mockResolvedValueOnce([unansweredReceipt()]);

    await h.service.sweep();

    const statuses = h.repository.expire.mock.calls.map((call) => call[0].expectedStatus);
    expect(statuses).toEqual(['PENDING_PAYMENT', 'PENDING_APPROVAL']);
  });

  // The two rules are disjoint by status, so the clamp boundary
  // (`holdExpiresAt === startTime`, which `holdExpiresAtFor` can produce) can
  // only ever match one of them. Double-counting is impossible by construction.
  it('should_count_a_clamp_boundary_booking_once', async () => {
    const at = minutesAgo(90);
    h.repository.findLapsedHolds.mockResolvedValueOnce([
      lapsedHold({ id: 'booking-clamped', startTime: at, endTime: at, holdExpiresAt: at }),
    ]);

    const summary = await h.service.sweep();

    expect(expiredIds(h.repository)).toEqual(['booking-clamped']);
    expect(summary.expiredPendingPayment + summary.expiredPendingApproval).toBe(1);
  });
});

describe('ExpiredHoldSweepService - batching and idempotence', () => {
  let h: Harness;

  beforeEach(() => {
    h = harness();
  });

  const fullPage = (offset: number): ExpirableBooking[] =>
    Array.from({ length: SWEEP_BATCH_SIZE }, (_, i) => lapsedHold({ id: `booking-${offset + i}` }));

  it('should_stop_after_a_short_page_rather_than_asking_again', async () => {
    h.repository.findLapsedHolds.mockResolvedValueOnce([lapsedHold()]);

    await h.service.sweep();

    expect(h.repository.findLapsedHolds).toHaveBeenCalledTimes(1);
  });

  it('should_ask_again_after_a_full_page', async () => {
    h.repository.findLapsedHolds
      .mockResolvedValueOnce(fullPage(0))
      .mockResolvedValueOnce([lapsedHold({ id: 'booking-last' })]);

    const summary = await h.service.sweep();

    expect(h.repository.findLapsedHolds).toHaveBeenCalledTimes(2);
    expect(summary.expiredPendingPayment).toBe(SWEEP_BATCH_SIZE + 1);
  });

  // The first production run meets every abandoned hold ever created,
  // including everything the gate scripts left behind. It must leave a
  // remainder rather than face it in one invocation.
  it('should_leave_a_remainder_once_the_per_run_cap_is_reached', async () => {
    h.repository.findLapsedHolds.mockImplementation(async () => fullPage(0));

    const summary = await h.service.sweep();

    expect(h.repository.findLapsedHolds).toHaveBeenCalledTimes(MAX_BATCHES_PER_RULE);
    expect(summary.expiredPendingPayment).toBe(SWEEP_BATCH_SIZE * MAX_BATCHES_PER_RULE);
  });

  it('should_never_request_more_than_the_batch_size', async () => {
    await h.service.sweep();

    expect(h.repository.findLapsedHolds.mock.calls[0][0].limit).toBe(SWEEP_BATCH_SIZE);
    expect(h.repository.findUnansweredReceipts.mock.calls[0][0].limit).toBe(SWEEP_BATCH_SIZE);
  });

  // A booking that moved underneath the run — a receipt attached, a payment
  // confirmed — matches zero rows. That is an ordinary outcome of a job with no
  // lock, not a failure, and it must not be counted as an expiry.
  it('should_treat_a_guarded_update_matching_nothing_as_not_swept', async () => {
    h.repository.findLapsedHolds.mockResolvedValueOnce([lapsedHold()]);
    h.repository.expire.mockResolvedValueOnce(0);

    const summary = await h.service.sweep();

    expect(summary.expiredPendingPayment).toBe(0);
    expect(h.logger.error).not.toHaveBeenCalled();
  });

  it('should_sweep_nothing_on_a_second_run_over_the_same_rows', async () => {
    h.repository.findLapsedHolds.mockResolvedValueOnce([lapsedHold()]);
    await h.service.sweep();

    h.repository.expire.mockClear();
    const second = await h.service.sweep();

    expect(h.repository.expire).not.toHaveBeenCalled();
    expect(second.expiredPendingPayment).toBe(0);
  });

  it('should_take_one_instant_for_the_whole_run', async () => {
    const ticking = { value: NOW.getTime() };
    const clock: IClock = {
      now: () => {
        ticking.value += 60_000;
        return ticking.value;
      },
      sleep: async () => {},
    };
    const repository = {
      findLapsedHolds: vi.fn().mockResolvedValue([]),
      findUnansweredReceipts: vi.fn().mockResolvedValue([]),
      expire: vi.fn(),
      findApprovedPaymentsFor: vi.fn().mockResolvedValue([]),
    };
    const service = new ExpiredHoldSweepService(
      repository as unknown as IExpiredHoldRepository,
      clock,
      { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as ILogger
    );

    await service.sweep();

    const cutoff: Date = repository.findLapsedHolds.mock.calls[0][0].cutoff;
    const receiptsNow: Date = repository.findUnansweredReceipts.mock.calls[0][0].now;
    expect(receiptsNow.getTime() - cutoff.getTime()).toBe(EXPIRY_GRACE_MINUTES * 60_000);
  });
});

describe('ExpiredHoldSweepService - the sweep is not owner-scoped and must prove it', () => {
  // Nothing in the contract confines this query to one shop, so the property is
  // held by test instead: the service passes on exactly the ids the candidate
  // read returned, and never widens the set it was given.
  it('should_expire_only_the_candidates_it_was_given', async () => {
    const h = harness();
    h.repository.findLapsedHolds.mockResolvedValueOnce([
      lapsedHold({ id: 'owner-a-abandoned' }),
      lapsedHold({ id: 'owner-b-live', holdExpiresAt: minutesAhead(5) }),
      lapsedHold({ id: 'owner-b-confirmed', status: 'CONFIRMED' }),
    ]);

    await h.service.sweep();

    expect(expiredIds(h.repository)).toEqual(['owner-a-abandoned']);
  });
});

describe('ExpiredHoldSweepService - what the run reports', () => {
  let h: Harness;

  beforeEach(() => {
    h = harness();
  });

  // The defining property of this job is that its failure is invisible: if it
  // never runs, every page still works. Silence must not also be its success
  // mode.
  it('should_emit_one_summary_even_when_it_expires_nothing', async () => {
    await h.service.sweep();

    expect(h.logger.info).toHaveBeenCalledTimes(1);
    const [, context] = h.logger.info.mock.calls[0];
    expect(context).toMatchObject({
      operation: 'booking.sweepExpiredHolds',
      candidatesScanned: 0,
      expiredPendingPayment: 0,
      expiredPendingApproval: 0,
    });
    expect(context.batches).toBeTypeOf('number');
    expect(context.durationMs).toBeTypeOf('number');
  });

  it('should_report_what_it_scanned_and_what_it_expired', async () => {
    h.repository.findLapsedHolds.mockResolvedValueOnce([
      lapsedHold({ id: 'a' }),
      lapsedHold({ id: 'b', holdExpiresAt: minutesAgo(1) }),
    ]);
    h.repository.findUnansweredReceipts.mockResolvedValueOnce([unansweredReceipt()]);

    const summary = await h.service.sweep();

    expect(summary.candidatesScanned).toBe(3);
    expect(summary.expiredPendingPayment).toBe(1);
    expect(summary.expiredPendingApproval).toBe(1);
    expect(h.logger.info.mock.calls[0][1]).toMatchObject({
      candidatesScanned: 3,
      expiredPendingPayment: 1,
      expiredPendingApproval: 1,
    });
  });

  // Once swept, a booking that was charged for stops looking anomalous
  // anywhere. This is the last surface that can say a refund is owed.
  it('should_report_an_expired_booking_that_had_already_been_paid', async () => {
    h.repository.findLapsedHolds.mockResolvedValueOnce([lapsedHold({ id: 'paid-but-lost' })]);
    h.repository.findApprovedPaymentsFor.mockResolvedValueOnce([
      { bookingId: 'paid-but-lost', paymentId: 'payment-1', amount: '3000.00' },
    ]);

    await h.service.sweep();

    expect(h.logger.error).toHaveBeenCalledTimes(1);
    const [, context] = h.logger.error.mock.calls[0];
    expect(context).toMatchObject({
      operation: 'booking.sweepExpiredHolds',
      bookingId: 'paid-but-lost',
      paymentId: 'payment-1',
      amount: '3000.00',
    });
  });

  it('should_not_look_for_payments_when_nothing_was_expired', async () => {
    await h.service.sweep();

    expect(h.repository.findApprovedPaymentsFor).not.toHaveBeenCalled();
  });

  it('should_not_swallow_a_repository_failure_as_an_empty_run', async () => {
    h.repository.findLapsedHolds.mockRejectedValueOnce(new Error('DATABASE_URL is not set'));

    await expect(h.service.sweep()).rejects.toThrow('DATABASE_URL is not set');
    expect(h.logger.info).not.toHaveBeenCalled();
  });
});

describe('ExpiredHoldSweepService - what it is forbidden to contain', () => {
  const source = readFileSync(new URL('./ExpiredHoldSweepService.ts', import.meta.url), 'utf8');
  const code = source.replace(/\/\*\*[\s\S]*?\*\/|\/\/.*$/gm, '');

  // The blocking rule reads a deadline, and a copy of it in SQL would drift
  // from the availability read the first time either was refined — offering a
  // client a time and then refusing them while they pay. The sweep is the
  // fourth caller and must stay a caller.
  it.each(['PENDING_APPROVAL', 'CONFIRMED', 'CANCELLED'])(
    'names no blocking status other than the one it writes: %s',
    (status) => {
      const mentions = code.split(status).length - 1;
      const allowed = status === 'PENDING_APPROVAL' ? 1 : 0;
      expect(mentions).toBe(allowed);
    }
  );

  it('uses no raw SQL of its own', () => {
    expect(code).not.toMatch(/\$queryRaw|\$executeRaw|SELECT |UPDATE |\bWHERE\b/i);
  });

  // The sweep writes one column. The money keeps its own history so a late
  // notification can still complete it; `cancelledAt`/`cancelledBy` stay null
  // because a deadline is not a decision; and `holdExpiresAt` survives as the
  // evidence of why the booking ended.
  it.each(['cancelledAt', 'cancelledBy', 'CANCELLED'])('never writes %s', (field) => {
    expect(code).not.toContain(field);
  });

  it('never mutates a payment or the hold deadline', () => {
    expect(code).not.toMatch(/payment\.(update|create|delete)/i);
    expect(code).not.toMatch(/holdExpiresAt:\s/);
  });
});
