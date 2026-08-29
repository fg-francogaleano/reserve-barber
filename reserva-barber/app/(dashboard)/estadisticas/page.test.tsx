import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { COPY } from '@/lib/copy';
import type { StatisticsView } from '@/server/application/services/StatisticsService';
import type { BusinessStatistics } from '@/server/domain/models/statistics';

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

function view(overrides: Partial<StatisticsView> = {}): StatisticsView {
  return {
    range: 'hoy',
    today: { year: 2026, month: 8, day: 16 },
    statistics: { ok: true, value: figures() },
    ...overrides,
  };
}

async function renderPage(searchParams: Record<string, string | string[] | undefined> = {}) {
  render(await StatisticsPage({ searchParams: Promise.resolve(searchParams) }));
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

    expect(screen.getByText('0')).toBeInTheDocument();
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

    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.queryByText(COPY.statistics.cancelledByClient(0))).not.toBeInTheDocument();
  });
});

describe('StatisticsPage - three states that must not look alike', () => {
  it('should_report_a_failed_read_as_a_failure_and_never_as_zeros', async () => {
    loadPage.mockResolvedValue(view({ statistics: { ok: false } }));
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
