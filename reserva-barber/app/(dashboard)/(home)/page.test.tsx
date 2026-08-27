import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { COPY } from '@/lib/copy';
import type { DashboardHomeView } from '@/server/application/services/DashboardSummaryService';
import type { RecentBooking } from '@/server/domain/models/dashboardSummary';

const requireOwner = vi.fn(async () => ({
  id: 'owner-root',
  email: 'owner@example.com',
  authUserId: 'auth-uuid',
}));
const loadHome = vi.fn();

vi.mock('@/server/infrastructure/supabase/requireOwner', () => ({
  requireOwner: () => requireOwner(),
}));
vi.mock('./dashboardSummaryService', () => ({
  dashboardSummaryService: () => ({ loadHome }),
}));
// The cancel control imports the action, which reaches `server-only` through
// its composition root — unresolvable in the component environment. The action
// has its own test; what this file asserts is where the control appears.
vi.mock('./actions', () => ({ cancelBookingAction: vi.fn() }));

const { default: DashboardHome } = await import('./page');

function booking(overrides: Partial<RecentBooking> = {}): RecentBooking {
  return {
    id: 'bkg-1',
    startTime: new Date('2026-08-23T13:00:00.000Z'),
    status: 'CONFIRMED',
    // C1: nobody cancelled by default. Tests that need one opt in.
    cancelledBy: null,
    clientName: 'Ana Pérez',
    serviceName: 'Corte',
    barberDisplayName: 'Leo',
    depositAmount: '5000.50',
    ...overrides,
  };
}

function view(overrides: Partial<DashboardHomeView> = {}): DashboardHomeView {
  return {
    summary: {
      ok: true,
      value: {
        confirmedToday: 3,
        heldToday: 2,
        cancelledToday: 1,
        confirmedAllTime: 41,
        pendingReceipts: 4,
        monthDepositIncome: '2000.50',
      },
    },
    recent: { ok: true, value: [booking()] },
    barbers: [
      { id: 'bar-leo', displayName: 'Leo' },
      { id: 'bar-nico', displayName: 'Nico' },
    ],
    selectedBarberId: undefined,
    ...overrides,
  };
}

async function renderPage(
  next: DashboardHomeView = view(),
  searchParams: Record<string, string | string[] | undefined> = {}
) {
  loadHome.mockResolvedValue(next);
  return render(await DashboardHome({ searchParams: Promise.resolve(searchParams) }));
}

beforeEach(() => {
  loadHome.mockReset();
});

describe('the counters', () => {
  it('renders every figure with a label that names what it counts', async () => {
    await renderPage();

    expect(screen.getByText(COPY.dashboard.confirmedToday)).toBeInTheDocument();
    expect(screen.getByText(COPY.dashboard.cancelledToday)).toBeInTheDocument();
    // Not "Turnos totales": the label has to say it counts confirmations, or
    // the number is not checkable by the person reading it.
    expect(screen.getByText(COPY.dashboard.confirmedAllTime)).toBeInTheDocument();
    expect(screen.getByText(COPY.dashboard.pendingReceipts)).toBeInTheDocument();
    expect(screen.getByText('41')).toBeInTheDocument();
  });

  it('renders the deposit income formatted and qualified as deposits', async () => {
    await renderPage();

    // The trailing zero survives: 2000.50, never 2000.5 read as five centavos.
    expect(screen.getByText(/2\.000,50/)).toBeInTheDocument();
    expect(screen.getByText(COPY.dashboard.monthIncomeHelp)).toBeInTheDocument();
  });

  it('keeps held bookings as a separate figure from confirmed ones', async () => {
    await renderPage();

    expect(screen.getByText('3')).toBeInTheDocument();
    // Never summed into the confirmed count — the two answer different
    // questions and 5 would answer neither.
    expect(screen.queryByText('5')).not.toBeInTheDocument();
    expect(screen.getByText(new RegExp(COPY.dashboard.heldToday(2)))).toBeInTheDocument();
  });

  it('omits the held line entirely when nothing is in flight', async () => {
    await renderPage(
      view({
        summary: {
          ok: true,
          value: {
            confirmedToday: 3,
            heldToday: 0,
            cancelledToday: 0,
            confirmedAllTime: 41,
            pendingReceipts: 0,
            monthDepositIncome: '0.00',
          },
        },
      })
    );

    expect(screen.queryByText(new RegExp(COPY.dashboard.heldTodayHelp))).not.toBeInTheDocument();
  });

  it('renders a genuine zero as a number, not as a failure', async () => {
    await renderPage(
      view({
        summary: {
          ok: true,
          value: {
            confirmedToday: 0,
            heldToday: 0,
            cancelledToday: 0,
            confirmedAllTime: 0,
            pendingReceipts: 0,
            monthDepositIncome: '0.00',
          },
        },
      })
    );

    expect(screen.getAllByText('0').length).toBeGreaterThan(0);
    expect(screen.queryByText(COPY.dashboard.countersFailed)).not.toBeInTheDocument();
  });
});

describe('a failed read', () => {
  it('says the figures could not load and renders no counter at all', async () => {
    const { container } = await renderPage(view({ summary: { ok: false } }));

    expect(screen.getByText(COPY.dashboard.countersFailed)).toBeInTheDocument();
    // The defect this state exists to prevent: an income card silently reading
    // $0,00 is a false statement about money, and indistinguishable from a
    // shop that earned nothing. Scoped to the counter grid rather than the
    // whole page, because the recent list is still rendering — which is the
    // independent degradation working, not a leak.
    expect(container.querySelector('dl')).toBeNull();
    expect(screen.queryByText(COPY.dashboard.monthIncome)).not.toBeInTheDocument();
    expect(screen.queryByText(COPY.dashboard.confirmedAllTime)).not.toBeInTheDocument();
  });

  it('keeps the recent list when only the counters failed', async () => {
    await renderPage(view({ summary: { ok: false } }));

    expect(screen.getByText('Ana Pérez', { exact: false })).toBeInTheDocument();
  });

  it('keeps the counters when only the list failed', async () => {
    await renderPage(view({ recent: { ok: false } }));

    expect(screen.getByText(COPY.dashboard.recentFailed)).toBeInTheDocument();
    expect(screen.getByText('41')).toBeInTheDocument();
  });
});

describe('the recent list', () => {
  it('renders a booking with its client, service and deposit', async () => {
    await renderPage();

    expect(screen.getByText(/Ana Pérez/)).toBeInTheDocument();
    expect(screen.getByText(/Corte/)).toBeInTheDocument();
    expect(screen.getByText(/5\.000,50/)).toBeInTheDocument();
  });

  it('never renders a client email or telephone', async () => {
    const { container } = await renderPage();

    // The projection carries neither, and this asserts the page cannot start
    // rendering one without the test noticing.
    expect(container.textContent).not.toMatch(/@/);
    expect(container.textContent).not.toMatch(/\+?\d{6,}/);
  });

  it('distinguishes a cancellation from an expiry', async () => {
    await renderPage(
      view({
        recent: {
          ok: true,
          value: [
            booking({ id: 'a', status: 'CANCELLED' }),
            booking({ id: 'b', status: 'EXPIRED' }),
          ],
        },
      })
    );

    const cancelled = screen.getByText(COPY.dashboard.status.CANCELLED);
    const expired = screen.getByText(COPY.dashboard.status.EXPIRED);

    // Two statuses exist precisely so a deadline can be told from a decision.
    // Rendering them alike would remove the only reason for the distinction.
    expect(cancelled).toBeInTheDocument();
    expect(expired).toBeInTheDocument();
    expect(cancelled.className).not.toBe(expired.className);
  });

  it('shows an abandoned checkout, which no other surface does', async () => {
    await renderPage({
      ...view(),
      recent: { ok: true, value: [booking({ status: 'EXPIRED' })] },
    });

    expect(screen.getByText(COPY.dashboard.status.EXPIRED)).toBeInTheDocument();
  });

  it('points a shop with no bookings at its public link', async () => {
    await renderPage(view({ recent: { ok: true, value: [] } }));

    expect(screen.getByText(COPY.dashboard.recentEmpty)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: COPY.dashboard.recentEmptyLink })).toHaveAttribute(
      'href',
      '/perfil'
    );
  });

  it('names the barber and offers a way back when a filter matches nothing', async () => {
    await renderPage(view({ recent: { ok: true, value: [] }, selectedBarberId: 'bar-nico' }));

    expect(screen.getByText(COPY.dashboard.recentEmptyFiltered('Nico'))).toBeInTheDocument();
    // A filtered-empty state that looks like a global-empty state reads as a
    // broken dashboard.
    expect(screen.getByRole('link', { name: COPY.dashboard.clearFilter })).toHaveAttribute(
      'href',
      '/'
    );
    expect(screen.queryByText(COPY.dashboard.recentEmpty)).not.toBeInTheDocument();
  });
});

describe('the barber filter', () => {
  it('is a GET form with a native select', async () => {
    const { container } = await renderPage();

    const form = container.querySelector('form');
    expect(form).toHaveAttribute('method', 'get');
    // A native, form-associated control, so the page needs no client JavaScript
    // for its one interaction. That is NOT the same as working with JavaScript
    // disabled — the segment's loading.tsx streams this route, so the skeleton
    // never resolves without it (T44, Cause 1, widened by D1).
    expect(screen.getByRole('combobox', { name: COPY.dashboard.filterLabel })).toBeInTheDocument();
  });

  it('offers every barber plus an unfiltered option', async () => {
    await renderPage();

    expect(screen.getByRole('option', { name: COPY.dashboard.filterAll })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Leo' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Nico' })).toBeInTheDocument();
  });

  it('reflects the resolved selection', async () => {
    await renderPage(view({ selectedBarberId: 'bar-nico' }));

    expect(screen.getByRole('combobox', { name: COPY.dashboard.filterLabel })).toHaveValue(
      'bar-nico'
    );
  });

  it('is not rendered at all for a shop with no barbers', async () => {
    await renderPage(view({ barbers: [] }));

    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('passes the raw parameter through to the service without interpreting it', async () => {
    await renderPage(view(), { barbero: 'barber-of-another-shop' });

    // Resolution is the service's job, against the owner's own barber list.
    // The page must not decide anything about this value.
    expect(loadHome).toHaveBeenCalledWith({
      ownerId: 'owner-root',
      rawBarberFilter: 'barber-of-another-shop',
    });
  });

  it('hands a repeated parameter over as the array it arrives as', async () => {
    await renderPage(view(), { barbero: ['bar-leo', 'bar-nico'] });

    expect(loadHome).toHaveBeenCalledWith({
      ownerId: 'owner-root',
      rawBarberFilter: ['bar-leo', 'bar-nico'],
    });
  });
});

describe('the page itself', () => {
  it('resolves the owner before reading anything', async () => {
    await renderPage();

    expect(requireOwner).toHaveBeenCalled();
    expect(loadHome).toHaveBeenCalledWith(expect.objectContaining({ ownerId: 'owner-root' }));
  });
});

/**
 * C2: the cancel control, and where it must not be.
 */
describe('the cancel control', () => {
  const cancellable = ['CONFIRMED', 'PENDING_PAYMENT', 'PENDING_APPROVAL'] as const;
  const terminal = ['CANCELLED', 'EXPIRED'] as const;

  it.each(cancellable)('offers a control on a %s booking', async (status) => {
    await renderPage({
      ...view(),
      recent: { ok: true, value: [booking({ status, clientName: 'Ana Pérez' })] },
    });

    expect(screen.getByRole('button', { name: /Cancelar el turno de Ana Pérez/ })).toBeInTheDocument();
  });

  /**
   * **Absent, never disabled.** A disabled-looking control invites a click that
   * cannot succeed — the rule the public flow's payment controls already follow.
   */
  it.each(terminal)('renders no control at all on a %s booking', async (status) => {
    const { container } = await renderPage({
      ...view(),
      recent: { ok: true, value: [booking({ status })] },
    });

    expect(container.querySelector('button[disabled]')).toBeNull();
    expect(screen.queryByRole('button', { name: /Cancelar/ })).not.toBeInTheDocument();
  });

  it('names the client in the control, so a list of rows stays unambiguous', async () => {
    await renderPage({
      ...view(),
      recent: {
        ok: true,
        value: [
          booking({ id: 'a', clientName: 'Ana Pérez' }),
          booking({ id: 'b', clientName: 'Beto Díaz' }),
        ],
      },
    });

    expect(screen.getByRole('button', { name: /Ana Pérez/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Beto Díaz/ })).toBeInTheDocument();
  });

  it('carries the booking id in the body, never in an action URL', async () => {
    const { container } = await renderPage({
      ...view(),
      recent: { ok: true, value: [booking({ id: 'bkg-42' })] },
    });

    expect(container.querySelector('input[name="bookingId"]')).toHaveValue('bkg-42');
  });
});

/**
 * C1: the owner's only channel for learning that a client cancelled.
 *
 * The story decided not to email them — no owner has ever been sent a message
 * by this product — which is defensible only if the surface that replaces the
 * message actually carries the fact. "Cancelaciones de hoy" sums both kinds,
 * and the badge says `CANCELLED` either way.
 */
describe('the canceller on a cancelled row', () => {
  it('names the client when they cancelled it themselves', async () => {
    await renderPage(
      view({ recent: { ok: true, value: [booking({ status: 'CANCELLED', cancelledBy: 'CLIENT' })] } })
    );

    expect(screen.getByText(COPY.dashboard.cancelledByClient)).toBeInTheDocument();
  });

  it('names the owner when they cancelled it themselves', async () => {
    await renderPage(
      view({ recent: { ok: true, value: [booking({ status: 'CANCELLED', cancelledBy: 'OWNER' })] } })
    );

    expect(screen.getByText(COPY.dashboard.cancelledByOwner)).toBeInTheDocument();
  });

  it('renders the two differently, which is the whole point', async () => {
    await renderPage(
      view({
        recent: {
          ok: true,
          value: [
            booking({ id: 'a', status: 'CANCELLED', cancelledBy: 'CLIENT' }),
            booking({ id: 'b', status: 'CANCELLED', cancelledBy: 'OWNER' }),
          ],
        },
      })
    );

    expect(screen.getByText(COPY.dashboard.cancelledByClient)).toBeInTheDocument();
    expect(screen.getByText(COPY.dashboard.cancelledByOwner)).toBeInTheDocument();
  });

  it('attributes nothing when no canceller was recorded', async () => {
    // Every row cancelled before the column had a writer is one of these.
    await renderPage(
      view({ recent: { ok: true, value: [booking({ status: 'CANCELLED', cancelledBy: null })] } })
    );

    expect(screen.queryByText(COPY.dashboard.cancelledByClient)).not.toBeInTheDocument();
    expect(screen.queryByText(COPY.dashboard.cancelledByOwner)).not.toBeInTheDocument();
  });

  it('says nothing on a booking that was never cancelled', async () => {
    await renderPage();

    expect(screen.queryByText(COPY.dashboard.cancelledByClient)).not.toBeInTheDocument();
    expect(screen.queryByText(COPY.dashboard.cancelledByOwner)).not.toBeInTheDocument();
  });

  it('still offers no cancel control on a cancelled row', async () => {
    // The canceller is a fact about a terminal booking, not an invitation to
    // act on one.
    await renderPage(
      view({ recent: { ok: true, value: [booking({ status: 'CANCELLED', cancelledBy: 'CLIENT' })] } })
    );

    expect(screen.queryByRole('button', { name: COPY.dashboard.cancel })).not.toBeInTheDocument();
  });
});
