import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { COPY } from '@/lib/copy';
import { formatCurrency } from '@/lib/formatCurrency';
import { formatBookingDateLong } from '@/lib/formatBookingDate';
import {
  formatSlotTime,
  // The business-local calendar day of an instant. Named `businessToday`
  // because its first caller asked it about `now`; the question it answers is
  // the general one, and asking it about an appointment is the same question.
  businessToday as businessDateOf,
} from '@/server/domain/models/bookingCalendar';
import {
  BOOKING_OUTCOME_PARAM,
  parsePaymentOutcomeCode,
} from '@/server/application/booking/bookingOutcome';
import {
  resolvePaymentPageState,
  offersPayment,
  type PaymentPageState,
} from '@/server/application/booking/paymentPageState';
import { PayDepositButton } from '@/components/booking/PayDepositButton';
import { bookingConfirmationService } from './bookingConfirmationService';
import { logger } from '@/server/infrastructure/logger';
import { toErrorLogContext } from '@/server/infrastructure/errorLogContext';

/**
 * Never indexed, never cached.
 *
 * The URL carries a booking's cancellation token. A crawler that reached one
 * would put a credential into a search index, and a cached render would show
 * one client's appointment to whoever asked next.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

interface PageProps {
  params: Promise<{ slug: string; token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** Generous, like every other bound on a stranger-supplied value in this flow. */
const MAX_TOKEN_LENGTH = 128;

/**
 * The hold confirmation, and the payment.
 *
 * **Addressed by `cancellationToken`, not by booking id** (B4 design D10). The
 * token is already unique and unguessable, is held by exactly this person, and
 * is the same credential the confirmation email will carry.
 *
 * It renders the appointment, the deposit and the state of the payment, and
 * **never the client's email or phone**: the link can be shared or opened on a
 * shared device, and the repository projection that feeds this page does not
 * select those columns, so they cannot appear by accident.
 *
 * **It reads live state and the outcome code decides nothing.** The code in the
 * URL only chooses wording within what the database already says is true — a
 * forged one cannot produce a confirmation, and a stale one cannot tell someone
 * their confirmed appointment failed. The precedence is a table in
 * `resolvePaymentPageState`, not branching here, because precedence is the part
 * of this page that is easy to get wrong.
 */
export default async function BookingConfirmationPage({ params, searchParams }: PageProps) {
  const { slug, token } = await params;

  if (token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
    notFound();
  }

  let booking;
  try {
    booking = await bookingConfirmationService().findByCancellationToken(token);
  } catch (error) {
    logger.error('Failed to resolve booking confirmation', toErrorLogContext('findByToken', error));
    throw error;
  }

  // A token that matches nothing is a 404 that discloses nothing about whether
  // it ever existed.
  if (booking === null) {
    notFound();
  }

  const outcome = parsePaymentOutcomeCode((await searchParams)[BOOKING_OUTCOME_PARAM]);
  const now = new Date();

  const state = resolvePaymentPageState({
    bookingStatus: booking.status,
    startTime: booking.startTime,
    endTime: booking.endTime,
    holdExpiresAt: booking.holdExpiresAt,
    paymentStatus: booking.paymentStatus,
    hasCheckout: booking.hasCheckout,
    outcome,
    now,
  });

  /**
   * Whole minutes, rendered on the server.
   *
   * A client-side ticking timer would be a hydration mismatch on the one page
   * whose entire value is being truthful about time — and it would keep
   * counting down past a deadline the server already knows has passed.
   */
  const minutesLeft =
    booking.holdExpiresAt === null
      ? null
      : Math.max(0, Math.ceil((booking.holdExpiresAt.getTime() - now.getTime()) / 60_000));

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">{headingFor(state)}</h1>
      <p className="text-muted-foreground text-sm">{introFor(state)}</p>

      <section className="border-border flex flex-col gap-2 rounded-md border p-4">
        <p className="text-lg font-medium break-words">
          {formatBookingDateLong(businessDateOf(booking.startTime))} ·{' '}
          {formatSlotTime(booking.startTime)}
        </p>
        <p className="text-muted-foreground text-sm break-words">
          {booking.serviceName} · {booking.barberDisplayName}
        </p>
        <p className="text-muted-foreground text-sm break-words">{booking.locationName}</p>
        {/* The client's own name, and nothing else about them. No email, no
            phone: this link can be shared or opened on a shared device. */}
        <p className="text-muted-foreground text-sm break-words">
          {COPY.booking.holdBookingFor} {booking.clientName}
        </p>
      </section>

      <section className="border-border bg-muted/50 flex flex-col gap-1 rounded-md border p-4">
        <p className="text-muted-foreground text-sm">{COPY.booking.depositLabel}</p>
        <p className="text-xl font-semibold break-words">
          {formatCurrency(booking.depositAmount)}
        </p>
        {state === 'holdLiveUnpaid' && minutesLeft !== null && (
          <p className="text-muted-foreground text-sm">
            {COPY.booking.holdExpiresIn(minutesLeft)}
          </p>
        )}
        {/* The rejection is the one failure where the remaining time is what
            decides whether trying again is worth attempting. */}
        {state === 'paymentRejected' && minutesLeft !== null && (
          <p className="text-muted-foreground text-sm">
            {COPY.booking.paymentRejectedTimeLeft(minutesLeft)}
          </p>
        )}
      </section>

      {/* Absent, never disabled. Every state below this line means the client
          has nothing left to do here, and a disabled-looking control would
          invite a tap that cannot succeed. */}
      {offersPayment(state) && (
        <form
          method="post"
          action="/api/payments/mercadopago"
          className="flex flex-col items-center gap-2 text-center"
        >
          {/* The token in the body, never in the URL: a fixed path is what lets
              the deny-by-default guard admit this endpoint by equality, and it
              keeps a live credential out of access logs. */}
          <input type="hidden" name="token" value={token} />
          <input type="hidden" name="slug" value={slug} />
          <PayDepositButton resuming={state === 'paymentInFlight'} />
          <p className="text-muted-foreground text-sm">
            {state === 'paymentInFlight'
              ? COPY.booking.resumePaymentHelp
              : COPY.booking.payDepositHelp}
          </p>
        </form>
      )}
    </main>
  );
}

function headingFor(state: PaymentPageState): string {
  switch (state) {
    case 'confirmed':
      return COPY.booking.paymentConfirmed;
    case 'awaitingConfirmation':
      return COPY.booking.paymentConfirming;
    case 'paymentRejected':
      return COPY.booking.paymentRejected;
    case 'holdLapsed':
      return COPY.booking.holdExpired;
    case 'paidSlotLost':
      return COPY.booking.paymentPaidSlotLost;
    case 'paymentsUnavailable':
      return COPY.booking.paymentsUnavailable;
    case 'holdLiveUnpaid':
    case 'paymentInFlight':
      return COPY.booking.holdHeading;
  }
}

function introFor(state: PaymentPageState): string {
  switch (state) {
    case 'confirmed':
      return COPY.booking.paymentConfirmedHelp;
    case 'awaitingConfirmation':
      return COPY.booking.paymentConfirmingHelp;
    case 'paymentRejected':
      return COPY.booking.paymentRejectedHelp;
    case 'holdLapsed':
      return COPY.booking.holdExpiredHelp;
    case 'paidSlotLost':
      return COPY.booking.paymentPaidSlotLostHelp;
    case 'paymentsUnavailable':
      return COPY.booking.paymentsUnavailableHelp;
    case 'holdLiveUnpaid':
    case 'paymentInFlight':
      return COPY.booking.holdIntro;
  }
}
