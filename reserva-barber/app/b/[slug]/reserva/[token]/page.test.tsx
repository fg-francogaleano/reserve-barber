import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { COPY } from '@/lib/copy';
import type { BookingByToken } from '@/server/domain/repositories/IBookingRepository';

const findByCancellationToken = vi.fn();
const notFound = vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND');
});

vi.mock('next/navigation', () => ({ notFound: () => notFound() }));
vi.mock('./bookingConfirmationService', () => ({
  bookingConfirmationService: () => ({ findByCancellationToken }),
}));

const { default: ConfirmationPage } = await import('./page');

const TOKEN = 'tok-1';
const SLUG = 'barberia-don-juan';

/** Far in the future, so the hold is live unless a test says otherwise. */
const LIVE_HOLD = new Date(Date.now() + 10 * 60_000);
const LAPSED_HOLD = new Date(Date.now() - 10 * 60_000);

function booking(overrides: Partial<BookingByToken> = {}): BookingByToken {
  return {
    id: 'bkg-1',
    status: 'PENDING_PAYMENT',
    startTime: new Date(Date.now() + 4 * 60 * 60_000),
    endTime: new Date(Date.now() + 4.5 * 60 * 60_000),
    holdExpiresAt: LIVE_HOLD,
    depositAmount: '5000.00',
    clientName: 'Franco Galeano',
    barberDisplayName: 'Juan',
    serviceName: 'Corte',
    locationName: 'Centro',
    paymentStatus: null,
    hasCheckout: false,
    ...overrides,
  };
}

async function renderPage(
  row: BookingByToken | null = booking(),
  search: Record<string, string> = {}
) {
  findByCancellationToken.mockResolvedValue(row);
  const ui = await ConfirmationPage({
    params: Promise.resolve({ slug: SLUG, token: TOKEN }),
    searchParams: Promise.resolve(search),
  });
  return render(ui);
}

beforeEach(() => {
  findByCancellationToken.mockReset();
  notFound.mockClear();
});

describe('the payment control', () => {
  it('offers payment on a live, unpaid hold', async () => {
    await renderPage();

    expect(screen.getByRole('button', { name: COPY.booking.payDeposit })).toBeInTheDocument();
  });

  it('posts the token in the body and never in the action URL', async () => {
    // The fixed path is what lets the deny-by-default guard admit this endpoint
    // by equality, and it keeps a live credential out of access logs.
    const { container } = await renderPage();
    const form = container.querySelector('form');

    expect(form?.getAttribute('action')).toBe('/api/payments/mercadopago');
    expect(form?.getAttribute('action')).not.toContain(TOKEN);
    expect(container.querySelector('input[name="token"]')).toHaveValue(TOKEN);
  });

  it('names the control as a resumption when a checkout is already open', async () => {
    await renderPage(booking({ paymentStatus: 'PENDING', hasCheckout: true }));

    expect(screen.getByRole('button', { name: COPY.booking.resumePayment }).tagName).toBe(
      'BUTTON'
    );
  });

  /**
   * Absent, never disabled. A disabled-looking control invites a tap that
   * cannot succeed.
   */
  it.each([
    ['a lapsed hold', booking({ holdExpiresAt: LAPSED_HOLD })],
    ['a confirmed booking', booking({ status: 'CONFIRMED', holdExpiresAt: null })],
    ['a paid booking whose slot was lost', booking({ paymentStatus: 'APPROVED' })],
  ])('renders no form at all for %s', async (_label, row) => {
    const { container } = await renderPage(row);

    expect(container.querySelector('form')).toBeNull();
    expect(container.querySelector('button')).toBeNull();
  });
});

describe('what the URL cannot claim', () => {
  /**
   * The page reports what the database says happened. A return URL is a
   * navigation anyone can type; only the notification, authenticated against
   * Mercado Pago, changes a booking.
   */
  it('does not announce a confirmation from an outcome code alone', async () => {
    await renderPage(booking(), { estado: 'pago-pendiente' });

    expect(screen.queryByText(COPY.booking.paymentConfirmed)).not.toBeInTheDocument();
    expect(screen.getByText(COPY.booking.paymentConfirming)).toBeInTheDocument();
  });

  it('shows a confirmed booking as confirmed even with a stale failure code', async () => {
    // A bookmarked URL must not tell somebody their confirmed appointment
    // failed.
    await renderPage(booking({ status: 'CONFIRMED', holdExpiresAt: null }), {
      estado: 'pago-rechazado',
    });

    expect(screen.getByText(COPY.booking.paymentConfirmed)).toBeInTheDocument();
  });

  it('ignores an outcome code it does not recognise', async () => {
    await renderPage(booking(), { estado: 'inventado' });

    expect(screen.getByText(COPY.booking.holdHeading)).toBeInTheDocument();
  });
});

describe('the eight states say the right thing', () => {
  it('tells a client returning from the gateway that it is confirming', async () => {
    await renderPage(booking(), { estado: 'pago-pendiente' });

    expect(screen.getByText(COPY.booking.paymentConfirmingHelp)).toBeInTheDocument();
  });

  /**
   * No spinner and no promise of automatic refresh: the page does not poll, and
   * implying otherwise would leave somebody staring at it.
   */
  it('does not imply the awaiting state refreshes itself', async () => {
    const { container } = await renderPage(booking(), { estado: 'pago-pendiente' });

    expect(container.querySelector('[role="progressbar"]')).toBeNull();
    expect(container.querySelector('.animate-spin')).toBeNull();
  });

  it('states the time left when a payment was rejected', async () => {
    await renderPage(booking(), { estado: 'pago-rechazado' });

    expect(screen.getByText(COPY.booking.paymentRejected)).toBeInTheDocument();
    expect(screen.getByText(/te queda/i)).toBeInTheDocument();
  });

  it('is honest when the money moved and the slot did not', async () => {
    await renderPage(booking({ paymentStatus: 'APPROVED', holdExpiresAt: LAPSED_HOLD }));

    expect(screen.getByText(COPY.booking.paymentPaidSlotLost)).toBeInTheDocument();
    // Never "your turn expired" to somebody who paid.
    expect(screen.queryByText(COPY.booking.holdExpired)).not.toBeInTheDocument();
  });

  /**
   * The shop's configuration, not the client's payment. Blaming the person who
   * tried to pay would be both wrong and unhelpful.
   */
  it.each(['sin-mercadopago', 'pagos-no-disponibles'])(
    'blames the shop, not the client, for %s',
    async (estado) => {
      await renderPage(booking(), { estado });

      expect(screen.getByText(COPY.booking.paymentsUnavailable)).toBeInTheDocument();
      expect(screen.queryByText(COPY.booking.paymentRejected)).not.toBeInTheDocument();
    }
  );
});

describe('closing B4 T59', () => {
  /**
   * The confirmed state is reached from two directions and only one is obvious.
   * `findLiveHoldsForClientOnDay` includes CONFIRMED bookings — correctly, a
   * confirmed appointment does hold its slot — so a client re-submitting a slot
   * they already paid for gets `alreadyHeld` and lands here. Before B5 that
   * rendered "Te guardamos el turno" and "el pago se habilita muy pronto" over
   * an appointment already paid for.
   *
   * Nothing could reach CONFIRMED before this change, which is why the path was
   * unreachable and is not any more.
   */
  it('shows a repeat submission of a confirmed booking as confirmed', async () => {
    // No outcome code: this is the redirect the booking write issues for
    // `alreadyHeld`, not a return from a checkout.
    await renderPage(booking({ status: 'CONFIRMED', holdExpiresAt: null }));

    expect(screen.getByText(COPY.booking.paymentConfirmed)).toBeInTheDocument();
    expect(screen.queryByText(COPY.booking.holdHeading)).not.toBeInTheDocument();
  });

  it('shows no countdown over a confirmed booking', async () => {
    await renderPage(booking({ status: 'CONFIRMED', holdExpiresAt: null }));

    expect(screen.queryByText(/vence en/i)).not.toBeInTheDocument();
  });
});

describe('what never appears', () => {
  it('renders the client name and no other contact detail', async () => {
    const { container } = await renderPage();

    expect(screen.getByText(/Franco Galeano/)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/@|\+54|1155/);
  });

  it('answers a token that matches nothing with a 404', async () => {
    await expect(renderPage(null)).rejects.toThrow('NEXT_NOT_FOUND');
    expect(notFound).toHaveBeenCalled();
  });
});
