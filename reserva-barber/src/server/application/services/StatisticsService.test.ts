import { describe, it, expect, vi } from 'vitest';
import { StatisticsService } from './StatisticsService';
import type { IStatisticsRepository } from '@/server/domain/repositories/IStatisticsRepository';
import type { ILogger } from '@/server/domain/repositories/ILogger';
import type { BusinessStatistics } from '@/server/domain/models/statistics';

/**
 * 23:30 in Buenos Aires on Sunday 2026-08-16 is 02:30 UTC on Monday the 17th.
 *
 * The instant that decides whether this service asks for the right day and the
 * right week. Against the runtime's own calendar it would ask for Monday the
 * 17th and for the week beginning that day — silently, during closing hours,
 * self-healing by morning.
 */
const SUNDAY_NIGHT = new Date('2026-08-17T02:30:00.000Z');

const FIGURES: BusinessStatistics = {
  confirmedCount: 4,
  depositTotal: '9000.00',
  cancelledCount: 2,
  cancelledByOwner: 1,
  cancelledByClient: 1,
  uniqueClients: 3,
  hasAnyBookingEver: true,
};

function makeService(overrides?: { statistics?: Partial<IStatisticsRepository> }) {
  const logger: ILogger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

  const statistics = {
    readStatistics: vi.fn().mockResolvedValue(FIGURES),
    ...overrides?.statistics,
  } as unknown as IStatisticsRepository;

  const service = new StatisticsService(
    statistics,
    { now: () => SUNDAY_NIGHT.getTime(), sleep: async () => {} },
    logger
  );

  return { service, statistics, logger };
}

describe('StatisticsService - resolving the period', () => {
  it('should_default_to_today_when_no_range_was_submitted', async () => {
    const { service, statistics } = makeService();

    const view = await service.loadPage({ ownerId: 'own-1', rawRange: undefined });

    expect(view.range).toBe('hoy');
    expect(statistics.readStatistics).toHaveBeenCalledWith({
      ownerId: 'own-1',
      range: {
        start: new Date('2026-08-16T03:00:00.000Z'),
        end: new Date('2026-08-17T03:00:00.000Z'),
      },
    });
  });

  it('should_ask_for_the_business_day_not_the_runtime_one', async () => {
    const { service, statistics } = makeService();

    await service.loadPage({ ownerId: 'own-1', rawRange: 'hoy' });

    const { range } = vi.mocked(statistics.readStatistics).mock.calls[0]![0];
    // The runtime's date here is Monday the 17th. Asking for it would report
    // an empty day to a shop that worked all Sunday evening.
    expect(range.start.toISOString()).toBe('2026-08-16T03:00:00.000Z');
  });

  it('should_resolve_the_week_from_the_business_sunday', async () => {
    const { service, statistics } = makeService();

    await service.loadPage({ ownerId: 'own-1', rawRange: 'semana' });

    const { range } = vi.mocked(statistics.readStatistics).mock.calls[0]![0];
    expect(range.start.toISOString()).toBe('2026-08-10T03:00:00.000Z');
    expect(range.end.toISOString()).toBe('2026-08-17T03:00:00.000Z');
  });

  it('should_degrade_an_unusable_range_to_today_without_failing', async () => {
    const { service } = makeService();

    const view = await service.loadPage({ ownerId: 'own-1', rawRange: 'trimestre' });

    expect(view.range).toBe('hoy');
    expect(view.statistics.ok).toBe(true);
  });

  it('should_read_the_clock_once_so_the_heading_and_the_figures_agree', async () => {
    const now = vi.fn().mockReturnValue(SUNDAY_NIGHT.getTime());
    const statistics = {
      readStatistics: vi.fn().mockResolvedValue(FIGURES),
    } as unknown as IStatisticsRepository;
    const logger: ILogger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    await new StatisticsService(statistics, { now, sleep: async () => {} }, logger).loadPage({
      ownerId: 'own-1',
      rawRange: 'semana',
    });

    // Two reads at 23:59:59.9 would let the heading and the figures describe
    // different days.
    expect(now).toHaveBeenCalledTimes(1);
  });

  it('should_return_the_business_date_the_period_was_derived_from', async () => {
    const { service } = makeService();

    const view = await service.loadPage({ ownerId: 'own-1', rawRange: 'hoy' });

    expect(view.today).toEqual({ year: 2026, month: 8, day: 16 });
  });
});

describe('StatisticsService - a read that fails', () => {
  it('should_report_the_failure_rather_than_returning_zeros', async () => {
    const { service } = makeService({
      statistics: { readStatistics: vi.fn().mockRejectedValue(new Error('pool exhausted')) },
    });

    const view = await service.loadPage({ ownerId: 'own-1', rawRange: 'mes' });

    // Zero and failure never render alike: an income card silently reading
    // $ 0,00 is a false statement about money.
    expect(view.statistics).toEqual({ ok: false });
  });

  it('should_still_report_which_period_was_asked_for', async () => {
    const { service } = makeService({
      statistics: { readStatistics: vi.fn().mockRejectedValue(new Error('boom')) },
    });

    const view = await service.loadPage({ ownerId: 'own-1', rawRange: 'mes-anterior' });

    // The control must keep its selection through a failure, or the owner
    // cannot tell which period failed.
    expect(view.range).toBe('mes-anterior');
  });

  it('should_log_the_failure_with_an_operation_name_and_the_shared_context_keys', async () => {
    const { service, logger } = makeService({
      statistics: { readStatistics: vi.fn().mockRejectedValue(new Error('boom')) },
    });

    await service.loadPage({ ownerId: 'own-1', rawRange: 'hoy' });

    expect(logger.error).toHaveBeenCalledTimes(1);
    const [, context] = vi.mocked(logger.error).mock.calls[0]!;
    // The keys are pinned rather than the absence of strings: `toErrorLogContext`
    // keeps the full message for anything outside its constraint-violation
    // list, and that is acceptable here because the statement is fully
    // parameterised and no column in it is personal or monetary.
    expect(Object.keys(context as object).sort()).toEqual(['cause', 'operation']);
    expect((context as { operation: string }).operation).toBe('dashboard.statistics');
  });

  it('should_not_let_a_failed_read_reach_the_caller_as_an_exception', async () => {
    const { service } = makeService({
      statistics: { readStatistics: vi.fn().mockRejectedValue(new Error('boom')) },
    });

    await expect(service.loadPage({ ownerId: 'own-1', rawRange: 'hoy' })).resolves.toBeDefined();
  });
});

describe('StatisticsService - what it hands the page', () => {
  it('should_pass_the_figures_through_untouched', async () => {
    const { service } = makeService();

    const view = await service.loadPage({ ownerId: 'own-1', rawRange: 'hoy' });

    expect(view.statistics).toEqual({ ok: true, value: FIGURES });
  });

  it('should_not_compute_the_average_itself', async () => {
    const { service } = makeService();

    const view = await service.loadPage({ ownerId: 'own-1', rawRange: 'hoy' });

    // The division is a monetary rule and lives in the domain, once. A copy
    // here would be a second place to round a centavo.
    expect(view).not.toHaveProperty('average');
    expect(view.statistics.ok && view.statistics.value).not.toHaveProperty('average');
  });
});
