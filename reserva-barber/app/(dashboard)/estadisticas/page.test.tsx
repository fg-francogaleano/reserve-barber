import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { COPY } from '@/lib/copy';
import type { StatisticsView } from '@/server/application/services/StatisticsService';
import type {
  BusinessBreakdowns,
  BusinessCharts,
  BusinessStatistics,
} from '@/server/domain/models/statistics';
import {
  bucketEdgesFor,
  hourBucketEdgesFor,
} from '@/server/application/dashboard/statisticsRangeParams';

const requireOwner = vi.fn(async () => ({
  id: 'owner-root',
  email: 'owner@example.com',
  authUserId: 'auth-uuid',
}));
const loadPage = vi.fn();

vi.mock('@/server/infrastructure/supabase/requireOwner', () => ({
  requireOwner: () => requireOwner(),
}));
vi.mock('./statisticsService', () => ({
  statisticsService: () => ({ loadPage }),
}));

const loggerError = vi.fn();
vi.mock('@/server/infrastructure/logger', () => ({
  logger: { error: (...args: unknown[]) => loggerError(...args) },
}));

const { default: StatisticsPage, dynamic, metadata } = await import('./page');

function figures(overrides: Partial<BusinessStatistics> = {}): BusinessStatistics {
  return {
    confirmedCount: 4,
    depositTotal: '9000.00',
    cancelledCount: 2,
    cancelledByOwner: 1,
    cancelledByClient: 1,
    uniqueClients: 3,
    hasAnyBookingEver: true,
    ...overrides,
  };
}

/**
 * The default view's edges are `hoy`'s real 24 hourly buckets, resolved from the
 * same date the view names — so a test that renders the income chart draws the
 * axis the page would actually draw, rather than one invented here.
 */
const TODAY = { year: 2026, month: 8, day: 16 } as const;

function charts(overrides: Partial<BusinessCharts> = {}): BusinessCharts {
  return {
    rows: [{ bucket: 12, method: 'MERCADO_PAGO', total: '9000.00', payments: 4 }],
    cashCollected: '7500.00',
    ...overrides,
  };
}

function breakdowns(overrides: Partial<BusinessBreakdowns> = {}): BusinessBreakdowns {
  return {
    services: [
      { key: 'svc-1', label: 'Corte', sublabel: null, count: 3 },
      { key: 'svc-2', label: 'Barba', sublabel: null, count: 1 },
    ],
    barbers: [
      { key: 'bar-1', label: 'Nico', sublabel: 'Centro', count: 3 },
      { key: 'bar-2', label: 'Ana', sublabel: 'Centro', count: 1 },
    ],
    hours: [{ bucket: 14, count: 4 }],
    ...overrides,
  };
}

function view(overrides: Partial<StatisticsView> = {}): StatisticsView {
  return {
    range: 'hoy',
    today: TODAY,
    edges: bucketEdgesFor('hoy', TODAY),
    hourEdges: hourBucketEdgesFor('hoy', TODAY),
    statistics: { ok: true, value: figures() },
    charts: { ok: true, value: charts() },
    breakdowns: { ok: true, value: breakdowns() },
    ...overrides,
  };
}

async function renderPage(searchParams: Record<string, string | string[] | undefined> = {}) {
  render(await StatisticsPage({ searchParams: Promise.resolve(searchParams) }));
}

/**
 * The figure card carrying a given label.
 *
 * Needed since D7: the page now renders twenty-four hourly counts and two
 * rankings, so a bare `getByText('0')` matches many elements and would go on
 * passing against the wrong one. Scoping to the card names what is being
 * asserted.
 */
function cardFor(label: string): HTMLElement {
  const card = screen.getByText(label).closest('[data-slot="card"]');
  if (card === null) throw new Error(`No card found for ${label}`);
  return card as HTMLElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  loadPage.mockResolvedValue(view());
});

describe('StatisticsPage - what the route declares about itself', () => {
  /**
   * Neither of these renders, so nothing behavioural can catch them going.
   *
   * A cached render of this route hands one shop's revenue to whoever asks
   * next, and an indexed one publishes it. Both are one deleted line away, and
   * the deletion would look like tidying.
   */
  it('should_never_be_cached', () => {
    expect(dynamic).toBe('force-dynamic');
  });

  it('should_never_be_indexed', () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
});

describe('StatisticsPage - the guard and the read', () => {
  it('should_resolve_the_owner_before_reading_anything', async () => {
    await renderPage();

    expect(requireOwner).toHaveBeenCalled();
    expect(loadPage).toHaveBeenCalledWith({ ownerId: 'owner-root', rawRange: undefined });
  });

  it('should_pass_the_submitted_range_through_without_interpreting_it', async () => {
    // The page hands the raw value over; the resolver is the only thing that
    // decides what it means, and it matches rather than parses.
    await renderPage({ rango: 'mes-anterior' });

    expect(loadPage).toHaveBeenCalledWith({ ownerId: 'owner-root', rawRange: 'mes-anterior' });
  });

  it('should_hand_over_a_repeated_parameter_untouched', async () => {
    await renderPage({ rango: ['mes', 'hoy'] });

    expect(loadPage).toHaveBeenCalledWith({ ownerId: 'owner-root', rawRange: ['mes', 'hoy'] });
  });
});

describe('StatisticsPage - the range control', () => {
  it('should_offer_every_period_the_product_defines', async () => {
    await renderPage();

    for (const label of Object.values(COPY.statistics.ranges)) {
      expect(screen.getByRole('link', { name: label })).toBeInTheDocument();
    }
  });

  it('should_mark_only_the_selected_period_as_current', async () => {
    loadPage.mockResolvedValue(view({ range: 'semana' }));
    await renderPage({ rango: 'semana' });

    const current = screen.getAllByRole('link').filter((link) => link.hasAttribute('aria-current'));

    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent(COPY.statistics.ranges.semana);
  });

  it('should_leave_the_default_period_unparameterised_in_its_own_link', async () => {
    await renderPage();

    expect(screen.getByRole('link', { name: COPY.statistics.ranges.hoy })).toHaveAttribute(
      'href',
      '/estadisticas'
    );
  });

  it('should_keep_the_control_and_its_selection_through_a_failed_read', async () => {
    loadPage.mockResolvedValue(view({ range: 'mes', statistics: { ok: false } }));
    await renderPage({ rango: 'mes' });

    // Without this the owner cannot tell which period failed.
    const current = screen.getAllByRole('link').filter((link) => link.hasAttribute('aria-current'));
    expect(current[0]).toHaveTextContent(COPY.statistics.ranges.mes);
  });
});

describe('StatisticsPage - the figures', () => {
  it('should_render_the_five_figures', async () => {
    await renderPage();

    expect(screen.getByText(COPY.statistics.confirmedCount)).toBeInTheDocument();
    expect(screen.getByText(COPY.statistics.depositTotal)).toBeInTheDocument();
    expect(screen.getByText(COPY.statistics.cancelledCount)).toBeInTheDocument();
    expect(screen.getByText(COPY.statistics.averageDeposit)).toBeInTheDocument();
    expect(screen.getByText(COPY.statistics.uniqueClients)).toBeInTheDocument();
  });

  it('should_format_money_on_the_server_and_keep_a_trailing_zero', async () => {
    loadPage.mockResolvedValue(
      view({ statistics: { ok: true, value: figures({ depositTotal: '2000.50', confirmedCount: 1 }) } })
    );
    await renderPage();

    // Two thousand pesos and fifty centavos, never five.
    expect(screen.getAllByText(/2\.000,50/).length).toBeGreaterThan(0);
  });

  it('should_state_that_the_income_is_deposits_and_which_appointments_they_belong_to', async () => {
    await renderPage();

    // The basis sentence D-1 requires: this figure and the dashboard home's are
    // on different clocks and will not agree.
    expect(screen.getByText(COPY.statistics.depositTotalHelp)).toBeInTheDocument();
    expect(COPY.statistics.depositTotalHelp).toMatch(/turnos de este período/i);
  });

  it('should_divide_the_average_over_the_periods_own_figures', async () => {
    loadPage.mockResolvedValue(
      view({
        statistics: { ok: true, value: figures({ depositTotal: '9000.00', confirmedCount: 4 }) },
      })
    );
    await renderPage();

    expect(screen.getAllByText(/2\.250,00/).length).toBeGreaterThan(0);
  });
});

describe('StatisticsPage - the average is absent rather than zero', () => {
  it('should_render_a_dash_when_the_period_has_no_confirmed_appointments', async () => {
    loadPage.mockResolvedValue(
      view({
        statistics: {
          ok: true,
          value: figures({ confirmedCount: 0, depositTotal: '0.00', uniqueClients: 0 }),
        },
      })
    );
    await renderPage();

    expect(screen.getByText(COPY.statistics.averageDepositAbsent)).toBeInTheDocument();
    expect(screen.getByText(COPY.statistics.averageDepositAbsentHelp)).toBeInTheDocument();
  });

  it('should_render_a_real_zero_when_appointments_happened_and_nothing_was_collected', async () => {
    // The asymmetry, pinned. An empty numerator is an answer; an empty
    // denominator is the absence of one. Anyone who has not read the spec will
    // read this as an inconsistency.
    loadPage.mockResolvedValue(
      view({ statistics: { ok: true, value: figures({ confirmedCount: 3, depositTotal: '0.00' }) } })
    );
    await renderPage();

    expect(screen.queryByText(COPY.statistics.averageDepositAbsent)).not.toBeInTheDocument();
    expect(screen.getAllByText(/0,00/).length).toBeGreaterThan(0);
  });

  it('should_render_no_cancellations_as_a_plain_zero', async () => {
    // A zero here is a real and welcome figure, unlike the average above.
    loadPage.mockResolvedValue(
      view({
        statistics: {
          ok: true,
          value: figures({ cancelledCount: 0, cancelledByOwner: 0, cancelledByClient: 0 }),
        },
      })
    );
    await renderPage();

    // Scoped to its own card since D7: the hour distribution puts a zero in
    // most of its twenty-four table rows, so an unscoped `getByText('0')` now
    // matches many elements — and would have gone on passing against any of
    // them rather than against this figure.
    expect(within(cardFor(COPY.statistics.cancelledCount)).getByText('0')).toBeInTheDocument();
  });
});

describe('StatisticsPage - the cancellation breakdown', () => {
  it('should_separate_who_ended_the_appointment', async () => {
    loadPage.mockResolvedValue(
      view({
        statistics: {
          ok: true,
          value: figures({ cancelledCount: 3, cancelledByOwner: 1, cancelledByClient: 2 }),
        },
      })
    );
    await renderPage();

    expect(screen.getByText(COPY.statistics.cancelledByOwner(1))).toBeInTheDocument();
    expect(screen.getByText(COPY.statistics.cancelledByClient(2))).toBeInTheDocument();
  });

  it('should_hide_a_part_that_is_zero', async () => {
    loadPage.mockResolvedValue(
      view({
        statistics: {
          ok: true,
          value: figures({ cancelledCount: 2, cancelledByOwner: 0, cancelledByClient: 2 }),
        },
      })
    );
    await renderPage();

    expect(screen.queryByText(COPY.statistics.cancelledByOwner(0))).not.toBeInTheDocument();
    expect(screen.getByText(COPY.statistics.cancelledByClient(2))).toBeInTheDocument();
  });

  it('should_count_a_cancellation_with_no_recorded_actor_in_the_total_only', async () => {
    // A row written before `cancelledBy` had a writer belongs to neither part.
    loadPage.mockResolvedValue(
      view({
        statistics: {
          ok: true,
          value: figures({ cancelledCount: 1, cancelledByOwner: 0, cancelledByClient: 0 }),
        },
      })
    );
    await renderPage();

    expect(within(cardFor(COPY.statistics.cancelledCount)).getByText('1')).toBeInTheDocument();
    expect(screen.queryByText(COPY.statistics.cancelledByClient(0))).not.toBeInTheDocument();
  });
});

describe('StatisticsPage - three states that must not look alike', () => {
  it('should_report_a_failed_read_as_a_failure_and_never_as_zeros', async () => {
    // **All three datasets fail here**, which is the state the page's own
    // try/catch produces and the only one that matches this test's name. D6
    // widened it from one read to two; D7 widens it to three, and leaving the
    // third populated would have made the assertions below measure a page that
    // had in fact loaded something. The partial cases are asserted separately,
    // because they are the ones that are new.
    loadPage.mockResolvedValue(
      view({ statistics: { ok: false }, charts: { ok: false }, breakdowns: { ok: false } })
    );
    await renderPage();

    expect(screen.getByText(COPY.statistics.loadFailed)).toBeInTheDocument();
    expect(screen.queryByText(COPY.statistics.confirmedCount)).not.toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
  });

  /**
   * The service catches the read and returns `{ ok: false }`. This covers the
   * thin ring around it — resolving the period and building the composition
   * root — which would otherwise escape to the route's error boundary and
   * replace a page that could explain itself with a generic one.
   */
  it('should_survive_the_service_throwing_rather_than_returning_a_failure', async () => {
    loadPage.mockRejectedValue(new Error('composition root exploded'));
    await renderPage({ rango: 'mes-anterior' });

    expect(screen.getByText(COPY.statistics.loadFailed)).toBeInTheDocument();
    expect(screen.queryByText(COPY.statistics.confirmedCount)).not.toBeInTheDocument();
  });

  it('should_keep_the_selected_period_marked_when_the_service_throws', async () => {
    // An owner who cannot tell which period failed has been told less than
    // nothing, so the fallback view is built from the resolved range.
    loadPage.mockRejectedValue(new Error('boom'));
    await renderPage({ rango: 'semana-anterior' });

    const marked = screen.getAllByRole('link').filter((link) => link.hasAttribute('aria-current'));
    expect(marked[0]).toHaveTextContent(COPY.statistics.ranges['semana-anterior']);
  });

  it('should_log_a_thrown_failure_with_an_operation_name_and_no_money', async () => {
    loadPage.mockRejectedValue(new Error('boom'));
    await renderPage();

    expect(loggerError).toHaveBeenCalledTimes(1);
    const [, context] = loggerError.mock.calls[0]!;
    expect((context as { operation: string }).operation).toBe('loadStatistics');
    expect(JSON.stringify(context)).not.toMatch(/\d+\.\d{2}/);
  });

  it('should_tell_a_shop_that_has_never_had_a_booking', async () => {
    loadPage.mockResolvedValue(
      view({
        statistics: {
          ok: true,
          value: figures({
            confirmedCount: 0,
            cancelledCount: 0,
            cancelledByOwner: 0,
            cancelledByClient: 0,
            uniqueClients: 0,
            depositTotal: '0.00',
            hasAnyBookingEver: false,
          }),
        },
      })
    );
    await renderPage();

    expect(screen.getByText(COPY.statistics.emptyShop)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: COPY.statistics.emptyShopLink })).toBeInTheDocument();
  });

  it('should_tell_a_quiet_period_apart_from_an_empty_business', async () => {
    loadPage.mockResolvedValue(
      view({
        range: 'ayer',
        statistics: {
          ok: true,
          value: figures({
            confirmedCount: 0,
            cancelledCount: 0,
            cancelledByOwner: 0,
            cancelledByClient: 0,
            uniqueClients: 0,
            depositTotal: '0.00',
            hasAnyBookingEver: true,
          }),
        },
      })
    );
    await renderPage();

    // Naming the period is what makes this different from the state above —
    // telling an owner with two years of history that nobody has ever booked
    // because yesterday was slow is false in a way they would notice.
    expect(screen.getByText('No hubo turnos ayer.')).toBeInTheDocument();
    expect(screen.queryByText(COPY.statistics.emptyShop)).not.toBeInTheDocument();
  });

  /**
   * The literal sentences, because the runtime pass found four of the six were
   * wrong and no assertion could have known.
   *
   * The original copy composed `en ${label}` and the test compared that
   * composition against itself — both sides equally wrong, green suite, and
   * "No hubo turnos **en hoy**" on the page. Spelling the expected Spanish out
   * is the only form of this test that can fail for the right reason.
   */
  it.each([
    ['hoy', 'No hubo turnos hoy.'],
    ['ayer', 'No hubo turnos ayer.'],
    ['semana', 'No hubo turnos esta semana.'],
    ['semana-anterior', 'No hubo turnos la semana pasada.'],
    ['mes', 'No hubo turnos este mes.'],
    ['mes-anterior', 'No hubo turnos el mes pasado.'],
  ] as const)('should_name_the_period_as_%s_reads_in_spanish', async (range, sentence) => {
    loadPage.mockResolvedValue(
      view({
        range,
        statistics: {
          ok: true,
          value: figures({
            confirmedCount: 0,
            cancelledCount: 0,
            cancelledByOwner: 0,
            cancelledByClient: 0,
            uniqueClients: 0,
            depositTotal: '0.00',
            hasAnyBookingEver: true,
          }),
        },
      })
    );
    await renderPage();

    expect(screen.getByText(sentence)).toBeInTheDocument();
  });

  it('should_not_offer_this_month_when_this_month_is_what_is_empty', async () => {
    // A link back to the page you are already on is worse than no link.
    loadPage.mockResolvedValue(
      view({
        range: 'mes',
        statistics: {
          ok: true,
          value: figures({
            confirmedCount: 0,
            cancelledCount: 0,
            cancelledByOwner: 0,
            cancelledByClient: 0,
            uniqueClients: 0,
            depositTotal: '0.00',
            hasAnyBookingEver: true,
          }),
        },
      })
    );
    await renderPage();

    expect(screen.getByText('No hubo turnos este mes.')).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: COPY.statistics.emptyPeriodLink })
    ).not.toBeInTheDocument();
  });

  it('should_still_show_the_figures_for_a_period_with_only_cancellations', async () => {
    // Not a quiet period: something happened, and it is the thing the owner
    // most wants to see.
    loadPage.mockResolvedValue(
      view({
        statistics: {
          ok: true,
          value: figures({
            confirmedCount: 0,
            depositTotal: '0.00',
            cancelledCount: 2,
            uniqueClients: 0,
          }),
        },
      })
    );
    await renderPage();

    expect(screen.getByText(COPY.statistics.cancelledCount)).toBeInTheDocument();
    expect(screen.queryByText(COPY.statistics.emptyPeriodHint)).not.toBeInTheDocument();
  });
});

describe('StatisticsPage - what it must not render or log', () => {
  it('should_wrap_a_sum_far_larger_than_any_single_price', async () => {
    loadPage.mockResolvedValue(
      view({
        statistics: {
          ok: true,
          value: figures({ depositTotal: '45000000.00', confirmedCount: 10_000 }),
        },
      })
    );
    await renderPage();

    const value = screen.getAllByText(/45\.000\.000,00/)[0]!;
    // The T18 family: a long unbroken value must wrap inside its card rather
    // than push the page sideways.
    expect(value.className).toContain('break-words');
    expect(value.className).toContain('min-w-0');
  });

  it('should_carry_no_client_name_email_or_telephone_anywhere', async () => {
    await renderPage();

    // The projection has none by construction; this pins that the page never
    // grows one, since nothing here would look wrong if it did.
    expect(document.body.textContent).not.toMatch(/@/);
  });
});

// ---------------------------------------------------------------------------
// D6 — the charts, the sixth figure, and the states they can be in
// ---------------------------------------------------------------------------

describe('StatisticsPage - the charts', () => {
  it('should_name_the_income_chart_after_the_period_it_actually_drew', async () => {
    await renderPage();

    expect(
      screen.getByRole('img', {
        name: COPY.statistics.incomeChartLabel(COPY.statistics.rangesInPhrase.hoy),
      })
    ).toBeInTheDocument();
  });

  it('should_name_the_method_split_when_there_is_a_split_to_draw', async () => {
    // Only when there is more than one part. The default fixture has a single
    // method and is asserted below as a sentence rather than a picture.
    loadPage.mockResolvedValue(
      view({
        charts: {
          ok: true,
          value: charts({
            rows: [
              { bucket: 12, method: 'MERCADO_PAGO', total: '7500.00', payments: 3 },
              { bucket: 12, method: 'BANK_TRANSFER', total: '2500.00', payments: 1 },
            ],
          }),
        },
      })
    );
    await renderPage();

    expect(screen.getByRole('img', { name: COPY.statistics.methodsChartLabel })).toBeInTheDocument();
  });

  it('should_carry_every_drawn_value_in_text_as_well', async () => {
    // A chart is an image to a screen reader. The table is the equivalent, not
    // a debugging aid, so it has to be present and complete.
    await renderPage();

    const table = screen.getByRole('table', { name: COPY.statistics.incomeChartTableCaption });
    // 24 hourly buckets plus the header row.
    expect(within(table).getAllByRole('row')).toHaveLength(25);
  });

  it('should_draw_one_bucket_per_hour_for_a_single_day_and_one_per_day_for_a_month', async () => {
    await renderPage();
    expect(
      within(
        screen.getByRole('table', { name: COPY.statistics.incomeChartTableCaption })
      ).getAllByRole('row')
    ).toHaveLength(25);

    cleanup();
    loadPage.mockResolvedValue(
      view({ range: 'mes', edges: bucketEdgesFor('mes', TODAY), charts: { ok: true, value: charts() } })
    );
    await renderPage({ rango: 'mes' });

    // August 2026 has 31 days.
    expect(
      within(
        screen.getByRole('table', { name: COPY.statistics.incomeChartTableCaption })
      ).getAllByRole('row')
    ).toHaveLength(32);
  });

  it('should_render_a_quiet_bucket_as_zero_rather_than_omitting_it', async () => {
    // The defect this exists to prevent draws a plausible shape on a shorter
    // axis. Only one of the 24 hours has money; the other 23 must be present.
    await renderPage();

    const table = screen.getByRole('table', { name: COPY.statistics.incomeChartTableCaption });
    expect(within(table).getAllByText('$ 0,00')).toHaveLength(23);
    expect(within(table).getAllByText(/9\.000,00/).length).toBeGreaterThan(0);
  });

  it('should_state_the_single_method_case_instead_of_drawing_a_share_of_one_part', async () => {
    // The permanent state of every owner who configured one payment method.
    await renderPage();

    expect(
      screen.getByText(
        COPY.statistics.methodsChartSingle(
          COPY.statistics.methods.MERCADO_PAGO,
          '$ 9.000,00',
          COPY.statistics.methodPaymentCount(4)
        )
      )
    ).toBeInTheDocument();
  });

  it('should_draw_the_split_when_both_methods_were_used', async () => {
    loadPage.mockResolvedValue(
      view({
        charts: {
          ok: true,
          value: charts({
            rows: [
              { bucket: 12, method: 'MERCADO_PAGO', total: '7500.00', payments: 3 },
              { bucket: 12, method: 'BANK_TRANSFER', total: '2500.00', payments: 1 },
            ],
          }),
        },
      })
    );
    await renderPage();

    expect(screen.getByText(COPY.statistics.methods.MERCADO_PAGO)).toBeInTheDocument();
    expect(screen.getByText(COPY.statistics.methods.BANK_TRANSFER)).toBeInTheDocument();
    // Colour is never the only encoder: each part states its amount and count.
    expect(screen.getByText(COPY.statistics.methodPaymentCount(3))).toBeInTheDocument();
    expect(screen.getByText(COPY.statistics.methodPaymentCount(1))).toBeInTheDocument();
  });

  it('should_say_so_when_the_period_had_appointments_but_collected_nothing', async () => {
    // An answer, not an absence — so the axis is still drawn, at zero.
    loadPage.mockResolvedValue(
      view({ charts: { ok: true, value: charts({ rows: [], cashCollected: '0.00' }) } })
    );
    await renderPage();

    expect(screen.getByText(COPY.statistics.incomeChartAllZero)).toBeInTheDocument();
    expect(screen.getByText(COPY.statistics.methodsChartEmpty)).toBeInTheDocument();
  });
});

describe('StatisticsPage - the charts and the figures fail apart', () => {
  it('should_keep_the_figures_when_only_the_charts_failed', async () => {
    // The property the rejected shared transaction would have destroyed. The
    // chart read is the heavier one, so this is the likely failure.
    loadPage.mockResolvedValue(view({ charts: { ok: false } }));
    await renderPage();

    expect(screen.getByText(COPY.statistics.confirmedCount)).toBeInTheDocument();
    expect(screen.getByText(COPY.statistics.chartsFailed)).toBeInTheDocument();
    expect(screen.getByText(COPY.statistics.chartsFailedHelp)).toBeInTheDocument();
  });

  it('should_never_draw_a_zero_series_for_a_failed_chart_read', async () => {
    // A flat line at zero is a statement about the business and is
    // indistinguishable from a period that earned nothing.
    loadPage.mockResolvedValue(view({ charts: { ok: false } }));
    await renderPage();

    expect(
      screen.queryByRole('table', { name: COPY.statistics.incomeChartTableCaption })
    ).not.toBeInTheDocument();
    // Named rather than "no image at all" since D7: the breakdowns are three
    // more drawings on this page and they succeeded, which is the whole point
    // of the reads failing independently. What must be absent is *this* chart.
    expect(
      screen.queryByRole('img', {
        name: COPY.statistics.incomeChartLabel(COPY.statistics.rangesInPhrase.hoy),
      })
    ).not.toBeInTheDocument();
  });

  it('should_hide_the_cash_figure_rather_than_zero_it_when_the_chart_read_failed', async () => {
    // It comes from the failed read. A money card reading `$ 0,00` because a
    // query timed out is a false statement about the business.
    loadPage.mockResolvedValue(view({ charts: { ok: false } }));
    await renderPage();

    expect(screen.queryByText(COPY.statistics.cashCollected)).not.toBeInTheDocument();
  });

  it('should_show_no_chart_at_all_for_a_shop_that_has_never_had_a_booking', async () => {
    loadPage.mockResolvedValue(
      view({ statistics: { ok: true, value: figures({ hasAnyBookingEver: false }) } })
    );
    await renderPage();

    expect(screen.getByText(COPY.statistics.emptyShop)).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.queryByText(COPY.statistics.incomeChartHeading)).not.toBeInTheDocument();
  });
});

describe('StatisticsPage - the sixth figure states its own basis', () => {
  it('should_render_the_cash_collected_figure_from_the_chart_read', async () => {
    await renderPage();

    expect(screen.getByText(COPY.statistics.cashCollected)).toBeInTheDocument();
    expect(screen.getAllByText(/7\.500,00/).length).toBeGreaterThan(0);
  });

  it('should_warn_that_it_will_not_match_the_deposits_figure', async () => {
    // T83's entire mitigation. Both figures are right and they disagree; an
    // owner who finds that out alone concludes one of them is broken.
    await renderPage();

    expect(screen.getByText(COPY.statistics.cashCollectedHelp)).toBeInTheDocument();
  });
});

describe('StatisticsPage - a period with no appointments claims nothing about turnos', () => {
  /**
   * **Found by D6's adversarial pass, and it is a false statement rather than
   * a layout complaint.**
   *
   * `Figures` returns the empty-period card when a period has neither confirmed
   * appointments nor cancellations. `Charts` did not know that, so it rendered
   * beneath it — and every bucket being zero triggered the copy *"Hubo turnos,
   * pero todavía no se cobró ninguna seña"*. There were no turnos. The page said
   * there were.
   *
   * Every existing test missed it because they all render a period that has
   * figures. The empty-period case had never been rendered with the charts
   * present.
   */
  const quiet = { ok: true as const, value: figures({ confirmedCount: 0, cancelledCount: 0, cancelledByOwner: 0, cancelledByClient: 0, uniqueClients: 0, depositTotal: '0.00' }) };

  it('should_not_claim_there_were_appointments_when_the_period_had_none', async () => {
    loadPage.mockResolvedValue(
      view({ statistics: quiet, charts: { ok: true, value: charts({ rows: [], cashCollected: '0.00' }) } })
    );
    await renderPage();

    expect(screen.getByText(COPY.statistics.emptyPeriod(COPY.statistics.rangesInPhrase.hoy))).toBeInTheDocument();
    expect(screen.queryByText(COPY.statistics.incomeChartAllZero)).not.toBeInTheDocument();
  });

  it('should_draw_no_chart_at_all_for_a_period_with_no_appointments', async () => {
    // The same rule the empty-business state already follows: an empty axis
    // under a message saying the period was empty is noise at best.
    loadPage.mockResolvedValue(
      view({ statistics: quiet, charts: { ok: true, value: charts({ rows: [], cashCollected: '0.00' }) } })
    );
    await renderPage();

    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.queryByText(COPY.statistics.incomeChartHeading)).not.toBeInTheDocument();
  });

  it('should_still_draw_the_zero_series_when_appointments_happened_and_collected_nothing', async () => {
    // The neighbouring case, and the one that must NOT be swept up by the fix:
    // appointments happened and earned nothing is an answer, and the axis says so.
    loadPage.mockResolvedValue(
      view({
        statistics: { ok: true, value: figures({ confirmedCount: 2, depositTotal: '0.00' }) },
        charts: { ok: true, value: charts({ rows: [], cashCollected: '0.00' }) },
      })
    );
    await renderPage();

    expect(screen.getByText(COPY.statistics.incomeChartAllZero)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: COPY.statistics.incomeChartLabel(COPY.statistics.rangesInPhrase.hoy) })).toBeInTheDocument();
  });
});

describe('StatisticsPage - a double failure does not vouch for numbers that are absent', () => {
  /**
   * **The second finding of D6's adversarial pass, and the same shape as the
   * first: copy asserting a state nothing checked.**
   *
   * `chartsFailedHelp` reassures the owner that *"los números de arriba sí están
   * actualizados"* — which is the right thing to say when only the chart read
   * failed, and false when both did. The figures' own failure card is already on
   * screen saying the opposite.
   *
   * Independent failure is the feature; claiming a half succeeded when neither
   * did is not.
   */
  it('should_show_only_the_figures_failure_when_both_reads_failed', async () => {
    loadPage.mockResolvedValue(view({ statistics: { ok: false }, charts: { ok: false } }));
    await renderPage();

    expect(screen.getByText(COPY.statistics.loadFailed)).toBeInTheDocument();
    expect(screen.queryByText(COPY.statistics.chartsFailed)).not.toBeInTheDocument();
    expect(screen.queryByText(COPY.statistics.chartsFailedHelp)).not.toBeInTheDocument();
  });

  it('should_still_reassure_about_the_figures_when_only_the_charts_failed', async () => {
    // The case the sentence was written for, and it must survive the fix.
    loadPage.mockResolvedValue(view({ charts: { ok: false } }));
    await renderPage();

    expect(screen.getByText(COPY.statistics.confirmedCount)).toBeInTheDocument();
    expect(screen.getByText(COPY.statistics.chartsFailedHelp)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// D7 — the two rankings, the hour distribution, and the states around them
// ---------------------------------------------------------------------------

describe('StatisticsPage - the breakdowns (D7)', () => {
  it('should_render_all_three_sections_for_a_period_with_appointments', async () => {
    await renderPage();

    expect(screen.getByText(COPY.statistics.servicesChartHeading)).toBeInTheDocument();
    expect(screen.getByText(COPY.statistics.barbersChartHeading)).toBeInTheDocument();
    expect(screen.getByText(COPY.statistics.hoursChartHeading)).toBeInTheDocument();
  });

  it('should_name_every_service_and_barber_it_counted', async () => {
    loadPage.mockResolvedValue(
      view({
        breakdowns: {
          ok: true,
          value: {
            services: [
              { key: 'svc-1', label: 'Corte', sublabel: null, count: 3 },
              { key: 'svc-2', label: 'Barba', sublabel: null, count: 1 },
            ],
            barbers: [
              { key: 'bar-1', label: 'Nico', sublabel: 'Centro', count: 3 },
              { key: 'bar-2', label: 'Ana', sublabel: 'Centro', count: 1 },
            ],
            hours: [{ bucket: 14, count: 4 }],
          },
        },
      })
    );

    await renderPage();

    for (const name of ['Corte', 'Barba', 'Nico', 'Ana']) {
      expect(screen.getAllByText(new RegExp(name)).length).toBeGreaterThan(0);
    }
  });

  it('should_qualify_two_barbers_of_the_same_name_by_their_location', async () => {
    loadPage.mockResolvedValue(
      view({
        breakdowns: {
          ok: true,
          value: {
            services: [{ key: 'svc-1', label: 'Corte', sublabel: null, count: 4 }],
            barbers: [
              { key: 'bar-1', label: 'Nico', sublabel: 'Centro', count: 3 },
              { key: 'bar-2', label: 'Nico', sublabel: 'Norte', count: 1 },
            ],
            hours: [{ bucket: 14, count: 4 }],
          },
        },
      })
    );

    await renderPage();

    expect(screen.getAllByText(/Centro/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Norte/).length).toBeGreaterThan(0);
  });

  it('should_state_a_single_barber_rather_than_drawing_a_ranking_of_one', async () => {
    // A ranking of one is not a ranking, and a bar at a hundred percent is not
    // information. The same treatment a single payment method already gets.
    loadPage.mockResolvedValue(
      view({
        breakdowns: {
          ok: true,
          value: {
            services: [
              { key: 'svc-1', label: 'Corte', sublabel: null, count: 3 },
              { key: 'svc-2', label: 'Barba', sublabel: null, count: 1 },
            ],
            barbers: [{ key: 'bar-1', label: 'Nico', sublabel: 'Centro', count: 4 }],
            hours: [{ bucket: 14, count: 4 }],
          },
        },
      })
    );

    await renderPage();

    expect(screen.getByText(COPY.statistics.barbersChartSingle('Nico', 4))).toBeInTheDocument();
  });

  it('should_state_a_single_service_rather_than_drawing_a_ranking_of_one', async () => {
    loadPage.mockResolvedValue(
      view({
        breakdowns: {
          ok: true,
          value: {
            services: [{ key: 'svc-1', label: 'Corte', sublabel: null, count: 4 }],
            barbers: [
              { key: 'bar-1', label: 'Nico', sublabel: 'Centro', count: 3 },
              { key: 'bar-2', label: 'Ana', sublabel: 'Centro', count: 1 },
            ],
            hours: [{ bucket: 14, count: 4 }],
          },
        },
      })
    );

    await renderPage();

    expect(screen.getByText(COPY.statistics.servicesChartSingle('Corte', 4))).toBeInTheDocument();
  });

  it('should_reach_every_hour_of_the_day_in_the_table_including_the_empty_ones', async () => {
    await renderPage();

    const table = screen.getByRole('table', { name: COPY.statistics.hoursChartTableCaption });
    // Twenty-four hours plus the header row.
    expect(within(table).getAllByRole('row')).toHaveLength(25);
  });

  it('should_tabulate_the_aggregated_remainder_and_never_draw_it_as_a_bar', async () => {
    // A bar whose height aggregates unlike things invites being read as one
    // thing, and in a wide catalogue it is often the longest.
    loadPage.mockResolvedValue(
      view({
        statistics: { ok: true, value: figures({ confirmedCount: 45 }) },
        breakdowns: {
          ok: true,
          value: {
            services: Array.from({ length: 12 }, (_, index) => ({
              key: 'svc-' + index,
              label: 'S' + index,
              sublabel: null,
              count: 12 - index,
            })),
            barbers: [
              { key: 'bar-1', label: 'Nico', sublabel: null, count: 40 },
              { key: 'bar-2', label: 'Ana', sublabel: null, count: 5 },
            ],
            hours: [{ bucket: 14, count: 45 }],
          },
        },
      })
    );

    await renderPage();

    const table = screen.getByRole('table', { name: COPY.statistics.servicesChartTableCaption });
    expect(within(table).getByText(COPY.statistics.rankingOthers)).toBeInTheDocument();

    // Eight named bars, and the remainder is not among them.
    const chart = screen.getByRole('img', {
      name: COPY.statistics.servicesChartLabel(COPY.statistics.rangesInPhrase.hoy),
    });
    expect(chart.querySelectorAll('rect')).toHaveLength(8);
  });

  it('should_show_the_aggregated_remainder_to_someone_looking_at_the_page', async () => {
    // **The worst defect of this change, found by its second adversarial pass.**
    // The aggregate was in the sr-only table and nowhere else, so the shares a
    // sighted owner could see summed to 84% of the period with nothing on screen
    // accounting for the rest — and the obvious reading of that is "a number is
    // missing". It is listed with the rows and drawn as no bar.
    loadPage.mockResolvedValue(
      view({
        statistics: { ok: true, value: figures({ confirmedCount: 45 }) },
        breakdowns: {
          ok: true,
          value: {
            ...breakdowns(),
            services: Array.from({ length: 12 }, (_, index) => ({
              key: 'svc-' + index,
              label: 'S' + index,
              sublabel: null,
              count: 12 - index,
            })),
          },
        },
      })
    );

    await renderPage();

    const visible = document.querySelectorAll('[aria-hidden="true"]');
    const listedOutsideTheTable = [...visible].some((node) =>
      node.textContent?.includes(COPY.statistics.rankingOthers)
    );
    expect(listedOutsideTheTable).toBe(true);
  });

  it('should_announce_the_ranking_once_rather_than_twice', async () => {
    // The visible list and the sr-only table are the same numbers in the same
    // order; announced together a screen reader reads the whole ranking twice.
    // `sr-only` hides from sight, not from assistive technology.
    await renderPage();

    const chart = screen.getByRole('img', {
      name: COPY.statistics.servicesChartLabel(COPY.statistics.rangesInPhrase.hoy),
    });
    const section = chart.closest('section');
    const list = section?.querySelector('div.flex.flex-col.gap-1');

    expect(list?.getAttribute('aria-hidden')).toBe('true');
    expect(section?.querySelector('table')?.getAttribute('aria-hidden')).toBeNull();
  });
});

describe('StatisticsPage - when the breakdowns are not three sections (D7)', () => {
  it('should_report_a_failed_breakdown_read_without_drawing_an_empty_ranking', async () => {
    loadPage.mockResolvedValue(view({ breakdowns: { ok: false } }));

    await renderPage();

    expect(screen.getByText(COPY.statistics.breakdownsFailed)).toBeInTheDocument();
    expect(screen.queryByText(COPY.statistics.servicesChartHeading)).not.toBeInTheDocument();
    expect(screen.queryByText(COPY.statistics.hoursChartHeading)).not.toBeInTheDocument();
  });

  it('should_keep_the_figures_and_the_charts_through_a_failed_breakdown_read', async () => {
    loadPage.mockResolvedValue(view({ breakdowns: { ok: false } }));

    await renderPage();

    expect(screen.getByText(COPY.statistics.confirmedCount)).toBeInTheDocument();
    expect(screen.getByText(COPY.statistics.incomeChartHeading)).toBeInTheDocument();
  });

  it('should_say_nothing_about_the_breakdowns_when_the_figures_failed_too', async () => {
    // The D6 defect, one section further down: copy that reports a partial
    // failure implies the rest is current, and printing it beneath a card
    // apologising for the figures makes that a false statement.
    loadPage.mockResolvedValue(
      view({ statistics: { ok: false }, charts: { ok: false }, breakdowns: { ok: false } })
    );

    await renderPage();

    expect(screen.getByText(COPY.statistics.loadFailed)).toBeInTheDocument();
    expect(screen.queryByText(COPY.statistics.breakdownsFailed)).not.toBeInTheDocument();
    expect(screen.queryByText(COPY.statistics.chartsFailed)).not.toBeInTheDocument();
  });

  it('should_draw_no_breakdown_for_a_period_with_cancellations_and_no_confirmations', async () => {
    // The whole point of the confirmed-activity predicate. `hasSomethingToReport`
    // is true here — something did happen — so the figures render; every
    // breakdown counts confirmations only, so three empty sections would appear
    // beneath them explaining nothing.
    loadPage.mockResolvedValue(
      view({
        statistics: { ok: true, value: figures({ confirmedCount: 0, cancelledCount: 3 }) },
        breakdowns: { ok: true, value: { services: [], barbers: [], hours: [] } },
      })
    );

    await renderPage();

    expect(screen.getByText(COPY.statistics.cancelledCount)).toBeInTheDocument();
    expect(screen.queryByText(COPY.statistics.servicesChartHeading)).not.toBeInTheDocument();
    expect(screen.queryByText(COPY.statistics.barbersChartHeading)).not.toBeInTheDocument();
    expect(screen.queryByText(COPY.statistics.hoursChartHeading)).not.toBeInTheDocument();
  });

  it('should_draw_no_breakdown_for_a_period_with_nothing_in_it', async () => {
    loadPage.mockResolvedValue(
      view({
        statistics: { ok: true, value: figures({ confirmedCount: 0, cancelledCount: 0 }) },
        breakdowns: { ok: true, value: { services: [], barbers: [], hours: [] } },
      })
    );

    await renderPage();

    expect(screen.queryByText(COPY.statistics.hoursChartHeading)).not.toBeInTheDocument();
  });

  it('should_draw_no_breakdown_for_a_shop_nobody_has_ever_booked_with', async () => {
    loadPage.mockResolvedValue(
      view({
        statistics: { ok: true, value: figures({ hasAnyBookingEver: false }) },
        breakdowns: { ok: true, value: { services: [], barbers: [], hours: [] } },
      })
    );

    await renderPage();

    expect(screen.getByText(COPY.statistics.emptyShop)).toBeInTheDocument();
    expect(screen.queryByText(COPY.statistics.hoursChartHeading)).not.toBeInTheDocument();
  });

  it('should_draw_nothing_when_the_breakdowns_are_empty_and_the_figures_say_otherwise', async () => {
    // Found by D7's adversarial pass. The two reads are independent by design
    // and can disagree, and `fillHourlyDistribution` answers an empty grouping
    // with twenty-four honest zeros — rendered beneath a figure reporting four
    // appointments, that is a chart stating none of them started at any hour.
    loadPage.mockResolvedValue(
      view({
        statistics: { ok: true, value: figures({ confirmedCount: 4 }) },
        breakdowns: { ok: true, value: { services: [], barbers: [], hours: [] } },
      })
    );

    await renderPage();

    expect(screen.getByText(COPY.statistics.confirmedCount)).toBeInTheDocument();
    expect(screen.queryByText(COPY.statistics.hoursChartHeading)).not.toBeInTheDocument();
    expect(screen.queryByText(COPY.statistics.breakdownsFailed)).not.toBeInTheDocument();
  });

  it('should_still_render_the_breakdowns_when_only_the_figures_failed', async () => {
    // Independent failure is the feature, and a ranking that loaded is not made
    // false by a figure that did not.
    loadPage.mockResolvedValue(view({ statistics: { ok: false } }));

    await renderPage();

    expect(screen.getByText(COPY.statistics.loadFailed)).toBeInTheDocument();
    expect(screen.getByText(COPY.statistics.hoursChartHeading)).toBeInTheDocument();
  });

  it('should_report_no_failure_for_the_breakdowns_when_the_period_was_empty', async () => {
    // A period with nothing in it has no breakdown worth reporting a failure
    // for, so the suppression is checked before the failure state.
    loadPage.mockResolvedValue(
      view({
        statistics: { ok: true, value: figures({ confirmedCount: 0, cancelledCount: 0 }) },
        breakdowns: { ok: false },
      })
    );

    await renderPage();

    expect(screen.queryByText(COPY.statistics.breakdownsFailed)).not.toBeInTheDocument();
  });
});

describe('StatisticsPage - the breakdowns are readable without seeing them (D7)', () => {
  it('should_give_every_drawn_breakdown_a_table_equivalent', async () => {
    await renderPage();

    for (const caption of [
      COPY.statistics.servicesChartTableCaption,
      COPY.statistics.barbersChartTableCaption,
      COPY.statistics.hoursChartTableCaption,
    ]) {
      expect(screen.getByRole('table', { name: caption })).toBeInTheDocument();
    }
  });

  it('should_give_every_drawn_breakdown_an_accessible_name', async () => {
    await renderPage();

    const phrase = COPY.statistics.rangesInPhrase.hoy;
    for (const label of [
      COPY.statistics.servicesChartLabel(phrase),
      COPY.statistics.barbersChartLabel(phrase),
      COPY.statistics.hoursChartLabel(phrase),
    ]) {
      expect(screen.getByRole('img', { name: label })).toBeInTheDocument();
    }
  });

  it('should_never_repeat_an_element_id_across_the_page', async () => {
    // Five inline drawings on one page. A shared clipPath or pattern id is a
    // duplicate in the document and a real cross-chart rendering bug, and an id
    // derived from a random value is a hydration mismatch in waiting.
    const { container } = render(
      await StatisticsPage({ searchParams: Promise.resolve({}) })
    );

    const ids = [...container.querySelectorAll('[id]')].map((node) => node.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('should_name_no_client_anywhere_in_the_breakdowns', async () => {
    await renderPage();

    // The projection carries service, barber and location names and nothing
    // else; a client's name reaching this page would be a privacy regression
    // rather than a rendering one.
    expect(document.body.textContent).not.toMatch(/@/);
  });
});
