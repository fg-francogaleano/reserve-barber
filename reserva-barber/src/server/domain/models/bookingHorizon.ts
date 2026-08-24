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

/**
 * How long a provisional hold lasts before it is eligible to be swept.
 *
 * Another judgement, not a measurement — comfortable for a Mercado Pago
 * checkout, tight but workable for locating a bank transfer destination.
 *
 * B7, which sweeps expired holds, has not shipped yet, so nothing enforces
 * this deadline by itself. Its only present-day effect is what
 * `blocksAvailability` (`Booking.ts`) reads it against: an expired
 * `PENDING_PAYMENT` hold stops blocking a slot, which is the mechanism that
 * makes an abandoned checkout's time sellable again before B7 exists.
 *
 * `Booking.holdExpiresAtFor()` clamps this against the appointment's own
 * `startTime` — a hold must never be scheduled to lapse after the
 * appointment it holds has already begun. `MIN_BOOKING_LEAD_MINUTES` makes
 * that clamp unreachable today only because it is itself a guess likely to be
 * lowered, so the clamp is written into the rule rather than relied upon as
 * an emergent property of another constant.
 */
export const HOLD_DURATION_MINUTES = 15;

/**
 * How long a hold lasts once the client has committed to paying by bank
 * transfer.
 *
 * A fourth judgement of the same kind as the three above, and the one with the
 * sharpest failure. Fifteen minutes was sized for a hosted checkout; a transfer
 * means authenticating into a banking app, registering a destination — which
 * several Argentine banks gate behind their own confirmation step — making the
 * transfer, capturing the screen and coming back to upload. A hold that lapses
 * in the middle of that leaves the client's money gone and **no row in this
 * system recording that anyone paid**, because unlike the Mercado Pago path
 * there is no gateway to ask afterwards.
 *
 * The extension is applied at the moment the client commits, not at creation,
 * so a Mercado Pago client never holds a slot three times longer than they
 * need. It is also why the destination is not disclosed until that write
 * succeeds: a CBU must never be visible during a window that is about to lapse.
 *
 * **45 rather than 60**, deliberately: `MIN_BOOKING_LEAD_MINUTES` is 60, so a
 * 60-minute hold would sit exactly on `holdExpiresAtFor`'s clamp for the
 * nearest bookable appointment — and `tech-debt.md` T53 records that the lead
 * time is the first of these constants a real shop is likely to ask to lower,
 * at which point that clamp stops being theoretical.
 *
 * T53 names B6 as the story that could finally *measure* one of these. It
 * cannot: no real shop has used the product. What it delivers instead is the
 * constant, its home beside the other three, and this note.
 */
export const TRANSFER_HOLD_DURATION_MINUTES = 45;

/**
 * How long after a hold has lapsed the sweeper waits before expiring the row.
 *
 * The fifth judgement of the same kind as the four above, and the only one that
 * exists to protect another path rather than to size a client's patience.
 *
 * **What it protects.** A Mercado Pago approval that arrives after the hold
 * lapsed still confirms the booking when nobody took the slot — that is B5's
 * late-payment guarantee, and `PrismaPaymentRepository.confirmIfSlotFree`
 * implements it with an update **guarded on the booking still being
 * `PENDING_PAYMENT`**. Expire the row at the instant its hold lapses and that
 * same notification takes the `notPending` branch instead: the charge stands,
 * the appointment does not, and a human arranges a refund. Preference expiry is
 * set to `holdExpiresAt`, so Mercado Pago refuses an attempt *begun* after the
 * deadline — it does nothing about one begun thirty seconds before it and
 * approved a minute after.
 *
 * **Why it costs nothing.** Availability stopped counting the booking when the
 * hold lapsed, ten minutes earlier. Nobody is denied the slot during the grace;
 * the only thing still holding is a row nobody can see.
 *
 * It is not applied to `PENDING_APPROVAL`, which is swept on its own
 * `startTime`: the grace exists for an in-flight gateway confirmation, and that
 * path has no gateway. The only thing that could still confirm such a booking
 * is a human, whose answer the passing of the appointment already made
 * worthless.
 *
 * Ten minutes is a guess, like the others, and it is the one with the clearest
 * path to being measured: the delivery latency of real notifications, once a
 * real shop has produced some.
 */
export const EXPIRY_GRACE_MINUTES = 10;
