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
  resolveConfirmationRefresh,
  CONFIRMATION_REFRESH_PARAM,
} from '@/server/application/booking/confirmationRefresh';
import { resolveConfirmationEmailNotice } from '@/server/application/booking/confirmationEmailNotice';
import {
  CANCEL_CONFIRM_PARAM,
  isCancellationConfirmationRequested,
} from '@/server/application/booking/cancellationConfirmation';
import {
  isCancellableByClient,
  type BookingStatus,
} from '@/server/domain/models/Booking';
import {
  resolvePaymentPageState,
  offersMercadoPago,
  offersTransfer,
  canBePaid,
  type PaymentPageState,
} from '@/server/application/booking/paymentPageState';
import {
  PUBLIC_CANCELLATION_API,
  PUBLIC_TRANSFER_API,
} from '@/server/application/auth/routeGuard';
import { PayDepositButton } from '@/components/booking/PayDepositButton';
import { ChooseTransferButton } from '@/components/booking/ChooseTransferButton';
import { TransferDestination } from '@/components/booking/TransferDestination';
import { ReceiptUploadForm } from '@/components/booking/ReceiptUploadForm';
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

  const query = await searchParams;
  const outcome = parsePaymentOutcomeCode(query[BOOKING_OUTCOME_PARAM]);
  const now = new Date();

  /**
   * C1: the two codes that mean a cancellation did not happen.
   *
   * Read out of the shared outcome union rather than given a parameter of their
   * own, because they are read by this page like every other code on it. They
   * decide **wording only**, and under the rule B5 established for every other
   * code here: *a code may sharpen a truth the database already tells, and may
   * never invent one.*
   *
   * **`turno-empezado` is therefore checked against the clock**, not trusted.
   * A hand-edited one on a booking whose appointment is still ahead would
   * otherwise tell its client the turn had already started — a false statement
   * about their own appointment, and the exact mirror of the forged
   * `transferencia-sin-lugar` B5 refused for telling somebody they had lost a
   * slot they still held. It degrades to the generic refusal, which asserts
   * nothing about the booking beyond an attempt having failed.
   *
   * Whether either renders at all is decided by the resolved state below, so a
   * forged code cannot claim a failure over a booking that is genuinely
   * cancelled.
   */
  const refusalCode =
    outcome === 'turno-empezado' || outcome === 'cancelacion-no-posible' ? outcome : null;

  const cancellationRefusal =
    refusalCode === 'turno-empezado' && booking.startTime.getTime() > now.getTime()
      ? 'cancelacion-no-posible'
      : refusalCode;

  /**
   * What this shop can actually be paid with.
   *
   * Deliberately **not** derived from `booking.transfer`, which is non-null
   * only once a transfer has been committed. The two answer different
   * questions: `hasTransferOption` is "may the page offer the method",
   * `booking.transfer` is "may the page show the account number". Collapsing
   * them is how a CBU ends up in front of somebody who never chose it.
   */
  const methods = {
    hasMercadoPago: booking.hasMercadoPago,
    hasTransfer: booking.hasTransferOption,
  };

  const state = resolvePaymentPageState({
    bookingStatus: booking.status,
    startTime: booking.startTime,
    endTime: booking.endTime,
    holdExpiresAt: booking.holdExpiresAt,
    paymentStatus: booking.paymentStatus,
    paymentMethod: booking.paymentMethod,
    hasCheckout: booking.hasCheckout,
    receiptStatus: booking.receiptStatus,
    cancelledBy: booking.cancelledBy,
    outcome,
    shopCanBePaid: canBePaid(methods),
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

  /**
   * C1: may this client cancel, and are they being asked to confirm?
   *
   * **The same predicate the write is guarded by**, so a control cannot appear
   * where the write refuses. It is stricter than the owner's rule in two ways:
   * a started appointment cannot be released, and a booking whose comprobante
   * is under review is not the client's to cancel — that receipt would vanish
   * from the owner's queue with the money already transferred.
   */
  const canCancel = isCancellableByClient(
    {
      startTime: booking.startTime,
      endTime: booking.endTime,
      status: booking.status as BookingStatus,
      holdExpiresAt: booking.holdExpiresAt,
    },
    now
  );

  /**
   * Step one of two, and it is a **`GET` that writes nothing**.
   *
   * Gated on `canCancel` as well as on the parameter: a hand-edited URL gets
   * the ordinary page rather than a confirmation for something that would then
   * be refused.
   */
  const confirmingCancellation =
    canCancel && isCancellationConfirmationRequested(query[CANCEL_CONFIRM_PARAM]);

  /**
   * T62: the awaiting state refreshes itself, a bounded number of times.
   *
   * Emitted only for that state. The bound, the parse and the clamp all live in
   * `resolveConfirmationRefresh` — a forged, malformed or out-of-range `intento`
   * renders the terminal form, which is exactly this page's behaviour before
   * this change, so the worst a hand-edited URL can do is get the old page.
   *
   * The URL is rebuilt from the resolved params rather than read from a header,
   * because this flow does not trust a request for its own address.
   *
   * **C1 suppresses it while the cancellation confirmation is on screen.** That
   * state is client-cancellable, so without this the page would reload
   * underneath somebody reading an irreversible warning — every five seconds,
   * twice. The module's own allowlist stops `cancelar` riding along on the
   * refresh URL; this stops the refresh happening at all while it matters.
   */
  const refresh =
    state === 'awaitingConfirmation' && !confirmingCancellation
      ? resolveConfirmationRefresh({
          // Passed **raw**, array and all. Flattening it here first is how a
          // repeated `?intento=2&intento=2` came to restart the counter: the
          // page read the array as absent, which the clamp treats as a first
          // arrival. The clamp is where that decision belongs, so it gets the
          // value the framework actually produced.
          attempt: query[CONFIRMATION_REFRESH_PARAM],
          currentUrl: currentUrlOf(slug, token, query),
        })
      : null;

  /**
   * N1: what the confirmed state may claim about the email.
   *
   * Never a guess. A page that said "te mandamos la confirmación" over a send
   * that failed would remove the client's reason to save the link, at the exact
   * moment the link became their only record of the appointment.
   */
  const emailNotice =
    state === 'confirmed'
      ? resolveConfirmationEmailNotice({
          sentAt: booking.confirmationEmailSentAt,
          updatedAt: booking.updatedAt,
          now,
        })
      : null;

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-8">
      {/* Server-rendered, because the public flow assumes no JavaScript. */}
      {refresh !== null && (
        <meta httpEquiv="refresh" content={`${refresh.seconds};url=${refresh.url}`} />
      )}

      <h1 className="text-2xl font-semibold tracking-tight">{headingFor(state)}</h1>
      <p className="text-muted-foreground text-sm">
        {state === 'awaitingConfirmation'
          ? // The one state whose help text depends on whether anything further
            // is going to happen. B5's original sentence — asking for a manual
            // reload — is now the terminal form rather than the only form.
            refresh !== null
            ? COPY.booking.paymentConfirmingHelp
            : COPY.booking.paymentConfirmingHelpExhausted
          : introFor(state)}
      </p>

      {/* Honest only because the refresh above is real. B5 forbade a progress
          indicator on this state for precisely that reason, and the prohibition
          survives on the terminal form, where nothing further will happen. */}
      {refresh !== null && (
        <p className="text-muted-foreground animate-pulse text-sm" aria-live="polite">
          {COPY.booking.paymentConfirming}…
        </p>
      )}

      {/*
        C1: why a cancellation did not happen — and only when it did not.

        **Gated on the resolved state, never on the code alone.** A second tap,
        a lost response after a commit and a browser retry all arrive here with
        a refusal code over a booking that is, in fact, cancelled. Rendering
        "no pudimos cancelar" under a heading that says the turn is cancelled is
        the product contradicting itself in two adjacent sentences — and with no
        JavaScript there is no disabled button to prevent the second tap.
      */}
      {cancellationRefusal !== null && !isCancelled(state) && (
        <p className="text-sm font-medium" aria-live="polite">
          {cancellationRefusal === 'turno-empezado'
            ? COPY.booking.cancelRefusedStarted
            : COPY.booking.cancelRefusedMoved}
        </p>
      )}

      {/*
        The one state where the control is deliberately withheld (C1).

        Their comprobante is waiting for a human and the money has already
        moved. Cancelling would take that receipt out of the owner's queue —
        which filters on the booking's status — leaving a transfer nobody ever
        reviews. Without this sentence the missing control reads as a bug.
      */}
      {state === 'receiptUnderReview' && (
        <p className="text-muted-foreground text-sm">
          {COPY.booking.receiptUnderReviewCancelHelp}
        </p>
      )}

      {emailNotice !== null && emailNotice !== 'pending' && (
        <p
          className={
            emailNotice === 'sent' ? 'text-muted-foreground text-sm' : 'text-sm font-medium'
          }
        >
          {emailNotice === 'sent'
            ? COPY.booking.paymentConfirmedEmailSent
            : COPY.booking.paymentConfirmedEmailFailed}
        </p>
      )}

      {/*
        C2: the money, on the one cancelled state where any moved.

        **The page is where this matters most and was the last place to say
        it.** The owner's confirmation warned them before the write and the
        email says it, but a client who still has their link open is the person
        most likely to look and least likely to have read either — so a page
        that mentioned only the released slot would be the quietest surface
        about the only thing that costs them anything.

        Guarded on the payment rather than on the state alone: a cancellation
        with nothing charged has no money to explain, and raising a refund a
        client never paid invites them to chase one.
      */}
      {isCancelled(state) && booking.paymentStatus === 'APPROVED' && (
        <p className="text-sm font-medium">{COPY.booking.bookingCancelledDepositNote}</p>
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

      {/*
        C1, step two: the confirmation, and the `POST` behind it.

        **The panel replaces the control rather than sitting beside it**, so
        there is one decision on screen at a time. Everything it says is said
        *before* the irreversible submission — this is the only surface shown
        while the choice is still the client's to reverse, which is the whole
        reason this is two steps and not a button.
      */}
      {confirmingCancellation && (
        <section className="border-border flex flex-col gap-3 rounded-md border p-4">
          <h2 className="text-lg font-medium">{COPY.booking.cancelConfirmHeading}</h2>
          <p className="text-muted-foreground text-sm">{COPY.booking.cancelConfirmSlot}</p>
          <p className="text-sm font-medium">{COPY.booking.cancelConfirmFinal}</p>

          {/* Guarded on the payment, not on the state: raising a refund for a
              client who never paid invites them to chase one. */}
          {booking.paymentStatus === 'APPROVED' && (
            <p className="text-sm font-medium">{COPY.booking.cancelConfirmDeposit}</p>
          )}

          {/* Cancelling does not close an open Mercado Pago checkout — that
              needs the shop's credentials on a path forbidden from holding
              them — so the client is told not to finish it. */}
          {booking.paymentStatus === 'PENDING' && (
            <p className="text-sm font-medium">{COPY.booking.cancelConfirmOpenPayment}</p>
          )}

          <form
            method="post"
            action={PUBLIC_CANCELLATION_API}
            className="flex flex-col items-center gap-2 text-center"
          >
            {/* The token in the body, never in the URL: the fixed path is what
                lets the deny-by-default guard admit this endpoint by equality,
                and it keeps a live credential out of access logs. */}
            <input type="hidden" name="token" value={token} />
            <button
              type="submit"
              className="bg-destructive text-destructive-foreground w-full rounded-md px-4 py-2 text-sm font-medium"
            >
              {COPY.booking.cancelConfirmSubmit}
            </button>
          </form>

          {/* A plain navigation back to this page without the parameter. No
              JavaScript, and nothing to undo. */}
          <a
            href={`/b/${encodeURIComponent(slug)}/reserva/${encodeURIComponent(token)}`}
            className="text-muted-foreground text-center text-sm underline"
          >
            {COPY.booking.cancelConfirmBack}
          </a>
        </section>
      )}

      {/*
        C1, step one: a link, and deliberately not a form.

        **A `GET` that writes nothing** is what makes this safe to put behind a
        token that lives in an unverified mailbox: a mail scanner, a
        link-preview bot, a security gateway or the framework's own prefetching
        can all fetch it, and all they get is a rendered page.
      */}
      {canCancel && !confirmingCancellation && (
        <a
          href={`/b/${encodeURIComponent(slug)}/reserva/${encodeURIComponent(
            token
          )}?${CANCEL_CONFIRM_PARAM}=1`}
          className="text-muted-foreground text-center text-sm underline"
        >
          {COPY.booking.cancelBookingCta}
        </a>
      )}

      {/* Absent, never disabled. Every state below this line means the client
          has nothing left to do here, and a disabled-looking control would
          invite a tap that cannot succeed. */}
      {offersMercadoPago(state, methods) && (
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

      {/* The second method. A separate form rather than a second submit on the
          first, because they post to different endpoints — and because a client
          with no JavaScript must be able to choose either by navigation. */}
      {offersTransfer(state, methods) && (
        <form
          method="post"
          action={PUBLIC_TRANSFER_API}
          className="flex flex-col items-center gap-2 text-center"
        >
          <input type="hidden" name="token" value={token} />
          <ChooseTransferButton />
          <p className="text-muted-foreground text-sm">{COPY.booking.payWithTransferHelp}</p>
        </form>
      )}

      {/* The destination, and only here. `booking.transfer` is null unless a
          transfer is committed, so this cannot render for somebody who has not
          chosen — the guarantee is the projection's, not this condition's. */}
      {state === 'transferAwaitingReceipt' && booking.transfer !== null && (
        <>
          <TransferDestination
            destination={booking.transfer}
            depositAmount={booking.depositAmount}
            minutesLeft={minutesLeft}
          />
          <ReceiptUploadForm token={token} replacing={booking.receiptStatus === 'PENDING'} />
        </>
      )}
    </main>
  );
}

/**
 * One value from a query parameter that may arrive as an array.
 *
 * Next hands a repeated parameter over as `string[]`, and a repeated `intento`
 * is the obvious way somebody would try to defeat the clamp. An array is
 * treated as malformed rather than as its first element: this page has never
 * emitted one, so its presence is not a value to interpret.
 */
function singleValue(raw: string | string[] | undefined): string | undefined {
  return typeof raw === 'string' ? raw : undefined;
}

/**
 * This page's own address, rebuilt from what it was routed with.
 *
 * **Never from a request header.** The public profile page already refuses a
 * `Host` fallback for its canonical URL, because a forged one rewrites a shop's
 * links to point elsewhere. Here the path carries a cancellation token, so a
 * forged host would aim a refresh — token included — at somebody else's domain.
 */
function currentUrlOf(
  slug: string,
  token: string,
  query: Record<string, string | string[] | undefined>
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    const single = singleValue(value);
    if (single !== undefined) search.set(key, single);
  }
  const suffix = search.size > 0 ? `?${search.toString()}` : '';
  return `/b/${encodeURIComponent(slug)}/reserva/${encodeURIComponent(token)}${suffix}`;
}

/**
 * Whether this state is a cancellation, of any attribution (C2, extended by C1).
 *
 * A predicate rather than three comparisons inlined at the call site. C2 wrote
 * it predicting that C1 would add the third member, and the page gained it by
 * editing one line rather than by somebody remembering every place that asks.
 */
function isCancelled(state: PaymentPageState): boolean {
  return (
    state === 'cancelledByShop' || state === 'cancelledByClient' || state === 'cancelled'
  );
}

function headingFor(state: PaymentPageState): string {
  switch (state) {
    case 'confirmed':
      return COPY.booking.paymentConfirmed;
    case 'cancelledByShop':
      return COPY.booking.bookingCancelledByShop;
    case 'cancelledByClient':
      return COPY.booking.bookingCancelledByClient;
    case 'cancelled':
      return COPY.booking.bookingCancelled;
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
    case 'transferAwaitingReceipt':
      return COPY.booking.transferHeading;
    case 'receiptUnderReview':
      return COPY.booking.receiptUnderReview;
    case 'receiptRejected':
      return COPY.booking.receiptRejected;
    case 'transferSlotLost':
      return COPY.booking.transferSlotLost;
    case 'methodInUse':
      return COPY.booking.methodInUse;
    case 'holdLiveUnpaid':
    case 'paymentInFlight':
      return COPY.booking.holdHeading;
  }
}

function introFor(state: PaymentPageState): string {
  switch (state) {
    case 'confirmed':
      return COPY.booking.paymentConfirmedHelp;
    case 'cancelledByShop':
      return COPY.booking.bookingCancelledByShopHelp;
    case 'cancelledByClient':
      return COPY.booking.bookingCancelledByClientHelp;
    case 'cancelled':
      return COPY.booking.bookingCancelledHelp;
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
    case 'transferAwaitingReceipt':
      return COPY.booking.transferIntro;
    case 'receiptUnderReview':
      return COPY.booking.receiptUnderReviewHelp;
    case 'receiptRejected':
      return COPY.booking.receiptRejectedHelp;
    case 'transferSlotLost':
      return COPY.booking.transferSlotLostHelp;
    case 'methodInUse':
      return COPY.booking.methodInUseHelp;
    case 'holdLiveUnpaid':
    case 'paymentInFlight':
      return COPY.booking.holdIntro;
  }
}
