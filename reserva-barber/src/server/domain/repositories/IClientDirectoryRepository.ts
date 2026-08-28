/**
 * One client, as the directory renders them.
 *
 * **This projection carries contact details on purpose, and that inverts the
 * rule every other projection in this project follows.** `RecentBooking` says
 * "no client email and no telephone", and the calendar's appointment says the
 * same, both for the reason that a field which is not selected cannot reach a
 * log line or a serialized prop.
 *
 * Here the contact details **are** the story: a telephone number the owner
 * cannot find is not a telephone number. So the discipline moves off the
 * projection and onto everything around it — the page is uncached, unindexed
 * and session-guarded, nothing personal travels in a URL (which is why this
 * capability has no search), and no log line may carry any of these values.
 *
 * That inversion is written down because "no email in a projection" is
 * otherwise a pattern a reader would expect this file to follow, and would be
 * wrong to enforce here.
 *
 * What it still refuses to carry: timestamps, booking identifiers, and any
 * monetary value. None of them is rendered, and money belongs to D5.
 */
export interface ClientDirectoryRow {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly phone: string;
  /**
   * `CONFIRMED` bookings, all time — the headline number.
   *
   * Never a count of rows. A row count is a count of **checkout attempts**:
   * abandoned holds accumulate without bound relative to real business, so a
   * client who never completed a payment would rank alongside one who has been
   * served ten times. The rule D1 applied to its own historical figure.
   */
  readonly confirmedCount: number;
  /**
   * Cancelled and expired bookings, together.
   *
   * **It exists because the headline number is ambiguous at zero**, and for no
   * other reason. A client who booked three times and cancelled all three, and
   * a client whose checkout created a record and never became a booking, both
   * read as zero confirmed — and they are opposite facts about a person.
   *
   * The two statuses are summed rather than separated because the distinction
   * between "they cancelled" and "their hold lapsed" is a statistic, and
   * statistics are D5's. This is a disambiguator.
   */
  readonly inactiveCount: number;
}

/** One page of the directory, with the total the clamp needs. */
export interface ClientDirectoryPage {
  readonly rows: readonly ClientDirectoryRow[];
  /** Every client this owner has, not the size of this page. */
  readonly total: number;
}

/**
 * The owner's client directory: one paged read, no writes.
 *
 * ---
 *
 * **Why this is not `IClientRepository`.**
 *
 * That contract belongs to the booking write — `resolve` and `findByEmail`,
 * both keyed by an email address, both answering "who is this person" so a
 * booking can be hung on them. Its own header says `ownerId` is half the
 * identity.
 *
 * This answers "who are my clients", in pages, with aggregate counts. A
 * contract that promises to resolve one person by address should not also be
 * where reporting lives, or the next reader cannot tell what it is for.
 * `IDashboardSummaryRepository` set the precedent and gives the argument: the
 * separation is about **shape**, not scoping.
 *
 * ---
 *
 * **What every implementation must hold.**
 *
 * 1. **Scope is the client's own owner column, and it is the whole tenancy
 *    boundary.** Unlike `Barber`, `Client` carries `ownerId` directly, so this
 *    is a single predicate rather than a join — which makes it *easier to get
 *    right and easier to omit*, with no row looking wrong either way. There is
 *    no row-level security on this table.
 * 2. **Cross-owner isolation is proven by a two-owner fixture, in both
 *    directions, never by inspection.** A leaked customer list is the most
 *    valuable read in this product to get wrong and the least visible.
 * 3. **One round trip for the rows, their counts and the total.** This page
 *    renders a whole customer base against a pool the public booking flow
 *    shares (T47), at ~0.35–0.40 s per Supavisor round trip (measured in B2).
 * 4. **The counts are one aggregate over the page, never a query per client.**
 *    "For each client, count their bookings" is the natural expression of this
 *    feature and is an N+1 on exactly the page that can least afford one.
 * 5. **The ordering is total.** Confirmed count descending, then a value unique
 *    to each client. Most clients will have exactly one confirmed booking, so
 *    ties are the ordinary case; without a unique final key, paging returns the
 *    same client twice and omits another, silently.
 * 6. **SQL may narrow; it may not decide what a booking means.** The statuses
 *    that make up each count are named in the domain, and a second copy of that
 *    list would drift the day either is refined.
 */
export interface IClientDirectoryRepository {
  /**
   * One page of this owner's clients, ordered and counted, with the total.
   *
   * `skip` arrives already bounded — twice: once against a ceiling that stops
   * an absurd parameter becoming an absurd offset, and once against a real
   * total. This layer does not clamp, because it does not know what the page
   * should show.
   */
  listForOwner(input: {
    ownerId: string;
    skip: number;
    take: number;
  }): Promise<ClientDirectoryPage>;
}
