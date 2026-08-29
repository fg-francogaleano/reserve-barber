import type { IStatisticsRepository } from '@/server/domain/repositories/IStatisticsRepository';
import type { IClock } from '@/server/domain/repositories/IClock';
import type { ILogger } from '@/server/domain/repositories/ILogger';
import type {
  BusinessCharts,
  BusinessStatistics,
  StatisticsRange,
} from '@/server/domain/models/statistics';
import { businessToday, type LocalDate } from '@/server/domain/models/bookingCalendar';
import { toErrorLogContext } from '@/server/infrastructure/errorLogContext';
import {
  bucketEdgesFor,
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
  /**
   * The charts and the cash-collected figure, or the fact that they could not
   * be read.
   *
   * **Its own `Loaded` rather than a widening of the one above** (design D4, as
   * revised during implementation). The two come from two independent reads
   * that deliberately share no transaction, and the heavier of them is the one
   * more likely to fail — so an owner whose chart read timed out keeps five real
   * figures instead of a page-wide apology.
   */
  readonly charts: Loaded<BusinessCharts>;
  /**
   * The instants bounding each bucket of the income chart, `n + 1` of them for
   * `n` buckets.
   *
   * Carried on the view rather than recomputed by the chart, so the axis is
   * built from the **same** clock read and the same range the figures were
   * counted over. A component resolving its own edges would be a second place
   * the business calendar is decided, and the disagreement would show up as
   * money in a bar that is in no figure.
   */
  readonly edges: readonly Date[];
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
    const interval = intervalFor(range, today);
    const edges = bucketEdgesFor(range, today);

    // Issued together but recovered apart. `allSettled` is not needed because
    // each read catches its own failure and answers with `{ ok: false }` — what
    // this concurrency buys is one round trip of latency rather than two,
    // against a pool the public booking flow shares (T47).
    const [statistics, charts] = await Promise.all([
      this.read(input.ownerId, interval),
      this.readCharts(input.ownerId, interval, edges),
    ]);

    return { range, today, edges, statistics, charts };
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

  /**
   * The charts, or the fact that they could not be read.
   *
   * **Caught separately from the figures on purpose.** This is the heavier of
   * the two statements and the pooler is on record hanging rather than raising
   * (T68), so it is the one that will fail — and when it does the owner should
   * lose two charts, not the whole page. The alternative considered was one
   * repeatable-read transaction over both, which would have made this failure
   * take the figures with it; `IStatisticsRepository` rule 9 records why it was
   * rejected and what skew that accepts.
   *
   * A failure is never collapsed into an empty series. A flat line at zero is a
   * statement about the business, and it is indistinguishable from a period
   * that earned nothing.
   */
  private async readCharts(
    ownerId: string,
    range: { start: Date; end: Date },
    edges: readonly Date[]
  ): Promise<Loaded<BusinessCharts>> {
    try {
      return { ok: true, value: await this.statistics.readCharts({ ownerId, range, edges }) };
    } catch (error) {
      this.logger.error(
        'Failed to read the business charts',
        toErrorLogContext('dashboard.statistics.charts', error)
      );
      return { ok: false };
    }
  }
}
