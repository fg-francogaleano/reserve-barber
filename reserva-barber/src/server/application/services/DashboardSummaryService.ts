import type { IDashboardSummaryRepository } from '@/server/domain/repositories/IDashboardSummaryRepository';
import type { ITransferReceiptRepository } from '@/server/domain/repositories/ITransferReceiptRepository';
import type { IClock } from '@/server/domain/repositories/IClock';
import type { ILogger } from '@/server/domain/repositories/ILogger';
import type {
  DashboardSummary,
  FilterableBarber,
  RecentBooking,
} from '@/server/domain/models/dashboardSummary';
import { RECENT_BOOKINGS_LIMIT } from '@/server/domain/models/dashboardSummary';
import { businessToday, dayBoundsOf, monthBoundsOf } from '@/server/domain/models/bookingCalendar';
import { toErrorLogContext } from '@/server/infrastructure/errorLogContext';
import { resolveBarberFilter } from '@/server/application/dashboard/recentBookingsParams';
import type { Loaded } from './loaded';

/**
 * The dashboard home's reads, assembled.
 *
 * **This service orchestrates; it does not decide what goes into a figure.**
 * Every counting rule is a predicate the repository issues, for the reason
 * `backend-standards.md` gives: an aggregate is computed in SQL rather than by
 * loading rows into a Worker isolate. What lives here is the part that is
 * genuinely the application's — which instants bound "today" and "this month",
 * which barber the filter resolved to, and what the page shows when a read
 * fails.
 *
 * The consequence for tests is worth stating, because it is the shape of T58: a
 * mocked repository cannot prove that income excludes an approved payment on an
 * expired booking. Those rules are proven where they are expressed — in the
 * repository's own tests and, definitively, in `scripts/d1-gate.ts` against real
 * rows.
 */

/**
 * Re-exported so existing importers keep working. The type itself moved to
 * `loaded.ts` when D5's statistics page needed the same shape for the same
 * reason — one argument in one file rather than two copies that can drift.
 */
export type { Loaded };

export interface DashboardHomeView {
  /** The six figures, or the fact that they could not be read. */
  readonly summary: Loaded<DashboardSummary>;
  /** The recent list, or the fact that it could not be read. */
  readonly recent: Loaded<readonly RecentBooking[]>;
  /**
   * The filter's options. An empty list is a normal state — a shop with no
   * barbers — and the control is not rendered for it.
   */
  readonly barbers: readonly FilterableBarber[];
  /** Which barber the list is filtered by, after resolution. `undefined` is unfiltered. */
  readonly selectedBarberId: string | undefined;
}

export class DashboardSummaryService {
  constructor(
    private readonly dashboard: IDashboardSummaryRepository,
    private readonly receipts: ITransferReceiptRepository,
    private readonly clock: IClock,
    private readonly logger: ILogger
  ) {}

  /**
   * Everything the dashboard home renders, in one call.
   *
   * **One instant for the whole view.** `now` is read once and both ranges are
   * derived from it, so the day and the month cannot straddle a rollover that
   * happened between two reads.
   *
   * **The barber options are read first**, and that ordering is not incidental:
   * the submitted filter is *matched* against them, so they are the universe
   * that decides whether the value is real. Issuing the list read before that
   * resolution would mean passing an unvalidated id into a query.
   *
   * The remaining reads are concurrent. Four round trips, but one round trip of
   * wall clock.
   */
  async loadHome(input: {
    ownerId: string;
    rawBarberFilter: string | readonly string[] | undefined;
  }): Promise<DashboardHomeView> {
    const now = new Date(this.clock.now());
    const today = businessToday(now);
    const dayRange = dayBoundsOf(today);
    const monthRange = monthBoundsOf(today);

    const barbers = await this.readBarbers(input.ownerId);
    const selectedBarberId = resolveBarberFilter(input.rawBarberFilter, barbers);

    const [summary, recent] = await Promise.all([
      this.readSummary({ ownerId: input.ownerId, dayRange, monthRange, now }),
      this.readRecent(input.ownerId, selectedBarberId),
    ]);

    return { summary, recent, barbers, selectedBarberId };
  }

  /**
   * The five booking-and-payment figures plus the receipt count.
   *
   * **The receipt count is a separate read on purpose.** Its predicate belongs
   * to the review queue, which requires it to be expressed once and shared by
   * the listing and the count; a raw reporting statement cannot share a query
   * fragment with that repository, so folding it in would create a second copy
   * of the exact predicate this change exists to unify, and the next narrowing
   * of the queue would desynchronise the counter again.
   *
   * The two are joined into one `Loaded` value because they render as one block
   * and a partial row of figures is not a state the page has.
   */
  private async readSummary(input: {
    ownerId: string;
    dayRange: { start: Date; end: Date };
    monthRange: { start: Date; end: Date };
    now: Date;
  }): Promise<Loaded<DashboardSummary>> {
    try {
      const [figures, pendingReceipts] = await Promise.all([
        this.dashboard.readSummary(input),
        this.receipts.countPendingForOwner(input.ownerId),
      ]);
      return { ok: true, value: { ...figures, pendingReceipts } };
    } catch (error) {
      this.logger.error(
        'Failed to read the dashboard summary',
        toErrorLogContext('dashboard.summary', error)
      );
      return { ok: false };
    }
  }

  private async readRecent(
    ownerId: string,
    barberId: string | undefined
  ): Promise<Loaded<readonly RecentBooking[]>> {
    try {
      const value = await this.dashboard.findRecentForOwner({
        ownerId,
        barberId,
        limit: RECENT_BOOKINGS_LIMIT,
      });
      return { ok: true, value };
    } catch (error) {
      this.logger.error(
        'Failed to read recent bookings',
        toErrorLogContext('dashboard.recent', error)
      );
      return { ok: false };
    }
  }

  /**
   * The filter's options, degrading to none.
   *
   * A failure here is the mildest of the three: the page loses a control it can
   * live without. It is **not** propagated as a failed region, because rendering
   * "could not load the filter" beside working figures would be noise about the
   * least important thing on the page.
   */
  private async readBarbers(ownerId: string): Promise<readonly FilterableBarber[]> {
    try {
      return await this.dashboard.findFilterableBarbers(ownerId);
    } catch (error) {
      this.logger.error(
        'Failed to read the barber filter options',
        toErrorLogContext('dashboard.barbers', error)
      );
      return [];
    }
  }
}
