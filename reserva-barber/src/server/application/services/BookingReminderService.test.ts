import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  BookingReminderService,
  MAX_REMINDER_BATCHES,
  REMINDER_BATCH_SIZE,
} from './BookingReminderService';
import { BOOKING_REMINDER_EMAIL } from '@/server/domain/models/emailCapability';
import type {
  IBookingReminderRepository,
  ReminderBooking,
  ReminderCandidateRow,
} from '@/server/domain/repositories/IBookingReminderRepository';
import type { IEmailSender, EmailSendOutcome } from '@/server/domain/repositories/IEmailSender';
import type { IClock } from '@/server/domain/repositories/IClock';
import type { ILogger } from '@/server/domain/repositories/ILogger';

const NOW = new Date('2026-08-29T12:00:00.000Z');
const ORIGIN = 'https://reservabarber.com';

/** Inside the 24-hour window, and made long enough beforehand to qualify. */
function candidate(overrides: Partial<ReminderCandidateRow> = {}): ReminderCandidateRow {
  return {
    id: 'bkg-1',
    startTime: new Date('2026-08-30T11:00:00.000Z'),
    createdAt: new Date('2026-08-20T09:00:00.000Z'),
    ...overrides,
  };
}

function claimed(overrides: Partial<ReminderBooking> = {}): ReminderBooking {
  return {
    id: 'bkg-1',
    clientName: 'Ana Pérez',
    clientEmail: 'ana@example.com',
    shopName: 'Barbería Central',
    shopSlug: 'barberia-central',
    locationName: 'Sucursal Palermo',
    locationAddress: 'Gorriti 4500',
    barberName: 'Nico',
    serviceName: 'Corte y barba',
    startTime: new Date('2026-08-30T11:00:00.000Z'),
    priceAtBooking: '9000.00',
    depositAmount: '2000.50',
    cancellationToken: 'tok-abc123',
    ...overrides,
  };
}

function testLogger(): ILogger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function testClock(): IClock {
  return { now: vi.fn().mockReturnValue(NOW.getTime()), sleep: vi.fn() };
}

function testRepository() {
  return {
    findDueCandidates: vi.fn<IBookingReminderRepository['findDueCandidates']>().mockResolvedValue([]),
    claimDue: vi.fn<IBookingReminderRepository['claimDue']>().mockResolvedValue([]),
  };
}

function testSender(outcome: EmailSendOutcome = 'sent') {
  return { send: vi.fn<IEmailSender['send']>().mockResolvedValue({ outcome }) };
}

function service(parts: {
  repository?: ReturnType<typeof testRepository>;
  sender?: ReturnType<typeof testSender>;
  logger?: ILogger;
  clock?: IClock;
  origin?: string | null;
}) {
  const repository = parts.repository ?? testRepository();
  const sender = parts.sender ?? testSender();
  const logger = parts.logger ?? testLogger();
  const clock = parts.clock ?? testClock();

  return {
    repository,
    sender,
    logger,
    clock,
    subject: new BookingReminderService(
      repository as unknown as IBookingReminderRepository,
      sender as unknown as IEmailSender,
      clock,
      logger,
      parts.origin === undefined ? ORIGIN : parts.origin
    ),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('BookingReminderService - what it refuses to send', () => {
  it('should_never_claim_a_booking_whose_appointment_has_already_started', async () => {
    // The candidate query already excludes the past. This asserts the SECOND
    // expression of that rule — the domain predicate — because it is the only
    // bound in this capability whose failure is unrecoverable, and a safety
    // property of that size does not rest on a query nobody can unit-test.
    const repository = testRepository();
    repository.findDueCandidates.mockResolvedValue([
      candidate({ startTime: new Date(NOW.getTime() - 60_000) }),
    ]);

    const { subject, sender } = service({ repository });
    const summary = await subject.run();

    expect(repository.claimDue).not.toHaveBeenCalled();
    expect(sender.send).not.toHaveBeenCalled();
    expect(summary.claimed).toBe(0);
  });

  it('should_never_claim_a_booking_made_inside_its_own_lead_window', async () => {
    const startTime = new Date(NOW.getTime() + 60 * 60_000);
    const repository = testRepository();
    repository.findDueCandidates.mockResolvedValue([
      candidate({ startTime, createdAt: new Date(startTime.getTime() - 60 * 60_000) }),
    ]);

    const { subject } = service({ repository });
    const summary = await subject.run();

    expect(repository.claimDue).not.toHaveBeenCalled();
    expect(summary.claimed).toBe(0);
  });

  it('should_send_nothing_for_a_candidate_the_claim_did_not_win', async () => {
    // A client cancelled, the owner cancelled, the sweep expired it, or another
    // invocation got there first. All four look identical from here, and all
    // four are the ordinary path rather than an error.
    const repository = testRepository();
    repository.findDueCandidates.mockResolvedValue([candidate()]);
    repository.claimDue.mockResolvedValue([]);

    const { subject, sender } = service({ repository });
    const summary = await subject.run();

    expect(sender.send).not.toHaveBeenCalled();
    expect(summary.sent).toBe(0);
    expect(summary.claimed).toBe(0);
  });
});

describe('BookingReminderService - claiming before sending', () => {
  it('should_claim_before_it_sends_and_never_the_other_way_round', async () => {
    // The whole of at-most-once. Recording after the send leaves a window in
    // which a dying Worker or an accepted-then-timed-out call leaves the row
    // unclaimed, and the next invocation sends again — once per invocation, for
    // as long as the appointment stays due.
    const order: string[] = [];
    const repository = testRepository();
    repository.findDueCandidates.mockResolvedValue([candidate()]);
    repository.claimDue.mockImplementation(async () => {
      order.push('claim');
      return [claimed()];
    });
    const sender = testSender();
    sender.send.mockImplementation(async () => {
      order.push('send');
      return { outcome: 'sent' as const };
    });

    const { subject } = service({ repository, sender });
    await subject.run();

    expect(order).toEqual(['claim', 'send']);
  });

  it('should_claim_with_the_run_instant_and_only_the_due_ids', async () => {
    const repository = testRepository();
    repository.findDueCandidates.mockResolvedValue([
      candidate({ id: 'due' }),
      candidate({ id: 'past', startTime: new Date(NOW.getTime() - 60_000) }),
    ]);
    repository.claimDue.mockResolvedValue([claimed({ id: 'due' })]);

    const { subject } = service({ repository });
    await subject.run();

    expect(repository.claimDue).toHaveBeenCalledWith({ ids: ['due'], claimedAt: NOW });
  });

  it('should_send_exactly_one_message_per_claimed_booking', async () => {
    const repository = testRepository();
    repository.findDueCandidates.mockResolvedValue([candidate({ id: 'a' }), candidate({ id: 'b' })]);
    repository.claimDue.mockResolvedValue([claimed({ id: 'a' }), claimed({ id: 'b' })]);

    const { subject, sender } = service({ repository });
    const summary = await subject.run();

    expect(sender.send).toHaveBeenCalledTimes(2);
    expect(summary.sent).toBe(2);
  });

  it('should_lose_one_message_and_not_the_batch_when_a_row_cannot_be_composed', async () => {
    // **Found by the adversarial pass, and the first guess at the mechanism was
    // wrong.** The claim was that malformed money would throw. It does not:
    // `toCents('x')` returns `NaN`, `cents > 0` is false, and the balance line
    // is simply omitted — measured, not assumed.
    //
    // What *does* throw is an unrenderable instant: `Intl` answers a
    // `RangeError` for an invalid date, so the builder is pure but **not
    // total**. Outside a per-message `try` that exception escapes to the run's
    // outer catch, which rethrows — and the rows are already claimed by then,
    // so one unrenderable booking would burn the reminder of every booking
    // behind it in the batch.
    //
    // Reaching it through Prisma would take a `Timestamptz` column yielding an
    // invalid `Date`, which is not a thing that happens today. The guard is
    // kept anyway because it costs one `catch` and the property it protects —
    // one bad row must not consume a batch — should not depend on the builder
    // staying total.
    const repository = testRepository();
    repository.findDueCandidates.mockResolvedValue([
      candidate({ id: 'broken' }),
      candidate({ id: 'fine' }),
    ]);
    repository.claimDue.mockResolvedValue([
      claimed({ id: 'broken', startTime: new Date('not-a-date') }),
      claimed({ id: 'fine' }),
    ]);

    const { subject, sender, logger } = service({ repository });
    const summary = await subject.run();

    // The healthy booking behind it is still sent to.
    expect(sender.send).toHaveBeenCalledTimes(1);
    expect(summary.sent).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.outcomes.rejected).toBe(1);
    expect(logger.error).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ bookingId: 'broken', outcome: 'rejected' })
    );
  });

  it('should_leave_the_claim_in_place_when_the_send_fails', async () => {
    // Nothing un-claims. A claimed row whose send failed may already have been
    // delivered, so releasing it turns a bounded loss into an unbounded
    // duplicate. The repository is asserted to expose no way to undo it.
    const repository = testRepository();
    repository.findDueCandidates.mockResolvedValue([candidate()]);
    repository.claimDue.mockResolvedValue([claimed()]);

    const { subject, logger } = service({ repository, sender: testSender('retry') });
    const summary = await subject.run();

    expect(summary.sent).toBe(0);
    expect(summary.failed).toBe(1);
    expect(Object.keys(repository)).not.toContain('release');
    expect(logger.error).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ operation: BOOKING_REMINDER_EMAIL.operation, outcome: 'retry' })
    );
  });
});

describe('BookingReminderService - bounds and the run instant', () => {
  it('should_read_the_clock_once_and_decide_everything_against_it', async () => {
    // Two clocks, one decision, is how a row becomes eligible by one reading
    // and live by the other. The clock is read once for the instant and once
    // more at the end for the duration, and never inside the loop.
    const repository = testRepository();
    repository.findDueCandidates.mockResolvedValue([candidate()]);
    repository.claimDue.mockResolvedValue([claimed()]);
    const clock = testClock();

    const { subject } = service({ repository, clock });
    await subject.run();

    const windowArgs = repository.findDueCandidates.mock.calls[0][0];
    expect(windowArgs.now).toEqual(NOW);
    expect(windowArgs.windowEnd).toEqual(new Date(NOW.getTime() + 24 * 60 * 60_000));
    expect(repository.claimDue.mock.calls[0][0].claimedAt).toEqual(NOW);
  });

  it('should_bound_each_page_and_stop_at_the_per_run_cap', async () => {
    // A job that CANNOT overrun is a job that cannot take the pooler down with
    // it. Every page is full and every row is claimed, so nothing else ends the
    // loop — only the cap.
    const repository = testRepository();
    const fullPage = Array.from({ length: REMINDER_BATCH_SIZE }, (_, index) =>
      candidate({ id: `bkg-${index}` })
    );
    repository.findDueCandidates.mockResolvedValue(fullPage);
    repository.claimDue.mockResolvedValue(fullPage.map((row) => claimed({ id: row.id })));

    const { subject } = service({ repository });
    const summary = await subject.run();

    expect(repository.findDueCandidates).toHaveBeenCalledTimes(MAX_REMINDER_BATCHES);
    expect(repository.findDueCandidates.mock.calls[0][0].limit).toBe(REMINDER_BATCH_SIZE);
    expect(summary.batches).toBe(MAX_REMINDER_BATCHES);
    expect(summary.sent).toBe(REMINDER_BATCH_SIZE * MAX_REMINDER_BATCHES);
  });

  it('should_stop_on_a_short_page_because_there_is_nothing_more_to_read', async () => {
    const repository = testRepository();
    repository.findDueCandidates.mockResolvedValue([candidate()]);
    repository.claimDue.mockResolvedValue([claimed()]);

    const { subject } = service({ repository });
    await subject.run();

    expect(repository.findDueCandidates).toHaveBeenCalledTimes(1);
  });

  it('should_stop_rather_than_re_read_a_full_page_it_claimed_nothing_from', async () => {
    // A full page of gap-suppressed rows is not claimed, so the same page comes
    // back on the next read — forever, up to the cap. Terminating on "claimed
    // nothing" is what stops an invocation spinning over rows it has already
    // decided about. The remainder is next invocation's work, which the
    // self-healing window makes safe.
    const repository = testRepository();
    const startTime = new Date(NOW.getTime() + 60 * 60_000);
    repository.findDueCandidates.mockResolvedValue(
      Array.from({ length: REMINDER_BATCH_SIZE }, (_, index) =>
        candidate({
          id: `bkg-${index}`,
          startTime,
          createdAt: new Date(startTime.getTime() - 60 * 60_000),
        })
      )
    );

    const { subject } = service({ repository });
    await subject.run();

    expect(repository.findDueCandidates).toHaveBeenCalledTimes(1);
  });

  it('should_send_each_batch_before_claiming_the_next', async () => {
    // Bounds the window between claiming a booking and sending its message to
    // one batch rather than the whole invocation. Nothing can close that window
    // — a client can cancel while the provider is accepting — so it is made
    // small rather than claimed to be closed.
    const order: string[] = [];
    const repository = testRepository();
    const fullPage = Array.from({ length: REMINDER_BATCH_SIZE }, (_, index) =>
      candidate({ id: `bkg-${index}` })
    );
    repository.findDueCandidates.mockImplementation(async () => {
      order.push('read');
      return fullPage;
    });
    repository.claimDue.mockImplementation(async () => {
      order.push('claim');
      return [claimed()];
    });
    const sender = testSender();
    sender.send.mockImplementation(async () => {
      order.push('send');
      return { outcome: 'sent' as const };
    });

    const { subject } = service({ repository, sender });
    await subject.run();

    expect(order.slice(0, 6)).toEqual([
      'read',
      'claim',
      'send',
      'read',
      'claim',
      'send',
    ]);
  });
});

describe('BookingReminderService - the summary', () => {
  it('should_emit_one_summary_even_when_nothing_was_due', async () => {
    // Silence is this job's failure mode, so silence must not also be its
    // success mode. If it never fires or cannot reach the database, nothing
    // else in the product looks wrong.
    const { subject, logger } = service({});
    const summary = await subject.run();

    expect(summary).toEqual({
      candidatesScanned: 0,
      due: 0,
      claimed: 0,
      sent: 0,
      failed: 0,
      outcomes: { rejected: 0, throttled: 0, retry: 0 },
      batches: 0,
      durationMs: expect.any(Number),
    });
    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ operation: BOOKING_REMINDER_EMAIL.operation, sent: 0 })
    );
  });

  it('should_keep_throttled_distinguishable_from_rejected', async () => {
    // They look identical at the call site and lead to completely different
    // action. Reminders arrive as a burst, so the likely production shape is
    // reminders exhausting the quota and every CONFIRMATION behind them being
    // throttled — the message carrying no money starving the one that does.
    const repository = testRepository();
    repository.findDueCandidates.mockResolvedValue([candidate()]);
    repository.claimDue.mockResolvedValue([claimed()]);

    const { subject } = service({ repository, sender: testSender('throttled') });
    const summary = await subject.run();

    expect(summary.outcomes).toEqual({ rejected: 0, throttled: 1, retry: 0 });
  });

  it('should_report_a_database_failure_as_an_error_rather_than_an_empty_run', async () => {
    const repository = testRepository();
    repository.findDueCandidates.mockRejectedValue(new Error('connection refused'));

    const { subject, logger } = service({ repository });

    await expect(subject.run()).rejects.toThrow();
    expect(logger.error).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ operation: BOOKING_REMINDER_EMAIL.operation })
    );
  });
});

describe('BookingReminderService - the origin', () => {
  it('should_still_send_with_no_link_when_no_origin_is_configured', async () => {
    const repository = testRepository();
    repository.findDueCandidates.mockResolvedValue([candidate()]);
    repository.claimDue.mockResolvedValue([claimed()]);

    const { subject, sender, logger } = service({ repository, origin: null });
    const summary = await subject.run();

    expect(summary.sent).toBe(1);
    expect(sender.send.mock.calls[0][0].text).not.toMatch(/https?:\/\//);
    expect(logger.error).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ reason: 'originMissing' })
    );
  });

  it('should_refuse_a_loopback_origin_and_send_without_a_link', async () => {
    // B5 measured what this costs on the payment path: a gateway accepted a
    // localhost notification URL, the client paid, and nothing ever learned. In
    // an inbox it is worse, because a message cannot be redeployed.
    const repository = testRepository();
    repository.findDueCandidates.mockResolvedValue([candidate()]);
    repository.claimDue.mockResolvedValue([claimed()]);

    const { subject, sender } = service({ repository, origin: 'http://localhost:3000' });
    await subject.run();

    expect(sender.send.mock.calls[0][0].text).not.toContain('localhost');
  });

  it('should_report_the_missing_origin_once_per_run_and_not_once_per_booking', async () => {
    // A configuration fault is a property of the deployment, not of a booking.
    // One entry per invocation is findable; one per message is noise that
    // buries the per-message failures underneath it.
    const repository = testRepository();
    repository.findDueCandidates.mockResolvedValue([candidate({ id: 'a' }), candidate({ id: 'b' })]);
    repository.claimDue.mockResolvedValue([claimed({ id: 'a' }), claimed({ id: 'b' })]);

    const { subject, logger } = service({ repository, origin: null });
    await subject.run();

    const originErrors = (logger.error as ReturnType<typeof vi.fn>).mock.calls.filter(
      (call) => call[1]?.reason === 'originMissing'
    );
    expect(originErrors).toHaveLength(1);
  });
});

describe('BookingReminderService - log hygiene', () => {
  it('should_carry_the_booking_id_and_the_outcome_and_nothing_about_the_person', async () => {
    const repository = testRepository();
    repository.findDueCandidates.mockResolvedValue([candidate()]);
    repository.claimDue.mockResolvedValue([claimed()]);
    const logger = testLogger();

    const { subject } = service({ repository, logger, sender: testSender('rejected') });
    await subject.run();

    const everything = JSON.stringify([
      (logger.info as ReturnType<typeof vi.fn>).mock.calls,
      (logger.error as ReturnType<typeof vi.fn>).mock.calls,
      (logger.warn as ReturnType<typeof vi.fn>).mock.calls,
    ]);

    expect(everything).toContain('bkg-1');
    expect(everything).not.toContain('ana@example.com');
    expect(everything).not.toContain('Ana Pérez');
    expect(everything).not.toContain('tok-abc123');
    expect(everything).not.toContain('reservabarber.com');
  });

  it('should_file_every_line_under_the_reminder_operation_and_never_the_confirmation', async () => {
    // The hole the cancellation notice fell through in C2: a shared component
    // reporting a fixed capability, so an operator filtering on one name
    // counted another message's failures.
    const repository = testRepository();
    repository.findDueCandidates.mockResolvedValue([candidate()]);
    repository.claimDue.mockResolvedValue([claimed()]);
    const logger = testLogger();

    const { subject } = service({ repository, logger, sender: testSender('rejected') });
    await subject.run();

    const everything = JSON.stringify([
      (logger.info as ReturnType<typeof vi.fn>).mock.calls,
      (logger.error as ReturnType<typeof vi.fn>).mock.calls,
    ]);

    expect(everything).toContain('email.bookingReminder');
    expect(everything).not.toContain('email.bookingConfirmation');
  });
});
