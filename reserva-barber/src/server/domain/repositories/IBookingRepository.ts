import type { Interval } from '@/server/domain/models/availability';
import type { LocalDate } from '@/server/domain/models/bookingCalendar';
import type { WorkingWindowMinutes } from './IBarberAvailabilityRepository';

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
  readonly barberDisplayName: string;
  readonly serviceName: string;
  readonly locationName: string;
}

/**
 * Repository contract for writing and reading bookings.
 *
 * Every method takes or is keyed by something owner-scoped, so an unscoped
 * query is inexpressible — the property every repository in this project
 * holds.
 */
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
   * The booking behind a cancellation token, for the confirmation page.
   *
   * Returns a **named projection** that carries no client email and no client
   * phone. The page can be opened by anyone holding the link, so the columns
   * it cannot select are the ones it cannot render.
   */
  findByCancellationToken(token: string): Promise<BookingByToken | null>;
}

/** Re-exported so the transaction's re-assertion has one vocabulary for windows. */
export type { WorkingWindowMinutes };
