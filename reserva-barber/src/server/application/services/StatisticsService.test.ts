import { describe, it, expect, vi } from 'vitest';
import { StatisticsService } from './StatisticsService';
import type { IStatisticsRepository } from '@/server/domain/repositories/IStatisticsRepository';
import type { ILogger } from '@/server/domain/repositories/ILogger';
import type { BusinessCharts, BusinessStatistics } from '@/server/domain/models/statistics';

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

const CHARTS: BusinessCharts = {
  rows: [{ bucket: 2, method: 'MERCADO_PAGO', total: '9000.00', payments: 4 }],
  cashCollected: '7500.00',
};

function makeService(overrides?: { statistics?: Partial<IStatisticsRepository> }) {
  const logger: ILogger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

  const statistics = {
    readStatistics: vi.fn().mockResolvedValue(FIGURES),
    readCharts: vi.fn().mockResolvedValue(CHARTS),
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

describe('StatisticsService - the charts load and fail on their own', () => {
  it('should_keep_the_figures_when_the_heavier_chart_read_fails', async () => {
    // The property the shared transaction would have destroyed (design D4,
    // revised). The chart read is the heavier of the two against a pooler on
    // record hanging rather than raising, so this is the likely failure — and
    // the owner keeps five real figures through it.
    const { service } = makeService({
      statistics: { readCharts: vi.fn().mockRejectedValue(new Error('statement timeout')) },
    });

    const view = await service.loadPage({ ownerId: 'own-1', rawRange: 'semana' });

    expect(view.statistics.ok).toBe(true);
    expect(view.charts.ok).toBe(false);
  });

  it('should_keep_the_charts_when_the_figures_read_fails', async () => {
    const { service } = makeService({
      statistics: { readStatistics: vi.fn().mockRejectedValue(new Error('boom')) },
    });

    const view = await service.loadPage({ ownerId: 'own-1', rawRange: 'semana' });

    expect(view.statistics.ok).toBe(false);
    expect(view.charts.ok).toBe(true);
  });

  it('should_never_report_a_failed_chart_read_as_an_empty_period', async () => {
    // Zero and failure never render alike. A flat zero series is a statement
    // about the business and is indistinguishable from a period that earned
    // nothing.
    const { service } = makeService({
      statistics: { readCharts: vi.fn().mockRejectedValue(new Error('boom')) },
    });

    const view = await service.loadPage({ ownerId: 'own-1', rawRange: 'semana' });

    expect(view.charts).toEqual({ ok: false });
  });

  it('should_log_a_failed_chart_read_without_any_monetary_value', async () => {
    const { service, logger } = makeService({
      statistics: { readCharts: vi.fn().mockRejectedValue(new Error('boom')) },
    });

    await service.loadPage({ ownerId: 'own-1', rawRange: 'semana' });

    expect(logger.error).toHaveBeenCalled();
    expect(JSON.stringify(vi.mocked(logger.error).mock.calls)).not.toContain('9000');
  });
});

describe('StatisticsService - one clock governs the figures and the axis', () => {
  it('should_bound_the_bucket_edges_by_the_same_range_it_asked_the_figures_for', async () => {
    // Any drift here is money in a bar that is in no figure. The edges span the
    // interval exactly, from the same single clock read.
    const { service, statistics } = makeService();

    await service.loadPage({ ownerId: 'own-1', rawRange: 'semana' });

    const { range } = vi.mocked(statistics.readStatistics).mock.calls[0]![0];
    const charts = vi.mocked(statistics.readCharts).mock.calls[0]![0];

    expect(charts.range).toEqual(range);
    expect(charts.edges[0]?.getTime()).toBe(range.start.getTime());
    expect(charts.edges[charts.edges.length - 1]?.getTime()).toBe(range.end.getTime());
  });

  it('should_ask_for_hourly_edges_on_a_single_day_and_daily_edges_on_a_month', async () => {
    const { service, statistics } = makeService();

    await service.loadPage({ ownerId: 'own-1', rawRange: 'hoy' });
    expect(vi.mocked(statistics.readCharts).mock.calls[0]![0].edges).toHaveLength(25);

    await service.loadPage({ ownerId: 'own-1', rawRange: 'mes' });
    expect(vi.mocked(statistics.readCharts).mock.calls[1]![0].edges).toHaveLength(32);
  });

  it('should_read_the_clock_once_for_both_reads', async () => {
    // Two reads at 23:59:59.9 would let the figures and the axis describe
    // different days.
    const { service, statistics } = makeService();

    await service.loadPage({ ownerId: 'own-1', rawRange: 'hoy' });

    const figures = vi.mocked(statistics.readStatistics).mock.calls[0]![0].range;
    const charts = vi.mocked(statistics.readCharts).mock.calls[0]![0].range;
    expect(charts.start.getTime()).toBe(figures.start.getTime());
    expect(charts.end.getTime()).toBe(figures.end.getTime());
  });
});
