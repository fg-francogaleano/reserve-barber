## 1. Correct the documents that currently disagree

Spec-first: these are done before any code, because two of them contradict each other about the endpoint this change builds.

- [x] 1.1 `docs/frontend-standards.md` — correct the Data Fetching & Mutations line that names Server Actions "for creating a booking from the public flow"; it contradicts `backend-standards.md`'s hard Route Handler rule for exactly that flow. Point it at the rule rather than restating it
- [x] 1.2 `docs/frontend-standards.md` — update the multi-step wizard line to six steps, and record that the public flow's no-JavaScript answer is server-rendered from the URL, not `useActionState`
- [x] 1.3 `docs/backend-standards.md` — add the public-write rate limiting rule and the guard's third permitted path to Security Best Practices; note that the entry is an exact match, never a prefix
- [x] 1.4 `docs/data-model.md` §10 — add the email normalization rule (trimmed, lowercased before the unique index), the AR phone canonical form, and the returning-client overwrite rule with its named consequence
- [x] 1.5 `docs/data-model.md` §11 — add the hold bounds: `holdExpiresAt` is creation plus the hold duration, clamped so it never exceeds `startTime`, and state why the clamp is correctness rather than preference
- [x] 1.6 `docs/roadmap.md` — correct B4's dependency list to include PC1/PC2 and PC3 (the readiness gate makes them upstream), and amend B2's entry to record that its "B4 will POST here" note is superseded by `/api/bookings`
- [x] 1.7 `docs/tech-debt.md` — rewrite **T44** per the design's D8: B4's half is satisfied natively by the Route Handler, and the dashboard's ten forms keep a corrected trigger. Do not leave a decision B4 provably cannot implement

## 2. Domain: constants, values and the entity B3 left half-written

- [x] 2.1 Add `HOLD_DURATION_MINUTES` (15) to `src/server/domain/models/bookingHorizon.ts`, documented in the same register as its two siblings — a judgement, not a measurement
- [x] 2.2 Write failing tests for the hold deadline: an ordinary appointment gets creation plus 15 minutes; an appointment sooner than 15 minutes away gets exactly `startTime`; the result is never after `startTime`
- [x] 2.3 Implement the hold-deadline rule in `src/server/domain/models/Booking.ts`, pure, taking the current instant as a parameter
- [x] 2.4 Write failing tests for `src/server/domain/models/phone.ts`: `+54 9 11 5555-4444`, `011 15 5555 4444` and `1155554444` normalize to one value; parentheses and non-breaking spaces are tolerated; a digit count that cannot form a valid AR number is rejected; an empty and a whitespace-only value are rejected
- [x] 2.5 Implement `phone.ts` following the shape `cbu.ts` established — tolerant on input, one canonical stored form, rejection only when the digits cannot work
- [x] 2.6 ~~Add `src/server/domain/errors/BookingErrors.ts`~~ — **written, then removed.** The design settled on result types (`{ outcome: 'slotTaken' | 'notPaymentReady' | … }`) rather than exceptions, because losing a race for a slot and meeting an unready shop are *ordinary outcomes of a public flow*, not failures — putting them in the same channel as a database outage is what the result type avoids. That left both classes with zero callers, which is precisely what PC1 refused to write when it declined `isBookable()` ahead of its first caller: a rule with no caller implies an enforcement that does not exist. `SlotUnavailableError` stays named in `backend-standards.md` for whichever story first needs to *throw* it
- [x] 2.7 Add a cancellation-token generator using `crypto.getRandomValues`, ≥ 256 bits, URL-safe encoding, with a test asserting two generations differ and that nothing in the output derives from inputs
- [x] 2.8 Grep the new domain files for `getDay`, `getHours`, `getDate` and `toISOString` and assert none appear

## 3. The route guard, before anything can reach the handler

- [x] 3.1 Write the failing guard test first: an unauthenticated request to `/api/bookings` continues rather than redirecting to `/login`
- [x] 3.2 Write the failing negative tests: `/api`, `/api/bookings/anything`, `/api/webhooks/mercadopago` and every `(dashboard)` path still redirect for an unauthenticated request
- [x] 3.3 Add the named constant and the **exact path match** to `decideGuardAction` — never a prefix test, never a relaxed default, never a matcher change
- [x] 3.4 Confirm the middleware matcher already reaches `/api/bookings` and record the confirmation, as B1 did for `/b/**`

## 4. Application layer: validation and orchestration

- [x] 4.1 Add `src/server/application/booking/bookingRequestSchema.ts` — Zod over slug, the three catalogue ids, `fecha`, `hora`, name, email, phone, with length bounds applied before anything else
- [x] 4.2 Write failing schema tests: every field over its bound is rejected before any read; a name of 1 character and of 121; an email over 255; an address with no `@`; an empty phone; a `hora` that is an ISO timestamp
- [x] 4.3 Extend the step model in `bookingSelectionParams.ts` with `datos` between `slot` and `complete`, and make the indicator's total derive from the flow definition rather than a literal
- [x] 4.4 Write failing tests for the step model: six steps with a branch choice, five when the branch is implied, and the details step unreachable without a resolved time
- [x] 4.5 Add `BookingCreationService` in `src/server/application/services/`, depending on repository interfaces only, orchestrating: catalogue re-verification → readiness gate → slot re-derivation → client resolution → transactional insert
- [x] 4.6 Write failing service tests for the refusal paths: unready shop, unresolvable barber, cross-owner ids, a time absent from the regenerated list, a service whose duration changed since the list was rendered
- [x] 4.7 Write failing service tests for the deposit: the amount comes from the shared rule, a policy edited after creation does not change it, and a submitted price or deposit field is ignored
- [x] 4.8 Assert the timezone check runs at the write composition root before any repository is constructed, with a test that a runtime without timezone support refuses before writing

## 5. Persistence: the client upsert and the transaction

- [x] 5.1 Add `IClientRepository` with a single owner-scoped `resolve` method expressed as a conflict-aware write, not a read followed by a write
- [x] 5.2 Implement it in `src/server/infrastructure/prisma/`, lowercasing and trimming the email before the write, updating name and phone on conflict
- [x] 5.3 Write repository tests: case and whitespace variants resolve to one row; the same address at two owners produces two rows; a conflict retries once; the retry does not surface as a field error
- [x] 5.4 Add `IBookingRepository` with `createProvisional`, returning either the created booking, the client's own existing hold, or a slot-taken outcome — never throwing for the ordinary conflict
- [x] 5.5 Implement the transaction: advisory lock keyed on the barber as the **first** statement, then the composed day read bounded at both ends by the maximum service duration, then `blocksAvailability`, then the window and absence re-assertion, then the insert
- [x] 5.6 Set explicit wait and execution timeouts on the interactive transaction rather than inheriting the defaults
- [x] 5.7 Write repository tests: an expired `PENDING_PAYMENT` hold does not block; a live one does; `PENDING_APPROVAL` blocks regardless of age; `CANCELLED` and `EXPIRED` do not; the client's own hold for the same slot is returned rather than refused
- [x] 5.8 Assert by test that the blocking decision calls the shared predicate and that no equivalent status filter exists in any SQL this change adds
- [x] 5.9 Add the readiness projection to the payment-config repository — a type with no field capable of carrying `mpAccessToken` — and a test asserting the executed query selects no credential column
- [x] 5.10 Write a test asserting the confirmation read names its columns and selects neither the client's email nor phone

## 6. The write endpoint

- [x] 6.1 Add `app/api/bookings/route.ts` handling `POST` only, parsing form-encoded and JSON bodies, delegating everything to the service
- [x] 6.2 Implement the outcome mapping: created and own-hold → `303` to the confirmation page; validation → `303` to the details step with an error code; slot taken → `303` to the **time** step with the stale-time notice; unready shop → `303` to the details step; throttled → `429`
- [x] 6.3 Return a JSON envelope only for `Accept: application/json`, in the project's success/error shape
- [x] 6.4 Write route tests for all six outcomes, asserting status, redirect target and that the four upstream selections survive a lost race
- [x] 6.5 Write a route test asserting an infrastructure failure returns a Spanish failure state on the flow rather than reaching the route error boundary
- [x] 6.6 Add the per-`(owner, email)` live-hold cap, checked against the database, with tests for exceeding it and for a lapsed hold restoring the allowance
- [x] 6.7 Add the per-origin throttle reusing the login-throttle shape, documented as best-effort and per-isolate, with a memory bound and a test for it
- [x] 6.8 Assert by test that no refusal message names a barber, a slot, a count, or which half of the payment configuration is missing

## 7. User interface

- [x] 7.1 Add `src/components/booking/ClientDetailsStep.tsx` — native `<form method="post" action="/api/bookings">`, uncontrolled inputs, `required` only, no `min`/`max`/`step`/`pattern`, hidden inputs carrying the selection
- [x] 7.2 Render the deposit amount above the fields, formatted as ARS in es-AR
- [x] 7.3 Render the error state from the URL's outcome code, preserving every submitted value, with errors associated to their fields and announced
- [x] 7.4 Add the pending state on the submit control via `useFormStatus`, in a child inside the form, documented as a post-hydration courtesy rather than a guard
- [x] 7.5 Render the not-taking-bookings state instead of the form for an unready shop, disclosing no cause
- [x] 7.6 Add `app/b/[slug]/reserva/[token]/page.tsx` — appointment, deposit, live hold countdown, and the Spanish disclosure that payment is not available yet; no email, no phone; live state rather than the redirect's snapshot; 404 for an unknown token
- [x] 7.7 Serve `Referrer-Policy: no-referrer` on the confirmation route, with a test asserting the header
- [x] 7.8 Update `BookingStepIndicator` for six steps and remove the inert call to action from the booking page's completed branch
- [x] 7.9 Add every new string to `src/lib/copy.ts` under the booking key — labels, the six outcomes, the not-ready notice, the throttle message, the confirmation page — and assert no new Spanish string is written inline
- [x] 7.10 Write component tests: keyboard completion of the step, an announced field error, the six outcome states rendering distinctly, and no contact data on the confirmation page
- [x] 7.11 Verify both surfaces at the project's narrow content bound with a long unbroken email and a long name, and that the six-step indicator does not wrap into an unreadable strip

## 8. Observability and disclosure

- [x] 8.1 Define the log context type for this flow as identifiers only, so a whole-context line has no contact data to disclose
- [x] 8.2 Emit one structured line on creation (booking, barber, service, owner ids) and one at warning level on a slot conflict, so the conflict rate is observable
- [x] 8.3 Write tests asserting that no log line on any path — validation failure, conflict, infrastructure error — contains the submitted name, email or phone
- [x] 8.4 Assert the composition root constructs no credential cipher and no Supabase client, extending the review test B1 and B2 established

## 9. Verification against the live database

- [x] 9.1 Add `scripts/b4-gate.ts` seeding a barber, service, schedule and payment configuration, and tearing down what it creates
- [x] 9.2 Gate check: confirm the advisory-lock facility is available on the deployed instance before trusting any concurrency result
- [x] 9.3 Gate check: N simultaneous submissions for one slot produce exactly one booking in a blocking status
- [x] 9.4 Gate check: the same client's repeated submission returns the same booking and creates no second row
- [x] 9.5 Gate check: a lapsed hold releases its slot to another client while `PENDING_PAYMENT`, with no sweeper running
- [x] 9.6 Gate check: a booking created during the last three hours of a business-local day stores the correct instant
- [x] 9.7 Make the script exit non-zero on any failed check, and hand the command to Franco to run — he runs the runtime checks and the deploy

## 10. Quality gates and debt

- [x] 10.1 `npm run lint`, `npm run typecheck`, `npm test` clean; coverage ≥ 90% on domain and application layers
- [x] 10.2 Confirm `prisma/schema.prisma` and `prisma/migrations/` are unchanged — this change carries no migration by design
- [x] 10.3 Measure the Worker bundle after build against the plan ceiling and record the headroom, as B2 and B3 did
- [x] 10.4 Hand the runtime and deploy commands to Franco — see group 11, which he runs and signs off
- [x] 10.5 `docs/tech-debt.md`: close or re-cost **T17** (its trigger fires), **T29** (its trigger fires; record what the transaction closes and what it does not), **T47** (a write joins the surface), **T52** (a fully-booked day is now reachable), **T53** (absorbs the hold duration)
- [x] 10.6 `docs/tech-debt.md`: open an entry for the returning-client rename re-labelling historical bookings, and one for the per-isolate limits of the throttle, each with the trigger that brings it back
- [x] 10.7 `docs/tech-debt.md`: open an entry for guest personal data having no deletion path, alongside the existing unreferenced-storage entry
- [x] 10.8 Update `docs/roadmap.md`'s B4 entry with what this story actually decided and what it cost, in the register B1–B3 established

## 11. Runtime verification — **Franco runs these and signs off**

Nothing in groups 1–10 proves the story works in the runtime it ships to. These do, and none of them is optional: **every finding this change is most afraid of is invisible to the test suite** — the guard answering `307`, the transaction losing its lock, a header not being sent, an instant drifting three hours.

Ticking a box here means Franco observed the stated result, not that the code looks right.

**Fixtures on the live database** (verified 2026-08-18), so no step needs guessing:

| | |
|---|---|
| slug | `barberia-don-juan-centro` |
| branch (Merlo) | `cmsj7phco0006psp7q8ckisvr` |
| service (Corte + Degrade, 35 min) | `cmsmj0n0g0000psp7n83tpwkj` |
| barber (Juan Carlos, 08:00–17:00 every day) | `cmskwwv2h0000psp75zk9dxel` |
| payment readiness | Mercado Pago **and** CBU configured, deposit `FIXED 2000.00` — the gate passes |

Shorthand used below (`{BASE}` is `http://localhost:8788` in preview, the deployed origin after):

```
{DETAILS} = {BASE}/b/barberia-don-juan-centro/reservar?local=cmsj7phco0006psp7q8ckisvr&servicio=cmsmj0n0g0000psp7n83tpwkj&barbero=cmskwwv2h0000psp75zk9dxel&fecha=2026-08-19&hora=10:00
```

### 11a. Build a worker that actually contains this change

- [ ] 11.1 **Stop any preview that is already running.** `npm run preview` builds and then serves; a session started before this change is serving the previous bundle and will show none of it. This is the first thing to rule out.
- [ ] 11.2 `npm run preview` — confirm the build completes and the OpenNext bundle is regenerated
- [ ] 11.3 Confirm the route exists at all: `curl -i -X POST {BASE}/api/bookings` returns **400** (`VALIDATION_ERROR`), **not 404 and not a redirect to `/login`**. A 404 means the build predates the change; a 307 means task 11.4 has already failed

### 11b. The guard — the finding no test in production can catch

- [ ] 11.4 **An anonymous POST is not redirected.** `curl -i -X POST {BASE}/api/bookings -d "slug=x"` → the status is **400**, and the `location` header is absent. A `307` to `/login` means `PUBLIC_BOOKING_API` is not taking effect and the flow is broken for every guest — an owner browsing while signed in would never see this
- [ ] 11.5 **The API root did not open with it.** `curl -i -X POST {BASE}/api/bookings/anything` and `curl -i {BASE}/api` → both **redirect to `/login`**. The entry is an exact match, and this is what proves it
- [ ] 11.6 **The dashboard is still protected.** Open `{BASE}/servicios` in a private window → redirected to `/login`

### 11c. The details step

- [ ] 11.7 Open `{DETAILS}` → the **"¿Con quién reservamos?"** step renders with three fields (nombre, email, teléfono) and the step indicator reads **paso 6 de 6**
- [ ] 11.8 The **deposit appears above the fields**, formatted `$ 2.000,00` — and the amount is the one the owner configured, not the service price
- [ ] 11.9 View source: the form is `<form method="post" action="/api/bookings">` carrying six hidden inputs, and **no control has `pattern`, `min`, `max`, `step`, `minlength` or `maxlength`**
- [ ] 11.10 Walk the flow by clicking from `{BASE}/b/barberia-don-juan-centro` instead of pasting the URL, and confirm it arrives at the same step

### 11d. The no-JavaScript path — the promise this story exists to make true

- [ ] 11.11 **Disable JavaScript** in the browser, reload `{DETAILS}`, submit a phone of `555` → the page returns to the details step, shows **"Revisá el teléfono…"** rendered by the server, and **nombre y email are still filled in**
- [ ] 11.12 With JavaScript still off, submit valid data → the booking is created and the confirmation page renders. This is the whole of T44's promise, on the one surface a stranger meets
- [ ] 11.13 Confirm the URL after a rejection carries **only `estado=datos`** — no name, no email, no phone in the query string

### 11e. The hold, and the two ways it can be got wrong

- [ ] 11.14 Submit a valid booking → redirected to `/b/barberia-don-juan-centro/reserva/{token}`, showing the appointment, the deposit, a countdown, and **"El pago de la seña se habilita muy pronto."**
- [ ] 11.15 The confirmation page shows the client's **name only** — no email and no phone anywhere in the rendered page or its source
- [ ] 11.16 `curl -sI {BASE}/b/barberia-don-juan-centro/reserva/{token} | grep -i referrer` → **`Referrer-Policy: no-referrer`**. Without it B5's redirect to Mercado Pago hands a third party the cancellation token
- [ ] 11.17 **The held slot disappears from availability.** Reload the slot step for that day → 10:00 is no longer offered
- [ ] 11.18 **The double submit is not a conflict.** Press the browser's back button and re-submit the identical form → the same confirmation page, **no "ese horario ya no está disponible"**, and no second row (check with `SELECT count(*) FROM "Booking" WHERE "startTime" = …`)
- [ ] 11.19 **Another client is refused.** In a different browser profile, submit the same slot with a different email → returned to the **time step** with "Ese horario ya no está disponible", and the branch, service, barber and date still selected

### 11f. The instant — where this project's worst bug class lives

- [ ] 11.20 **Run at least one pass after 21:00 local**, when the runtime's UTC calendar has already rolled to the next day. Book a slot and confirm the confirmation page names the day and time you chose, not one three hours off
- [ ] 11.21 Verify in the database that the stored instant matches: `SELECT "startTime" AT TIME ZONE 'America/Argentina/Buenos_Aires' FROM "Booking" ORDER BY "createdAt" DESC LIMIT 1;`
- [ ] 11.22 Confirm `holdExpiresAt` is 15 minutes after creation and **never after `startTime`**

### 11g. The bounds

- [ ] 11.23 **The throttle answers 429.** Fire 15 rapid posts from one origin: `for i in $(seq 1 15); do curl -s -o /dev/null -w "%{http_code}\n" -X POST {BASE}/api/bookings -d "slug=x"; done` → the last ones return **429**
- [ ] 11.24 **The per-client cap holds.** Create 3 holds with one email, then attempt a fourth → returned with `estado=demasiados`. This is the bound that matters; the throttle is per-isolate (T55)
- [ ] 11.25 **The unready-shop wall.** Temporarily clear the deposit policy in the dashboard (`/sena`), reload `{DETAILS}` → **no form**, and "Esta barbería todavía no está tomando reservas online." Restore the policy afterwards

### 11h. The concurrency gate and the deploy

- [ ] 11.26 `npx tsx scripts/b4-gate.ts` against the live database, **after 21:00 local**, → `GATE PASSED`. Its probe B confirms `hashtextextended` exists; if that fails, every concurrency result below it is measuring an unlocked transaction
- [ ] 11.27 Clean up the bookings created by hand during 11c–11g (the gate cleans up after itself; manual runs do not)
- [ ] 11.28 `npm run deploy`, then repeat **11.3, 11.4, 11.14 and 11.16** against the deployed origin — the guard and the header are configuration, and configuration is exactly what differs between preview and production
- [ ] 11.29 **Franco's sign-off:** record the result here before archiving, including which checks ran after 21:00 local
