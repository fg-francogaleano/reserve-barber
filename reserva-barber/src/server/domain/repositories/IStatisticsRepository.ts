import type { Interval } from '../models/availability';
import type { BusinessCharts, BusinessStatistics } from '../models/statistics';

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
 *
 * ---
 *
 * **What D6 adds, and the two rules it makes load-bearing.**
 *
 * 9. **The two reads are independent, and SHALL NOT share a transaction.** The
 *    obvious move is a repeatable-read transaction, so the bars and the figure
 *    beside them come from one snapshot. It was considered and rejected: an
 *    interactive transaction holds a connection open across round trips against
 *    a transaction-mode pooler — the thing every other repository here is
 *    careful not to do — on the pool the public booking flow shares (T47); and
 *    `readCharts` is the heavier statement against a pooler on record *hanging*
 *    rather than raising (T68), so inside a shared transaction its failure would
 *    cost the owner the five figures too. The likelier failure is asymmetric,
 *    which makes independent recoverability worth more than the snapshot.
 *
 *    **The accepted cost:** a booking confirming into the period between the two
 *    reads leaves the bars one deposit short of the figure until the next
 *    render. Reconciliation is instead proven where it is decidable — the filled
 *    series sums to the total the same rows represent, in the domain, with no
 *    database — which is the property a reader actually depends on.
 * 10. **The chart read filters payments by status in its own right.** Rule 4
 *    keeps `Payment` out of the *counted* row set; this read is a payment read
 *    and must instead exclude the rejected rows explicitly. The partial unique
 *    index admits unlimited `REJECTED` attempts beside one live payment,
 *    deliberately — a declined card is exactly the client who will try again —
 *    so a client who retried three times becomes three Mercado Pago payments in
 *    the method split unless `p.status = 'APPROVED'` is present. The result is
 *    wrong in the direction that flatters the gateway the shop pays fees to.
 * 11. **Bucket assignment may happen in SQL; bucket boundaries may not.** The
 *    edges arrive as instants computed in the domain, for the reason rule 5
 *    already gives, and the statement only compares a row against them. Bucket
 *    indexes are `width_bucket`'s 1-based convention and are narrowed from the
 *    driver's wide integer type at this boundary like every other count.
 * 12. **`cashCollected` is the one value in this port bounded on
 *    `Payment.approvedAt`**, and it is required to be: it answers how much money
 *    *arrived* in the period, which is what an owner reconciles against a bank
 *    statement and what no surface answered before D6 (T83). Every other figure
 *    and every bucket stays on the appointment's `startTime`. Nothing may divide
 *    it by an appointment-keyed figure, and whatever renders it SHALL state its
 *    basis — it will not equal the deposits figure beside it, and both are
 *    right.
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

  /**
   * Both charts and the cash-collected figure, from **one grouped read**.
   *
   * One read rather than two because the two questions share a row set: grouped
   * by bucket and by method, summed over methods it is the income series, and
   * summed over buckets it is the payment-method split. Splitting them would put
   * two charts on one screen that cannot be reconciled against each other, which
   * is the same defect rule 9 describes between the charts and the figures.
   *
   * **It returns rows, not a series.** Only buckets that have payments come
   * back; filling the empty ones is `fillIncomeSeries`'s job in the domain. That
   * is deliberate — a chart that silently omits a quiet Tuesday draws a
   * plausible shape on an axis a day too short, and the rule that prevents it
   * belongs somewhere a test can reach without a database.
   *
   * `edges` bounds the buckets and SHALL span exactly `range`: same first
   * instant, same last. A row assigned outside that span is the caller's bug and
   * the domain drops it rather than clamping it into a bucket it does not belong
   * to.
   */
  readCharts(input: {
    ownerId: string;
    range: Interval;
    edges: readonly Date[];
  }): Promise<BusinessCharts>;
}
