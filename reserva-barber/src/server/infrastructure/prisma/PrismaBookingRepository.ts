import type {
  BookingByToken,
  BookingForConfirmationEmail,
  BookingForPaymentInitiation,
  BookingForTransfer,
  CancelBookingResult,
  PublicTransferDestination,
  HeldBooking,
  IBookingRepository,
  ProvisionalBookingInput,
  ProvisionalBookingResult,
} from '@/server/domain/repositories/IBookingRepository';
import type { Interval } from '@/server/domain/models/availability';
import { overlaps } from '@/server/domain/models/availability';
import {
  blocksAvailability,
  isCancellableByOwner,
  BOOKING_STATUSES,
  type BookingStatus,
} from '@/server/domain/models/Booking';
import type { PaymentMethod, PaymentStatus } from '@/server/domain/models/Payment';
import type { ReceiptStatus } from '@/server/domain/models/TransferReceipt';
import { isTransferOfferableToClient } from '@/server/domain/models/PaymentConfig';
import { workingIntervalsFor } from '@/server/domain/models/bookingCalendar';
import { MAX_DURATION_MINUTES } from '@/server/domain/models/slotGranularity';
import { MAX_TIME_OFF_DAYS } from '@/server/application/timeOff/timeOffSchema';
import { toCanonicalDecimal } from './canonicalDecimal';
import type { PrismaClient } from '@/generated/prisma/client';

/**
 * Statuses that can matter, as a **read** filter — the same list the
 * availability read uses, and wider than the blocking rule on purpose.
 * `blocksAvailability` decides; encoding the expired-hold clause as SQL here
 * would be the second copy that drifts.
 */
const POSSIBLY_BLOCKING: BookingStatus[] = ['PENDING_PAYMENT', 'PENDING_APPROVAL', 'CONFIRMED'];

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/**
 * How long the transaction may wait for a connection, and how long it may hold
 * one (B4 design D3).
 *
 * Explicit rather than inherited. The transaction pins a pooled connection for
 * its duration and the pool is shared with the owner's dashboard, so an
 * unbounded one under contention degrades a surface that has nothing to do
 * with this flow. Four statements at the ~350–400 ms round trips B2 measured
 * fit comfortably inside the execution budget; the wait budget is what queues
 * a burst on one barber rather than failing it.
 */
const TRANSACTION_OPTIONS = { maxWait: 5_000, timeout: 15_000 } as const;

/**
 * The same lower bound the availability read uses, and for the same measured
 * reason: `startTime < end AND endTime > start` bounds the scan from above
 * only, leaving `endTime` in Filter while PostgreSQL walks every earlier row
 * of that barber. Safe because both entities have an enforced maximum length.
 */
function earliestOverlappingStart(rangeStart: Date, maxLengthMs: number): Date {
  return new Date(rangeStart.getTime() - maxLengthMs);
}

/** Scoping predicate. `Barber` has no ownerId column (`data-model.md` §5). */
function ownedBy(ownerId: string) {
  return { location: { ownerId } };
}

function containsWholly(outer: Interval, inner: Interval): boolean {
  return outer.start.getTime() <= inner.start.getTime() && outer.end.getTime() >= inner.end.getTime();
}

export class PrismaBookingRepository implements IBookingRepository {
  constructor(private readonly db: PrismaClient) {}

  /**
   * The no-overlap invariant, enforced inside one transaction.
   *
   * The order of the five steps is the rule, not an implementation detail:
   *
   * 1. **The advisory lock is the first statement.** Taken before any read, so
   *    two requests for the same barber serialize rather than both reading a
   *    free slot and both inserting. It is transaction-scoped, so it releases
   *    on commit or rollback with nothing to clean up.
   * 2. **Re-read the day** — windows, absences and candidate bookings — under
   *    the lock. Reading before the lock would be reading a state the lock was
   *    supposed to freeze.
   * 3. **`blocksAvailability` decides**, the same function the availability
   *    read calls. Never a SQL predicate: the rule reads a deadline, and a
   *    copy would drift the first time B7 refines it, offering a client a time
   *    and then refusing them while they pay.
   * 4. **Re-assert the schedule.** An owner can narrow a window or record an
   *    absence between the moment the times were offered and the moment one is
   *    submitted (`tech-debt.md` T29). This is the only place where the answer
   *    is still current.
   * 5. **Insert.**
   *
   * **Why not an exclusion constraint.** `btree_gist` over
   * `(barberId, tsrange(startTime, endTime))` would be stronger than anything
   * application code can do — but its predicate cannot include the
   * expired-hold clause, because `holdExpiresAt > now()` is not immutable and
   * cannot appear in a partial index predicate. It could only cover the three
   * blocking statuses, so it would refuse a write over a slot availability
   * correctly reports as free: the read/write divergence this story exists to
   * prevent, arriving from the direction nobody would watch.
   *
   * **Why not serializable isolation.** Also correct, and it turns every
   * collision into a 40001 needing retry orchestration on an endpoint with no
   * rate limit. The advisory lock has the granularity the domain actually has:
   * one barber's calendar.
   *
   * **The lock binds only code that takes it.** This is the sole writer of
   * `Booking` today; B7's sweeper and D2's approval must take the same lock
   * when they arrive.
   */
  async createProvisional(input: ProvisionalBookingInput): Promise<ProvisionalBookingResult> {
    const requested: Interval = { start: input.startTime, end: input.endTime };

    return this.db.$transaction(async (tx) => {
      // 1. Serialize on the barber, before reading anything.
      //
      // `hashtextextended` is a PostgreSQL built-in (11+) needing no
      // extension. The zero seed is arbitrary and fixed: every caller must
      // hash the same way or they would take different locks for one barber.
      //
      // **`$executeRaw`, never `$queryRaw`.** `pg_advisory_xact_lock` returns
      // `void`, and the pg driver adapter cannot deserialize a void column —
      // it raises `UnsupportedNativeDataType`, which surfaces as a generic
      // P2010 and aborts the transaction. This statement is run for its
      // effect, not its result, and `$executeRaw` is the call that does not
      // try to read columns back. Measured against the live database: with
      // `$queryRaw` every booking write failed.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${input.barberId}, 0))`;

      // 2. Re-read the day under the lock. Entered from `Barber` so the owner
      // predicate, the weekday filter and both range filters hang off one row
      // — and so a barber belonging to another owner returns null here rather
      // than empty lists that would read as "free all day".
      const barber = await tx.barber.findFirst({
        where: { id: input.barberId, isActive: true, ...ownedBy(input.ownerId) },
        select: {
          workingHours: {
            where: { dayOfWeek: input.weekday },
            select: { startMinute: true, endMinute: true },
            orderBy: [{ startMinute: 'asc' }],
          },
          timeOffs: {
            where: {
              startsAt: {
                gte: earliestOverlappingStart(input.dayRange.start, MAX_TIME_OFF_DAYS * DAY_MS),
                lt: input.dayRange.end,
              },
              endsAt: { gt: input.dayRange.start },
            },
            // No `reason`: it can hold medical information (M5b design D6).
            select: { startsAt: true, endsAt: true },
          },
          bookings: {
            where: {
              status: { in: POSSIBLY_BLOCKING },
              startTime: {
                gte: earliestOverlappingStart(
                  input.dayRange.start,
                  MAX_DURATION_MINUTES * MINUTE_MS
                ),
                lt: input.dayRange.end,
              },
              endTime: { gt: input.dayRange.start },
            },
            // `clientId` is selected here and nowhere else in a public read:
            // it is what distinguishes this client's own hold from a stranger's
            // (design D7), and without it a double tap reports a conflict to
            // the person who just succeeded.
            select: {
              id: true,
              clientId: true,
              startTime: true,
              endTime: true,
              status: true,
              holdExpiresAt: true,
              cancellationToken: true,
              depositAmount: true,
            },
          },
        },
      });

      if (barber === null) {
        return { outcome: 'slotTaken' as const };
      }

      // 3. The shared predicate decides which of them block.
      const blocking = barber.bookings.filter((booking) =>
        blocksAvailability(booking, input.now)
      );
      const conflicting = blocking.filter((booking) =>
        overlaps({ start: booking.startTime, end: booking.endTime }, requested)
      );

      if (conflicting.length > 0) {
        // The same client's own hold for this exact start is not a conflict —
        // it is a repeat submission (design D7). Returned rather than refused,
        // which makes a double tap, a retried POST and a back-button
        // re-submission all resolve to the one appointment.
        const own = conflicting.find(
          (booking) =>
            booking.clientId === input.clientId &&
            booking.startTime.getTime() === input.startTime.getTime()
        );

        if (own !== undefined && conflicting.length === 1) {
          return {
            outcome: 'alreadyHeld' as const,
            booking: {
              id: own.id,
              cancellationToken: own.cancellationToken,
              startTime: own.startTime,
              endTime: own.endTime,
              holdExpiresAt: own.holdExpiresAt,
              depositAmount: toCanonicalDecimal(own.depositAmount),
            },
          };
        }

        return { outcome: 'slotTaken' as const };
      }

      // 4. The schedule may have changed since the times were offered (T29).
      const windows = workingIntervalsFor(input.localDate, barber.workingHours);
      const fitsAWindow = windows.some((window) => containsWholly(window, requested));
      const hitsAnAbsence = barber.timeOffs.some((absence) =>
        overlaps({ start: absence.startsAt, end: absence.endsAt }, requested)
      );

      if (!fitsAWindow || hitsAnAbsence) {
        return { outcome: 'slotTaken' as const };
      }

      // 5. Only now.
      const created = await tx.booking.create({
        data: {
          clientId: input.clientId,
          barberId: input.barberId,
          serviceId: input.serviceId,
          startTime: input.startTime,
          endTime: input.endTime,
          status: 'PENDING_PAYMENT',
          priceAtBooking: input.priceAtBooking,
          depositAmount: input.depositAmount,
          cancellationToken: input.cancellationToken,
          holdExpiresAt: input.holdExpiresAt,
        },
        select: {
          id: true,
          cancellationToken: true,
          startTime: true,
          endTime: true,
          holdExpiresAt: true,
          depositAmount: true,
        },
      });

      return {
        outcome: 'created' as const,
        booking: this.toHeldBooking(created),
      };
    }, TRANSACTION_OPTIONS);
  }

  /**
   * Live holds for one client (FR11's cap).
   *
   * "Live" asks the same question `blocksAvailability` does, expressed here as
   * the SQL that can be counted without loading rows: a `PENDING_PAYMENT` row
   * past its deadline is not holding anything. `PENDING_APPROVAL` counts
   * regardless of age — a receipt is uploaded and a human owes an answer.
   */
  async countLiveHoldsForClient(clientId: string, now: Date): Promise<number> {
    return this.db.booking.count({
      where: {
        clientId,
        OR: [
          { status: 'PENDING_APPROVAL' },
          { status: 'PENDING_PAYMENT', holdExpiresAt: null },
          { status: 'PENDING_PAYMENT', holdExpiresAt: { gt: now } },
        ],
      },
    });
  }

  /**
   * This client's live holds with one barber on one day (design D7's second
   * half).
   *
   * The `blocksAvailability` question, expressed as the SQL that can be
   * answered without loading the day: a `PENDING_PAYMENT` row past its
   * deadline is not holding anything.
   */
  async findLiveHoldsForClientOnDay(input: {
    clientId: string;
    barberId: string;
    dayRange: Interval;
    now: Date;
  }): Promise<HeldBooking[]> {
    const rows = await this.db.booking.findMany({
      where: {
        clientId: input.clientId,
        barberId: input.barberId,
        startTime: { gte: input.dayRange.start, lt: input.dayRange.end },
        OR: [
          { status: 'PENDING_APPROVAL' },
          { status: 'CONFIRMED' },
          { status: 'PENDING_PAYMENT', holdExpiresAt: null },
          { status: 'PENDING_PAYMENT', holdExpiresAt: { gt: input.now } },
        ],
      },
      select: {
        id: true,
        cancellationToken: true,
        startTime: true,
        endTime: true,
        holdExpiresAt: true,
        depositAmount: true,
      },
    });

    return rows.map((row) => this.toHeldBooking(row));
  }

  /**
   * The confirmation page's read, as a named projection.
   *
   * The client's email and phone are **not selected**. The page is addressed
   * by a token that can be shared or opened on a shared device, so the columns
   * it cannot select are the columns it cannot render.
   */
  async findByCancellationToken(token: string): Promise<BookingByToken | null> {
    // Two statements, issued together so their round trips overlap rather than
    // queue. The second exists because Prisma's `select` cannot express
    // `"mpAccessToken" IS NOT NULL` as a projected column, and the alternative
    // — selecting the token and reducing it here — would bring a bearer
    // credential into the process on a route a stranger reaches without a
    // session. B4 settled this for the booking write; the same answer holds on
    // the page. Keyed by the token in both, so neither waits on the other.
    const [row, mercadoPago] = await Promise.all([
      this.db.booking.findUnique({
        where: { cancellationToken: token },
        select: {
          id: true,
          status: true,
          startTime: true,
          endTime: true,
          holdExpiresAt: true,
          depositAmount: true,
          // N1: whether the client was told, and when this row last changed.
          // `client.email` stays unselected here — this projection feeds a page
          // that can be opened on a shared device, which is exactly the
          // distinction the confirmation-email projection is a named exception
          // to.
          confirmationEmailSentAt: true,
          updatedAt: true,
          // C2: who ended it, so the page attributes rather than guesses.
          cancelledBy: true,
          client: { select: { name: true } },
          service: { select: { name: true } },
          barber: {
            select: {
              displayName: true,
              location: {
                select: {
                  name: true,
                  // The three plaintext columns a client is shown. The access
                  // token lives in this row and is deliberately not selected;
                  // the projection returned below has no field it could occupy.
                  owner: {
                    select: {
                      paymentConfig: {
                        select: {
                          transferCbuCvu: true,
                          transferAlias: true,
                          transferHolderName: true,
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          // The booking's live payment, in the same query. A second read would
          // be a second round trip on the page a paying client is staring at,
          // and the partial unique index guarantees there is at most one.
          payments: {
            where: { status: { not: 'REJECTED' } },
            select: {
              status: true,
              method: true,
              mpInitPoint: true,
              transferReceipt: { select: { status: true } },
            },
            take: 1,
          },
        },
      }),
      this.db.$queryRaw<{ hasMercadoPago: boolean }[]>`
        SELECT pc."mpAccessToken" IS NOT NULL AS "hasMercadoPago"
        FROM "Booking" b
        JOIN "Barber" br ON br.id = b."barberId"
        JOIN "Location" l ON l.id = br."locationId"
        LEFT JOIN "PaymentConfig" pc ON pc."ownerId" = l."ownerId"
        WHERE b."cancellationToken" = ${token}
      `,
    ]);

    if (row === null) return null;

    const payment = row.payments[0] ?? null;
    const config = row.barber.location.owner.paymentConfig;

    // Whether the method may be OFFERED. Stricter than the bookability gate: a
    // destination with no holder name is unusable to a client, who cannot
    // confirm from their bank's screen who they are paying.
    const hasTransferOption =
      config != null &&
      isTransferOfferableToClient({
        cbuCvu: config.transferCbuCvu,
        alias: config.transferAlias,
        holderName: config.transferHolderName,
      });

    // Whether the account number may be SHOWN — a different question, and only
    // once the client has committed. The rule is that a CBU must never be
    // visible during a window that is about to lapse, and this is where it is
    // enforced: the page cannot render what it was not given.
    const destination: PublicTransferDestination | null =
      hasTransferOption && payment?.method === 'BANK_TRANSFER' && config != null
        ? {
            cbuCvu: config.transferCbuCvu,
            alias: config.transferAlias,
            // Non-null by `hasTransferOption`, which requires it.
            holderName: config.transferHolderName as string,
          }
        : null;

    return {
      id: row.id,
      status: row.status,
      startTime: row.startTime,
      endTime: row.endTime,
      holdExpiresAt: row.holdExpiresAt,
      depositAmount: toCanonicalDecimal(row.depositAmount),
      clientName: row.client.name,
      confirmationEmailSentAt: row.confirmationEmailSentAt,
      updatedAt: row.updatedAt,
      cancelledBy: row.cancelledBy,
      barberDisplayName: row.barber.displayName,
      serviceName: row.service.name,
      locationName: row.barber.location.name,
      paymentStatus: payment === null ? null : (payment.status as PaymentStatus),
      // A boolean, never the URL: resuming goes back through the idempotent
      // initiation endpoint rather than through a second path rendered here.
      hasCheckout: payment?.mpInitPoint != null,
      paymentMethod: payment === null ? null : (payment.method as PaymentMethod),
      receiptStatus: (payment?.transferReceipt?.status as ReceiptStatus | undefined) ?? null,
      hasMercadoPago: mercadoPago[0]?.hasMercadoPago ?? false,
      hasTransferOption,
      transfer: destination,
    };
  }

  private toHeldBooking(row: {
    id: string;
    cancellationToken: string;
    startTime: Date;
    endTime: Date;
    holdExpiresAt: Date | null;
    depositAmount: unknown;
  }): HeldBooking {
    return {
      id: row.id,
      cancellationToken: row.cancellationToken,
      startTime: row.startTime,
      endTime: row.endTime,
      holdExpiresAt: row.holdExpiresAt,
      depositAmount: toCanonicalDecimal(row.depositAmount),
    };
  }

  /**
   * The same row, cut for the charge rather than for the render.
   *
   * Reaches the owner through the barber's location — `Barber` has no
   * `ownerId` column (`data-model.md` §5) — and the public slug through that
   * owner's profile, so the return URL is built from the booking's own shop and
   * never from anything the request supplied.
   *
   * Selects no client at all. The initiation renders nobody, so the columns it
   * never asks for are the ones that cannot reach a log line.
   */
  async findForPaymentInitiation(token: string): Promise<BookingForPaymentInitiation | null> {
    const row = await this.db.booking.findUnique({
      where: { cancellationToken: token },
      select: {
        id: true,
        status: true,
        startTime: true,
        endTime: true,
        holdExpiresAt: true,
        depositAmount: true,
        service: { select: { name: true } },
        barber: {
          select: {
            location: {
              select: {
                ownerId: true,
                owner: { select: { businessProfile: { select: { publicSlug: true } } } },
              },
            },
          },
        },
      },
    });

    if (row === null) return null;

    const slug = row.barber.location.owner.businessProfile?.publicSlug;
    // A booking whose shop has no public profile cannot be paid: there is
    // nowhere to send the client back to. Unreachable through the flow, which
    // is entered by slug, and reported as absent rather than papered over with
    // a URL that would 404 after a real charge.
    if (slug === undefined) return null;

    return {
      id: row.id,
      status: row.status,
      startTime: row.startTime,
      endTime: row.endTime,
      holdExpiresAt: row.holdExpiresAt,
      depositAmount: toCanonicalDecimal(row.depositAmount),
      serviceName: row.service.name,
      ownerId: row.barber.location.ownerId,
      publicSlug: slug,
    };
  }

  /**
   * The same token, answered for the bank transfer path.
   *
   * Reaches one column further than the Mercado Pago projection —
   * `Owner.authUserId` — because that value is the leading segment of the
   * storage key and therefore what the bucket's policies compare against a
   * session. It is deliberately absent from the Mercado Pago projection, which
   * has no key to compose.
   */
  async findForTransfer(token: string): Promise<BookingForTransfer | null> {
    const row = await this.db.booking.findUnique({
      where: { cancellationToken: token },
      select: {
        id: true,
        status: true,
        startTime: true,
        endTime: true,
        holdExpiresAt: true,
        depositAmount: true,
        barberId: true,
        barber: {
          select: {
            location: {
              select: {
                ownerId: true,
                owner: {
                  select: {
                    authUserId: true,
                    businessProfile: { select: { publicSlug: true } },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (row === null) return null;

    // Same rule as the Mercado Pago projection: a booking whose shop has no
    // public profile has nowhere to send the client back to.
    const slug = row.barber.location.owner.businessProfile?.publicSlug;
    if (slug === undefined) return null;

    return {
      id: row.id,
      status: row.status,
      startTime: row.startTime,
      endTime: row.endTime,
      holdExpiresAt: row.holdExpiresAt,
      depositAmount: toCanonicalDecimal(row.depositAmount),
      ownerId: row.barber.location.ownerId,
      ownerAuthUserId: row.barber.location.owner.authUserId,
      publicSlug: slug,
      barberId: row.barberId,
    };
  }

  /**
   * What the confirmation message is composed from (N1).
   *
   * **The one read here that deliberately selects the client's email**, for the
   * reason `IBookingRepository` records on the contract: the other projections
   * withhold contact detail because they feed a page anyone holding the link
   * can open, and an address is not something a *message* might leak — it is
   * where the message goes.
   *
   * Keyed on the booking id rather than the token. Its callers already have the
   * id from the transition they just completed, and a second token lookup is a
   * second surface a stranger's input could reach.
   *
   * `null` for a shop with no public profile, the same rule the two payment
   * projections apply: without a slug there is no address the link could be
   * built from, and a message whose only actionable content is a broken URL is
   * worse than one that omits it.
   */
  async findForConfirmationEmail(bookingId: string): Promise<BookingForConfirmationEmail | null> {
    const row = await this.db.booking.findUnique({
      where: { id: bookingId },
      select: {
        startTime: true,
        priceAtBooking: true,
        depositAmount: true,
        cancellationToken: true,
        // Name and email. **No phone** — nothing in the message needs it.
        client: { select: { name: true, email: true } },
        service: { select: { name: true } },
        barber: {
          select: {
            displayName: true,
            location: {
              select: {
                name: true,
                address: true,
                // The brand and the slug the link is addressed through. The
                // owner's `paymentConfig` is deliberately not reachable from
                // here: nothing on the way to an email may become a second
                // holder of an access token.
                owner: {
                  select: {
                    businessProfile: { select: { businessName: true, publicSlug: true } },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (row === null) return null;

    const profile = row.barber.location.owner.businessProfile;
    if (profile === null || profile === undefined) return null;

    return {
      clientName: row.client.name,
      clientEmail: row.client.email,
      shopName: profile.businessName,
      shopSlug: profile.publicSlug,
      locationName: row.barber.location.name,
      locationAddress: row.barber.location.address,
      barberName: row.barber.displayName,
      serviceName: row.service.name,
      startTime: row.startTime,
      priceAtBooking: toCanonicalDecimal(row.priceAtBooking),
      depositAmount: toCanonicalDecimal(row.depositAmount),
      cancellationToken: row.cancellationToken,
    };
  }

  /**
   * Records that the provider accepted the confirmation message (N1).
   *
   * **One statement, no transaction and no lock.** It follows a transition that
   * has already committed, and it can change nothing about what the booking is
   * — so there is no invariant for a lock to protect and nothing a concurrent
   * write could corrupt.
   *
   * **Two columns move, not one: this one and Prisma's `@updatedAt`.** An
   * earlier version of this comment said "one column", which the N1 gate
   * falsified by comparing the whole stored row before and after — probe 6.3
   * prints `changed=[confirmationEmailSentAt, updatedAt]` to this day. The claim
   * was corrected in the contract, the schema, `data-model.md` and the spec, and
   * missed here, which is the file a reader checking the guarantee actually
   * opens. Making it literally true would mean `$executeRaw`, the only write in
   * this product to bypass the client, for a property nothing reads.
   *
   * `updateMany` rather than `update` so a booking deleted between the send and
   * this write matches zero rows instead of throwing. The caller treats this
   * write's failure as a log line either way; making the ordinary case
   * non-throwing keeps that promise cheap to honour.
   */
  async markConfirmationEmailSent(bookingId: string, sentAt: Date): Promise<void> {
    await this.db.booking.updateMany({
      where: { id: bookingId },
      data: { confirmationEmailSentAt: sentAt },
    });
  }

  /**
   * The owner cancels a booking, releasing its slot (C2).
   *
   * **No advisory lock, and that is the design rather than an omission.** The
   * per-barber lock exists so two writers cannot *place* a booking into one
   * slot; this only releases one, and a release cannot double-book — the same
   * argument the receipt rejection makes about itself. What carries the safety
   * instead is that **every write below is conditional on the status it
   * expects**, so a row that moved underneath matches zero rows rather than
   * being reasserted.
   *
   * The resolution happens **before** the transaction: a booking outside this
   * owner's scope should cost one indexed read, not an opened transaction.
   */
  async cancelByOwner(input: {
    bookingId: string;
    ownerId: string;
    now: Date;
  }): Promise<CancelBookingResult> {
    const target = await this.db.booking.findFirst({
      // `Barber` carries no ownerId (`data-model.md` §5), so ownership is
      // reached through the location — the only path, and the tenancy boundary.
      where: { id: input.bookingId, barber: { location: { ownerId: input.ownerId } } },
      select: { id: true, status: true },
    });

    // Another owner's booking and one that does not exist are the same answer.
    if (target === null) return { outcome: 'notFound' };

    // Asked here as well as in the guard below, so a terminal booking costs no
    // transaction. The guard is still what makes it correct — this is the cheap
    // rejection, not the safety.
    if (!isCancellableByOwner(target.status as BookingStatus)) {
      return { outcome: 'notCancellable', status: target.status };
    }

    return this.db.$transaction(async (client) => {
      const tx = client as unknown as CancelTx;

      const cancelled = await tx.booking.updateMany({
        where: { id: input.bookingId, status: { in: CANCELLABLE_STATUSES } },
        data: {
          status: 'CANCELLED',
          cancelledAt: input.now,
          cancelledBy: 'OWNER',
          // Cleared, deliberately unlike an expiry — which preserves it as the
          // evidence of why that row ended. A booking this write finishes has
          // no hold left to describe.
          holdExpiresAt: null,
        },
      });

      if (cancelled.count === 0) {
        // It moved between the read and the write. Report what it became; the
        // payment and the receipt are left untouched, because a booking this
        // call did not cancel is not this call's to unwind.
        const current = await tx.booking.findUnique({
          where: { id: input.bookingId },
          select: { status: true },
        });
        return { outcome: 'notCancellable' as const, status: current?.status ?? 'MISSING' };
      }

      /**
       * **Guarded on `PENDING`, not branched on it.** An `APPROVED` payment
       * matches zero rows here, which is a stronger protection than an `if`
       * that a later edit could invert: the database refuses it rather than the
       * code remembering to. An approved deposit is a charge that really
       * happened and rewriting it would falsify the only record of it.
       */
      await tx.payment.updateMany({
        where: { bookingId: input.bookingId, status: 'PENDING' },
        data: { status: 'REJECTED' },
      });

      /**
       * **A pending receipt is deliberately left `PENDING`**, and the first
       * draft of C2 rejected it here.
       *
       * The argument for writing it was that the row keeps asserting "a human
       * owes an answer" when nobody does. The argument against turned out to be
       * decisive and only surfaced when an existing page test went red: the
       * receipt rejection already produces `{CANCELLED, receipt REJECTED,
       * cancelledBy OWNER}`, so writing `REJECTED` here would make a
       * cancellation **byte-identical to a rejection** — and the client's page
       * distinguishes them to choose between "la barbería no aprobó tu
       * comprobante" and "la barbería canceló tu turno". One of the two would
       * necessarily have got the wrong message.
       *
       * Leaving it `PENDING` is also the more honest record: nobody reviewed
       * this document. `REJECTED` would claim a review that never happened, for
       * a queue that already hides the row anyway — it filters on the booking's
       * status, so a cancelled booking's receipt disappears from the owner's
       * view with no write at all.
       */

      /**
       * Asked inside the transaction because this is where it is answerable
       * without a race: the payment write above has just refused to touch an
       * approval, so an approval found here is the one that survived.
       */
      const approved = await tx.payment.findFirst({
        where: { bookingId: input.bookingId, status: 'APPROVED' },
        select: { id: true },
      });

      return {
        outcome: 'applied' as const,
        bookingId: input.bookingId,
        depositApproved: approved !== null,
      };
    }, TRANSACTION_OPTIONS);
  }
}

/** The statuses the guard admits, derived from the domain predicate. */
const CANCELLABLE_STATUSES: BookingStatus[] = BOOKING_STATUSES.filter(isCancellableByOwner);

/**
 * The slice of the transaction client this write uses.
 *
 * **It names no `$executeRaw`**, which is the type-level form of "this takes no
 * lock": an implementation that tried would not compile. B4 shipped a lock
 * defect past a test that mocked the call, so here the absence is structural
 * rather than asserted.
 */
interface CancelTx {
  booking: {
    updateMany(args: unknown): Promise<{ count: number }>;
    findUnique(args: unknown): Promise<{ status: string } | null>;
  };
  payment: {
    updateMany(args: unknown): Promise<{ count: number }>;
    findFirst(args: unknown): Promise<{ id: string } | null>;
  };
}
