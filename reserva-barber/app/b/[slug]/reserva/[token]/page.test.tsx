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
    // N1 defaults: nothing sent, and the row written just now — so a confirmed
    // booking is inside the notice grace and says nothing about the email
    // unless a test opts in. Existing assertions keep meaning what they meant.
    confirmationEmailSentAt: null,
    updatedAt: new Date(),
    // C2: nobody cancelled by default. Tests that need a cancellation opt in.
    cancelledBy: null,
    barberDisplayName: 'Juan',
    serviceName: 'Corte',
    locationName: 'Centro',
    paymentStatus: null,
    hasCheckout: false,
    paymentMethod: null,
    receiptStatus: null,
    // The default shop is Mercado Pago only, which is what B5 shipped. Transfer
    // cases opt in, so every existing assertion keeps meaning what it meant.
    hasMercadoPago: true,
    hasTransferOption: false,
    transfer: null,
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
    await renderPage(
      booking({ paymentStatus: 'PENDING', hasCheckout: true, paymentMethod: 'MERCADO_PAGO' })
    );

    expect(screen.getByRole('button', { name: COPY.booking.resumePayment }).tagName).toBe('BUTTON');
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
   * **This assertion is inverted by T62, deliberately.**
   *
   * B5 wrote it to hold the rule that the awaiting state must not imply an
   * update it does not perform — a spinner over a page that never changes
   * leaves somebody staring at it. The rule was always conditional on the page
   * not refreshing, and N1 makes the refresh real, so the honest form of the
   * same rule is: the indicator appears exactly while something is actually
   * going to happen, and never on the terminal form.
   *
   * Kept here rather than deleted, so the reversal is visible to whoever reads
   * this file next.
   */
  it('shows a progress indicator only while it is actually refreshing', async () => {
    const { container } = await renderPage(booking(), { estado: 'pago-pendiente' });

    expect(refreshMeta()).not.toBeNull();
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
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

/** A shop whose transfer destination is complete and therefore offerable. */
function transferable(overrides: Partial<BookingByToken> = {}): BookingByToken {
  return booking({ hasTransferOption: true, ...overrides });
}

const DESTINATION = {
  cbuCvu: '0000003100010000000001',
  alias: 'mi.barberia',
  holderName: 'Ana Pérez',
};

describe('choosing a method', () => {
  it('offers both controls at a shop with both configured', async () => {
    await renderPage(transferable());

    expect(screen.getByRole('button', { name: COPY.booking.payDeposit })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: COPY.booking.payWithTransfer })).toBeInTheDocument();
  });

  /**
   * The gap B6 closes. `isBookable` already admits a transfer-only shop and B4
   * already lets it create holds, so before this the client met a control that
   * could only fail.
   */
  it('offers only transfer at a shop without Mercado Pago', async () => {
    await renderPage(transferable({ hasMercadoPago: false }));

    expect(screen.getByRole('button', { name: COPY.booking.payWithTransfer })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: COPY.booking.payDeposit })).not.toBeInTheDocument();
  });

  it('offers only Mercado Pago at a shop without a usable destination', async () => {
    await renderPage(booking());

    expect(screen.getByRole('button', { name: COPY.booking.payDeposit })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: COPY.booking.payWithTransfer })
    ).not.toBeInTheDocument();
  });

  it('reports a shop with neither method as unable to take payments', async () => {
    const { container } = await renderPage(booking({ hasMercadoPago: false }));

    expect(screen.getByText(COPY.booking.paymentsUnavailable)).toBeInTheDocument();
    expect(container.querySelector('button')).toBeNull();
  });

  it('posts the transfer commitment to its own endpoint with the token in the body', async () => {
    const { container } = await renderPage(transferable());
    const transferForm = Array.from(container.querySelectorAll('form')).find(
      (form) => form.getAttribute('action') === '/api/payments/transfer'
    );

    expect(transferForm).toBeDefined();
    expect(transferForm?.getAttribute('action')).not.toContain(TOKEN);
    expect(transferForm?.querySelector('input[name="token"]')).toHaveValue(TOKEN);
  });
});

describe('the destination is never shown before it is earned', () => {
  /**
   * The rule this story turns on: a CBU visible during a window about to lapse
   * is how a client transfers real money into a turn they have already lost,
   * with no gateway anywhere that could be asked about it.
   */
  it('shows no account number while the client is still choosing', async () => {
    const { container } = await renderPage(transferable());

    expect(container.textContent).not.toContain(DESTINATION.cbuCvu);
    expect(container.textContent).not.toContain(DESTINATION.holderName);
  });

  it('shows no account number on a lapsed hold', async () => {
    const { container } = await renderPage(
      transferable({ holdExpiresAt: LAPSED_HOLD, transfer: DESTINATION })
    );

    expect(container.textContent).not.toContain(DESTINATION.cbuCvu);
  });

  it('shows the destination once a transfer payment is live', async () => {
    const { container } = await renderPage(
      transferable({
        paymentStatus: 'PENDING',
        paymentMethod: 'BANK_TRANSFER',
        transfer: DESTINATION,
      })
    );

    expect(container.textContent).toContain(DESTINATION.cbuCvu);
    expect(container.textContent).toContain(DESTINATION.holderName);
  });

  /** The warning has to be read before the number, so it precedes it. */
  it('puts the deadline warning above the account number', async () => {
    const { container } = await renderPage(
      transferable({
        paymentStatus: 'PENDING',
        paymentMethod: 'BANK_TRANSFER',
        transfer: DESTINATION,
      })
    );

    const text = container.textContent ?? '';
    const warning = text.indexOf('Si transfer');
    const cbu = text.indexOf(DESTINATION.cbuCvu);

    expect(warning).toBeGreaterThanOrEqual(0);
    expect(warning).toBeLessThan(cbu);
  });

  it('renders the snapshotted deposit beside the destination', async () => {
    const { container } = await renderPage(
      transferable({
        depositAmount: '5000.00',
        paymentStatus: 'PENDING',
        paymentMethod: 'BANK_TRANSFER',
        transfer: DESTINATION,
      })
    );

    expect(container.textContent).toContain(COPY.booking.transferAmountLabel);
  });
});

describe('the receipt form', () => {
  function committed(overrides: Partial<BookingByToken> = {}) {
    return transferable({
      paymentStatus: 'PENDING',
      paymentMethod: 'BANK_TRANSFER',
      transfer: DESTINATION,
      ...overrides,
    });
  }

  it('is a native multipart form posting to the transfer endpoint', async () => {
    const { container } = await renderPage(committed());
    const form = Array.from(container.querySelectorAll('form')).find(
      (candidate) => candidate.getAttribute('enctype') === 'multipart/form-data'
    );

    expect(form).toBeDefined();
    expect(form?.getAttribute('method')).toBe('post');
    expect(form?.getAttribute('action')).toBe('/api/payments/transfer');
    expect(form?.querySelector('input[type="file"]')).toBeInTheDocument();
  });

  /** A hint to the picker, never a check. The bytes decide, server-side. */
  it('hints the accepted types without relying on the attribute', async () => {
    const { container } = await renderPage(committed());
    const file = container.querySelector('input[type="file"]');

    expect(file?.getAttribute('accept')).toBe('image/jpeg,image/png,application/pdf');
  });
});

describe('the states a receipt produces', () => {
  function underReview(overrides: Partial<BookingByToken> = {}) {
    return transferable({
      status: 'PENDING_APPROVAL',
      paymentStatus: 'PENDING',
      paymentMethod: 'BANK_TRANSFER',
      receiptStatus: 'PENDING',
      ...overrides,
    });
  }

  it('tells a client their receipt is under review', async () => {
    await renderPage(underReview());

    expect(screen.getByText(COPY.booking.receiptUnderReview)).toBeInTheDocument();
  });

  /**
   * `holdExpiresAt` was the deadline for uploading a receipt, never for
   * answering one. Telling this client their turn expired while the owner is
   * looking at their comprobante would be false.
   */
  it('does not call an unanswered receipt an expired turn', async () => {
    await renderPage(underReview({ holdExpiresAt: LAPSED_HOLD }));

    expect(screen.getByText(COPY.booking.receiptUnderReview)).toBeInTheDocument();
    expect(screen.queryByText(COPY.booking.holdExpired)).not.toBeInTheDocument();
  });

  it('leaves no control once a receipt is under review', async () => {
    const { container } = await renderPage(underReview());

    expect(container.querySelector('form')).toBeNull();
  });

  it('reports a rejected receipt rather than a bare cancellation', async () => {
    await renderPage(
      transferable({ status: 'CANCELLED', holdExpiresAt: null, receiptStatus: 'REJECTED' })
    );

    expect(screen.getByText(COPY.booking.receiptRejected)).toBeInTheDocument();
  });

  /** May mean money moved with nothing here recording it. Its own message. */
  it('is honest when a transfer arrived after the slot was taken', async () => {
    await renderPage(transferable({ holdExpiresAt: LAPSED_HOLD }), {
      estado: 'transferencia-sin-lugar',
    });

    expect(screen.getByText(COPY.booking.transferSlotLost)).toBeInTheDocument();
    expect(screen.queryByText(COPY.booking.holdExpired)).not.toBeInTheDocument();
  });

  it('explains why the other method is blocked', async () => {
    await renderPage(transferable(), { estado: 'metodo-en-curso' });

    expect(screen.getByText(COPY.booking.methodInUse)).toBeInTheDocument();
  });
});

/**
 * T62: the awaiting state stops asking for a manual refresh.
 *
 * B5 measured that this state is what nearly every client sees — the browser
 * redirect from Mercado Pago beats the server-to-server notification
 * essentially every time — so the most important moment in this product ended
 * with an instruction to reload.
 */
/**
 * React hoists a bare `<meta>` into `document.head` — which is exactly where an
 * `http-equiv` refresh has to be to work at all, so the hoisting is the desired
 * behaviour rather than a testing quirk to route around.
 */
function refreshMeta(): Element | null {
  return document.head.querySelector('meta[http-equiv="refresh"]');
}

describe('the awaiting-confirmation refresh', () => {
  const AWAITING = { estado: 'pago-pendiente' };

  it('emits a server-rendered refresh on the first arrival', async () => {
    await renderPage(booking(), AWAITING);

    const meta = refreshMeta();
    expect(meta).not.toBeNull();
    expect(meta?.getAttribute('content')).toContain('intento=2');
  });

  it('advances the counter rather than repeating it', async () => {
    await renderPage(booking(), { ...AWAITING, intento: '2' });

    const content = refreshMeta()?.getAttribute('content');
    expect(content).toContain('intento=3');
    expect(content?.split('intento=').length).toBe(2);
  });

  it('stops at the bound and asks for a manual reload', async () => {
    await renderPage(booking(), { ...AWAITING, intento: '3' });

    expect(refreshMeta()).toBeNull();
    expect(screen.getByText(COPY.booking.paymentConfirmingHelpExhausted)).toBeInTheDocument();
  });

  it('renders the terminal form for a forged counter rather than looping', async () => {
    await renderPage(booking(), { ...AWAITING, intento: '999' });

    expect(refreshMeta()).toBeNull();
  });

  it('renders the terminal form for a malformed counter', async () => {
    await renderPage(booking(), { ...AWAITING, intento: 'abc' });

    expect(refreshMeta()).toBeNull();
  });

  it('keeps the outcome code across the refresh so the state survives it', async () => {
    await renderPage(booking(), AWAITING);

    const content = refreshMeta()?.getAttribute('content');
    expect(content).toContain('estado=pago-pendiente');
  });

  it('refreshes to a relative url, never to a host it was told', async () => {
    // The path carries a cancellation token. A forged Host would aim the
    // refresh, token included, at somebody else's domain.
    await renderPage(booking(), AWAITING);

    const content = refreshMeta()?.getAttribute('content');
    expect(content).toMatch(/url=\//);
    expect(content).not.toMatch(/url=https?:/);
  });

  /**
   * B5 forbade a progress indicator here because the page did not update.
   * The prohibition was conditional on that, and it survives on the terminal
   * form — where nothing further is going to happen.
   */
  it('shows no progress indicator once the refreshing has stopped', async () => {
    const { container } = await renderPage(booking(), { ...AWAITING, intento: '3' });

    expect(container.querySelector('.animate-pulse')).toBeNull();
  });

  it('emits no refresh on any other state', async () => {
    await renderPage(booking({ status: 'CONFIRMED' }));

    expect(refreshMeta()).toBeNull();
  });
});

/**
 * N1: the confirmed state tells the truth about the email, or says nothing.
 */
describe('what the confirmed state says about the email', () => {
  it('says the confirmation was emailed once it was recorded', async () => {
    await renderPage(booking({ status: 'CONFIRMED', confirmationEmailSentAt: new Date() }));

    expect(screen.getByText(COPY.booking.paymentConfirmedEmailSent)).toBeInTheDocument();
  });

  it('says nothing while the send may still be in flight', async () => {
    await renderPage(
      booking({ status: 'CONFIRMED', confirmationEmailSentAt: null, updatedAt: new Date() })
    );

    expect(screen.queryByText(COPY.booking.paymentConfirmedEmailSent)).not.toBeInTheDocument();
    expect(screen.queryByText(COPY.booking.paymentConfirmedEmailFailed)).not.toBeInTheDocument();
  });

  it('tells the client the link is their only copy when the send failed', async () => {
    await renderPage(
      booking({
        status: 'CONFIRMED',
        confirmationEmailSentAt: null,
        updatedAt: new Date(Date.now() - 10 * 60_000),
      })
    );

    expect(screen.getByText(COPY.booking.paymentConfirmedEmailFailed)).toBeInTheDocument();
  });

  it('never claims a message that was not sent', async () => {
    await renderPage(
      booking({
        status: 'CONFIRMED',
        confirmationEmailSentAt: null,
        updatedAt: new Date(Date.now() - 10 * 60_000),
      })
    );

    expect(screen.queryByText(COPY.booking.paymentConfirmedEmailSent)).not.toBeInTheDocument();
  });

  it('says nothing about the email on a booking that is not confirmed', async () => {
    await renderPage(booking({ confirmationEmailSentAt: new Date() }));

    expect(screen.queryByText(COPY.booking.paymentConfirmedEmailSent)).not.toBeInTheDocument();
  });

  it('still renders no client email or phone in any of the three variants', async () => {
    const { container } = await renderPage(
      booking({ status: 'CONFIRMED', confirmationEmailSentAt: new Date() })
    );

    expect(container.textContent).not.toMatch(/@/);
  });
});

/**
 * C2: the cancelled state, and the money it must not stay quiet about.
 */
describe('a booking the shop cancelled', () => {
  const cancelled = (overrides: Partial<BookingByToken> = {}) =>
    booking({
      status: 'CANCELLED',
      holdExpiresAt: null,
      cancelledBy: 'OWNER',
      ...overrides,
    });

  it('names the shop rather than reporting an expiry', async () => {
    await renderPage(cancelled());

    expect(screen.getByText(COPY.booking.bookingCancelledByShop)).toBeInTheDocument();
    expect(screen.queryByText(COPY.booking.holdExpired)).not.toBeInTheDocument();
  });

  it('blames nobody when no canceller was recorded', async () => {
    await renderPage(cancelled({ cancelledBy: null }));

    expect(screen.getByText(COPY.booking.bookingCancelled)).toBeInTheDocument();
    expect(screen.queryByText(COPY.booking.bookingCancelledByShop)).not.toBeInTheDocument();
  });

  /**
   * The page was the last surface to say this and the one the client is most
   * likely to be looking at. Without it, the only thing that costs them
   * anything is the thing this page stays quiet about.
   */
  it('says the deposit is not returned here when one was approved', async () => {
    await renderPage(cancelled({ paymentStatus: 'APPROVED' }));

    expect(screen.getByText(COPY.booking.bookingCancelledDepositNote)).toBeInTheDocument();
  });

  it('says nothing about money when nothing was charged', async () => {
    await renderPage(cancelled({ paymentStatus: null }));

    expect(screen.queryByText(COPY.booking.bookingCancelledDepositNote)).not.toBeInTheDocument();
  });

  it('says nothing about money when the payment never completed', async () => {
    await renderPage(cancelled({ paymentStatus: 'PENDING' }));

    expect(screen.queryByText(COPY.booking.bookingCancelledDepositNote)).not.toBeInTheDocument();
  });

  it('carries the note on an unattributed cancellation too', async () => {
    // A row cancelled before C2 recorded who did it. The money question is
    // independent of the attribution question.
    await renderPage(cancelled({ cancelledBy: null, paymentStatus: 'APPROVED' }));

    expect(screen.getByText(COPY.booking.bookingCancelledDepositNote)).toBeInTheDocument();
  });

  it('offers no payment control and no receipt form', async () => {
    const { container } = await renderPage(cancelled({ paymentStatus: 'APPROVED' }));

    expect(container.querySelector('form')).toBeNull();
    expect(container.querySelector('button')).toBeNull();
  });

  it('still renders no client email or phone', async () => {
    const { container } = await renderPage(cancelled({ paymentStatus: 'APPROVED' }));

    expect(container.textContent).not.toMatch(/@/);
  });
});

/**
 * C1: the client cancels their own booking.
 *
 * Two steps and no JavaScript: a link that writes nothing, then a `POST` from a
 * form on the page it renders.
 */
describe('C1 - the cancellation control', () => {
  const cancelLink = () => screen.queryByRole('link', { name: COPY.booking.cancelBookingCta });

  it('offers it on a confirmed appointment that has not started', async () => {
    await renderPage(booking({ status: 'CONFIRMED', holdExpiresAt: null }));

    expect(cancelLink()).toBeInTheDocument();
  });

  it('offers it on a live, unpaid hold', async () => {
    await renderPage();

    expect(cancelLink()).toBeInTheDocument();
  });

  it('points at a GET that writes nothing', async () => {
    // The property T69 requires: a scanner, a preview bot or the framework's
    // own prefetching can fetch this and get a page, not a cancellation.
    await renderPage(booking({ status: 'CONFIRMED', holdExpiresAt: null }));

    expect(cancelLink()).toHaveAttribute('href', `/b/${SLUG}/reserva/${TOKEN}?cancelar=1`);
  });

  it('withholds it once the appointment has started', async () => {
    await renderPage(
      booking({
        status: 'CONFIRMED',
        holdExpiresAt: null,
        startTime: new Date(Date.now() - 60 * 60_000),
        endTime: new Date(Date.now() - 30 * 60_000),
      })
    );

    expect(cancelLink()).not.toBeInTheDocument();
  });

  it('withholds it while a comprobante is under review, and says why', async () => {
    await renderPage(booking({ status: 'PENDING_APPROVAL', receiptStatus: 'PENDING' }));

    expect(cancelLink()).not.toBeInTheDocument();
    expect(screen.getByText(COPY.booking.receiptUnderReviewCancelHelp)).toBeInTheDocument();
  });

  it('withholds it on a lapsed hold', async () => {
    await renderPage(booking({ holdExpiresAt: LAPSED_HOLD }));

    expect(cancelLink()).not.toBeInTheDocument();
  });

  it('withholds it on an already cancelled booking', async () => {
    await renderPage(booking({ status: 'CANCELLED', holdExpiresAt: null, cancelledBy: 'CLIENT' }));

    expect(cancelLink()).not.toBeInTheDocument();
  });
});

describe('C1 - the confirmation step', () => {
  const confirmed = { status: 'CONFIRMED' as const, holdExpiresAt: null };

  it('renders the confirmation for the expected parameter', async () => {
    await renderPage(booking(confirmed), { cancelar: '1' });

    expect(screen.getByText(COPY.booking.cancelConfirmHeading)).toBeInTheDocument();
    expect(screen.getByText(COPY.booking.cancelConfirmSlot)).toBeInTheDocument();
    expect(screen.getByText(COPY.booking.cancelConfirmFinal)).toBeInTheDocument();
  });

  it('posts to the fixed public path with the token in the body', async () => {
    const { container } = await renderPage(booking(confirmed), { cancelar: '1' });
    const form = container.querySelector('form[action="/api/bookings/cancel"]');

    expect(form).not.toBeNull();
    expect(form?.querySelector('input[name="token"]')).toHaveValue(TOKEN);
    expect(form?.getAttribute('action')).not.toContain(TOKEN);
  });

  it('replaces the control rather than sitting beside it', async () => {
    await renderPage(booking(confirmed), { cancelar: '1' });

    expect(
      screen.queryByRole('link', { name: COPY.booking.cancelBookingCta })
    ).not.toBeInTheDocument();
  });

  it('offers a plain way back that changes nothing', async () => {
    await renderPage(booking(confirmed), { cancelar: '1' });

    expect(screen.getByRole('link', { name: COPY.booking.cancelConfirmBack })).toHaveAttribute(
      'href',
      `/b/${SLUG}/reserva/${TOKEN}`
    );
  });

  it.each(['0', 'true', '', 'si'])('ignores the truthy-looking value %s', async (value) => {
    await renderPage(booking(confirmed), { cancelar: value });

    expect(screen.queryByText(COPY.booking.cancelConfirmHeading)).not.toBeInTheDocument();
  });

  it('ignores it entirely for a booking that cannot be cancelled', async () => {
    // A hand-edited URL gets the ordinary page, never a confirmation for
    // something the write would then refuse.
    await renderPage(booking({ status: 'PENDING_APPROVAL', receiptStatus: 'PENDING' }), {
      cancelar: '1',
    });

    expect(screen.queryByText(COPY.booking.cancelConfirmHeading)).not.toBeInTheDocument();
  });

  it('names the deposit when one was approved', async () => {
    await renderPage(booking({ ...confirmed, paymentStatus: 'APPROVED' }), { cancelar: '1' });

    expect(screen.getByText(COPY.booking.cancelConfirmDeposit)).toBeInTheDocument();
  });

  it('raises no refund for a client who paid nothing', async () => {
    await renderPage(booking(confirmed), { cancelar: '1' });

    expect(screen.queryByText(COPY.booking.cancelConfirmDeposit)).not.toBeInTheDocument();
  });

  it('warns about a payment already started', async () => {
    // Cancelling does not close an open checkout, so the client is told.
    await renderPage(
      booking({ paymentStatus: 'PENDING', paymentMethod: 'MERCADO_PAGO', hasCheckout: true }),
      { cancelar: '1' }
    );

    expect(screen.getByText(COPY.booking.cancelConfirmOpenPayment)).toBeInTheDocument();
  });
});

describe('C1 - the confirmation is never pulled away by the self-refresh', () => {
  const awaiting = { paymentStatus: 'PENDING' as const, paymentMethod: 'MERCADO_PAGO' as const };

  it('emits no refresh while the confirmation is on screen', async () => {
    // The defect this closes: the awaiting state is client-cancellable, and the
    // refresh URL was rebuilt from every parameter — so the page reloaded
    // underneath somebody reading an irreversible warning.
    await renderPage(booking(awaiting), {
      estado: 'pago-pendiente',
      cancelar: '1',
    });

    expect(refreshMeta()).toBeNull();
  });

  it('still refreshes when the confirmation is not on screen', async () => {
    await renderPage(booking(awaiting), { estado: 'pago-pendiente' });

    expect(refreshMeta()).not.toBeNull();
  });

  it('never carries the confirmation parameter into a refresh', async () => {
    await renderPage(booking(awaiting), {
      estado: 'pago-pendiente',
      cancelar: '0',
    });
    const meta = refreshMeta();

    expect(meta?.getAttribute('content')).not.toContain('cancelar');
  });
});

describe('C1 - the refusal notice', () => {
  /**
   * **Inverted rather than deleted.** This case originally asserted the started
   * wording over a booking whose appointment was still ahead — which is the
   * defect the adversarial pass found: a forged code inventing a fact about the
   * client's own appointment. It now asserts a started appointment, which is
   * what the code is allowed to sharpen.
   */
  it('explains a refusal over a booking whose appointment really started', async () => {
    await renderPage(
      booking({
        status: 'CONFIRMED',
        holdExpiresAt: null,
        startTime: new Date(Date.now() - 60 * 60_000),
        endTime: new Date(Date.now() - 30 * 60_000),
      }),
      { estado: 'turno-empezado' }
    );

    expect(screen.getByText(COPY.booking.cancelRefusedStarted)).toBeInTheDocument();
  });

  it('uses the generic wording for a booking that moved', async () => {
    await renderPage(booking({ status: 'CONFIRMED', holdExpiresAt: null }), {
      estado: 'cancelacion-no-posible',
    });

    expect(screen.getByText(COPY.booking.cancelRefusedMoved)).toBeInTheDocument();
  });

  /**
   * The contradiction this rule exists to prevent.
   *
   * With no JavaScript there is no disabled button, so a double tap is two
   * POSTs — and the same shape comes from a lost response after a commit, and
   * from a browser retry. The client wanted the booking cancelled and it is.
   */
  it('says nothing when the booking is actually cancelled', async () => {
    await renderPage(booking({ status: 'CANCELLED', holdExpiresAt: null, cancelledBy: 'CLIENT' }), {
      estado: 'cancelacion-no-posible',
    });

    expect(screen.queryByText(COPY.booking.cancelRefusedMoved)).not.toBeInTheDocument();
    expect(screen.getByText(COPY.booking.bookingCancelledByClient)).toBeInTheDocument();
  });

  it('says nothing when the shop cancelled it first', async () => {
    // Losing the race to the owner is not the client's attempt failing at
    // something that already happened.
    await renderPage(booking({ status: 'CANCELLED', holdExpiresAt: null, cancelledBy: 'OWNER' }), {
      estado: 'cancelacion-no-posible',
    });

    expect(screen.queryByText(COPY.booking.cancelRefusedMoved)).not.toBeInTheDocument();
    expect(screen.getByText(COPY.booking.bookingCancelledByShop)).toBeInTheDocument();
  });

  it('announces itself to a screen reader', async () => {
    const { container } = await renderPage(booking({ status: 'CONFIRMED', holdExpiresAt: null }), {
      estado: 'cancelacion-no-posible',
    });

    expect(container.querySelector('[aria-live="polite"]')?.textContent).toContain(
      COPY.booking.cancelRefusedMoved
    );
  });
});

describe('C1 - the client cancelled it themselves', () => {
  const byClient = {
    status: 'CANCELLED' as const,
    holdExpiresAt: null,
    cancelledBy: 'CLIENT' as const,
  };

  it('reads as a receipt rather than an apology', async () => {
    await renderPage(booking(byClient));

    expect(screen.getByText(COPY.booking.bookingCancelledByClient)).toBeInTheDocument();
    expect(screen.getByText(COPY.booking.bookingCancelledByClientHelp)).toBeInTheDocument();
  });

  it('never blames the shop', async () => {
    await renderPage(booking(byClient));

    expect(screen.queryByText(COPY.booking.bookingCancelledByShop)).not.toBeInTheDocument();
  });

  it('never says the booking expired', async () => {
    const { container } = await renderPage(booking(byClient));

    expect(container.textContent).not.toContain('venció');
  });

  it('states the deposit when one was approved', async () => {
    await renderPage(booking({ ...byClient, paymentStatus: 'APPROVED' }));

    expect(screen.getByText(COPY.booking.bookingCancelledDepositNote)).toBeInTheDocument();
  });

  it('offers no payment control', async () => {
    const { container } = await renderPage(booking(byClient));

    expect(container.querySelector('form')).toBeNull();
  });
});

/**
 * Found by the adversarial pass: a forged code was able to invent a fact about
 * the client's own appointment.
 *
 * The rule B5 established for every code on this page is that a code may
 * sharpen a truth the database already tells and may never invent one. A
 * hand-edited `turno-empezado` on a booking whose appointment is still ahead
 * would have told its client the turn had already started — the exact mirror of
 * the forged `transferencia-sin-lugar` B5 refused for telling somebody they had
 * lost a slot they still held.
 */
describe('C1 - a forged refusal cannot invent a started appointment', () => {
  it('degrades to the generic refusal when the appointment is still ahead', async () => {
    await renderPage(booking({ status: 'CONFIRMED', holdExpiresAt: null }), {
      estado: 'turno-empezado',
    });

    expect(screen.queryByText(COPY.booking.cancelRefusedStarted)).not.toBeInTheDocument();
    expect(screen.getByText(COPY.booking.cancelRefusedMoved)).toBeInTheDocument();
  });

  it('keeps the started wording when the database agrees', async () => {
    await renderPage(
      booking({
        status: 'CONFIRMED',
        holdExpiresAt: null,
        startTime: new Date(Date.now() - 60 * 60_000),
        endTime: new Date(Date.now() - 30 * 60_000),
      }),
      { estado: 'turno-empezado' }
    );

    expect(screen.getByText(COPY.booking.cancelRefusedStarted)).toBeInTheDocument();
  });

  it('says nothing about the appointment having started on a live hold', async () => {
    await renderPage(booking(), { estado: 'turno-empezado' });

    expect(screen.queryByText(COPY.booking.cancelRefusedStarted)).not.toBeInTheDocument();
  });
});
