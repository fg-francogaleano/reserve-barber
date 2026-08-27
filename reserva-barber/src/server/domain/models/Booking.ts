/**
 * The booking states, the one question availability asks about a booking, and
 * the hold-deadline rule B4 needed once it became the table's writer.
 *
 * B3 created this table and read it, writing nothing. What lived here then was
 * only the part slot generation needed; `holdExpiresAtFor` is the first piece
 * that belongs to a writer.
 */

import {
  EXPIRY_GRACE_MINUTES,
  HOLD_DURATION_MINUTES,
  TRANSFER_HOLD_DURATION_MINUTES,
} from './bookingHorizon';

export const BOOKING_STATUSES = [
  'PENDING_PAYMENT',
  'PENDING_APPROVAL',
  'CONFIRMED',
  'CANCELLED',
  'EXPIRED',
] as const;

export type BookingStatus = (typeof BOOKING_STATUSES)[number];

/**
 * Who ended a booking, when a human did (C2).
 *
 * Declared here rather than imported from the generated client, like
 * `BOOKING_STATUSES`: the page's state table and the repository both need it,
 * and only one of them may depend on Prisma.
 *
 * **`OWNER` covers both an owner cancelling directly and an owner rejecting a
 * transfer receipt** — the owner is the actor in both. `CLIENT` belongs to C1
 * and nothing writes it yet. Telling the two apart is the entire reason this
 * column exists: `CANCELLED` alone cannot say whether a client walked away or a
 * shop cancelled on them, and those are opposite messages.
 */
export const CANCELLED_BY = ['OWNER', 'CLIENT'] as const;

export type CancelledBy = (typeof CANCELLED_BY)[number];

/**
 * The projection availability reads. Four columns, and deliberately not one
 * more: no client id, no cancellation token, no price, no deposit.
 */
export interface BlockingCandidate {
  readonly startTime: Date;
  readonly endTime: Date;
  readonly status: BookingStatus;
  readonly holdExpiresAt: Date | null;
}

/**
 * Whether this booking removes its time from sale.
 *
 * **This predicate has one home, and B4's transactional no-overlap check must
 * use this same function.** If the read side and the write side disagreed about
 * which bookings block, a client would be offered a time here and rejected
 * while paying for it — the worst place in the product to be told no.
 *
 * The expired-hold clause is the part that is easy to get wrong by omission.
 * `PENDING_PAYMENT` means a checkout is in flight, and `holdExpiresAt` is when
 * that claim lapses. B7 — the scheduled job that sweeps lapsed holds into
 * `EXPIRED` — ships four stories after this one, so until then a status-only
 * filter would let every abandoned checkout block its slot forever, with no
 * surface anywhere in the product that would explain it to the owner.
 *
 * `PENDING_APPROVAL` is never expired by `holdExpiresAt`: that column is the
 * deadline for *uploading* a receipt, not for *answering* one. Releasing the
 * slot underneath a transfer that the owner is about to approve would sell it
 * twice.
 *
 * **It does stop blocking once its own appointment has passed**, and that is
 * the only exit this status has which does not depend on the owner being
 * attentive. Nothing is sold twice by it — the time is unsellable by then —
 * and without it an unanswered receipt blocks a slot forever. The review
 * surface makes that rarer, not impossible: an owner on holiday blocks the
 * calendar exactly as an absent reviewer would.
 *
 * The comparison is inclusive of the start instant — the booking blocks while
 * `startTime >= now` — because "has passed" is false at the moment something
 * begins. This is the conservative direction: holding one instant too long
 * costs nothing, and releasing one instant too early would offer a time that
 * is being used right now. It is deliberately *not* the half-open rule the
 * interval boundaries follow, which answers a different question.
 *
 * `CONFIRMED` is deliberately *not* given the same treatment. A confirmed
 * appointment in the past is history rather than a hold, and nothing is
 * waiting on it.
 *
 * A null `holdExpiresAt` blocks. The column is optional, and reading its
 * absence as "expired long ago" would release a slot the instant a write set
 * the status without the deadline.
 */
export function blocksAvailability(booking: BlockingCandidate, now: Date): boolean {
  switch (booking.status) {
    case 'CONFIRMED':
      return true;

    case 'PENDING_APPROVAL':
      return booking.startTime.getTime() >= now.getTime();

    case 'PENDING_PAYMENT':
      // Half-open, like every other boundary here: the hold covers
      // [created, holdExpiresAt), so the expiry instant itself is past it.
      return booking.holdExpiresAt === null || booking.holdExpiresAt.getTime() > now.getTime();

    case 'CANCELLED':
    case 'EXPIRED':
      return false;
  }
}

/**
 * Whether the owner may still cancel this booking (C2).
 *
 * **One definition, three callers**, for the same reason `blocksAvailability`
 * has one: the row deciding whether to render a control, the service deciding
 * whether to attempt the write, and the write's own guard all need this answer,
 * and three copies of a status list is three chances for a control to appear
 * where the write refuses.
 *
 * `CANCELLED` and `EXPIRED` are terminal — there is nothing left to release.
 * The other three all occupy their slot in some way and are the whole point of
 * the feature.
 *
 * **It deliberately takes no instant.** A no-show is precisely a past
 * appointment the owner wants off the books, and the list this is offered from
 * is ordered by recency rather than by future-ness. Forbidding a past booking
 * would remove the most common real reason to reach for this control.
 *
 * A `switch` over the union rather than a set membership test, so a new status
 * forces a decision here instead of defaulting to "not cancellable" by silence.
 */
export function isCancellableByOwner(status: BookingStatus): boolean {
  switch (status) {
    case 'CONFIRMED':
    case 'PENDING_PAYMENT':
    case 'PENDING_APPROVAL':
      return true;

    case 'CANCELLED':
    case 'EXPIRED':
      return false;
  }
}

/**
 * Whether the **client** may still cancel this booking (C1).
 *
 * **Built on `blocksAvailability` rather than on a status list**, because that
 * predicate already answers this question: is this booking still holding its
 * time? A client cancels in order to give time back, so a booking holding none
 * has nothing to release. The paid-slot-lost case falls out for free — an
 * approved deposit against a hold that lapsed is a slot already gone, and
 * cancelling it would convert the client's bad luck into their own recorded
 * decision.
 *
 * **It takes an instant, and `isCancellableByOwner` deliberately does not.**
 * That asymmetry is the whole difference between the two rules. A no-show is
 * precisely the past appointment an owner wants off the books; for a client a
 * past slot cannot be released, so cancelling one would only record an
 * appointment that happened as cancelled — which D1's counter counts and D5's
 * statistics will report as churn. The comparison is strict: "has not started"
 * is false at the moment something begins.
 *
 * **`PENDING_APPROVAL` is excluded, and this is the one rule stricter than the
 * owner's.** There the client has already transferred real money and uploaded
 * proof of it, and a human owes them an answer. The review queue filters on the
 * *booking's* status, so a client cancellation would remove that receipt from
 * the only surface anybody would ever look at it on, leaving money in the
 * shop's account with no row in this product asserting that it arrived. The
 * page tells them to contact the shop instead, and the owner cancels with the
 * comprobante in front of them. The exclusion lifts when T74 records the
 * obligation this feature creates.
 *
 * **One definition, three callers** — the control that renders, the service
 * that attempts, and the write's cheap rejection — for the reason
 * `isCancellableByOwner` gives.
 */
export function isCancellableByClient(booking: BlockingCandidate, now: Date): boolean {
  if (booking.status === 'PENDING_APPROVAL') return false;
  if (!blocksAvailability(booking, now)) return false;
  return booking.startTime.getTime() > now.getTime();
}

/**
 * When a new provisional hold lapses: the creation instant plus
 * `HOLD_DURATION_MINUTES`, **clamped so it never exceeds `startTime`**.
 *
 * The clamp is correctness, not a preference. An unclamped hold on a
 * near-term appointment would lapse *after* the appointment has already
 * begun, and B7 — once it exists — would expire a booking whose time has
 * passed. `MIN_BOOKING_LEAD_MINUTES` makes that case unreachable today only
 * because it is itself a guess a real shop is likely to have lowered before
 * this clamp is ever exercised, which is exactly why it is written into the
 * rule rather than relied on as a side effect of another constant.
 */
export function holdExpiresAtFor(input: { createdAt: Date; startTime: Date }): Date {
  return holdDeadline(input.createdAt, HOLD_DURATION_MINUTES, input.startTime);
}

/**
 * When a hold lapses once the client has committed to paying by bank transfer:
 * the commitment instant plus `TRANSFER_HOLD_DURATION_MINUTES`, **under the
 * same clamp**.
 *
 * The extension exists because 15 minutes was sized for a hosted checkout and
 * a bank transfer is not one. It is applied at commitment rather than at
 * creation so that a Mercado Pago client never holds a slot three times longer
 * than they need — and because making it a write is what allows the destination
 * to be withheld until it succeeds. A CBU shown during a window that is about
 * to lapse is how a client ends up having transferred real money that no row
 * here records.
 *
 * It shares `holdDeadline` with the creation write rather than restating the
 * clamp. At three times the duration this clamp is materially closer to being
 * reached, so two copies of the rule would be two chances to get it wrong.
 */
export function transferHoldExpiresAtFor(input: { committedAt: Date; startTime: Date }): Date {
  return holdDeadline(input.committedAt, TRANSFER_HOLD_DURATION_MINUTES, input.startTime);
}

/**
 * The instant a lapsed hold must predate before the sweeper may expire it:
 * `now` less `EXPIRY_GRACE_MINUTES`.
 *
 * A `PENDING_PAYMENT` booking is sweepable when `holdExpiresAt < cutoff` —
 * **strictly**, so a hold sitting exactly on the cutoff survives one more run.
 * That is the same conservative direction `blocksAvailability` takes at the
 * start instant: waiting one cycle longer costs nothing, and expiring one
 * instant too early costs a client their paid appointment.
 *
 * The arithmetic lives here rather than at the sweeper's call site for the
 * reason the deadline rules above give: this is a number the write side and the
 * query bound must agree on, and two expressions of it are two chances to
 * disagree. `bookingHorizon.ts` records what the grace protects and why it is
 * free.
 *
 * It is **not** applied to `PENDING_APPROVAL`, which is swept on its own
 * `startTime` and has no gateway whose confirmation could still be in flight.
 */
export function holdSweepCutoff(now: Date): Date {
  return new Date(now.getTime() - EXPIRY_GRACE_MINUTES * 60_000);
}

/**
 * The clamp, in one place.
 *
 * Every write that sets or moves `holdExpiresAt` goes through here. A hold must
 * never be scheduled to lapse after the appointment it holds has already begun:
 * the sweeper would then expire a booking whose time has passed, and the
 * confirmation page would count down to a deadline that means nothing.
 */
function holdDeadline(from: Date, durationMinutes: number, startTime: Date): Date {
  const unclamped = new Date(from.getTime() + durationMinutes * 60_000);
  return unclamped.getTime() > startTime.getTime() ? startTime : unclamped;
}

/**
 * How a booking appears on the owner's calendar (D3).
 *
 * The five values a day's entry can take. `CANCELLED_BY` is declared the same
 * way and for the same reason: the page, the pure day composition and the tests
 * all need the set, and none of them may depend on Prisma.
 */
export const CALENDAR_PRESENCES = [
  'confirmed',
  'awaitingApproval',
  'holding',
  'lapsed',
  'cancelled',
] as const;

export type CalendarPresence = (typeof CALENDAR_PRESENCES)[number];

/**
 * The three that occupy the day's timeline. The other two are recorded beside
 * it, because a cancelled booking and the one that replaced it share a time and
 * drawing both in one lane makes the timeline say the barber is in two places.
 */
export const OCCUPYING_PRESENCES = ['confirmed', 'awaitingApproval', 'holding'] as const;

export function occupiesCalendar(presence: CalendarPresence): boolean {
  return (OCCUPYING_PRESENCES as readonly CalendarPresence[]).includes(presence);
}

/**
 * How this booking appears on a given day of the owner's calendar.
 *
 * ---
 *
 * **This is a second predicate over the same union as `blocksAvailability`, and
 * it must stay one.** That is the opposite of what this project usually does —
 * the blocking rule has exactly one home precisely so the read side and the
 * write side cannot disagree about which bookings hold a slot — so the reason
 * is written here rather than left for a reader to reconstruct.
 *
 * The two answer different questions:
 *
 * - `blocksAvailability` asks **"is this time still on sale, now?"** It is
 *   shared with B4's transaction under its advisory lock, with B5's late
 *   confirmation and with D2's approval. Being wrong there sells a slot twice.
 * - This asks **"what was real on this day?"** It is shared with nothing, and
 *   being wrong here draws a day that did not happen.
 *
 * They diverge on any past date, and `PENDING_APPROVAL` is where. The blocking
 * rule stops blocking it once the appointment has started — correctly: nothing
 * can be sold into a time that is being used, and without that clause an
 * unanswered receipt would hold a slot forever. Reuse it here and yesterday's
 * appointment, whose comprobante the shop never got round to answering and
 * whose client may well have been served, is filed under "no effect".
 *
 * So this one is **clock-independent for `PENDING_APPROVAL`**: an unanswered
 * receipt is a fact about the shop's queue, not about the hour. It is the first
 * surface in the product that shows the owner one at all (T64).
 *
 * The clock is consulted for exactly one case — the live/lapsed hold boundary —
 * and on the same half-open convention as everything else here: the hold covers
 * `[created, holdExpiresAt)`, so the deadline instant is already past it. A null
 * deadline holds, mirroring the blocking rule, because reading its absence as
 * "expired long ago" would erase a booking the instant a write set the status
 * without it.
 *
 * A `switch` over the union rather than a lookup, so a sixth status forces a
 * decision here instead of defaulting to invisible by silence.
 *
 * **The one direction in which the two rules may not differ** is asserted by
 * test: anything `blocksAvailability` still blocks must occupy the calendar, or
 * the owner would be shown free time no client can buy.
 */
export function calendarPresence(booking: BlockingCandidate, now: Date): CalendarPresence {
  switch (booking.status) {
    case 'CONFIRMED':
      return 'confirmed';

    case 'PENDING_APPROVAL':
      return 'awaitingApproval';

    case 'PENDING_PAYMENT':
      return booking.holdExpiresAt === null || booking.holdExpiresAt.getTime() > now.getTime()
        ? 'holding'
        : 'lapsed';

    case 'EXPIRED':
      return 'lapsed';

    case 'CANCELLED':
      return 'cancelled';
  }
}
