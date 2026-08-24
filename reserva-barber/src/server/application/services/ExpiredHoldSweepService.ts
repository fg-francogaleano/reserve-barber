import {
  blocksAvailability,
  holdSweepCutoff,
  type BookingStatus,
} from '@/server/domain/models/Booking';
import type {
  ExpirableBooking,
  IExpiredHoldRepository,
} from '@/server/domain/repositories/IExpiredHoldRepository';
import type { IClock } from '@/server/domain/repositories/IClock';
import type { ILogger } from '@/server/domain/repositories/ILogger';

/**
 * The scheduled sweep: the only thing in this product that writes `EXPIRED`.
 *
 * **It does not free slots.** Availability has ignored a lapsed hold since B3,
 * by evaluating `holdExpiresAt` at read time through `blocksAvailability`, and
 * every read and write path calls that same predicate. A swept row and an
 * unswept lapsed row are indistinguishable to all of them. What this adds is
 * the terminal record — a status that describes what happened — so a reader
 * that filters on status alone is correct rather than accidentally correct.
 *
 * Two rules, run as two independent loops:
 *
 * 1. A `PENDING_PAYMENT` booking whose hold lapsed **before the grace cutoff**.
 * 2. A `PENDING_APPROVAL` booking whose **own appointment** has passed.
 *
 * They are disjoint by status, so a booking sitting on the clamp boundary —
 * `holdExpiresAt === startTime`, which `holdExpiresAtFor` can produce — can
 * only ever match one of them. Nothing has to de-duplicate.
 */

/**
 * Rows per statement.
 *
 * Bounded because the first production run faces every abandoned hold ever
 * created, including everything the gate scripts left behind, and because this
 * job shares a pooler capped at five connections with the owner's dashboard and
 * the public booking write. Two hundred is a page a single `IN (...)` update
 * handles comfortably; it is not a measurement, and nothing depends on the
 * exact value.
 */
export const SWEEP_BATCH_SIZE = 200;

/**
 * Pages per rule per invocation.
 *
 * The run is allowed to leave a remainder. At five minutes between runs, a
 * backlog drains at up to two thousand rows an hour without any single
 * invocation holding a connection long enough to matter — and a job that
 * *cannot* overrun is a job that cannot take the database down with it.
 */
export const MAX_BATCHES_PER_RULE = 5;

/** What one invocation did. Emitted whole, including when it did nothing. */
export interface SweepSummary {
  readonly candidatesScanned: number;
  readonly expiredPendingPayment: number;
  readonly expiredPendingApproval: number;
  readonly batches: number;
  readonly durationMs: number;
}

interface RuleOutcome {
  readonly scanned: number;
  readonly expired: number;
  readonly batches: number;
}

const OPERATION = 'booking.sweepExpiredHolds';

export class ExpiredHoldSweepService {
  constructor(
    private readonly holds: IExpiredHoldRepository,
    private readonly clock: IClock,
    private readonly logger: ILogger
  ) {}

  async sweep(): Promise<SweepSummary> {
    const startedAt = this.clock.now();

    /**
     * **One instant for the whole run.** The query bound and the predicate are
     * answering the same question and must answer it against the same moment;
     * reading the clock twice would let a row be eligible by one reading and
     * live by the other. The database's own `now()` is never consulted for the
     * same reason — two clocks, one decision.
     */
    const now = new Date(startedAt);
    const cutoff = holdSweepCutoff(now);

    const lapsedHolds = await this.sweepRule({
      expectedStatus: 'PENDING_PAYMENT',
      now,
      load: (limit) => this.holds.findLapsedHolds({ cutoff, limit }),
      /**
       * **The grace is asserted here as well as in the query bound, and that
       * is deliberate duplication.**
       *
       * Everywhere else in this file a rule has exactly one home. This one
       * does not, because the property it protects is the only one in the
       * sweep that costs a client real money when it fails: expire a booking
       * one minute early and the Mercado Pago approval that would have rescued
       * it finds a status its confirmation is not guarded for. Leaving that to
       * a `WHERE` clause means the safety of the story rests on a bound no
       * unit test can see — only the live gate would ever catch a repository
       * that widened it.
       *
       * `blocksAvailability` cannot supply it: it answers "is this still
       * holding the slot", which has been false since the deadline passed. The
       * grace asks something different — "could a payment still be in flight
       * for it" — and the two questions have different answers for exactly the
       * ten minutes that matter.
       */
      isEligible: (candidate) =>
        candidate.holdExpiresAt !== null && candidate.holdExpiresAt.getTime() < cutoff.getTime(),
    });

    const unansweredReceipts = await this.sweepRule({
      expectedStatus: 'PENDING_APPROVAL',
      now,
      load: (limit) => this.holds.findUnansweredReceipts({ now, limit }),
      /**
       * Nothing beyond the shared predicate, which for this status is exactly
       * `startTime >= now`. The grace does not apply: it protects an in-flight
       * gateway confirmation, and this path has no gateway.
       */
      isEligible: () => true,
    });

    const summary: SweepSummary = {
      candidatesScanned: lapsedHolds.scanned + unansweredReceipts.scanned,
      expiredPendingPayment: lapsedHolds.expired,
      expiredPendingApproval: unansweredReceipts.expired,
      batches: lapsedHolds.batches + unansweredReceipts.batches,
      durationMs: this.clock.now() - startedAt,
    };

    /**
     * **Unconditional, and that is the point.** This job's natural failure is
     * silence: if it never fires, or cannot reach the database, every page
     * still renders and availability is still correct, so nothing else in the
     * product would ever mention it. A run that swept nothing and a run that
     * never happened must not look the same in the logs.
     */
    this.logger.info('Expired hold sweep complete', { operation: OPERATION, ...summary });

    return summary;
  }

  /**
   * One rule, page by page.
   *
   * The loop ends on a short page (nothing more to read), on an empty page, on
   * a page where nothing was eligible — which cannot happen while the candidate
   * queries match the predicate, and which would otherwise re-read the same
   * rows forever if they ever diverged — or at the per-run cap.
   */
  private async sweepRule(rule: {
    expectedStatus: BookingStatus;
    now: Date;
    load: (limit: number) => Promise<ExpirableBooking[]>;
    isEligible: (candidate: ExpirableBooking) => boolean;
  }): Promise<RuleOutcome> {
    const { expectedStatus, now, load, isEligible } = rule;
    let scanned = 0;
    let expired = 0;
    let batches = 0;

    for (let batch = 0; batch < MAX_BATCHES_PER_RULE; batch += 1) {
      const candidates = await load(SWEEP_BATCH_SIZE);
      if (candidates.length === 0) {
        break;
      }

      batches += 1;
      scanned += candidates.length;

      /**
       * **The candidate query narrows; this decides.** The rule is never
       * re-expressed in SQL — it reads a deadline, and a second copy of it
       * drifts from the availability read the first time either is refined,
       * which would offer a client a time and then refuse them while they pay
       * (`IBookingRepository.createProvisional` records the same constraint).
       *
       * In practice every candidate the two queries return is eligible, so this
       * is a confirmation rather than a filter. It is still asked, because the
       * day the queries and the rule disagree is the day this catches it.
       */
      const eligible = candidates.filter(
        (candidate) =>
          candidate.status === expectedStatus &&
          !blocksAvailability(candidate, now) &&
          isEligible(candidate)
      );

      if (eligible.length === 0) {
        break;
      }

      const ids = eligible.map((candidate) => candidate.id);
      const count = await this.holds.expire({ ids, expectedStatus });
      expired += count;

      if (count > 0) {
        await this.reportAlreadyPaid(ids);
      }

      if (candidates.length < SWEEP_BATCH_SIZE) {
        break;
      }
    }

    return { scanned, expired, batches };
  }

  /**
   * An expired booking whose deposit had already been paid.
   *
   * This is `confirmIfSlotFree`'s slot-lost ending: the charge went through,
   * the slot was gone, and the booking was left "for the sweeper". Collecting
   * it is the last chance anything has to say a refund is owed — once the row
   * reads `EXPIRED` it looks like every other abandoned checkout.
   *
   * The read is guarded on the booking being `EXPIRED` **now**, because `ids`
   * is what we tried to expire rather than what moved: a booking that raced to
   * `CONFIRMED` between the read and the write is in this set and has an
   * approved payment for the entirely ordinary reason that somebody paid for an
   * appointment they still have.
   */
  private async reportAlreadyPaid(ids: readonly string[]): Promise<void> {
    const paid = await this.holds.findApprovedPaymentsFor(ids);

    for (const payment of paid) {
      this.logger.error('Expired a booking whose deposit had already been paid', {
        operation: OPERATION,
        bookingId: payment.bookingId,
        paymentId: payment.paymentId,
        // Money is not personal data, and an operator cannot act on this
        // without the figure.
        amount: payment.amount,
      });
    }
  }
}
