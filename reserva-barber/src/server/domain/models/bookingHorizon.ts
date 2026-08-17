/**
 * How far ahead a client may book, and how soon.
 *
 * Both are **judgements, not measurements** — no real shop has used this
 * product yet, and these are the first two numbers to revisit when one does.
 * They live here rather than at their call sites because each is load-bearing
 * for a reason that is not obvious where it is consumed.
 *
 * They sit beside `slotGranularity.ts` because the three constants together are
 * the definition of what a bookable time is: the grid it sits on, the earliest
 * it can be, and the latest.
 */

/**
 * The last day the date step offers, counted from today in business local time.
 *
 * The bound exists for two independent reasons and would be needed for either
 * alone:
 *
 * - **Product.** A barber's schedule two years out is a guess. Offering it
 *   invites a booking nobody will honour.
 * - **Cost.** `?fecha` is supplied by a stranger on a route that has neither a
 *   cache nor a rate limit (`docs/tech-debt.md` T47), and each distinct value
 *   costs a full availability read against a pool shared with the owner's
 *   dashboard. Unbounded, it is an open-ended parameter space for anyone
 *   willing to sweep it.
 */
export const MAX_BOOKING_HORIZON_DAYS = 60;

/**
 * The minimum notice between now and the start of an appointment.
 *
 * Without it a client books a slot two minutes out and the barber finds out by
 * email — the one failure in this flow that lands entirely on someone who was
 * not part of it.
 *
 * One hour is the conservative end of the plausible range. A shop that wants to
 * take walk-in-shaped bookings will want less, and that is a per-owner setting
 * this version does not model.
 */
export const MIN_BOOKING_LEAD_MINUTES = 60;
