import { isReminderDue, reminderDueBefore } from '@/server/domain/models/Booking';
import { buildBookingReminderEmail } from '@/server/domain/models/bookingReminderEmail';
import { isPubliclyRoutableHost } from '@/server/domain/models/publicOrigin';
import { BOOKING_REMINDER_EMAIL } from '@/server/domain/models/emailCapability';
import type {
  IBookingReminderRepository,
  ReminderBooking,
} from '@/server/domain/repositories/IBookingReminderRepository';
import type { EmailSendOutcome, IEmailSender } from '@/server/domain/repositories/IEmailSender';
import type { IClock } from '@/server/domain/repositories/IClock';
import type { ILogger } from '@/server/domain/repositories/ILogger';

/**
 * Telling a client their appointment is tomorrow (N2).
 *
 * **The value of this message is the link, not the reminder.** A client who has
 * changed their mind is the only person who can free the slot while it is still
 * resellable, and this is the one moment between booking and appointment that
 * the product puts that control in front of them. A forgotten haircut costs the
 * shop a slot; a released one is a slot it can still sell.
 *
 * ---
 *
 * **How this differs from `BookingConfirmationNotificationService`, and every
 * difference follows from one thing.** That service is called from the branch
 * of a guarded status transition, so at-most-once is already true before it
 * runs and it can record the send afterwards. **This job has no transition to
 * key on** — its trigger is time passing, and nothing in the row changes to say
 * a booking is due — so the guarantee has to be constructed here:
 *
 * 1. **The claim is the read.** One conditional update marks and reports, and
 *    only its returned rows are sent to.
 * 2. **The claim happens before the send.** Recording afterwards leaves a
 *    window in which a dying Worker or an accepted-then-timed-out call leaves
 *    the row unclaimed, and the next invocation sends again — once per
 *    invocation, for as long as the appointment stays due.
 * 3. **Nothing is ever un-claimed.** A claimed row whose send failed may
 *    already have been delivered.
 *
 * The cost is stated rather than hidden: a failed send means one client is not
 * reminded, with no automatic recovery. It is a log line and a `WHERE` clause,
 * which is the same shape N1 accepted for a message that matters more.
 *
 * ---
 *
 * **This service throws where the confirmation's swallows.** That one must
 * never fail its caller, because its callers have already committed
 * money-bearing writes and an exception there would turn a successful
 * confirmation into a request for redelivery. Here the caller is a scheduled
 * invocation whose only audience is the platform's view of the schedule: a
 * database it cannot reach must mark the invocation **failed**, because a dead
 * job that looks healthy is the exact failure this capability is written
 * against. Per-message failures are still non-fatal — one provider rejection
 * must not abandon the rest of the batch.
 */

/**
 * Rows per statement.
 *
 * Bounded because this job shares a pooler capped at five connections with the
 * owner's dashboard and the public booking write. Two hundred is a page a
 * single `IN (...)` claim handles comfortably; it is not a measurement, and
 * nothing depends on the exact value.
 */
export const REMINDER_BATCH_SIZE = 200;

/**
 * Pages per invocation.
 *
 * The run is allowed to leave a remainder, and that is safe **because of the
 * shape of the candidate rule**: the window ends at the appointment rather than
 * being centred on a target instant, so anything this invocation does not reach
 * is still a candidate on the next one. A job that *cannot* overrun is a job
 * that cannot take the database down with it.
 */
export const MAX_REMINDER_BATCHES = 5;

/** What one invocation did. Emitted whole, including when it did nothing. */
export interface ReminderSummary {
  readonly candidatesScanned: number;
  readonly due: number;
  readonly claimed: number;
  readonly sent: number;
  readonly failed: number;
  /**
   * Failures split by cause, and `throttled` is deliberately its own number.
   *
   * It and `rejected` look identical at the call site and lead to completely
   * different action. Reminders arrive as a burst rather than spread across the
   * day, so the likeliest production failure is reminders exhausting the
   * provider quota and every **confirmation** behind them being throttled — the
   * message that carries no money starving the one that does.
   */
  readonly outcomes: Record<Exclude<EmailSendOutcome, 'sent'>, number>;
  readonly batches: number;
  readonly durationMs: number;
}

const OPERATION = BOOKING_REMINDER_EMAIL.operation;

export class BookingReminderService {
  constructor(
    private readonly reminders: IBookingReminderRepository,
    private readonly sender: IEmailSender,
    private readonly clock: IClock,
    private readonly logger: ILogger,
    /**
     * The deployment's configured public origin, or `null`.
     *
     * Passed in rather than read here, so this stays testable without an
     * environment and so the composition root remains the one place that reads
     * configuration — the pattern every other service in this layer follows,
     * and the one the scheduled entrypoint depends on.
     */
    private readonly configuredOrigin: string | null
  ) {}

  async run(): Promise<ReminderSummary> {
    const startedAt = this.clock.now();

    /**
     * **One instant for the whole run.** The window bound, the minimum-gap
     * comparison and the claim's recorded value are answering the same question
     * and must answer it against the same moment; reading the clock twice would
     * let a row be due by one reading and not by the other. The database's own
     * `now()` is never consulted for the same reason — two clocks, one
     * decision.
     */
    const now = new Date(startedAt);
    const windowEnd = reminderDueBefore(now);

    // Resolved once per run, not once per message: a configuration fault is a
    // property of the deployment, and one entry per booking would bury the
    // per-message failures underneath it.
    const origin = this.usableOrigin();

    let candidatesScanned = 0;
    let due = 0;
    let claimedCount = 0;
    let sent = 0;
    let batches = 0;
    const outcomes: Record<Exclude<EmailSendOutcome, 'sent'>, number> = {
      rejected: 0,
      throttled: 0,
      retry: 0,
    };

    try {
      for (let batch = 0; batch < MAX_REMINDER_BATCHES; batch += 1) {
        const candidates = await this.reminders.findDueCandidates({
          now,
          windowEnd,
          limit: REMINDER_BATCH_SIZE,
        });

        if (candidates.length === 0) {
          break;
        }

        batches += 1;
        candidatesScanned += candidates.length;

        /**
         * **The query narrows; this decides.** The candidate query carries the
         * status, the null claim and the window bound — the three things the
         * partial index is built on — and deliberately not the minimum-gap
         * rule, which lives in the domain so it can be refined without touching
         * a query or an index.
         *
         * `startTime > now` is asserted in both places, and that duplication is
         * deliberate: it is the only clause here whose failure is
         * unrecoverable, and it does not get to rest on a `WHERE` clause no
         * unit test can see.
         */
        const eligible = candidates.filter((candidate) => isReminderDue(candidate, now));
        due += eligible.length;

        /**
         * **Stop when a page yielded nothing to claim, and issue no statement
         * for it.**
         *
         * A page whose rows were all suppressed by the gap rule is not claimed,
         * so the very same page comes back on the next read, and the loop would
         * spin over rows it has already decided about, up to the cap. The
         * sweep's own loop terminates on the same condition for the same
         * reason.
         *
         * The repository would absorb an empty id list on its own. Returning
         * here rather than relying on that keeps the decision in the layer that
         * made it: "nothing on this page was due" is an application answer, and
         * a repository guard is a defence against a caller, not a place to put
         * one.
         */
        if (eligible.length === 0) {
          break;
        }

        const claimed = await this.reminders.claimDue({
          ids: eligible.map((candidate) => candidate.id),
          claimedAt: now,
        });

        claimedCount += claimed.length;

        /**
         * Every eligible row lost its race — cancelled, expired, or taken by an
         * overlapping invocation between the read and the claim. Stopping is
         * harmless: the remainder is next invocation's work, which is what the
         * self-healing window is for.
         */
        if (claimed.length === 0) {
          break;
        }

        // Claim, then send, then read the next page — so the interval between
        // claiming a booking and sending its message is bounded by one batch
        // rather than by the whole invocation. Nothing can close that window; a
        // client can cancel while the provider is accepting the message. It is
        // made small rather than claimed to be closed.
        for (const booking of claimed) {
          const outcome = await this.sendOne(booking, origin);

          if (outcome === 'sent') {
            sent += 1;
          } else {
            outcomes[outcome] += 1;
          }
        }

        if (candidates.length < REMINDER_BATCH_SIZE) {
          break;
        }
      }
    } catch (error) {
      /**
       * A failure of the job itself — the database is unreachable, or a claim
       * statement failed. Logged and **rethrown**, because rethrowing is what
       * marks the invocation failed in the platform's own view of the schedule.
       * Swallowing it would leave a dead job looking exactly like a healthy one,
       * which is the failure mode this whole capability is written against.
       */
      this.logger.error('Booking reminder run failed', {
        operation: OPERATION,
        reason: error instanceof Error ? error.name : 'unknown',
        batches,
        claimed: claimedCount,
        sent,
      });
      throw error;
    }

    const summary: ReminderSummary = {
      candidatesScanned,
      due,
      claimed: claimedCount,
      sent,
      failed: outcomes.rejected + outcomes.throttled + outcomes.retry,
      outcomes,
      batches,
      durationMs: this.clock.now() - startedAt,
    };

    /**
     * **Unconditional, and that is the point.** This job's natural failure is
     * silence: if it never fires, or cannot reach the database, or has no
     * usable sender, every page still renders and every booking still confirms,
     * so nothing else in the product would ever mention it. A run that reminded
     * nobody and a run that never happened must not look the same in the logs.
     */
    this.logger.info('Booking reminder run complete', { operation: OPERATION, ...summary });

    return summary;
  }

  /**
   * One message, and a failure that stops nothing.
   *
   * A provider rejection must not abandon the rest of the batch — the other
   * clients in it have appointments too — so this reports rather than throws.
   * That is the one place this service keeps the confirmation path's rule.
   */
  private async sendOne(booking: ReminderBooking, origin: string | null): Promise<EmailSendOutcome> {
    let message;

    try {
      message = buildBookingReminderEmail({ booking, origin });
    } catch (error) {
      /**
       * **Composing a message can throw, and the spec only protected against
       * the provider rejecting one.**
       *
       * The builder is pure, but it is not **total**: `Intl` answers a
       * `RangeError` for an unrenderable instant, so an invalid `startTime`
       * throws here. (Malformed money does not — `toCents` returns `NaN`, the
       * balance comparison is false, and the line is omitted. Measured rather
       * than assumed, because the first guess at this was wrong.) Outside this
       * `try` that exception escapes to the run's outer catch, which rethrows
       * to mark the invocation failed. The rows are **already claimed** by
       * then, so one unrenderable booking would burn the reminder of every
       * booking behind it in the batch.
       *
       * Reaching it through Prisma would take a `Timestamptz` column yielding
       * an invalid `Date`, which does not happen today. The guard is kept
       * because it costs one `catch`, and the property it protects should not
       * depend on the builder staying total.
       *
       * Isolating it costs one `catch` and turns an unbounded loss into the
       * loss of one message — the same bound a provider rejection already had.
       *
       * `rejected` rather than `retry`: nothing about a row this code cannot
       * render is transient, and a caller treating it as transient would keep
       * a useless outcome alive in the logs.
       */
      this.logger.error('Could not compose a booking reminder', {
        operation: OPERATION,
        bookingId: booking.id,
        outcome: 'rejected',
        reason: error instanceof Error ? error.name : 'unknown',
      });
      return 'rejected';
    }

    const { outcome } = await this.sender.send(message);

    if (outcome !== 'sent') {
      // Error rather than warn for all three. The client has not been told, the
      // row is claimed so nothing will retry, and **no other surface in this
      // product will ever mention it** — unlike a failed confirmation, which the
      // booking page discloses.
      this.logger.error('Could not send a booking reminder', {
        operation: OPERATION,
        bookingId: booking.id,
        outcome,
      });
      return outcome;
    }

    this.logger.info('Booking reminder sent', {
      operation: OPERATION,
      bookingId: booking.id,
      outcome,
    });

    return outcome;
  }

  /**
   * The origin to build the link on, or `null` when none is usable.
   *
   * **Two checks and not one.** A configured value can be absent, and it can be
   * present and unreachable — a loopback or private address, which is every
   * local run of this project. B5 measured what the second costs on the payment
   * path: a gateway accepted a `localhost` notification URL, the client paid,
   * and nothing in the product ever learned.
   *
   * Either way the message still goes out, without the link. Logged at error,
   * and **the loss here is larger than on the confirmation path**: a
   * confirmation without a link is still a receipt for money that moved, while
   * a reminder without one has had its purpose removed and leaves the client
   * exactly where they were before it arrived.
   */
  private usableOrigin(): string | null {
    const configured = this.configuredOrigin?.trim();

    if (configured) {
      try {
        const url = new URL(configured);
        if (isPubliclyRoutableHost(url.host)) {
          return url.origin;
        }
      } catch {
        // A malformed value is an absent one, handled below.
      }
    }

    this.logger.error('Sending reminders with no link: no usable public origin', {
      operation: OPERATION,
      reason: 'originMissing',
    });
    return null;
  }
}
