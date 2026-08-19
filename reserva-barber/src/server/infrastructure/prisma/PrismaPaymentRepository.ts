import type {
  ConfirmPaymentResult,
  CreatePaymentResult,
  IPaymentRepository,
  PaymentForNotification,
  PaymentRecord,
} from '@/server/domain/repositories/IPaymentRepository';
import type { PaymentStatus } from '@/server/domain/models/Payment';
import { toCanonicalDecimal } from './canonicalDecimal';
import type { PrismaClient } from '@/generated/prisma/client';

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
  status: true,
  amount: true,
  mpPreferenceId: true,
  mpInitPoint: true,
  approvedAt: true,
} as const;

interface PaymentRow {
  id: string;
  bookingId: string;
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
 * pooled connection and the pool is shared with the owner's dashboard. This one
 * is smaller than the booking write's because it does strictly less — two
 * updates, no reads, no lock — and because its caller is a third party that
 * retries, so failing fast is cheaper than queueing.
 */
const TRANSACTION_OPTIONS = { maxWait: 5_000, timeout: 10_000 } as const;

export class PrismaPaymentRepository implements IPaymentRepository {
  constructor(private readonly db: PrismaClient) {}

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
          return { outcome: 'notPending' as const };
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
   * The slot-lost branch: the charge happened, the appointment did not.
   *
   * The payment is `APPROVED` because the money moved. Recording it `REJECTED`
   * would hide from the owner's own accounting a sum they have received and now
   * owe back — the opposite of what they need to see, on the one path where a
   * human has to act.
   *
   * The booking is deliberately untouched. It keeps whatever status it had, and
   * the sweeper will expire it like any other lapsed hold.
   */
  async approveWithoutConfirming(input: {
    paymentId: string;
    gatewayPaymentId: string;
    approvedAt: Date;
  }): Promise<ConfirmPaymentResult> {
    try {
      return await this.db.$transaction(async (tx) => {
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
      if (violates(error, GATEWAY_ID_CONSTRAINT)) {
        return { outcome: 'alreadyProcessed' };
      }
      throw error;
    }
  }
}
