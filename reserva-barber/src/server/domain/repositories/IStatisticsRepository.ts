import type { Interval } from '../models/availability';
import type { BusinessStatistics } from '../models/statistics';

/**
 * The statistics page's read: one aggregate over a period the owner chose.
 *
 * ---
 *
 * **Why this is not a method on `IDashboardSummaryRepository`.**
 *
 * That port's own header states it is *"the dashboard home's reads"*, and its
 * separation argument — which `IClientDirectoryRepository` then echoed — is
 * about **shape**, not scoping. Both of those ports are owner-scoped; what makes
 * them separate is that one hands back an aggregate assembled for one page and
 * the other a projection assembled for another.
 *
 * This is a third shape: an aggregate over a **caller-chosen interval**, with a
 * value the page derives from two of its figures. Folding it into the home's
 * port would leave the next reader unable to tell what that port is for, which
 * is the failure the precedent exists to prevent.
 *
 * ---
 *
 * **What every implementation must hold.**
 *
 * 1. **Scope reaches the owner through `barber → location → ownerId`.** A
 *    booking's location is deliberately not duplicated onto the row
 *    (`data-model.md` §11), so this is the only path. There is no row-level
 *    security on these tables: the join **is** the tenancy boundary.
 * 2. **Cross-owner isolation is proven by a two-owner fixture, in both
 *    directions, never by inspection.** A leaked aggregate produces no row that
 *    can look wrong — only a plausible integer — which makes it the worst
 *    possible place to rely on a reviewer noticing. The money figure is the one
 *    that matters most and is checked in its own right.
 * 3. **The income sub-query carries its own owner predicate.** It is redundant
 *    while the outer query is correct, and it stops being redundant the first
 *    time somebody edits the outer query. This is the single read in the product
 *    where getting it wrong yields a plausible number rather than a visible row.
 * 4. **`Payment` is never joined into the row set the counts are computed
 *    over.** A booking may carry many payment rows: the live-payment uniqueness
 *    constraint admits any number of `REJECTED` attempts alongside one live
 *    payment, deliberately, so a declined card does not block the retry. Joining
 *    them multiplies that booking's row and inflates every `count(*) FILTER`,
 *    while a `count(DISTINCT "clientId")` absorbs the duplication entirely — so
 *    the result reads as a rounding quirk rather than as a join defect.
 * 5. **The range arrives already computed, as two instants.** Converting a
 *    business-local calendar boundary into an instant is a domain rule and this
 *    layer decides nothing — the property `IDashboardSummaryRepository` already
 *    states about its own `dayRange` and `monthRange`. No implementation may
 *    perform date arithmetic of its own: `date_trunc` and its relatives
 *    truncate in the **session's** timezone, which is UTC in this deployment.
 * 6. **SQL may narrow; it may not decide.** A statement here filters by owner,
 *    by status and by an instant range. **No figure here asks whether a hold is
 *    live**, so no clause reads `holdExpiresAt`. Should one ever need to,
 *    `blocksAvailability` remains the only definition and its clauses are
 *    applied rather than restated — the constraint `IBookingRepository`,
 *    `IExpiredHoldRepository` and `IDashboardSummaryRepository` all carry.
 * 7. **Monetary values cross as canonical decimal strings**; counts cross as
 *    `number`, narrowed from the driver's wide integer type at this boundary.
 *    The driver returns a stored `2000.50` as `2000.5`, and a `SUM` carries the
 *    same defect as a column.
 * 8. **The average is not computed here.** The statement returns the sum and the
 *    count; the division happens in the domain over integer cents, because
 *    `toCanonicalDecimal`'s two branches disagree about a value with more than
 *    two decimals and a quotient is exactly that (design D8).
 */
export interface IStatisticsRepository {
  /**
   * Every figure for one period, from **one statement**.
   *
   * One rather than several, and the second reason is not about speed. A round
   * trip to the pooler costs ~0.35–0.40 s from this deployment, against a pool
   * the public booking flow shares (`docs/tech-debt.md` T47). But more
   * importantly **separate queries answer from separate instants**: a booking
   * confirmed mid-render would be counted by one figure and not another, and the
   * owner would be shown two numbers that cannot both be true.
   *
   * It is also the natural place to lose that property — "add a second query for
   * the average" is the obvious refactor, and rule 8 above is what makes it
   * unnecessary.
   *
   * An owner with no bookings at all yields **one row of zeros**, not no row:
   * the aggregate has no `GROUP BY`. An implementation that guards the empty
   * result guards it for a wrong *shape*, never for an empty shop.
   */
  readStatistics(input: { ownerId: string; range: Interval }): Promise<BusinessStatistics>;
}
