import type { IStatisticsRepository } from '@/server/domain/repositories/IStatisticsRepository';
import type { IClock } from '@/server/domain/repositories/IClock';
import type { ILogger } from '@/server/domain/repositories/ILogger';
import type { BusinessStatistics, StatisticsRange } from '@/server/domain/models/statistics';
import { businessToday, type LocalDate } from '@/server/domain/models/bookingCalendar';
import { toErrorLogContext } from '@/server/infrastructure/errorLogContext';
import {
  intervalFor,
  resolveStatisticsRange,
} from '@/server/application/dashboard/statisticsRangeParams';
import type { Loaded } from './loaded';

/**
 * The statistics page's read, assembled.
 *
 * **This service orchestrates; it does not decide what goes into a figure.**
 * Every counting rule is a predicate the repository issues, for the reason
 * `backend-standards.md` gives: an aggregate is computed in SQL rather than by
 * loading rows into a Worker isolate. What lives here is the part that is
 * genuinely the application's — which period was asked for, which instants bound
 * it, and what the page shows when the read fails.
 *
 * **It does not compute the average either.** That is a monetary rule and it
 * lives in the domain, once (`averageDepositPerBooking`). A copy here would be a
 * second place a centavo gets rounded.
 *
 * The consequence for tests is worth stating, because it is the shape of T58: a
 * mocked repository cannot prove that income excludes an approved payment on an
 * expired booking, nor that the driver can deserialize a `count(DISTINCT …)`.
 * Those are proven where they are expressed — in the repository's own tests and,
 * definitively, in `scripts/d5-gate.ts` against real rows.
 */

export interface StatisticsView {
  /** The period the page is reporting on, after resolution. Never absent. */
  readonly range: StatisticsRange;
  /**
   * The business date every interval was derived from.
   *
   * Carried so the page can name the period — "hoy, domingo 16 de agosto" —
   * from the **same** clock read the figures came from. A page that formatted
   * its own heading from a second read could describe a different day than the
   * one it queried.
   */
  readonly today: LocalDate;
  /** The figures, or the fact that they could not be read. */
  readonly statistics: Loaded<BusinessStatistics>;
}

export class StatisticsService {
  constructor(
    private readonly statistics: IStatisticsRepository,
    private readonly clock: IClock,
    private readonly logger: ILogger
  ) {}

  /**
   * Everything the statistics page renders, in one call.
   *
   * **One instant for the whole view.** `now` is read once and the business date
   * and every interval derive from it, so the heading and the figures cannot
   * straddle a rollover that happened between two reads.
   *
   * The submitted range is **matched** against the closed set before it is used
   * for anything, so nothing the caller typed survives into an interval — let
   * alone into a statement.
   */
  async loadPage(input: {
    ownerId: string;
    rawRange: string | readonly string[] | undefined;
  }): Promise<StatisticsView> {
    const today = businessToday(new Date(this.clock.now()));
    const range = resolveStatisticsRange(input.rawRange);

    return {
      range,
      today,
      statistics: await this.read(input.ownerId, intervalFor(range, today)),
    };
  }

  /**
   * The figures, or the fact that they could not be read.
   *
   * The failure is **not** collapsed into zeros. An income card reading
   * `$ 0,00` on a failed read is a false statement about money and is
   * indistinguishable from a period that earned nothing — D1's rule, and the
   * reason `Loaded<T>` exists at all.
   *
   * The period is still returned alongside it, so the control keeps its
   * selection through a failure and the owner can tell which period failed.
   */
  private async read(
    ownerId: string,
    range: { start: Date; end: Date }
  ): Promise<Loaded<BusinessStatistics>> {
    try {
      return { ok: true, value: await this.statistics.readStatistics({ ownerId, range }) };
    } catch (error) {
      this.logger.error(
        'Failed to read the business statistics',
        toErrorLogContext('dashboard.statistics', error)
      );
      return { ok: false };
    }
  }
}
