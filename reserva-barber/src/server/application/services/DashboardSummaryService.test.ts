import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DashboardSummaryService } from './DashboardSummaryService';
import type { IDashboardSummaryRepository } from '@/server/domain/repositories/IDashboardSummaryRepository';
import type { ITransferReceiptRepository } from '@/server/domain/repositories/ITransferReceiptRepository';
import type { ILogger } from '@/server/domain/repositories/ILogger';
import type { DashboardSummary } from '@/server/domain/models/dashboardSummary';
import { RECENT_BOOKINGS_LIMIT } from '@/server/domain/models/dashboardSummary';

/**
 * 23:30 in Buenos Aires on 31 August 2026 is 02:30 UTC on 1 September.
 *
 * The instant that decides whether this service asks for the right day and the
 * right month. Against the runtime's own calendar it would ask for 1 September
 * and for all of September — and it would do so silently, during closing hours,
 * self-healing by morning.
 */
const MONTH_END_NIGHT = new Date('2026-09-01T02:30:00.000Z');

const FIGURES: Omit<DashboardSummary, 'pendingReceipts'> = {
  confirmedToday: 3,
  heldToday: 2,
  cancelledToday: 1,
  confirmedAllTime: 41,
  monthDepositIncome: '2000.50',
};

function makeService(overrides?: {
  dashboard?: Partial<IDashboardSummaryRepository>;
  receipts?: Partial<ITransferReceiptRepository>;
}) {
  const logger: ILogger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

  const dashboard = {
    readSummary: vi.fn().mockResolvedValue({ ...FIGURES, pendingReceipts: 0 }),
    findRecentForOwner: vi.fn().mockResolvedValue([]),
    findFilterableBarbers: vi.fn().mockResolvedValue([{ id: 'barber-nico', displayName: 'Nico' }]),
    ...overrides?.dashboard,
  } as unknown as IDashboardSummaryRepository;

  const receipts = {
    countPendingForOwner: vi.fn().mockResolvedValue(4),
    ...overrides?.receipts,
  } as unknown as ITransferReceiptRepository;

  const service = new DashboardSummaryService(
    dashboard,
    receipts,
    { now: () => MONTH_END_NIGHT.getTime(), sleep: async () => {} },
    logger
  );

  return { service, dashboard, receipts, logger };
}

describe('DashboardSummaryService - the instants it asks about', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should_ask_for_the_business_day_not_the_runtime_one', async () => {
    const { service, dashboard } = makeService();

    await service.loadHome({ ownerId: 'owner-a', rawBarberFilter: undefined });

    const { dayRange } = vi.mocked(dashboard.readSummary).mock.calls[0][0];
    // 31 August local, which the runtime would have called 1 September.
    expect(dayRange.start.toISOString()).toBe('2026-08-31T03:00:00.000Z');
    expect(dayRange.end.toISOString()).toBe('2026-09-01T03:00:00.000Z');
  });

  it('should_ask_for_the_business_month_not_the_runtime_one', async () => {
    const { service, dashboard } = makeService();

    await service.loadHome({ ownerId: 'owner-a', rawBarberFilter: undefined });

    const { monthRange } = vi.mocked(dashboard.readSummary).mock.calls[0][0];
    expect(monthRange.start.toISOString()).toBe('2026-08-01T03:00:00.000Z');
    expect(monthRange.end.toISOString()).toBe('2026-09-01T03:00:00.000Z');
  });

  it('should_derive_both_ranges_from_one_instant', async () => {
    const { service, dashboard } = makeService();

    await service.loadHome({ ownerId: 'owner-a', rawBarberFilter: undefined });

    const call = vi.mocked(dashboard.readSummary).mock.calls[0][0];
    // The day sits inside the month it was derived alongside — impossible to
    // violate with one clock read, easy to violate with two.
    expect(call.dayRange.start.getTime()).toBeGreaterThanOrEqual(call.monthRange.start.getTime());
    expect(call.dayRange.end.getTime()).toBeLessThanOrEqual(call.monthRange.end.getTime());
    expect(call.now.getTime()).toBe(MONTH_END_NIGHT.getTime());
  });
});

describe('DashboardSummaryService - the receipt count is a separate read', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should_take_the_pending_count_from_the_receipt_repository', async () => {
    const { service, receipts } = makeService();

    const view = await service.loadHome({ ownerId: 'owner-a', rawBarberFilter: undefined });

    // The queue's predicate has one home. If the aggregate statement grew a
    // receipt clause, this figure would come from the other copy.
    expect(receipts.countPendingForOwner).toHaveBeenCalledWith('owner-a');
    expect(view.summary.ok && view.summary.value.pendingReceipts).toBe(4);
  });

  it('should_report_the_whole_block_as_failed_when_the_receipt_count_fails', async () => {
    const { service } = makeService({
      receipts: { countPendingForOwner: vi.fn().mockRejectedValue(new Error('pool exhausted')) },
    });

    const view = await service.loadHome({ ownerId: 'owner-a', rawBarberFilter: undefined });

    // A partial row of figures is not a state this page has.
    expect(view.summary.ok).toBe(false);
  });
});

describe('DashboardSummaryService - the barber filter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should_pass_a_barber_that_belongs_to_this_owner', async () => {
    const { service, dashboard } = makeService();

    const view = await service.loadHome({
      ownerId: 'owner-a',
      rawBarberFilter: 'barber-nico',
    });

    expect(view.selectedBarberId).toBe('barber-nico');
    expect(dashboard.findRecentForOwner).toHaveBeenCalledWith({
      ownerId: 'owner-a',
      barberId: 'barber-nico',
      limit: RECENT_BOOKINGS_LIMIT,
    });
  });

  it('should_never_pass_an_unmatched_id_into_the_query', async () => {
    const { service, dashboard } = makeService();

    const view = await service.loadHome({
      ownerId: 'owner-a',
      rawBarberFilter: 'barber-of-another-shop',
    });

    // The whole point of matching rather than parsing: the value does not reach
    // a query, so the page cannot answer "does this id exist".
    expect(view.selectedBarberId).toBeUndefined();
    expect(dashboard.findRecentForOwner).toHaveBeenCalledWith({
      ownerId: 'owner-a',
      barberId: undefined,
      limit: RECENT_BOOKINGS_LIMIT,
    });
  });

  it('should_resolve_the_filter_before_issuing_the_list_read', async () => {
    const order: string[] = [];
    const { service } = makeService({
      dashboard: {
        findFilterableBarbers: vi.fn(async () => {
          order.push('barbers');
          return [{ id: 'barber-nico', displayName: 'Nico' }];
        }),
        findRecentForOwner: vi.fn(async () => {
          order.push('recent');
          return [];
        }),
      },
    });

    await service.loadHome({ ownerId: 'owner-a', rawBarberFilter: 'barber-nico' });

    expect(order).toEqual(['barbers', 'recent']);
  });

  it('should_bound_the_list_by_the_named_constant', async () => {
    const { service, dashboard } = makeService();

    await service.loadHome({ ownerId: 'owner-a', rawBarberFilter: undefined });

    expect(vi.mocked(dashboard.findRecentForOwner).mock.calls[0][0].limit).toBe(
      RECENT_BOOKINGS_LIMIT
    );
  });

  it('should_offer_no_options_and_no_filter_for_a_shop_with_no_barbers', async () => {
    const { service } = makeService({
      dashboard: { findFilterableBarbers: vi.fn().mockResolvedValue([]) },
    });

    const view = await service.loadHome({ ownerId: 'owner-a', rawBarberFilter: 'barber-nico' });

    expect(view.barbers).toEqual([]);
    expect(view.selectedBarberId).toBeUndefined();
  });
});

describe('DashboardSummaryService - degradation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should_report_a_failed_summary_as_failed_and_never_as_zeros', async () => {
    const { service } = makeService({
      dashboard: { readSummary: vi.fn().mockRejectedValue(new Error('connection reset')) },
    });

    const view = await service.loadHome({ ownerId: 'owner-a', rawBarberFilter: undefined });

    expect(view.summary.ok).toBe(false);
    // There is no shape of this value that carries a zero. The type is what
    // makes an income card silently reading $0,00 unrepresentable.
    expect(view.summary).not.toHaveProperty('value');
  });

  it('should_keep_the_counters_when_only_the_list_fails', async () => {
    const { service } = makeService({
      dashboard: { findRecentForOwner: vi.fn().mockRejectedValue(new Error('timeout')) },
    });

    const view = await service.loadHome({ ownerId: 'owner-a', rawBarberFilter: undefined });

    expect(view.summary.ok).toBe(true);
    expect(view.recent.ok).toBe(false);
  });

  it('should_keep_the_page_when_only_the_counters_fail', async () => {
    const { service } = makeService({
      dashboard: {
        readSummary: vi.fn().mockRejectedValue(new Error('connection reset')),
        findRecentForOwner: vi.fn().mockResolvedValue([]),
      },
    });

    const view = await service.loadHome({ ownerId: 'owner-a', rawBarberFilter: undefined });

    expect(view.summary.ok).toBe(false);
    expect(view.recent.ok).toBe(true);
  });

  it('should_not_rethrow_into_the_route_error_boundary', async () => {
    const { service } = makeService({
      dashboard: {
        readSummary: vi.fn().mockRejectedValue(new Error('a')),
        findRecentForOwner: vi.fn().mockRejectedValue(new Error('b')),
        findFilterableBarbers: vi.fn().mockRejectedValue(new Error('c')),
      },
      receipts: { countPendingForOwner: vi.fn().mockRejectedValue(new Error('d')) },
    });

    // Every read failing still renders a page. Throwing would replace the
    // owner's landing page with a generic apology.
    await expect(
      service.loadHome({ ownerId: 'owner-a', rawBarberFilter: undefined })
    ).resolves.toMatchObject({ summary: { ok: false }, recent: { ok: false }, barbers: [] });
  });

  it('should_degrade_the_filter_to_no_options_rather_than_failing_the_page', async () => {
    const { service, logger } = makeService({
      dashboard: { findFilterableBarbers: vi.fn().mockRejectedValue(new Error('timeout')) },
    });

    const view = await service.loadHome({ ownerId: 'owner-a', rawBarberFilter: undefined });

    expect(view.barbers).toEqual([]);
    expect(view.summary.ok).toBe(true);
    expect(logger.error).toHaveBeenCalled();
  });

  it('should_log_a_failure_without_rendering_it', async () => {
    const { service, logger } = makeService({
      dashboard: { readSummary: vi.fn().mockRejectedValue(new Error('connection reset')) },
    });

    await service.loadHome({ ownerId: 'owner-a', rawBarberFilter: undefined });

    expect(logger.error).toHaveBeenCalledWith(
      'Failed to read the dashboard summary',
      expect.objectContaining({ operation: 'dashboard.summary' })
    );
  });
});

describe('DashboardSummaryService - what it does not decide', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should_pass_the_repository_figures_through_untouched', async () => {
    const { service } = makeService();

    const view = await service.loadHome({ ownerId: 'owner-a', rawBarberFilter: undefined });

    // Two properties at once. The money keeps its trailing zero because nothing
    // here converts it. And the two "today" figures arrive as two numbers and
    // are never summed into one — they answer different questions.
    expect(view.summary.ok && view.summary.value).toMatchObject({
      monthDepositIncome: '2000.50',
      confirmedToday: 3,
      heldToday: 2,
    });
  });
});
