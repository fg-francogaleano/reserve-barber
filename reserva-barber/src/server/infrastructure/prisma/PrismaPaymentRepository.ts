import type {
  CommitTransferResult,
  ConfirmPaymentResult,
  LateConfirmResult,
  CreatePaymentResult,
  IPaymentRepository,
  PaymentForNotification,
  PaymentRecord,
} from '@/server/domain/repositories/IPaymentRepository';
import type { PaymentMethod, PaymentStatus } from '@/server/domain/models/Payment';
// The blocking rule has one home, and the late-payment re-check calls it rather
// than expressing the statuses again in SQL (booking-availability spec).
import {
  blocksAvailability,
  transferHoldExpiresAtFor,
  type BookingStatus,
} from '@/server/domain/models/Booking';
import { overlaps } from '@/server/domain/models/availability';
import { MAX_DURATION_MINUTES } from '@/server/domain/models/slotGranularity';
import { toCanonicalDecimal } from './canonicalDecimal';
import type { PrismaClient } from '@/generated/prisma/client';

/**
 * Statuses that can matter, as a READ filter — wider than the blocking rule on
 * purpose. `blocksAvailability` decides; encoding the expired-hold clause as SQL
 * here would be the second copy that drifts.
 */
const POSSIBLY_BLOCKING: BookingStatus[] = ['PENDING_PAYMENT', 'PENDING_APPROVAL', 'CONFIRMED'];

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

/** The column the partial unique index `Payment_one_live_per_booking` covers. */
const LIVE_PAYMENT_CONSTRAINT = ['bookingId'];

/** The column backing the webhook's idempotency guarantee. */
const GATEWAY_ID_CONSTRAINT = ['mpPaymentId'];

/**
 * Which unique constraint a violation names, or `null` when that cannot be
 * determined.
 *
 * **Not `meta.target`**, which Prisma's own documentation points at and which
 * this stack does not populate. `scripts/p1-gate-db.ts` measured what actually
 * arrives under Prisma 7 with `@prisma/adapter-pg`:
 *
 *     meta.driverAdapterError.cause.constraint.fields = ['"bookingId"']
 *
 * Column names come back **already quoted**, so the quotes are stripped before
 * comparison — a naive equality check matches nothing and every violation
 * collapses into the fallback.
 *
 * Returning `null` rather than guessing is the same choice
 * `PrismaBusinessProfileRepository` made: if a future Prisma version moves this
 * again, the failure surfaces as an untranslated error instead of being
 * mistranslated into the wrong business meaning. On this table that distinction
 * is money — one constraint means "somebody double-tapped" and the other means
 * "this notification was already processed", and confusing them either
 * double-charges a client or drops a confirmation.
 *
 * **This shape is asserted against the real database by the gate**, not
 * inferred here. A partial unique index is a case `p1-gate-db.ts` never
 * measured, and a mock cannot tell us what the driver reports for one.
 */
function violatedConstraint(error: unknown): string[] | null {
  if (typeof error !== 'object' || error === null) return null;

  const candidate = error as {
    code?: unknown;
    meta?: { driverAdapterError?: { cause?: { constraint?: { fields?: unknown } } } };
  };
  if (candidate.code !== UNIQUE_CONSTRAINT_VIOLATION) return null;

  const fields = candidate.meta?.driverAdapterError?.cause?.constraint?.fields;
  if (!Array.isArray(fields) || fields.length === 0) return null;

  return fields.map((field) => String(field).replaceAll('"', ''));
}

function violates(error: unknown, expected: string[]): boolean {
  const actual = violatedConstraint(error);
  return (
    actual !== null &&
    actual.length === expected.length &&
    expected.every((field) => actual.includes(field))
  );
}

/** The columns every payment read needs, and not one more. */
const PAYMENT_SELECT = {
  id: true,
  bookingId: true,
  method: true,
  status: true,
  amount: true,
  mpPreferenceId: true,
  mpInitPoint: true,
  approvedAt: true,
} as const;

interface PaymentRow {
  id: string;
  bookingId: string;
  method: string;
  status: string;
  amount: unknown;
  mpPreferenceId: string | null;
  mpInitPoint: string | null;
  approvedAt: Date | null;
}

function toRecord(row: PaymentRow): PaymentRecord {
  return {
    id: row.id,
    bookingId: row.bookingId,
    method: row.method as PaymentMethod,
    status: row.status as PaymentStatus,
    // Converted here and nowhere above: the driver returns a stored 5000.50 as
    // 5000.5, and integer-cent arithmetic reads the lone 5 as five centavos.
    amount: toCanonicalDecimal(row.amount),
    mpPreferenceId: row.mpPreferenceId,
    mpInitPoint: row.mpInitPoint,
    approvedAt: row.approvedAt,
  };
}

/**
 * How long the confirming transaction may wait for a connection and hold one.
 *
 * Explicit for the same reason the booking write's is: the transaction pins a
 * pooled connection and the pool is shared with the owner's dashboard. Smaller
 * than the booking write's because even the heavier path here — the
 * late-payment re-check, which does take the lock and does read — has one query
 * against that write's four, and because its caller is a third party that
 * retries, so failing fast is cheaper than queueing.
 */
const TRANSACTION_OPTIONS = { maxWait: 5_000, timeout: 10_000 } as const;

export class PrismaPaymentRepository implements IPaymentRepository {
  constructor(private readonly db: PrismaClient) {}

  /**
   * Opens a bank-transfer payment and extends the hold, in one transaction.
   *
   * **No advisory lock.** Nothing here changes whether the booking blocks — it
   * is `PENDING_PAYMENT` on both sides of this write — so no slot is being
   * taken and there is no race to serialize. `attachReceipt` and the owner's
   * approval do take it, because both move a booking between blocking states.
   */
  async commitBankTransfer(input: {
    bookingId: string;
    amount: string;
    startTime: Date;
    now: Date;
  }): Promise<CommitTransferResult> {
    try {
      return await this.db.$transaction(async (tx) => {
        const booking = await tx.booking.findUnique({
          where: { id: input.bookingId },
          select: { status: true, holdExpiresAt: true, startTime: true, endTime: true },
        });

        if (booking === null) {
          return { outcome: 'notPending' as const, bookingStatus: 'MISSING' };
        }

        if (booking.status !== 'PENDING_PAYMENT') {
          return { outcome: 'notPending' as const, bookingStatus: booking.status };
        }

        // The shared predicate, not a hand-written date comparison. A hold that
        // this rule considers lapsed must not be extendable, or the client is
        // sent to their bank holding a slot availability has already resold.
        const holdIsLive = blocksAvailability(
          {
            startTime: booking.startTime,
            endTime: booking.endTime,
            status: booking.status as BookingStatus,
            holdExpiresAt: booking.holdExpiresAt,
          },
          input.now
        );
        if (!holdIsLive) {
          return { outcome: 'holdExpired' as const };
        }

        const live = await tx.payment.findFirst({
          where: { bookingId: input.bookingId, status: { not: 'REJECTED' } },
          select: PAYMENT_SELECT,
        });

        if (live !== null) {
          const record = toRecord(live as PaymentRow);

          // The ordinary double-tap. The deadline is deliberately NOT pushed
          // again: extending on every tap would let a client hold a slot for as
          // long as they keep pressing the control.
          if (record.method === 'BANK_TRANSFER') {
            return {
              outcome: 'alreadyCommitted' as const,
              payment: record,
              holdExpiresAt: booking.holdExpiresAt,
            };
          }

          // A checkout exists and can be paid at any moment. Making room for a
          // second method here is how a client gets charged twice.
          if (record.mpInitPoint !== null) {
            return { outcome: 'mercadoPagoInFlight' as const };
          }

          // No `mpInitPoint` means the preference was never created, so no
          // checkout ever existed and nobody could have paid it. Rejecting it
          // frees the partial index without putting any money at risk — and it
          // is what keeps a gateway outage from trapping the client in a method
          // that cannot work (data-model.md §12).
          await tx.payment.updateMany({
            where: { id: record.id, mpInitPoint: null, status: 'PENDING' },
            data: { status: 'REJECTED' },
          });
        }

        const created = await tx.payment.create({
          data: {
            bookingId: input.bookingId,
            method: 'BANK_TRANSFER',
            status: 'PENDING',
            amount: input.amount,
          },
          select: PAYMENT_SELECT,
        });

        const holdExpiresAt = transferHoldExpiresAtFor({
          committedAt: input.now,
          startTime: input.startTime,
        });

        await tx.booking.updateMany({
          where: { id: input.bookingId, status: 'PENDING_PAYMENT' },
          data: { holdExpiresAt },
        });

        return {
          outcome: 'committed' as const,
          payment: toRecord(created as PaymentRow),
          holdExpiresAt,
        };
      }, TRANSACTION_OPTIONS);
    } catch (error) {
      // Two concurrent commitments both passed the read above; the partial
      // index settled it. The loser is handed the winner's row, because B4
      // established that a client must not be able to tell they double-tapped.
      if (!violates(error, LIVE_PAYMENT_CONSTRAINT)) throw error;

      const existing = await this.findLiveByBookingId(input.bookingId);
      if (existing === null) throw error;

      const booking = await this.db.booking.findUnique({
        where: { id: input.bookingId },
        select: { holdExpiresAt: true },
      });

      return {
        outcome: 'alreadyCommitted',
        payment: existing,
        holdExpiresAt: booking?.holdExpiresAt ?? null,
      };
    }
  }

  /**
   * Opens a pending payment, or hands back the live one that beat us to it.
   *
   * The race is real and the database is the only thing that can settle it:
   * two taps a few milliseconds apart both see no payment, and both try to
   * create one. `Payment_one_live_per_booking` refuses the second, and the
   * loser is handed the winner's row rather than an error — B4 established
   * that a client who double-taps must not be able to tell that they did.
   */
  async createPendingMercadoPago(input: {
    bookingId: string;
    amount: string;
  }): Promise<CreatePaymentResult> {
    try {
      const row = await this.db.payment.create({
        data: {
          bookingId: input.bookingId,
          method: 'MERCADO_PAGO',
          status: 'PENDING',
          amount: input.amount,
        },
        select: PAYMENT_SELECT,
      });
      return { outcome: 'created', payment: toRecord(row as PaymentRow) };
    } catch (error) {
      if (!violates(error, LIVE_PAYMENT_CONSTRAINT)) throw error;

      const existing = await this.findLiveByBookingId(input.bookingId);
      // The winner committed between our insert and this read, then vanished —
      // possible only if something rejected it in that window. Re-throwing is
      // right: we have no payment to hand back and inventing one would be worse.
      if (existing === null) throw error;

      return { outcome: 'alreadyLive', payment: existing };
    }
  }

  async attachPreference(input: {
    paymentId: string;
    preferenceId: string;
    initPoint: string;
  }): Promise<void> {
    await this.db.payment.update({
      where: { id: input.paymentId },
      data: { mpPreferenceId: input.preferenceId, mpInitPoint: input.initPoint },
    });
  }

  async findLiveByBookingId(bookingId: string): Promise<PaymentRecord | null> {
    const row = await this.db.payment.findFirst({
      // The application's half of the partial index's predicate. Both say
      // "not rejected", and they say it in one vocabulary on purpose.
      where: { bookingId, status: { not: 'REJECTED' } },
      select: PAYMENT_SELECT,
    });
    return row === null ? null : toRecord(row as PaymentRow);
  }

  /**
   * Resolves a notification's `ref` — one indexed read on the primary key,
   * joining through to the owner.
   *
   * **One read, and it comes first.** This is a public endpoint anyone can post
   * to, so the cheap rejection has to precede the expensive work: a `ref` that
   * resolves nothing costs this query and nothing else, never an outbound call
   * to Mercado Pago. That ordering is the mitigation T60 leans on.
   *
   * The projection carries no client, no email, no phone and no cancellation
   * token. Nothing on this path renders a person, and a column that is never
   * selected cannot reach a log line.
   */
  async findForNotification(paymentId: string): Promise<PaymentForNotification | null> {
    const row = await this.db.payment.findUnique({
      where: { id: paymentId },
      select: {
        id: true,
        status: true,
        amount: true,
        mpPaymentId: true,
        booking: {
          select: {
            id: true,
            status: true,
            holdExpiresAt: true,
            startTime: true,
            endTime: true,
            barberId: true,
            // `Barber` has no ownerId column (`data-model.md` §5), so ownership
            // is reached through the location, as every other read does it.
            barber: { select: { location: { select: { ownerId: true } } } },
          },
        },
      },
    });

    if (row === null) return null;

    const payment = row as unknown as {
      id: string;
      status: string;
      amount: unknown;
      mpPaymentId: string | null;
      booking: {
        id: string;
        status: string;
        holdExpiresAt: Date | null;
        startTime: Date;
        endTime: Date;
        barberId: string;
        barber: { location: { ownerId: string } };
      };
    };

    return {
      paymentId: payment.id,
      paymentStatus: payment.status as PaymentStatus,
      amount: toCanonicalDecimal(payment.amount),
      mpPaymentId: payment.mpPaymentId,
      bookingId: payment.booking.id,
      bookingStatus: payment.booking.status,
      holdExpiresAt: payment.booking.holdExpiresAt,
      startTime: payment.booking.startTime,
      endTime: payment.booking.endTime,
      barberId: payment.booking.barberId,
      ownerId: payment.booking.barber.location.ownerId,
    };
  }

  /**
   * Approves the payment and confirms its booking, in one transaction.
   *
   * **The booking update is conditional and the order matters.** It runs first,
   * guarded on the status still being `PENDING_PAYMENT`; if it matches nothing,
   * the payment is left untouched and the caller is told `notPending`. A
   * duplicate delivery therefore changes nothing and is not an error — Mercado
   * Pago retries by design, and a handler that threw here would answer `5xx`
   * and ask for a third delivery.
   *
   * Writing the payment first would leave an approved payment against a booking
   * the guard then refused to confirm — which is a real state this product has
   * (the slot-lost branch), reached by accident instead of by decision.
   */
  async confirmWithPayment(input: {
    paymentId: string;
    bookingId: string;
    gatewayPaymentId: string;
    approvedAt: Date;
  }): Promise<ConfirmPaymentResult> {
    try {
      return await this.db.$transaction(async (tx) => {
        const confirmed = await tx.booking.updateMany({
          where: { id: input.bookingId, status: 'PENDING_PAYMENT' },
          data: { status: 'CONFIRMED', holdExpiresAt: null },
        });

        if (confirmed.count === 0) {
          // **The status it actually found travels with the refusal.** A
          // booking already `CONFIRMED` is a duplicate delivery; one that is
          // `CANCELLED` or `EXPIRED` is money taken for an appointment that no
          // longer exists. From here the two updates look identical, and only
          // the caller can act on the difference.
          const current = await tx.booking.findUnique({
            where: { id: input.bookingId },
            select: { status: true },
          });
          return { outcome: 'notPending' as const, bookingStatus: current?.status ?? 'MISSING' };
        }

        await tx.payment.update({
          where: { id: input.paymentId },
          data: {
            status: 'APPROVED',
            mpPaymentId: input.gatewayPaymentId,
            approvedAt: input.approvedAt,
          },
        });

        return { outcome: 'confirmed' as const };
      }, TRANSACTION_OPTIONS);
    } catch (error) {
      // The unique `mpPaymentId` IS the idempotency guarantee, so tripping it
      // is the mechanism working rather than failing. Qualified on the
      // constraint: T15 is what happens when it is not.
      if (violates(error, GATEWAY_ID_CONSTRAINT)) {
        return { outcome: 'alreadyProcessed' };
      }
      throw error;
    }
  }

  /**
   * The late-payment branch, under the same lock the booking write takes.
   *
   * The five steps are the rule, in this order:
   *
   * 1. **The advisory lock is the first statement**, scoped to the barber and
   *    taken before any read — so this confirmation and a concurrent booking
   *    write serialize instead of both seeing a free slot. B4 warned that "an
   *    advisory lock binds only code that takes it"; this is the third caller,
   *    and the first that confirms rather than creates.
   * 2. **Re-read the barber's overlapping bookings** under the lock, excluding
   *    this one. Reading before the lock would be reading the state the lock
   *    exists to freeze.
   * 3. **`blocksAvailability` decides**, the same function the availability
   *    read and the booking write call. Never re-expressed in SQL: the rule
   *    reads a deadline, and a copy would drift the first time B7 refines it.
   * 4. **The booking is confirmed only if nothing blocks**, and the update is
   *    still guarded on `PENDING_PAYMENT` so a duplicate delivery matches zero
   *    rows.
   * 5. **The payment is approved either way**, because the charge is real. The
   *    slot-lost case leaves the booking alone for the sweeper, and hands the
   *    caller a value it can log and render rather than an error.
   */
  async confirmIfSlotFree(input: {
    paymentId: string;
    bookingId: string;
    barberId: string;
    startTime: Date;
    endTime: Date;
    gatewayPaymentId: string;
    approvedAt: Date;
    now: Date;
  }): Promise<LateConfirmResult> {
    try {
      return await this.db.$transaction(async (tx) => {
        // `$executeRaw`, never `$queryRaw`: `pg_advisory_xact_lock` returns
        // void, and the pg driver adapter cannot deserialize a void column —
        // which is how this call failed silently for B4's entire first
        // implementation. It runs for its effect and reads nothing back.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${input.barberId}, 0))`;

        const candidates = await tx.booking.findMany({
          where: {
            barberId: input.barberId,
            id: { not: input.bookingId },
            status: { in: POSSIBLY_BLOCKING },
            // Bounded at both ends, for the reason the availability read
            // measured: without a lower bound `endTime` lands in Filter and
            // the scan walks every earlier row of that barber.
            startTime: {
              gte: new Date(input.startTime.getTime() - MAX_DURATION_MINUTES * 60_000),
              lt: input.endTime,
            },
          },
          select: { startTime: true, endTime: true, status: true, holdExpiresAt: true },
        });

        const taken = candidates.some(
          (candidate) =>
            overlaps(
              { start: input.startTime, end: input.endTime },
              { start: candidate.startTime, end: candidate.endTime }
            ) &&
            blocksAvailability(
              {
                startTime: candidate.startTime,
                endTime: candidate.endTime,
                status: candidate.status as BookingStatus,
                holdExpiresAt: candidate.holdExpiresAt,
              },
              input.now
            )
        );

        // The charge happened. Recorded before the branch so both endings leave
        // the same truth about the money.
        //
        // **Guarded on `mpPaymentId: null`, and that guard is not decoration.**
        // This is the one path that writes the payment before checking the
        // booking, so the booking's guard cannot protect it. Without this, a
        // second notification carrying a *different* gateway id — Mercado Pago
        // permits several payment attempts against one preference — would
        // overwrite the id and the instant of a payment already approved, and
        // the unique constraint would not fire because the new id is new. The
        // first approval is the one that happened; later ones do not get to
        // rewrite it.
        const approved = await tx.payment.updateMany({
          where: { id: input.paymentId, mpPaymentId: null },
          data: {
            status: 'APPROVED',
            mpPaymentId: input.gatewayPaymentId,
            approvedAt: input.approvedAt,
          },
        });

        if (approved.count === 0) {
          return { outcome: 'alreadyProcessed' as const };
        }

        if (taken) {
          return { outcome: 'slotLost' as const };
        }

        const confirmed = await tx.booking.updateMany({
          where: { id: input.bookingId, status: 'PENDING_PAYMENT' },
          data: { status: 'CONFIRMED', holdExpiresAt: null },
        });

        if (confirmed.count === 0) {
          const current = await tx.booking.findUnique({
            where: { id: input.bookingId },
            select: { status: true },
          });
          return { outcome: 'notPending' as const, bookingStatus: current?.status ?? 'MISSING' };
        }

        return { outcome: 'confirmed' as const };
      }, TRANSACTION_OPTIONS);
    } catch (error) {
      if (violates(error, GATEWAY_ID_CONSTRAINT)) {
        return { outcome: 'alreadyProcessed' };
      }
      throw error;
    }
  }
}
