import { blocksAvailability, type BookingStatus } from '@/server/domain/models/Booking';
import type { PaymentMethod, PaymentStatus } from '@/server/domain/models/Payment';
import type { ReceiptStatus } from '@/server/domain/models/TransferReceipt';
import type { PaymentOutcomeCode } from './bookingOutcome';

/**
 * Which of the confirmation page's states to render, and which methods to
 * offer.
 *
 * A pure function rather than branching inside the component, for two reasons.
 * The precedence between these states is the part that is easy to get wrong —
 * a confirmed booking must win over an outcome code, a paid-but-lost slot must
 * win over a lapsed hold, and a receipt under review must win over both,
 * because a booking in `PENDING_APPROVAL` has not expired and telling its
 * client otherwise would be false. Precedence is far easier to prove in a table
 * of cases than in nested JSX. And the page reads **live** state, so the rule
 * that a URL parameter never decides anything has to be visible in one place
 * rather than inferred from where each branch happens to sit.
 */

export type PaymentPageState =
  /** Held, unpaid, and payable now. */
  | 'holdLiveUnpaid'
  /** A Mercado Pago checkout was already opened and can be resumed. */
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
  | 'paymentsUnavailable'
  /** Transfer committed: the destination is disclosed and a receipt is awaited. */
  | 'transferAwaitingReceipt'
  /** A receipt is uploaded and a human owes an answer. Terminal for the client. */
  | 'receiptUnderReview'
  /** The owner declined the receipt. The slot is gone. */
  | 'receiptRejected'
  /** A receipt arrived after somebody else took the slot. */
  | 'transferSlotLost'
  /** A Mercado Pago checkout is live, so the other method cannot be started. */
  | 'methodInUse';

export interface PaymentPageInput {
  readonly bookingStatus: string;
  readonly startTime: Date;
  readonly endTime: Date;
  readonly holdExpiresAt: Date | null;
  /** The booking's live payment, if it has one. */
  readonly paymentStatus: PaymentStatus | null;
  /** Which method that payment belongs to. */
  readonly paymentMethod: PaymentMethod | null;
  /** Whether that payment has a checkout the client can return to. */
  readonly hasCheckout: boolean;
  /** The review state of the booking's receipt, if it has one. */
  readonly receiptStatus: ReceiptStatus | null;
  /** The code carried back in the URL. A hint about wording, never evidence. */
  readonly outcome: PaymentOutcomeCode | null;
  /**
   * Whether this shop has any usable payment method at all.
   *
   * In the table rather than left to the page, because it is a precedence
   * question like every other one here: a shop with nothing configured must
   * render as unable to take payments, not as a held slot with no controls
   * under it. **This is the gap B6 closes** — `isBookable` already admits a
   * transfer-only shop and B4 already lets it create holds, so a booking can
   * reach this page with no way to pay for it.
   */
  readonly shopCanBePaid: boolean;
  readonly now: Date;
}

/** What the page may offer, given what the shop has configured. */
export interface PaymentMethodAvailability {
  readonly hasMercadoPago: boolean;
  /** Whether a **usable** transfer destination exists — holder name included. */
  readonly hasTransfer: boolean;
}

/** Codes that mean the shop cannot charge, whatever the booking looks like. */
const SHOP_SIDE_FAILURES: ReadonlySet<PaymentOutcomeCode> = new Set([
  'sin-mercadopago',
  'pagos-no-disponibles',
  'sin-transferencia',
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

  // **Second: a receipt is with a human.** Above everything below, because a
  // `PENDING_APPROVAL` booking is not governed by `holdExpiresAt` — that column
  // was the deadline for *uploading*, not for *answering* — so the lapsed-hold
  // branch would otherwise tell somebody their turn expired while the owner is
  // looking at their comprobante.
  if (input.bookingStatus === 'PENDING_APPROVAL' && input.receiptStatus === 'PENDING') {
    return 'receiptUnderReview';
  }

  // The owner declined it. Its own state rather than a plain cancellation,
  // because the client is owed the reason and a way to act on it.
  if (input.receiptStatus === 'REJECTED') {
    return 'receiptRejected';
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

  // **Money moved and the appointment did not.** This outranks the lapsed hold
  // below, because "your turn expired" would be a lie to somebody who paid.
  if (input.paymentStatus === 'APPROVED') {
    return 'paidSlotLost';
  }

  // **The lapsed hold, and the one code allowed to refine what it says.**
  //
  // `transferencia-sin-lugar` has no row behind it — the receipt was refused
  // before anything was written — so it is the only state on this page that a
  // URL parameter alone can produce. That makes it the one place where the
  // rule "a code never decides anything" is at risk, and it is why the code is
  // read **inside** this branch rather than above it.
  //
  // An earlier version asked it first. A forged `?estado=transferencia-sin-lugar`
  // on a booking whose hold was still live then rendered "your slot was taken"
  // and removed the payment controls — telling a client they had lost a turn
  // they still held, which is the mirror of the forged confirmation the flow
  // has refused since B5 and no less damaging: one invents good news, the other
  // makes somebody abandon a booking that is theirs.
  //
  // Here it can only sharpen a truth the database already told us: the hold is
  // gone either way, and the code says whether a transfer went with it.
  if (!holdIsLive) {
    return input.outcome === 'transferencia-sin-lugar' ? 'transferSlotLost' : 'holdLapsed';
  }

  // The shop's own failure, and only while the hold is still live — once it has
  // lapsed there is nothing to configure a way out of.
  if (input.outcome !== null && SHOP_SIDE_FAILURES.has(input.outcome)) {
    return 'paymentsUnavailable';
  }

  // The same state reached without any code at all: nothing is configured, so
  // there is nothing to offer. Below the committed-transfer branch would be
  // wrong — a client who already committed keeps their destination even if the
  // owner clears it afterwards, because the money may already have moved. This
  // sits above it only for a booking with no live transfer, which is why it is
  // guarded on the method rather than placed later.
  if (!input.shopCanBePaid && input.paymentMethod !== 'BANK_TRANSFER') {
    return 'paymentsUnavailable';
  }

  // Chose transfer and cannot, because a checkout is already open. Asked before
  // the transfer state below so the client is told why, rather than being shown
  // a destination they were never given.
  if (input.outcome === 'metodo-en-curso') {
    return 'methodInUse';
  }

  // **A committed transfer is a state of the database, never of the URL.** The
  // destination the page renders comes from a projection that is null unless
  // this is true, so a forged `transferencia-iniciada` shows nobody a CBU.
  if (input.paymentMethod === 'BANK_TRANSFER' && input.paymentStatus === 'PENDING') {
    return 'transferAwaitingReceipt';
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
  if (
    input.paymentMethod === 'MERCADO_PAGO' &&
    input.paymentStatus === 'PENDING' &&
    input.hasCheckout
  ) {
    return 'paymentInFlight';
  }

  return 'holdLiveUnpaid';
}

/**
 * The states in which a client is still choosing how to pay.
 *
 * Kept beside the resolver so the page cannot render a control in a state the
 * table above never intended to be payable. Terminal states render **no control
 * at all** rather than a disabled one: a disabled-looking button invites a tap
 * that cannot succeed.
 */
function isChoosingMethod(state: PaymentPageState): boolean {
  return state === 'holdLiveUnpaid' || state === 'paymentRejected';
}

/**
 * Whether to offer Mercado Pago.
 *
 * **Now conditional on the shop having credentials**, which B5's version was
 * not: it offered the control unconditionally and let the failure surface as
 * `sin-mercadopago` after the POST. That was defensible while Mercado Pago was
 * the only method; with two, offering one that cannot work is just hiding the
 * one that can.
 */
export function offersMercadoPago(
  state: PaymentPageState,
  methods: PaymentMethodAvailability
): boolean {
  if (!methods.hasMercadoPago) return false;
  // `paymentInFlight` resumes an existing checkout, which is a Mercado Pago
  // control even though no choice is being made.
  return isChoosingMethod(state) || state === 'paymentInFlight';
}

/** Whether to offer bank transfer. */
export function offersTransfer(
  state: PaymentPageState,
  methods: PaymentMethodAvailability
): boolean {
  return methods.hasTransfer && isChoosingMethod(state);
}

/**
 * Whether the shop can be paid at all.
 *
 * A shop with neither method usable renders as unable to take payments — the
 * gap B6 closes, since `isBookable` already admits a transfer-only shop and B4
 * already lets it create holds.
 */
export function canBePaid(methods: PaymentMethodAvailability): boolean {
  return methods.hasMercadoPago || methods.hasTransfer;
}
