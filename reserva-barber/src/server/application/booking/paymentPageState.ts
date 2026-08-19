import { blocksAvailability, type BookingStatus } from '@/server/domain/models/Booking';
import type { PaymentStatus } from '@/server/domain/models/Payment';
import type { PaymentOutcomeCode } from './bookingOutcome';

/**
 * Which of the confirmation page's eight states to render.
 *
 * A pure function rather than branching inside the component, for two reasons.
 * The precedence between these states is the part that is easy to get wrong —
 * a confirmed booking must win over an outcome code, and a paid-but-lost slot
 * must win over a lapsed hold — and precedence is far easier to prove in a
 * table of cases than in nested JSX. And the page reads **live** state, so the
 * rule that a URL parameter never decides anything has to be visible in one
 * place rather than inferred from where each branch happens to sit.
 */

export type PaymentPageState =
  /** Held, unpaid, and payable now. */
  | 'holdLiveUnpaid'
  /** A checkout was already opened and can be resumed. */
  | 'paymentInFlight'
  /** Back from the gateway; the notification has not landed yet. */
  | 'awaitingConfirmation'
  /** The booking is confirmed. Nothing left to do. */
  | 'confirmed'
  /** The gateway rejected the payment and the hold is still live. */
  | 'paymentRejected'
  /** The hold lapsed with nothing paid. */
  | 'holdLapsed'
  /** The charge went through and the slot did not survive. */
  | 'paidSlotLost'
  /** The shop cannot take payments right now. Never the client's fault. */
  | 'paymentsUnavailable';

export interface PaymentPageInput {
  readonly bookingStatus: string;
  readonly startTime: Date;
  readonly endTime: Date;
  readonly holdExpiresAt: Date | null;
  /** The booking's live payment, if it has one. */
  readonly paymentStatus: PaymentStatus | null;
  /** Whether that payment has a checkout the client can return to. */
  readonly hasCheckout: boolean;
  /** The code carried back in the URL. A hint about wording, never evidence. */
  readonly outcome: PaymentOutcomeCode | null;
  readonly now: Date;
}

/** Codes that mean the shop cannot charge, whatever the booking looks like. */
const SHOP_SIDE_FAILURES: ReadonlySet<PaymentOutcomeCode> = new Set([
  'sin-mercadopago',
  'pagos-no-disponibles',
  'monto-rechazado',
]);

export function resolvePaymentPageState(input: PaymentPageInput): PaymentPageState {
  // **First, and unconditionally.** A confirmed booking outranks every outcome
  // code, including a forged one: the page reports what the database says
  // happened, not what a URL claims. It also outranks the reverse — a stale
  // `pago-rechazado` in a bookmarked URL must not tell somebody their
  // confirmed appointment failed.
  if (input.bookingStatus === 'CONFIRMED') {
    return 'confirmed';
  }

  const holdIsLive = blocksAvailability(
    {
      startTime: input.startTime,
      endTime: input.endTime,
      status: input.bookingStatus as BookingStatus,
      holdExpiresAt: input.holdExpiresAt,
    },
    input.now
  );

  // **Second: money moved and the appointment did not.** This outranks the
  // lapsed hold below, because "your turn expired" would be a lie to somebody
  // who paid — and it is the one state on this page that owes the client an
  // explanation rather than an instruction.
  if (input.paymentStatus === 'APPROVED') {
    return 'paidSlotLost';
  }

  if (!holdIsLive) {
    return 'holdLapsed';
  }

  // The shop's own failure, and only while the hold is still live — once it has
  // lapsed there is nothing to configure a way out of.
  if (input.outcome !== null && SHOP_SIDE_FAILURES.has(input.outcome)) {
    return 'paymentsUnavailable';
  }

  if (input.outcome === 'pago-rechazado') {
    return 'paymentRejected';
  }

  // Returned from the gateway with the notification still in flight. Below the
  // rejection so an explicit failure is never softened into "we are checking".
  if (input.outcome === 'pago-pendiente') {
    return 'awaitingConfirmation';
  }

  // A checkout already exists and can be resumed. Asked after the outcome codes
  // so that a client who just came back is told what happened rather than
  // offered the same button again.
  if (input.paymentStatus === 'PENDING' && input.hasCheckout) {
    return 'paymentInFlight';
  }

  return 'holdLiveUnpaid';
}

/**
 * Whether this state offers a control that starts or resumes a payment.
 *
 * Kept beside the resolver so the page cannot render a button in a state the
 * table above never intended to be payable. The lapsed and confirmed states
 * render **no control at all** rather than a disabled one: a disabled-looking
 * button invites a tap that cannot succeed.
 */
export function offersPayment(state: PaymentPageState): boolean {
  return (
    state === 'holdLiveUnpaid' || state === 'paymentInFlight' || state === 'paymentRejected'
  );
}
