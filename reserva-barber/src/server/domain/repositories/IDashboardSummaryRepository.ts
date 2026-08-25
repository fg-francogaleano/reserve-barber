import type { Interval } from '../models/availability';
import type { DashboardSummary, FilterableBarber, RecentBooking } from '../models/dashboardSummary';

/**
 * The dashboard home's reads: one aggregate, one list, one set of filter
 * options.
 *
 * ---
 *
 * **Why this is not three methods on `IBookingRepository`.**
 *
 * That contract states about itself that every method is keyed by something
 * owner-scoped, so an unscoped query is inexpressible through it. This port
 * holds that property too — every method below takes an `ownerId` — so the
 * separation is **not** about scoping.
 *
 * It is about shape. `IBookingRepository` reads and writes bookings; these
 * methods return counts, a sum, and a projection assembled for one page. A
 * contract that promises to hand back an aggregate root should not also be the
 * place reporting lives, or the next reader has no way to tell what it is for.
 * `IExpiredHoldRepository` set the precedent for writing a new port rather than
 * widening an existing one whose stated promise would have had to stretch;
 * there the exception was to ownership, here it is to shape, but the move and
 * the reason are the same.
 *
 * ---
 *
 * **What every implementation must hold.**
 *
 * 1. **Scope reaches the owner through `barber → location → ownerId`.** A
 *    booking's location is deliberately not duplicated onto the row
 *    (`data-model.md` §11), so this is the only path. There is no row-level
 *    security on these tables: the join **is** the tenancy boundary.
 * 2. **Cross-owner isolation is proven by a two-owner fixture, never by
 *    inspection.** A leaked aggregate produces no row that can look wrong —
 *    only a plausible integer — which makes it the worst possible place to rely
 *    on a reviewer noticing.
 * 3. **SQL may narrow; it may not decide.** A statement here filters by status,
 *    by owner and by an instant range. It SHALL NOT re-express a rule that
 *    reads `holdExpiresAt`: `blocksAvailability` is the only definition of
 *    whether a booking still holds its slot, and a second copy drifts from the
 *    availability read the first time either is refined — the same constraint
 *    `IBookingRepository.createProvisional` and `IExpiredHoldRepository`
 *    already carry.
 * 4. **Monetary values cross as canonical decimal strings.** The driver returns
 *    a stored `2000.50` as `2000.5`; a `SUM` is the same shape of value and
 *    carries the same defect.
 */
export interface IDashboardSummaryRepository {
  /**
   * The six figures, from **one statement**.
   *
   * One rather than six for two independent reasons, and the second is not
   * about speed: six queries answer from six different instants, so a booking
   * confirmed mid-render is counted by one figure and not another, and the
   * owner is shown two numbers that cannot both be true.
   *
   * `dayRange` and `monthRange` arrive already computed, because converting a
   * business-local calendar boundary into an instant is a domain rule and this
   * layer decides nothing. `now` is passed for the one figure that asks whether
   * a hold is still live.
   */
  readSummary(input: {
    ownerId: string;
    dayRange: Interval;
    monthRange: Interval;
    now: Date;
  }): Promise<DashboardSummary>;

  /**
   * The most recently created bookings, newest first, in **every** status.
   *
   * Bounded by `limit` on every call: this is read on each visit to the
   * dashboard home, and an unbounded list would grow with the shop's whole
   * history for a region that shows the newest handful.
   *
   * `barberId` narrows the list **in addition to** the owner scope, never
   * instead of it. It arrives already resolved against this owner's own
   * barbers — an unmatched value is dropped above this layer and never reaches
   * a query, because an unvalidated read filter is an oracle: a valid foreign
   * id would return that barber's bookings and an invalid one would return
   * nothing.
   */
  findRecentForOwner(input: {
    ownerId: string;
    barberId?: string | undefined;
    limit: number;
  }): Promise<readonly RecentBooking[]>;

  /**
   * The owner's barbers, as the filter control offers them and as the
   * submitted parameter is matched against.
   *
   * **Includes inactive barbers**, deliberately. Filtering them out would make
   * a deactivated barber's history unreachable while their rows still appear in
   * the unfiltered list — a filter that cannot select something the page is
   * already showing.
   */
  findFilterableBarbers(ownerId: string): Promise<readonly FilterableBarber[]>;
}
