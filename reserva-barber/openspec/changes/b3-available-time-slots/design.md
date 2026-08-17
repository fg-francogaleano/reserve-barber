## Context

Three stories stored the inputs and none of them read together. M5a stores a recurring week as **wall-clock minutes from midnight**, never converted at rest. M5b stores absences as **UTC instants** in a half-open range. M3 stores the duration that sizes an appointment. B2 hands over a `(location, service, barber)` triple and carries `durationMinutes` in its catalogue projection specifically so this story would not have to re-issue that query.

Four constraints are inherited and non-negotiable, each measured on the deployment runtime rather than assumed:

- **The runtime is UTC and the business is UTC−3.** `getDay()`, `getHours()`, `getDate()` and `toISOString().slice(0, 10)` return a plausible wrong answer for the last three hours of every local day, and return it without raising. `businessTime.ts` exists to be the only place any conversion happens.
- **No `loading.tsx` above the slug resolution.** B1 measured that a boundary makes Next commit `200 OK` before the page resolves, degrading `notFound()` to a soft 404 and `permanentRedirect()` to a meta refresh — which WhatsApp, the product's distribution channel, does not follow. Raising the outcome in `generateMetadata` was built and measured and does not work on this runtime.
- **No prefetch on public-flow links.** B2 measured one speculative full-catalogue read per `<Link>` entering the viewport.
- **~484 KiB of Worker headroom** against a 3 MiB ceiling, with `wrangler deploy --dry-run` proven unable to say "this will fit".

Two decisions were taken by the owner before this document and are recorded here as inputs, not as findings: the slot grid is **5 minutes**, and this change carries the **`Booking` migration**.

## Goals / Non-Goals

**Goals:**

- Compute, for a `(barber, service, local date)`, exactly the start times that can be honoured — working hours minus absences minus blocking bookings, sized by the service duration.
- Make the composition testable without a database: the rule is a pure function over intervals.
- Create the booking tables correctly the first time, since the columns that carry instants and money are the ones that cannot be fixed cheaply later.
- Keep every property B1 and B2 established on this route: no payment configuration read, no soft 404, no prefetch, no owner id in the payload, no oracle in the responses.

**Non-Goals:**

- Writing a booking. Nothing here holds a slot; the truth is B4's transaction.
- Expiring stale holds. That is B7. This change works around their absence, it does not solve it.
- "Any available barber" as a selection. The step order is fixed at `location → service → barber → date → time`.
- Business-wide holidays, per-barber lead-time overrides, and the split-shift **editor** (this change makes the *generator* correct for N windows; the UI that writes a second window stays with T27).

## Decisions

### D1 — Candidate starts every 5 minutes, anchored at the start of each free interval

**Owner's decision.** From the beginning of each free interval, emit a candidate every `SLOT_GRANULARITY_MINUTES` (5) and keep it when `[start, start + duration)` fits entirely inside one working window and overlaps no absence and no blocking booking.

*Alternative considered and rejected:* stepping by `durationMinutes`. It would have produced 18 starts instead of 103 for a 9:00–18:00 day and a 30-minute service, but it forfeits bookable surface: a 30-minute cancellation reopens six possible starts under the 5-minute grid and one under duration-stepping.

Two consequences are accepted and become requirements rather than surprises:

- **Density.** 103 starts is the ordinary case, not the stress case. Presentation is part of this change (see D11).
- **Fragmentation.** A client booking 9:05 leaves an unsellable 5-minute gap. The day fragments more than it would under packing. This is the cost of the surface gained, it is a property of the decision, and it is not a defect for B3 to correct.

The grid constant already lives in `slotGranularity.ts`, whose comment reserved it for exactly this: *"slot generation (story B3) and booking sizing (story B5) consume the same definition."*

### D2 — The generator is pure, and `now` is an argument

`generateSlots` takes windows, absences, bookings, duration, a horizon bound and the current instant, and returns start instants. No I/O, no `Date.now()`, no repository, no clock singleton.

The alternative — reading the clock inside — makes "the last slot of today" untestable without freezing global time, and this rule has more boundary cases than any other in the project. `IClock` already exists as the injected port.

### D3 — The generator consumes N windows per day

T27 names this story: *"B3 must not ship assuming a single window is sufficient."* The schema's unique key is `(barberId, dayOfWeek, startMinute)` precisely so a split shift needs a UI change and not a migration. The generator therefore takes a **list** of windows for the weekday and treats each independently.

A service must fit inside **one** window: with 9–13 and 16–20 stored, a 60-minute service is not offered at 12:30. Allowing a slot to span two windows would sell an appointment across the break the windows exist to express.

This does not close T27 — the editor still writes one window per day — but it means the defect T27 describes stops being *created* here.

### D4 — An expired hold does not block

The blocking set is `status IN (PENDING_PAYMENT, PENDING_APPROVAL, CONFIRMED)` **minus** rows where `status = PENDING_PAYMENT AND holdExpiresAt < now`.

B7 ships four stories later. Without this clause, every abandoned checkout removes a slot from sale permanently, and the owner has no surface anywhere in the product that would show them why. The predicate is written once, documented as shared, and B4's transaction must use the identical one — a disagreement between the two shows up as a client who is offered a slot and then rejected while paying, which is the worst place in the product to be told no.

`PENDING_APPROVAL` is never expired by this rule: a receipt has been uploaded and a human owes an answer.

### D5 — This change creates `Client` and `Booking`, and writes neither

`Booking.clientId` is a required FK, so `Client` arrives with it; `Payment` and `TransferReceipt` do not, because those FKs live on the child side.

*Alternative considered and rejected:* a port with a stub returning `[]`, leaving the migration to B4. It keeps this change smaller, but the booking subtraction — the only genuinely new fact B3 introduces — would be the one part of it that nothing verifies, and B4 would return to re-open this change's composition root and spec.

The precedent is `PaymentConfig`, whose schema comment records the same reasoning for the same reason: *"A single-row entity assembled across three migrations is three chances for the three stories to disagree about its shape."*

The cost is stated plainly: this change creates a table it never reads (`Client`) and ten columns it never touches. What it buys is that the four decisions below are made by the story that reads them, and that B4 — the concurrency-critical story — arrives to a table, an index and a foreign-key policy that already exist.

### D6 — Four choices in the schema that are expensive to change later

- **`@db.Timestamptz(3)` on `startTime`, `endTime`, `holdExpiresAt`, `cancelledAt`.** `data-model.md` names inheriting Prisma's zone-less default *"the failure mode this convention exists to prevent"*. `TimeOff` already does this; `createdAt`/`updatedAt` stay `TIMESTAMP(3)` as everywhere else.
- **`Decimal(12, 2)` on `priceAtBooking` and `depositAmount`**, never Prisma's `Decimal(65,30)` — the same declaration `Service.price` carries, and the same reason: the column is deliberately wider than the application maximum so a numeric overflow is unreachable by construction. Both cross the repository boundary as canonical strings through the helper PC3 extracted, because the driver returns a stored `2000.50` as `2000.5`.
- **`onDelete: Restrict` on all four booking foreign keys** (`Booking → Client/Barber/Service`, `Client → Owner`). Same criterion as `Barber → Location` and opposite to `BarberService`: a booking carries data of its own — money, and a cancellation token that has travelled by email — that must not vanish because a parent row was removed.
- **`@@index([barberId, startTime])`**, which serves this change's range read and B4's transactional overlap check. A partial index on the blocking statuses was considered and rejected as premature: it optimizes a predicate whose shape D4 may still refine when B7 lands.

### D7 — One composed read, not five round trips

B2 measured ~0.35–0.40 s per Supavisor round trip and 2 queries / ~0.97 s for the current booking route. Adding the week, the absences and the bookings sequentially would make the slot step **five round trips, ≈1.9 s**, on a phone, on the route that earns the business money.

A single repository method returns all three sets in one round trip with an explicit projection, mirroring `findBookableCatalog`. B2 proved a three-level nested join resolves in one trip on this runtime.

The absences come back through the projection that **omits `reason`** — M5b confined that field structurally because it can hold medical information, and this is precisely the consumer it was confined against.

The number goes into T47's table, measured on `workerd` against the live database.

### D8 — The date step marks non-working days, and does not compute availability for the horizon

A day is rendered unavailable when the barber has **no working window** for that weekday. That is free: the week is seven rows already loaded.

A day that has a window but is entirely absent or entirely booked still renders as selectable and resolves to the slot step's empty state. Computing true availability for every day in the horizon would be one full availability computation per day — 60 of them — on the route with neither a cache nor a rate limit (T47).

*This is a deliberate lie of omission and it is written into the spec rather than left for someone to notice.* The alternative was silently offering fewer horizon days, which costs more and hides more.

### D9 — An unavailable time is absent, never labelled

The slot list contains only available starts. Nothing renders "ocupado", and nothing distinguishes booked from absent from outside-working-hours.

Rendering unavailable times publishes a private person's agenda density and the shape of their absences to any anonymous visitor with the link — the same reasoning that made M5b hide `reason` structurally, applied one layer out. The client also cannot act on the difference.

### D10 — Fail closed, twice

- **A failed bookings read never degrades to "everything is free."** Rendering slots computed from an empty booking set sells appointments that do not exist and takes a deposit for them. Any failure in the availability read renders the client-toned Spanish error boundary with retry.
- **`hasTimezoneSupport()` gates the route.** A runtime without tz data does not throw — it silently reports UTC, shifting every slot by three hours with nothing to notice. The probe already exists for this and is asserted at the composition root.

### D11 — Density is absorbed by grouping, not by shrinking the list

103 chips in one flat column is a scroll with no landmarks. The slot step groups starts into **mañana / tarde / noche** with headings, rendering each group as a wrapping grid of time chips.

Grouping is presentation only — the generator's output is unchanged, and the boundaries are constants in the copy module rather than business rules. The 360px test runs against the dense case (a 5-minute service across a 9-hour window), not a comfortable one.

### D12 — The last step ships inert

Choosing a time completes the selection and presents a disclosed, non-actionable confirmation. B1 did this for "Reservar" when `/b/{slug}` did not exist, and B2 inherited it. Linking to a route that redirects to `/login` is worse than saying so.

### D13 — No date library, no date picker

`businessTime.ts` already does every calculation this change needs. A picker component or a date library is the most likely single thing to consume the remaining Worker headroom (T51), and a JS picker would also break the pre-hydration requirement: the date strip is server-rendered links, like every other step in this flow.

### D14 — `?hora` is matched, never parsed into a time

`?fecha` is validated as a canonical `YYYY-MM-DD` naming a real calendar date inside `[today_local, today_local + horizon]`. `?hora` is only ever compared against the generated list for that date. A time that is syntactically absurd and a time that was booked ten minutes ago therefore produce byte-identical responses — B2's no-oracle rule, extended.

Both degrade the way B2 established: the owning step re-renders with a Spanish notice, upstream selections survive, nothing is substituted, and it is never a 404. Changing an upstream selection discards `fecha` and `hora` with everything else downstream.

### D15 — `scripts/b3-gate.ts` is the only writer

No route and no action in this change inserts a `Booking` or `Client` row. The verification script seeds the cases no UI can produce before B4 exists — most importantly the expired hold of D4 — and is the vehicle for the runtime verification this project runs on every story. It follows the existing `m5a-gate.ts` / `pc2-gate.ts` pattern and cleans up after itself.

## Risks / Trade-offs

**A `getDay()` or `toISOString().slice(0,10)` slips into the new code** → wrong weekday for three hours every evening, silently, for clients only. Mitigation: every date operation routes through `businessTime.ts`; a lint-visible test asserts weekday resolution at 23:00 local; the gate script is run in that window at least once.

**The 5-minute grid makes the slot step unusable on a phone** → D11 groups by daypart, and the 360px test uses the dense case. If it still fails in the browser, that is a finding for this change, not debt to file.

**Adding two Prisma models grows the Worker past the ceiling** → measured before deploying, not assumed; `--dry-run` is not accepted as evidence (T51). If it does not fit, the fallback is Workers Paid, not shrinking this change.

**The composed read is slower than four separate ones under the pooler** → measured on `workerd` against the live database and recorded in T47's table either way. If the join loses, splitting it is a repository-internal change with no spec consequence.

**A cancellation in another tab makes the rendered list stale within seconds** → inherent; nothing is held until B4. Mitigated by copy that never implies the slot is reserved, and by B4 re-validating inside its transaction rather than trusting the URL.

**The horizon bound is a guess** → 60 days is a judgement, not a measurement, and it is the first thing to revisit when a real shop uses this. It is a constant in one module for that reason.

**D8's selectable-but-empty day looks like a bug to a client** → the empty state says so in Spanish and offers the way back, and the trade-off is written in the spec so a future reader does not "fix" it into 60 availability computations.

## Migration Plan

One additive migration: `CREATE TYPE BookingStatus`, `CREATE TYPE CancelledBy`, `CREATE TABLE Client`, `CREATE TABLE Booking`, three indexes, four foreign keys. No backfill, no alteration of an existing column, no lock on a table anything reads.

Sequence: branch from an updated `main` first — the database is shared, and a stale branch makes `prisma migrate dev` propose a `migrate reset`. Generate the migration, review the SQL by hand against D6 (the four properties there are exactly what a generated migration gets wrong when the schema annotation is missing), apply, regenerate both Prisma clients.

**Rollback** is trivial and that is a deliberate property of doing it this way: two tables with no readers outside this change and no rows written by the application. Abandoning the change leaves them empty and inert.

**Deploy order** is unchanged from every previous story: migration first, then the Worker.
