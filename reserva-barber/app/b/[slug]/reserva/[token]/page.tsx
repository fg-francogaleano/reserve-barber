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
import { blocksAvailability, type BookingStatus } from '@/server/domain/models/Booking';
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
}

/** Generous, like every other bound on a stranger-supplied value in this flow. */
const MAX_TOKEN_LENGTH = 128;

/**
 * The hold confirmation.
 *
 * **Addressed by `cancellationToken`, not by booking id** (design D10). The
 * token is already unique and unguessable, is held by exactly this person, and
 * is the same credential the confirmation email will carry — a second
 * view-only secret would be two secrets for one holder.
 *
 * It renders the appointment, the deposit and the time left on the hold, and
 * **never the client's email or phone**: the link can be shared or opened on a
 * shared device, and the repository projection that feeds this page does not
 * select those columns, so they cannot appear by accident.
 *
 * It reads live state rather than trusting the redirect that sent the client
 * here, so a hold that lapsed while the page sat open is shown as lapsed
 * rather than counting down toward a slot that is already back on sale.
 */
export default async function BookingConfirmationPage({ params }: PageProps) {
  const { token } = await params;

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

  const now = new Date();
  const isLive = blocksAvailability(
    {
      startTime: booking.startTime,
      endTime: booking.endTime,
      status: booking.status as BookingStatus,
      holdExpiresAt: booking.holdExpiresAt,
    },
    now
  );

  const minutesLeft =
    booking.holdExpiresAt === null
      ? null
      : Math.max(0, Math.ceil((booking.holdExpiresAt.getTime() - now.getTime()) / 60_000));

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">
        {isLive ? COPY.booking.holdHeading : COPY.booking.holdExpired}
      </h1>

      {isLive ? (
        <p className="text-muted-foreground text-sm">{COPY.booking.holdIntro}</p>
      ) : (
        <p className="text-muted-foreground text-sm">{COPY.booking.holdExpiredHelp}</p>
      )}

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
        {isLive && minutesLeft !== null && (
          <p className="text-muted-foreground text-sm">
            {COPY.booking.holdExpiresIn(minutesLeft)}
          </p>
        )}
      </section>

      {/* B5 and B6 own the two ways to pay. Until they ship the page says so
          plainly rather than ending on a control that goes nowhere — the same
          disclosure B1 made for the "Reservar" button, now attached to a
          statement that is finally true. */}
      {isLive && (
        <div className="flex flex-col items-center gap-1 text-center">
          <p className="text-muted-foreground text-sm">{COPY.booking.paymentUnavailable}</p>
          <p className="text-muted-foreground text-sm">{COPY.booking.paymentUnavailableHelp}</p>
        </div>
      )}
    </main>
  );
}
