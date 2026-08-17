## Why

B2 leaves the client holding a branch, a service and a barber, and nothing to do with them. The flow stops one step short of a time, which is the only selection that makes a booking a booking.

Everything that decides a time already exists and has never been read together: M5a stores the recurring week, M5b stores the absences, M3 stores the duration that sizes an appointment. B3 is the story that composes them into the answer a client actually needs — *when can this person cut my hair* — and it is the last selection before B4 writes a row.

The composition is also where this project's most dangerous class of bug lives. `data-model.md` records that the deployment runtime is UTC while the business is at UTC−3, so `getDay()`, `getHours()`, `getDate()` and `toISOString().slice(0, 10)` return a **plausible wrong answer** for the last three hours of every local day, and return it silently. B3 is the first story whose output is entirely made of that arithmetic.

## What Changes

### The flow grows two steps

- A **date step** listing selectable days from today to a bounded horizon, with days the barber does not work marked as unavailable rather than omitted — the client needs to see that Sundays are closed, not wonder why a date vanished.
- A **slot step** listing the start times that barber can actually take on the chosen date, in es-AR `HH:mm`.
- Two new query parameters, `?fecha` and `?hora`, carried the same way `?local`, `?servicio` and `?barbero` already are: server-rendered, shareable, operable before hydration, and degrading rather than 404ing when stale.
- The step indicator and the selection summary absorb a flow of five steps (four when B2's single-branch skip applies). The step count is computed, never a literal.
- The final call to action **ships inert with a Spanish disclosure**, as B1 did for "Reservar" and B2 inherited. B4 owns the route it will point at.

### Availability becomes a domain rule

- A pure slot generator: working windows for the business-local weekday, minus absences, minus blocking bookings, emitting candidate starts every `SLOT_GRANULARITY_MINUTES` (5) from the beginning of **each free interval**, keeping those whose `[start, start + duration)` fits entirely inside one window.
- The generator consumes **N windows per day, not one**. `tech-debt.md` T27 names this story: *"B3 must not ship assuming a single window is sufficient."* The schema already permits a split shift; the editor writing one window today does not license the generator to assume it.
- Two new bounds, `MAX_BOOKING_HORIZON_DAYS` and `MIN_BOOKING_LEAD_MINUTES`, without which `?fecha` is an unbounded crawl space on a route with neither a cache nor a rate limit, and a client can book a slot two minutes out.

### The booking tables are created

- **New**: `BookingStatus`, `CancelledBy`, `Client`, `Booking`. `Booking.clientId` is a required FK, so `Client` is not optional scope — it comes with the table.
- B3 writes the **read side only**. No route and no action in this change inserts a `Booking` or a `Client` row; the sole writer is the verification script.
- The migration materializes what `data-model.md` §10 and §11 already define. No data-model change is proposed here.

### One deliberate consequence, named rather than discovered

A `PENDING_PAYMENT` booking whose `holdExpiresAt` has passed **does not block**. B7 — the job that expires abandoned holds — ships four stories later, so a status-only filter would let every abandoned checkout remove a slot from sale permanently, with no owner-visible cause.

## Capabilities

### New Capabilities
- `booking-availability`: the date and slot steps, the slot generation rule, the bounds on how far ahead and how soon a client may book, and what an unavailable time is allowed to disclose.

### Modified Capabilities
- `booking-selection`: the flow becomes five steps; `?fecha` and `?hora` join the selection carried in the query string, obeying the existing stale-link, no-oracle and downstream-discard rules; the inert call to action moves from the barber step to the end of the flow.
- `data-persistence`: `Client` and `Booking` as sources of truth — zone-aware instants, explicit monetary precision, `Restrict` on every booking foreign key, and the indexed, owner-scoped read of blocking bookings for a barber over a range.

## Impact

**Database** — one additive migration: two enums, two tables, four FKs, three indexes. No backfill, no change to an existing column, no lockable write. If this change were abandoned mid-flight it would leave two empty tables with no readers.

**New code** — `src/server/domain/models/availability.ts` (pure), `bookingHorizon.ts`, `IBookingRepository` + its Prisma implementation, `PublicAvailabilityService`, `DateStep.tsx`, `SlotStep.tsx`, `scripts/b3-gate.ts`.

**Changed code** — `prisma/schema.prisma`, `bookingSelectionParams.ts`, the booking route and its composition root, `BookingStepIndicator`, `BookingSelectionSummary`, `src/lib/copy.ts`.

**Unchanged by contract** — the route still reads no `PaymentConfig`, constructs no cipher and no Supabase client (B1/B2), still declares no `loading.tsx` above the slug resolution (B1 measured that it degrades `notFound()` to a soft 404 on this runtime), and still disables router prefetch on every public-flow link (B2 measured one speculative catalogue read per link in the viewport).

**Tech debt this change must answer** — T27 (split shift; this story is its named trigger), T28 (the "1440 minutes" assumption gains a third consumer), T29 (retroactive schedule edits now strand real bookings), T33 (this story is its named trigger), T47 (the public read cost grows again and must be re-measured), T51 (~484 KiB of headroom against the Worker size ceiling, and `--dry-run` is proven unreliable as a gate).

**Accepted product consequence of the 5-minute grid** — maximum bookable surface, at the cost of a dense list (103 starts for a 9:00–18:00 day and a 30-minute service) and a day that fragments into unsellable 5-to-25-minute gaps. Presentation is therefore a requirement of this change, not a detail, and the 360px test runs against the dense case.
