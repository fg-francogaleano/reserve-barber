## Why

B3 leaves the client holding a complete selection and an inert button. Every step of the flow now works and none of them writes anything: the last screen says so out loud, because two clients can be looking at the same 15:00 and neither of them has it.

B4 is where the product starts existing. It is also the first story in this project to accept a write from a stranger, and that changes the shape of every rule around it. Until now the public surface was a read: a bad request cost a query. From here a bad request costs a slot — and slots are the only inventory this business has.

Three things converge here and none of them can be deferred to the story after:

- **The no-overlap invariant.** `backend-standards.md` states it as the first Booking rule and the roadmap names B4 the concurrency-critical story: B5, B6, B7 and D2 all assume holds work, and none may start until this transaction is proven under concurrent requests. An application-level read-then-write is explicitly insufficient.
- **The rule that must not fork.** B3 wrote `blocksAvailability` once and documented it as the rule B4's transaction must reuse. If the write side re-expresses it in SQL, the product offers a client a time and then rejects them while they are paying — the worst place in the flow to be told no.
- **The abuse surface.** A 5-minute grid over a 60-day horizon is roughly six thousand start times per barber, and B7 — the job that sweeps abandoned holds — is three stories away. A public write with no bound is a shop's entire calendar, takeable by one script, with nothing in the dashboard that would explain it.

## What Changes

### The flow grows its sixth step and stops being inert

- A **client-details step** (`datos`) after the time: name, email and phone, in the house form pattern — native `<form>`, uncontrolled inputs, one Zod schema on the server, `required` and nothing else (no `min`, `max`, `step` or `pattern`, whose browser-locale messages would replace the validation this spec describes).
- The inert call to action B1 shipped and B2 and B3 inherited is **retired**. The disclosure it carried moves to a place where it is finally true: a hold-confirmation page that says the slot is held and that payment is not available yet.
- The selection reaches the write as hidden inputs and **every one of them is re-verified server-side**. `hora` is matched against a freshly generated slot list and never parsed as an instant, exactly as the read side does it.

### The public surface accepts its first write

- **`POST /api/bookings`**, a Route Handler — `backend-standards.md` makes this a hard rule for the public flow rather than a preference, because a Server Action is addressed by a build-time id and a guest halfway through paying a deposit is precisely the person who must never meet a dead action.
- **The route guard gains exactly one named path.** `decideGuardAction` is deny-by-default with a public set of `/login` and `/b/**`, so an anonymous POST to `/api/bookings` is answered `307 → /login`. The flow would be broken for every guest and no existing test would notice. One explicit entry, with its own executable test; the default and the matcher are untouched. B5's Mercado Pago webhook needs the same door, which is why it is opened once, here, deliberately.
- **The no-JavaScript promise is kept natively.** The handler answers `303` and the page renders its error from the URL. T44's PC3 decision — `permalink` plus `useActionState` — cannot be executed by a Route Handler at all; this change re-decides it and leaves the dashboard's ten forms with a corrected trigger.

### The hold

- A `Booking` is created `PENDING_PAYMENT` with `holdExpiresAt = min(now + HOLD_DURATION_MINUTES, startTime)`. The clamp is correctness, not preference: a hold that outlives the appointment start is a booking B7 would expire after it had already begun.
- `HOLD_DURATION_MINUTES` is **15**, a judgement and not a measurement, recorded as such beside the other two judgement constants and absorbed into T53.
- The insert runs inside one interactive transaction that takes a **per-barber advisory lock**, re-reads the day, applies `blocksAvailability` — the same function, not a copy — re-asserts the time is inside a working window and outside every absence, and only then writes.
- **A `Client` is deduplicated by `(ownerId, email)`**, with the address lowercased before persistence because the unique index compares raw bytes. A returning client's name and phone overwrite what is stored: the owner needs the number that answers today.
- `depositAmount` and `priceAtBooking` are snapshotted through the one authoritative `DepositPolicy` rule, and never recomputed in any later status.
- `cancellationToken` is generated here and becomes the credential for the confirmation page, which serves `Referrer-Policy: no-referrer` so that B5's redirect to Mercado Pago cannot carry it away in a header.

### The gate that B2 deliberately left standing

The payment-readiness rule — at least one configured payment method **and** a deposit policy — has been written since PC3 and enforced nowhere. B2 recorded the accepted consequence in its own spec: a client can finish every step at a shop with no deposit configured and meet the wall at B4. This is that wall. It is enforced twice, at the render of the details step and inside the handler, and the read that answers it uses a projection that **cannot carry the Mercado Pago access token** — the guarantee B1, B2 and B3 held by constructing no `PaymentConfig` repository at all is preserved here by a type instead, because this is the story that must finally ask the question.

### Two consequences named rather than discovered

- **A double submit is not a conflict.** Without a rule for it, a client who double-taps is told their own hold belongs to somebody else — the one error message in this flow delivered exclusively to people who succeeded. When the blocking booking is the same client's own hold for the same slot, it is returned rather than refused.
- **Holds are bounded per client and per address.** Not polish: with a 15-minute hold, no cap and no sweeper, one visitor can hold a barber's whole horizon and re-take each slot as it lapses.

## Capabilities

### New Capabilities
- `booking-creation`: the client-details step, the public write endpoint and how it is reached, the transactional no-overlap hold, client deduplication, the deposit and price snapshots, the cancellation token and the confirmation page it authorizes, the payment-readiness gate at the entry to the write, and the bounds that keep a public write from becoming a calendar lock.

### Modified Capabilities
- `booking-selection`: the flow becomes six steps; the completed selection ends in a form rather than a disclosed inert control; and the route's absolute prohibition on reading `PaymentConfig` narrows to what it was always protecting — no credential, no cipher, no token — so the readiness projection can be read where the gate is enforced.
- `booking-availability`: choosing a time still reserves nothing, but the clause forbidding any route or action from writing a `Booking` or `Client` row lifts; and the shared blocking predicate acquires the second caller it was written for.
- `data-persistence`: `Client` and `Booking` gain their first writer — email normalization before the unique index, the dedup upsert and its race, the hold invariants, and the advisory-locked transaction that is the no-overlap guarantee.
- `owner-authentication`: the deny-by-default public set gains exactly one explicitly named path, proven by test rather than by reading the matcher.

## Impact

**Database** — **no migration.** B3 carried the enums, both tables, the `(barberId, startTime)` index and the `PENDING_PAYMENT ⇒ holdExpiresAt IS NOT NULL` check constraint precisely so this story would not need one. `hashtextextended` is a built-in on PostgreSQL 11+ and needs no extension; its availability on the instance is verified by the gate script rather than assumed.

**New code** — `app/api/bookings/route.ts`, `app/b/[slug]/reserva/[token]/page.tsx`, `ClientDetailsStep.tsx`, `bookingRequestSchema.ts`, `BookingCreationService`, `IBookingRepository` / `IClientRepository` and their Prisma implementations, `domain/models/phone.ts`, `errors/BookingErrors.ts`, `scripts/b4-gate.ts`.

**Changed code** — `routeGuard.ts`, `bookingSelectionParams.ts`, the booking route and its composition root, `models/Booking.ts` (the half B3 deliberately left for this story), `bookingHorizon.ts`, `BookingStepIndicator`, `src/lib/copy.ts`.

**Unchanged by contract** — the route still declares no `loading.tsx` above the slug resolution (B1 measured that it degrades `notFound()` to a soft 404 on this runtime), still constructs no credential cipher and no Supabase client, still prefetches nothing in the public flow, and still discloses no cause behind any unavailability. The owner id still never reaches the page.

**Documents this change must correct before code** — `frontend-standards.md` says Server Actions are used "for creating a booking from the public flow", which contradicts `backend-standards.md`'s hard Route Handler rule for exactly that flow; `data-model.md` §10 needs the email normalization rule and the AR phone rule it currently only gestures at, and §11 the hold bounds; the roadmap's B4 line names only B3 as a dependency, when the payment-readiness gate makes PC1/PC2 and PC3 upstream of it, and its B2 line records a 308 note this change supersedes.

**Tech debt this change must answer** — T17 (its trigger fires: the first publicly-linked write), T29 (its trigger fires: bookings can now exist, and the transaction is what stops a mid-checkout schedule edit from stranding one), T44 (re-decided, not inherited), T47 (a write joins a public surface with neither a cache nor a rate limit), T52 (a fully-booked day becomes reachable for the first time), T53 (absorbs the hold duration), plus new entries for the client-rename consequence and for the per-isolate limits of any throttle this runtime can offer.

**Accepted product consequence** — the flow ends at a held slot and no payment. B5 and B6 own the two ways to pay, so this change ships a client who is told, truthfully and in Spanish, that their turn is held and that paying is not possible yet. That is a worse product than a booking and a better one than a button that lies.
