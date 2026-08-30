import type {
  IBookingReminderRepository,
  ReminderBooking,
  ReminderCandidateRow,
} from '@/server/domain/repositories/IBookingReminderRepository';
import type { PrismaClient } from '@/generated/prisma/client';
import { toCanonicalDecimal } from './canonicalDecimal';

/**
 * The reminder job's data access.
 *
 * **Three things this repository deliberately does not do**, each correct here
 * and wrong in the booking write — the same three the sweep's repository lists,
 * for the same reasons:
 *
 * 1. **No transaction.** Each call is a single statement, and a single
 *    statement is already atomic. Wrapping one would hold a connection from a
 *    pool capped at five — shared with the owner's dashboard and the public
 *    booking write — across a decision made in application code.
 * 2. **No advisory lock.** Every caller of that lock *places* a booking into a
 *    slot, and the lock exists so two of them cannot choose the same one. This
 *    claims a row and sends a message; it cannot double-book.
 * 3. **No domain rule in SQL.** The candidate query narrows by status, by the
 *    null claim and by a bound on `startTime`; `isReminderDue` decides above
 *    this layer, and the minimum-gap rule is deliberately absent from the
 *    `WHERE` clause so it can be refined without touching a query or an index.
 *
 * The queries are **not owner-scoped**, which is the exception
 * `IBookingReminderRepository` documents. `findDueCandidates` is served by the
 * partial index `Booking_reminder_due` — `(startTime) WHERE status =
 * 'CONFIRMED' AND "reminderEmailSentAt" IS NULL`, added in
 * `20260829201500_n2_reminder_email`. None of this table's other indexes can:
 * `(barberId, startTime)` leads with a barber this query does not name, and
 * B7's two are restricted to the provisional statuses.
 */

/**
 * What a candidate is allowed to be, and it is three columns.
 *
 * **No personal data at all**, unlike the projection below. A candidate is not
 * yet a recipient — `isReminderDue` may reject it and the claim may lose it to
 * an overlapping invocation — so selecting a name or an address here would read
 * personal data for a row nobody will ever be sent a message about.
 */
const CANDIDATE_PROJECTION = {
  id: true,
  startTime: true,
  createdAt: true,
} as const;

/**
 * What the message needs, and deliberately not one field more.
 *
 * No phone: the confirmation message's projection refuses it on the grounds
 * that a shape which cannot hold it cannot render it by accident, and this one
 * is read without an owner scope, which makes the discipline load-bearing
 * rather than tidy. No owner id, which never reaches a rendering layer.
 */
const MESSAGE_PROJECTION = {
  id: true,
  startTime: true,
  priceAtBooking: true,
  depositAmount: true,
  cancellationToken: true,
  client: { select: { name: true, email: true } },
  service: { select: { name: true } },
  barber: {
    select: {
      displayName: true,
      location: {
        select: {
          name: true,
          address: true,
          owner: {
            select: { businessProfile: { select: { businessName: true, publicSlug: true } } },
          },
        },
      },
    },
  },
} as const;

interface CandidateRow {
  id: string;
  startTime: Date;
  createdAt: Date;
}

interface MessageRow {
  id: string;
  startTime: Date;
  priceAtBooking: unknown;
  depositAmount: unknown;
  cancellationToken: string;
  client: { name: string; email: string };
  service: { name: string };
  barber: {
    displayName: string;
    location: {
      name: string;
      address: string | null;
      owner: { businessProfile: { businessName: string; publicSlug: string } | null };
    };
  };
}

/**
 * A row becomes a message, or it becomes nothing.
 *
 * Returns `null` when the shop has no `BusinessProfile`, because the public
 * slug the link is built on lives there. That is unreachable today — the slug
 * *is* the profile, so a booking cannot exist without one — but the relation is
 * nullable, and a link composed on an absent slug is a permanent 404 in an
 * inbox. Dropping the row is the recoverable failure; sending it is not.
 */
function toReminderBooking(row: MessageRow): ReminderBooking | null {
  const profile = row.barber.location.owner.businessProfile;

  if (profile === null) {
    return null;
  }

  return {
    id: row.id,
    clientName: row.client.name,
    clientEmail: row.client.email,
    shopName: profile.businessName,
    shopSlug: profile.publicSlug,
    locationName: row.barber.location.name,
    locationAddress: row.barber.location.address,
    barberName: row.barber.displayName,
    serviceName: row.service.name,
    startTime: row.startTime,
    // Canonical strings in both cases: the driver returns a stored 2000.50 as
    // 2000.5, and the integer-cent arithmetic that computes the balance would
    // then read the lone 5 as five centavos. Measured in PC3.
    priceAtBooking: toCanonicalDecimal(row.priceAtBooking),
    depositAmount: toCanonicalDecimal(row.depositAmount),
    cancellationToken: row.cancellationToken,
  };
}

export class PrismaBookingReminderRepository implements IBookingReminderRepository {
  constructor(private readonly db: PrismaClient) {}

  async findDueCandidates(input: {
    now: Date;
    windowEnd: Date;
    limit: number;
  }): Promise<ReminderCandidateRow[]> {
    const rows = (await this.db.booking.findMany({
      where: {
        status: 'CONFIRMED',
        // Never claimed. Together with the status this is what the partial
        // index is built on, and what makes a claimed row leave it forever.
        reminderEmailSentAt: null,
        // **`gt: now` is the bound that stops this job mailing the past**, and
        // it is asserted again by `isReminderDue` above this layer. That
        // duplication is deliberate: it is the only clause here whose failure
        // is unrecoverable, and a safety property of that size does not get to
        // rest on a `WHERE` clause no unit test can see. B7 duplicates its
        // grace window for the same shape of reason.
        startTime: { gt: input.now, lt: input.windowEnd },
      },
      select: CANDIDATE_PROJECTION,
      // Soonest first, so a backlog drains in the order the appointments
      // actually arrive rather than leaving the most urgent behind a page of
      // less urgent ones.
      orderBy: { startTime: 'asc' },
      take: input.limit,
    })) as CandidateRow[];

    return rows.map((row) => ({
      id: row.id,
      startTime: row.startTime,
      createdAt: row.createdAt,
    }));
  }

  async claimDue(input: { ids: readonly string[]; claimedAt: Date }): Promise<ReminderBooking[]> {
    if (input.ids.length === 0) {
      return [];
    }

    /**
     * **The claim, and the whole of at-most-once.**
     *
     * `updateManyAndReturn` rather than `updateMany`: the count a plain
     * `updateMany` returns would force a read-back to discover *which* rows
     * were won, and between the update and that read another invocation could
     * do anything at all. One statement that both marks and reports is what
     * closes the window.
     *
     * The two guards are the guarantee. A booking cancelled by its client (C1)
     * or by the owner (C2), expired by the sweep (B7), or claimed by an
     * overlapping invocation between `findDueCandidates` and here matches zero
     * rows and is simply absent from the result — never overwritten, never
     * sent to twice.
     *
     * One key written. `status`, `holdExpiresAt`, the monetary snapshots and
     * the token are all untouched; Prisma's `@updatedAt` moves alongside, as it
     * does on every write through the client.
     */
    const claimed = (await this.db.booking.updateManyAndReturn({
      where: {
        id: { in: [...input.ids] },
        status: 'CONFIRMED',
        reminderEmailSentAt: null,
      },
      data: { reminderEmailSentAt: input.claimedAt },
      select: { id: true },
    })) as { id: string }[];

    if (claimed.length === 0) {
      return [];
    }

    /**
     * The message projection, read **only** for the rows this invocation won.
     *
     * A second statement, and not a second decision: these ids are already
     * claimed, so nothing about them can change what is sent. It exists because
     * `updateManyAndReturn` returns scalars of the updated model and the
     * message needs four relations — the client, the service, the barber, and
     * the shop's public profile through its location and owner.
     *
     * Reading it here rather than in `findDueCandidates` is what keeps personal
     * data out of the rows that were considered and discarded.
     */
    const rows = (await this.db.booking.findMany({
      where: { id: { in: claimed.map((row) => row.id) } },
      select: MESSAGE_PROJECTION,
    })) as MessageRow[];

    return rows
      .map(toReminderBooking)
      .filter((booking): booking is ReminderBooking => booking !== null);
  }
}
