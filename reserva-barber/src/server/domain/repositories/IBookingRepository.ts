import type { Interval } from '@/server/domain/models/availability';
import type { LocalDate } from '@/server/domain/models/bookingCalendar';
import type { WorkingWindowMinutes } from './IBarberAvailabilityRepository';
import type { PaymentMethod, PaymentStatus } from '../models/Payment';
import type { ReceiptStatus } from '../models/TransferReceipt';
import type { CancelledBy } from '../models/Booking';

/**
 * The booking a successful hold produces, as the flow needs it.
 *
 * `cancellationToken` is here because it addresses the confirmation page (B4
 * design D10). The client's name, email and phone are **not**: nothing above
 * this repository renders them back, and a field that does not exist cannot be
 * leaked into a log line or a serialized prop.
 */
export interface HeldBooking {
  readonly id: string;
  readonly cancellationToken: string;
  readonly startTime: Date;
  readonly endTime: Date;
  readonly holdExpiresAt: Date | null;
  readonly depositAmount: string;
}

/**
 * Everything the transaction needs to write one provisional booking.
 *
 * The two money values arrive as canonical decimal strings, already computed
 * by the deposit rule — the repository converts at the boundary and never
 * decides an amount.
 */
export interface ProvisionalBookingInput {
  readonly ownerId: string;
  readonly barberId: string;
  readonly serviceId: string;
  readonly clientId: string;
  readonly startTime: Date;
  readonly endTime: Date;
  readonly priceAtBooking: string;
  readonly depositAmount: string;
  readonly cancellationToken: string;
  readonly holdExpiresAt: Date;
  /** The weekday whose working windows must still contain the appointment. */
  readonly weekday: number;
  /**
   * The business-local calendar day the appointment falls on.
   *
   * Passed rather than re-derived from `startTime`: working windows are stored
   * as wall-clock minutes and must be converted against the same day the
   * availability read used. Deriving it again here would be a second answer to
   * a question the caller already settled — and the two would disagree for the
   * last three hours of every local day.
   */
  readonly localDate: LocalDate;
  /** The business-local day bounds, for re-reading absences and bookings. */
  readonly dayRange: Interval;
  /** The current instant, injected so the blocking rule is testable. */
  readonly now: Date;
}

/**
 * What the transaction decided.
 *
 * `slotTaken` is a **return value, not an exception**: losing a race for a
 * slot is an ordinary outcome of a public booking flow, not a failure of the
 * system, and modelling it as a throw would put the flow's most common
 * non-success path in the same channel as a database outage.
 *
 * `alreadyHeld` is the same client's own hold for the same barber and start
 * time, returned rather than refused (B4 design D7). Without it a client who
 * double-taps is told the slot they just took belongs to somebody else.
 */
export type ProvisionalBookingResult =
  | { readonly outcome: 'created'; readonly booking: HeldBooking }
  | { readonly outcome: 'alreadyHeld'; readonly booking: HeldBooking }
  | { readonly outcome: 'slotTaken' };

/** A booking as the hold-confirmation page reads it, by cancellation token. */
export interface BookingByToken {
  readonly id: string;
  readonly status: string;
  readonly startTime: Date;
  readonly endTime: Date;
  readonly holdExpiresAt: Date | null;
  readonly depositAmount: string;
  readonly clientName: string;
  /**
   * Who cancelled, when somebody did (C2).
   *
   * The page attributes the decision from this rather than inferring it from
   * the status, which cannot tell an owner cancelling from a client doing so —
   * opposite messages. A null on a cancelled booking is every row written
   * before it was recorded.
   */
  readonly cancelledBy: CancelledBy | null;
  /**
   * When the confirmation email was accepted by the provider, or `null` (N1).
   *
   * On this page it drives one sentence in the confirmed state, and the reason
   * it belongs on **this** projection is that the sentence must never be a
   * guess: claiming a message that failed would remove the client's reason to
   * save the link, at exactly the moment the link became their only record.
   */
  readonly confirmationEmailSentAt: Date | null;
  /**
   * The booking's last write, used only to tell "not sent yet" from "could not
   * be sent" (N1).
   *
   * A proxy for the confirmation instant, which this table does not store.
   * Good enough for the one thing it decides — whether to stay quiet for a few
   * seconds or to tell the client the message failed — and named here as a
   * proxy so nobody later mistakes it for the confirmation time.
   */
  readonly updatedAt: Date;
  readonly barberDisplayName: string;
  readonly serviceName: string;
  readonly locationName: string;
  /**
   * The status of this booking's live payment, or `null` if it has none (B5).
   *
   * Enough to tell "nothing paid" from "a checkout is open" from "the money
   * moved", which is what the page's states turn on.
   */
  readonly paymentStatus: PaymentStatus | null;
  /**
   * Whether that payment has a checkout the client can return to.
   *
   * **A boolean, deliberately, and not the URL.** The page never renders the
   * checkout address: resuming goes back through the initiation endpoint, which
   * is already idempotent and answers with the existing checkout. Putting the
   * URL in the page would be a second path to the same place, and the one that
   * cannot be re-decided if the payment turns out to be stale.
   *
   * `false` with a `PENDING` payment means a preference creation that never
   * finished — the client gets the ordinary button and the initiation retries.
   */
  readonly hasCheckout: boolean;
  /**
   * Which method the live payment belongs to, or `null` if there is none (B6).
   *
   * With two methods in the product, a `PENDING` payment is no longer a
   * complete answer: it means "resume the checkout" for one and "upload your
   * receipt" for the other.
   */
  readonly paymentMethod: PaymentMethod | null;
  /** The review state of this booking's receipt, if it has one (B6). */
  readonly receiptStatus: ReceiptStatus | null;
  /**
   * Whether the shop can be paid through Mercado Pago.
   *
   * Derived **in SQL** as `mpAccessToken IS NOT NULL`, so the credential never
   * enters the process on a route a stranger reaches without a session — the
   * technique B4 established for the booking write's readiness gate. This
   * interface has no field the token could occupy.
   */
  readonly hasMercadoPago: boolean;
  /**
   * Whether the shop has a transfer destination a client could **use** (B6).
   *
   * Deliberately separate from `transfer` below, because they answer different
   * questions: this one is "may the page offer the method", that one is "may
   * the page show the account number". Collapsing them into one field is how a
   * CBU ends up rendered to somebody who has not committed and whose hold is
   * about to lapse.
   *
   * Stricter than the bookability gate: a destination with no holder name is
   * unusable here, because the client cannot confirm from their bank's screen
   * who they are paying.
   */
  readonly hasTransferOption: boolean;
  /**
   * The transfer destination, **and `null` unless this booking has already
   * committed to paying by transfer** (B6).
   *
   * Not merely "not rendered yet" — unrepresentable. The rule is that a CBU
   * must never be visible during a window that is about to lapse, because a
   * client who transfers into a lapsed hold has moved real money that no row
   * here records and no gateway can be asked about. A projection that carried
   * the destination unconditionally would leave that rule to whoever writes the
   * next component; this one cannot be got wrong from the page.
   *
   * It is also `null` when the destination is missing a holder name, which
   * `isTransferOfferableToClient` treats as unusable.
   */
  readonly transfer: PublicTransferDestination | null;
}

/** The three plaintext columns a client is shown. Never a credential. */
export interface PublicTransferDestination {
  readonly cbuCvu: string | null;
  readonly alias: string | null;
  readonly holderName: string;
}

/**
 * A booking as the payment initiation path reads it, by cancellation token.
 *
 * **A separate projection from `BookingByToken`, not an extension of it.** This
 * one carries `ownerId` — the initiation needs it to reach that owner's Mercado
 * Pago credential — and B2 established that the owner id never reaches a page.
 * Widening the page's projection to serve an API route would hand every render
 * a field it must not have, so the two are cut apart and neither can grow into
 * the other by accident.
 *
 * `publicSlug` is here for the same reason in the opposite direction: the
 * return URL Mercado Pago sends the client back to is built from the booking's
 * own shop, never from anything the request supplied, so a submitted slug
 * cannot steer where a payment returns to.
 *
 * It carries no client name, email or phone. The initiation renders nobody.
 */
export interface BookingForPaymentInitiation {
  readonly id: string;
  readonly status: string;
  readonly startTime: Date;
  readonly endTime: Date;
  readonly holdExpiresAt: Date | null;
  readonly depositAmount: string;
  readonly serviceName: string;
  readonly ownerId: string;
  readonly publicSlug: string;
}

/**
 * What the bank transfer path needs, and a third projection rather than a
 * widened second one (B6).
 *
 * It differs from `BookingForPaymentInitiation` in three columns, and each is
 * needed for a reason the Mercado Pago path does not share:
 *
 * - `barberId`, because attaching a receipt moves the booking between blocking
 *   states and must take the per-barber advisory lock. The Mercado Pago
 *   initiation takes no lock and has no use for it.
 * - `ownerAuthUserId`, because it is the leading segment of the storage key and
 *   therefore what the bucket's policies compare against a session. It is the
 *   **Supabase auth user id**, not `Owner.id` — distinct values, and only this
 *   one is comparable to `auth.uid()`.
 * - no `serviceName`, because nothing on this path renders one.
 *
 * `ownerAuthUserId` is nullable at the column level. A booking whose owner has
 * none cannot have a key composed for it, and the caller refuses rather than
 * inventing a prefix.
 */
export interface BookingForTransfer {
  readonly id: string;
  readonly status: string;
  readonly startTime: Date;
  readonly endTime: Date;
  readonly holdExpiresAt: Date | null;
  readonly depositAmount: string;
  readonly ownerId: string;
  readonly ownerAuthUserId: string | null;
  readonly publicSlug: string;
  readonly barberId: string;
}

/**
 * Repository contract for writing and reading bookings.
 *
 * Every method takes or is keyed by something owner-scoped, so an unscoped
 * query is inexpressible — the property every repository in this project
 * holds.
 */
/**
 * What composing the confirmation message needs (N1).
 *
 * Structurally identical to `ConfirmationEmailBooking` in the domain builder,
 * and deliberately declared separately: this one is the repository's promise
 * about which columns it reads, and that one is the builder's statement about
 * which values it renders. They agree today because the message needs exactly
 * what the read returns; if a later change makes them differ, two names make
 * that visible rather than silently widening a query to feed a template.
 *
 * `shopSlug` comes from the owner's `BusinessProfile`, which is what the link
 * is addressed through. `locationAddress` is optional because a branch may not
 * have one, and the message omits the line rather than printing an empty label.
 */
export interface BookingForConfirmationEmail {
  readonly clientName: string;
  readonly clientEmail: string;
  readonly shopName: string;
  readonly shopSlug: string;
  readonly locationName: string;
  readonly locationAddress: string | null;
  readonly barberName: string;
  readonly serviceName: string;
  readonly startTime: Date;
  /** Canonical decimal strings, like every money value crossing this boundary. */
  readonly priceAtBooking: string;
  readonly depositAmount: string;
  readonly cancellationToken: string;
}

/**
 * What an owner's cancellation attempt did (C2).
 *
 * `notCancellable` carries **the status it actually found**, for the reason the
 * payment confirmation gives about its own refusal: from inside the transaction
 * a booking confirmed a moment ago and one the sweep expired look identical,
 * and only the caller can turn that difference into something an owner reads.
 *
 * `applied` carries `depositApproved` because the transaction is the only place
 * that question is answered authoritatively — it has just read the payment
 * under the same statement that refused to touch it — and the client's notice
 * needs it to decide whether to mention money at all. Recomputing it afterwards
 * would be a second read that a concurrent write could answer differently.
 */
export type CancelBookingResult =
  | { readonly outcome: 'applied'; readonly bookingId: string; readonly depositApproved: boolean }
  | { readonly outcome: 'notCancellable'; readonly status: string }
  /** The booking id resolved to nothing within this owner's scope. */
  | { readonly outcome: 'notFound' };

export interface IBookingRepository {
  /**
   * Holds a slot, or reports why it could not.
   *
   * **The implementation MUST be a single transaction** whose first statement
   * acquires a lock scoped to the barber, and which then re-reads the day's
   * windows, absences and candidate bookings, applies the shared
   * `blocksAvailability` predicate, re-asserts the appointment still fits a
   * working window and misses every absence, and only then inserts
   * (`backend-standards.md`, Booking rule 1). An application-level
   * read-then-write is explicitly insufficient: the check and the write may
   * not share a connection through a transaction-mode pooler.
   *
   * The blocking decision MUST call `blocksAvailability` rather than re-express
   * it in SQL. The predicate reads a deadline (`holdExpiresAt`), and a SQL copy
   * would drift from the availability read the first time B7 refines it —
   * offering a client a time and then refusing them while they pay.
   */
  createProvisional(input: ProvisionalBookingInput): Promise<ProvisionalBookingResult>;

  /**
   * How many live holds this client currently has with this owner (B4 FR11).
   *
   * "Live" is the same question `blocksAvailability` asks: a `PENDING_PAYMENT`
   * row past its deadline does not count, because it is no longer holding
   * anything.
   */
  countLiveHoldsForClient(clientId: string, now: Date): Promise<number>;

  /**
   * This client's still-live holds with this barber on one day.
   *
   * Exists for the repeat-submission rule, and only on the path where the
   * availability read has already refused the requested time. **A client's own
   * hold removes their own slot from the offered list**, so a second identical
   * submission fails the membership check before the transaction — whose
   * `alreadyHeld` branch would otherwise have caught it — and the client is
   * told the slot they are holding is taken.
   *
   * The caller compares formatted start times rather than parsing the
   * submitted one, so the "matched, never parsed" rule holds here too.
   */
  findLiveHoldsForClientOnDay(input: {
    clientId: string;
    barberId: string;
    dayRange: Interval;
    now: Date;
  }): Promise<HeldBooking[]>;

  /**
   * The booking behind a cancellation token, for the confirmation page.
   *
   * Returns a **named projection** that carries no client email and no client
   * phone. The page can be opened by anyone holding the link, so the columns
   * it cannot select are the ones it cannot render.
   */
  findByCancellationToken(token: string): Promise<BookingByToken | null>;

  /**
   * The booking a payment is about to be opened for, by cancellation token.
   *
   * Separate from `findByCancellationToken` because it answers a different
   * question for a different caller — see `BookingForPaymentInitiation`. The
   * two must not be merged: one feeds a render and the other feeds a charge,
   * and each carries exactly the columns its side is allowed to know.
   */
  findForPaymentInitiation(token: string): Promise<BookingForPaymentInitiation | null>;

  /**
   * The same token, answered for the bank transfer path.
   *
   * A third method rather than a widened second one, for the reason stated on
   * `BookingForTransfer`: each projection carries exactly the columns its side
   * is allowed to know, and the two payment paths need different ones.
   */
  findForTransfer(token: string): Promise<BookingForTransfer | null>;

  /**
   * The booking behind a confirmation email, by booking id (N1).
   *
   * **This is the one projection in the public flow that deliberately selects
   * the client's email address, and it is a named exception rather than an
   * inconsistency.** Every projection above states that it carries no contact
   * detail, and the reason each gives is the same: those feed a *page*, the
   * link to that page can be shared or opened on a shared device, and a
   * projection that cannot hold an address cannot render one by accident.
   *
   * A message is not a page. The address is not something the message might
   * leak — it is where the message goes. Withholding it here would not protect
   * anything; it would only move the read somewhere with less scrutiny.
   *
   * The bounds that remain are the ones that still mean something:
   *
   * - **No phone.** Nothing in the message needs it, and the shape that cannot
   *   hold it cannot render it.
   * - **No payment-configuration column, encrypted or otherwise.** The
   *   notification path's composition root is specified as the only one in the
   *   public flow that may decrypt an access token, and nothing on the way to
   *   an email may become a second holder of one.
   * - **By booking id, not by token.** Its callers already have the id from the
   *   transition they just completed. Keying it on the token would make it a
   *   second lookup a stranger's input could reach.
   *
   * Returns `null` when the booking does not exist, which its caller treats as
   * a fault to log rather than as a reason to fail anything.
   */
  findForConfirmationEmail(bookingId: string): Promise<BookingForConfirmationEmail | null>;

  /**
   * Records that the confirmation message was accepted by the provider (N1).
   *
   * **It disturbs nothing about what the booking is** — never `status`, never
   * `holdExpiresAt`, never a snapshot, never the token. It runs outside the
   * confirming transaction, and its own failure changes nothing: a booking must
   * not become unconfirmed because a bookkeeping write failed.
   *
   * **`updatedAt` moves with it, and that is not avoidable.** This contract
   * used to say "one column and nothing else"; the N1 gate compared the whole
   * row before and after and found Prisma's `@updatedAt` bumping alongside, as
   * it does on every write through the client. Making the claim literally true
   * would mean `$executeRaw` — the only write in this product to bypass the
   * client, for a cosmetic property — so the claim was corrected instead. The
   * one caller that reads `updatedAt` (`resolveConfirmationEmailNotice`, which
   * uses it as a proxy for the confirmation instant) is unaffected: it consults
   * it only when the send instant is null, which is exactly when this write did
   * not happen.
   *
   * It is **not** an idempotency key and no caller reads it before sending. At
   * most one send per booking is already guaranteed by the confirming
   * transition being a conditional update. What this column buys is the
   * question "which confirmed bookings have a client who was never told".
   */
  markConfirmationEmailSent(bookingId: string, sentAt: Date): Promise<void>;

  /**
   * The owner cancels a booking, releasing its slot (C2).
   *
   * **One transaction, every write conditional on the status it expects, and no
   * advisory lock.** The per-barber lock exists so two writers cannot *place* a
   * booking into one slot; this only releases one, and a release cannot
   * double-book — the same reasoning the receipt rejection records. Safety is
   * the conditional update: a booking confirmed by a notification or swept by
   * the expiry job between the read and the write matches zero rows and is
   * reported as what it became, rather than having `CANCELLED` stamped over it.
   *
   * The booking write sets the status, `cancelledAt`, `cancelledBy` as `OWNER`,
   * and **clears `holdExpiresAt`** — deliberately unlike an expiry, which keeps
   * it as the evidence of why the row ended.
   *
   * **An `APPROVED` payment is never rewritten.** It records a charge that
   * really happened, and the payment update is guarded on `PENDING` so an
   * approval matches zero rows rather than relying on a branch to skip it. A
   * `PENDING` payment becomes `REJECTED`: it is an attempt that can now never
   * complete, and leaving it pending keeps it counted as live by the
   * one-live-payment index.
   *
   * A `PENDING` receipt becomes `REJECTED` with a `reviewedAt`, so a row does
   * not go on asserting that a human owes an answer when nobody does.
   *
   * `ownerId` scopes the resolution: a booking belonging to another owner and
   * one that does not exist MUST both answer `notFound`.
   */
  cancelByOwner(input: {
    bookingId: string;
    ownerId: string;
    now: Date;
  }): Promise<CancelBookingResult>;
}

/** Re-exported so the transaction's re-assertion has one vocabulary for windows. */
export type { WorkingWindowMinutes };
