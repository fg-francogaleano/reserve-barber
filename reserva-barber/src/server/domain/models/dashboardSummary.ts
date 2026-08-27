/**
 * What the dashboard home shows, and the one number it had to guess.
 *
 * The types here are the contract between the aggregate read and the page. They
 * carry no behaviour: every rule that decides *what* goes into a figure lives
 * either in the predicate the repository issues or in `blocksAvailability`, and
 * this module is deliberately not a third place where such a rule could be
 * restated.
 */

import type { BookingStatus, CancelledBy } from './Booking';

/**
 * How many recent bookings the dashboard lists.
 *
 * **A judgement, not a measurement** — the sixth in this project's family of
 * guessed constants, after the four in `bookingHorizon.ts` and the slot
 * granularity. It is declared here, named, and consumed once, so the next answer
 * is a one-line change rather than a search.
 *
 * The bound itself is not optional even though its value is arbitrary. This list
 * is read on every visit to the most-visited authenticated page in the product,
 * against a pool shared with the public booking flow; an unbounded read would
 * grow with the shop's whole history for a region of the page that shows the
 * newest handful.
 *
 * Ten is sized for "what happened since I last looked" on a phone. A shop taking
 * more than ten bookings between glances has outgrown this list rather than this
 * constant, and wants D3's calendar.
 */
export const RECENT_BOOKINGS_LIMIT = 10;

/**
 * The six figures, as one snapshot.
 *
 * They arrive together from a single statement, which is what makes them
 * comparable: six separate reads would answer from six instants, and a booking
 * confirmed mid-render would be counted by one figure and not by another.
 */
export interface DashboardSummary {
  /** `CONFIRMED` bookings whose appointment falls inside the business's today. */
  readonly confirmedToday: number;
  /**
   * Bookings starting today that are still holding their slot without being
   * confirmed.
   *
   * **A separate number from `confirmedToday`, never summed into it.** The two
   * answer different questions — who is being served today, and what is still in
   * flight — and their sum answers neither. Kept apart, they are also the
   * product's only diagnosis of a broken checkout: a large second number over a
   * zero first one says the flow is reaching the payment step and not passing
   * it.
   */
  readonly heldToday: number;
  /**
   * Bookings **cancelled** today, keyed on when the cancellation happened.
   *
   * Never includes an `EXPIRED` booking. `EXPIRED` against `CANCELLED` is how
   * this product tells a deadline apart from a decision, and the sweep produces
   * expired rows continuously — counting them here would report abandoned
   * checkouts as clients walking away.
   */
  readonly cancelledToday: number;
  /**
   * `CONFIRMED` bookings for all time, past appointments included.
   *
   * Confirmations rather than rows: an all-time count of every booking is a
   * count of checkout *attempts*, and abandoned holds accumulate without bound
   * relative to real business.
   */
  readonly confirmedAllTime: number;
  /** Receipts still awaiting the owner's answer, over the review queue's own predicate. */
  readonly pendingReceipts: number;
  /**
   * Deposits **collected** this month, as a canonical decimal string.
   *
   * A string because the driver returns a stored `2000.50` as `2000.5` and
   * integer-cent arithmetic then reads the lone `5` as five centavos (measured
   * in PC3). A sum carries the same defect as a column.
   *
   * It is deposits, not turnover: this product never records the balance a
   * client pays in the chair. Whatever renders it must say so.
   */
  readonly monthDepositIncome: string;
}

/**
 * One row of the recent list.
 *
 * **No client email and no telephone.** A field that is not selected cannot
 * reach a log line or a serialized prop, and contact details belong to D4.
 *
 * `status` is carried whole rather than reduced to a flag: this list is the
 * first surface in the product that shows an owner an `EXPIRED` booking at all,
 * and collapsing it would remove the one thing it adds.
 */
export interface RecentBooking {
  readonly id: string;
  readonly startTime: Date;
  readonly status: BookingStatus;
  readonly clientName: string;
  readonly serviceName: string;
  readonly barberDisplayName: string;
  /** The booking's snapshot, as a canonical decimal string. */
  readonly depositAmount: string;
  /**
   * Who cancelled, when somebody did (C1).
   *
   * **The projection grows by exactly one field, and this is the field.** The
   * rule that this list's projection must not widen was written when the only
   * thing being added was a control the row's existing columns already
   * supported; it does not extend to a fact the row does not carry.
   *
   * It is here because C1 decided **not** to email the owner when a client
   * cancels: the dashboard is then the only channel, and a channel that cannot
   * tell "I cancelled this" from "my client did" is not carrying the fact. A
   * null is every row written before the column had a writer.
   */
  readonly cancelledBy: CancelledBy | null;
}

/**
 * A barber as the filter control offers them.
 *
 * The list is also what the submitted parameter is **matched against** — the
 * value is never parsed into a query — so this doubles as the resolver's
 * universe.
 */
export interface FilterableBarber {
  readonly id: string;
  readonly displayName: string;
}
