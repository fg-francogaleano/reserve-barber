## Context

B3 left the public flow one step short of a booking, and every piece the last step needs already exists: the catalogue read, the availability rule, the `blocksAvailability` predicate written explicitly for this story's transaction, the `DepositPolicy` calculation, the `isBookable` readiness rule that has never had a caller, and both database tables with the index and the check constraint that serve them.

What does not exist is a write. Everything the public surface has done so far is a read, and the constraints that shaped it were about cost and disclosure. From here a bad request costs a slot, and slots are the only inventory this business has.

Three properties of the environment shape every decision below:

- **The database is reached through a transaction-mode pooler.** Two statements are not guaranteed to share a connection, so a read followed by a write proves nothing. Anything that must be atomic has to say so.
- **The runtime is `workerd`, and the business is at UTC−3.** Local calendar accessors return the UTC answer silently. On the read side that produced a wrong page; here it would persist a wrong appointment.
- **The route guard is deny-by-default with two named public paths.** A new endpoint is protected the moment it exists — which is correct, and which is also why this story's endpoint would be unreachable until it is named.

Seven decisions were taken by the owner before this design and are inputs to it, not questions inside it: the endpoint is `/api/bookings`; the guard gains one explicit entry; the no-JavaScript answer is server-rendered from the URL; the hold is 15 minutes; a returning client's details overwrite the stored ones; phones normalize tolerantly to one canonical form; and the confirmation page is authorized by the cancellation token.

## Goals / Non-Goals

**Goals:**

- One slot, one booking, under concurrent submissions, proven against the live database rather than against mocks.
- The read side and the write side apply **one** definition of what blocks a slot.
- A client who succeeds is never told they failed, including on a double tap, a retry or a back-button re-submit.
- The payment-readiness gate is finally enforced, without putting an encrypted credential within reach of an anonymous route.
- The public write cannot be turned into a calendar lock by anyone who can run a loop.
- The no-JavaScript promise becomes true on the surface where a stranger meets it.

**Non-Goals:**

- Charging anything. No `Payment` row, no gateway call, no receipt. B5 and B6 own the two ways to pay.
- Expiring holds. B7 owns the sweeper; this change is written to be correct in its absence, which is why the blocking predicate reads the deadline rather than the status alone.
- Sending email. N1 owns it; the cancellation token is generated here so N1 has something to send.
- Any dashboard surface. D1 will show these bookings; nothing here renders one to an owner.
- Fixing the dashboard's ten no-JavaScript forms. That half of T44 is re-triggered, not inherited.

## Decisions

### D1 — `POST /api/bookings`, a Route Handler, and one named guard entry

`backend-standards.md` makes the Route Handler a hard rule for this flow rather than a preference: a Server Action is addressed by a build-time id, and a guest halfway through a deposit is the person who must never meet a dead action id. The URL is the one that document already names.

The guard consequence is the part that is easy to miss and impossible to discover in normal use. `decideGuardAction` permits `/login` and `/b/**` and redirects everything else, so an anonymous POST to `/api/bookings` is answered `307 → /login`. An owner testing their own shop is signed in and would never see it.

The entry is an **exact path match**, not a prefix. Opening `/api` would admit every future endpoint the moment it is created — the precise failure deny-by-default exists to prevent — and the dashboard's own API routes will live under the same root. B5's Mercado Pago webhook will need a second exact entry; it does not get to inherit this one.

*Alternative rejected:* placing the handler under `/b/[slug]/reservar/confirmar/route.ts`, inside the already-public namespace, needing no guard change. It works and it contradicts the documented API surface, and it only defers the guard edit to B5, which needs it for the webhook regardless. Doing it once, here, with a test, is cheaper than doing it under pressure later.

### D2 — The write re-runs the read, inside the transaction

The handler does not trust the submission to name a real time. It re-resolves the shop from the slug, re-verifies the ids against the catalogue, derives `startTime` itself from the calendar date and `HH:mm`, and then — inside the transaction — regenerates the day's availability and requires the requested start to be a member of it.

This collapses four separate correctness questions into one mechanism: is the time on the grid, is it inside a working window, is it outside every absence, and is it free of blocking bookings. Checking them separately would mean four rules that can disagree; regenerating is one rule that cannot.

It also closes T29's window from the only side that can be closed today. An owner narrowing a schedule between the moment a time was offered and the moment it was submitted is a real sequence, and the transaction is the only place where the answer is still current.

*Alternative rejected:* re-checking only bookings, and trusting the windows and absences that produced the offered list. Cheaper by nothing measurable — the composed read is a single round trip — and wrong in exactly the case the check exists for.

### D3 — A per-barber advisory lock, not an exclusion constraint and not serializable isolation

The transaction's first statement takes a transaction-scoped advisory lock keyed on the barber id. Then it reads, decides with `blocksAvailability`, and writes. The lock releases with the transaction, and it serializes exactly the thing that must be serialized: two people booking the same barber.

**An exclusion constraint was the obvious answer and is wrong here.** `btree_gist` over `(barberId, tsrange(startTime, endTime))` would enforce non-overlap in the database, which is stronger than anything application code can do — but its predicate cannot include the expired-hold clause, because `holdExpiresAt > now()` is not immutable and cannot appear in a partial index predicate. The constraint could only cover the three blocking statuses, so it would refuse a write over a slot that availability correctly reports as free. That is the read/write divergence this whole story is organized around, arriving from the direction nobody would be watching.

**Serializable isolation** would also be correct, and turns every collision into a `40001` requiring retry orchestration on an endpoint with no rate limit, against a pool shared with the owner's dashboard. The advisory lock has the granularity the domain actually has.

*Cost accepted:* the lock is advisory, so it binds only code that takes it. This story is the only writer of `Booking`, and B7 and D2 must take the same lock when they arrive. That is written down here rather than left to be inferred.

### D4 — `blocksAvailability` gets a second caller and no second copy

The transaction calls the same function the availability read calls, over rows it fetched itself. The blocking decision is made in TypeScript, not in SQL, for the same reason B3 gave when it declined to push the filter down: the expired-hold clause is a rule with a deadline in it, and a SQL copy would drift the first time B7 refines it.

The read that feeds it is deliberately **wider** than the rule — every booking overlapping the range whose status could matter — and the predicate decides. `blocksAvailability` is now the single point where the read side and the write side agree, and its test suite is the proof.

### D5 — The readiness gate reads a projection that cannot hold the token

B1, B2 and B3 guaranteed the encrypted Mercado Pago token could not leak from the public flow by handing it no `PaymentConfig` repository at all. B4 has to ask a question about that row, so the guarantee changes shape rather than weakening: a repository method returning a readiness projection whose type has no field capable of carrying a credential, and a composition root that still constructs no cipher and no Supabase client.

A type that cannot express the leak is stronger than every consumer remembering to strip a field. The gate is enforced at the details step's render and again in the handler, because a form that refuses to appear is not a boundary — only the second check protects a client whose form was rendered a minute ago.

### D6 — The hold is 15 minutes, clamped at `startTime`

`HOLD_DURATION_MINUTES = 15` lives beside `MIN_BOOKING_LEAD_MINUTES` and `MAX_BOOKING_HORIZON_DAYS`, and is documented in the same register: a judgement made before any real shop used the product.

The clamp is not a preference. An unclamped hold on a near-term appointment lapses after the appointment has begun, and B7 would then expire a booking whose time has passed. Today the 60-minute lead time makes this unreachable — and T53 already records that the lead time is a guess that a real owner will want lowered, which is exactly how an unreachable case becomes reachable without anyone editing the code that assumed it.

### D7 — A repeated submission is idempotent by ownership, not by a nonce

When the transaction finds a blocking booking, it asks one more question before refusing: is this the same client's own hold, for this barber, at this start time? If so it returns that booking.

This makes a double tap, a retried POST and a back-button re-submit all resolve to the same appointment, with no new column, no stored nonce and no expiry to manage. A hidden idempotency key would need storage this change does not have and would be fragile precisely where it matters — across a reload.

Combined with answering success as a `303`, the browser's own repeat-navigation behaviour re-issues a `GET` and never the `POST`.

### D8 — Every outcome is a redirect with a code, and the page renders the message

The handler answers a browser submission with `303` and an outcome code in the query string; the page reads it and renders Spanish from the copy module. A JSON envelope is produced only for `Accept: application/json`.

This is T44's option 3, and it is not a workaround — it is the natural shape for a Route Handler, and it makes the no-JavaScript promise true here without touching the dashboard. T44's recorded decision ("option 2, implemented in B4") cannot be executed by this story at all: `useActionState` belongs to Server Actions, and this flow has none. The entry is rewritten rather than silently unmet.

A lost race is a special case of the same mechanism, aimed at a different step: back to the **time** step with the stale-time notice that already exists, upstream selections intact. The client's next action is picking another time, so that is where they land.

### D9 — Two bounds, one of which actually holds

A per-`(owner, email)` cap on simultaneously live holds is checked against the database and is the bound that binds. A per-origin throttle reuses the shape of the login throttle and is **best effort**: this runtime has no shared counter across isolates, so it blunts a naive loop and does not defeat a distributed one. Writing that down is the point — an accepted debt with a false justification is worse than one with none.

Without both, a five-minute grid over a sixty-day horizon is thousands of start times per barber, a fifteen-minute hold recycles each one four times an hour, and B7 does not exist yet. The bound is not hardening for later; it is what stops the story from shipping a calendar lock.

### D10 — The confirmation page is addressed by the cancellation token

One secret, already unique and unguessable, held by exactly this person, and the same one N1 will email. A second view-only token would be two secrets for one holder and a migration to introduce it.

The cost is specific and in scope: that route sends `Referrer-Policy: no-referrer`, because B5 will redirect from a page in this flow to an external payment provider, and a `Referer` header carrying a cancellation credential to a third party is a leak nobody would look for. The page also reads live state rather than trusting the redirect, so a hold that lapsed while it was open is not shown counting down, and it renders no email or phone — the link can be shared or opened on a shared device.

### D11 — Phone normalization is tolerant on input, strict on storage

One domain module, the shape `cbu.ts` established. It accepts `+54`, a leading `0`, a `15` prefix, spaces, dashes and parentheses, produces one canonical value, and rejects only when the digits cannot form a valid Argentine number.

The asymmetry is deliberate and is a product judgement: a stored value that varies in punctuation costs the owner a retype before they can use it, while a rejection at the last step of a checkout costs a booking. The strictness belongs where the data is stored, not where it is typed.

### D12 — Contact data enters the server for the first time, and never enters a log

The existing logging helpers were written for identifiers and driver messages, and the redaction helper was written for secrets. Neither anticipated a stranger's name, email and phone. The rule here is structural rather than a matter of care: the log context type for this flow carries identifiers only, so a whole-context log line has nothing to disclose.

A creation emits one structured line; a conflict emits one at warning level. The conflict rate is the only signal that will ever tell anyone whether the concurrency design is holding in production.

### D13 — The gate script is the acceptance criterion

`scripts/b4-gate.ts` runs against the live database and proves four things in one execution: N simultaneous submissions for one slot yield exactly one booking; the same client's repeat submission is idempotent; a lapsed hold releases its slot; and the advisory-lock facility the transaction depends on is actually available on the deployed instance.

Every interesting failure in this story is a race, and a mocked repository cannot express one. B3 established the precedent and it earned its keep — its gate ran in the three-hour window where the runtime's UTC calendar and the business date disagree, which no unit test would have arranged.

## Risks / Trade-offs

- **The advisory lock binds only code that takes it.** → Documented at the lock site and in the data-persistence spec as a rule B7 and D2 must follow. This story is the only writer today, so the guarantee is complete today and the obligation is recorded before it can be broken.
- **An interactive transaction pins a pooled connection shared with the dashboard.** → Explicit wait and execution timeouts, a transaction of four statements, and a lock scoped to one barber so contention is per-barber rather than global.
- **The per-origin throttle is per-isolate and does not survive a distributed attempt.** → The per-client cap is checked against the database and is the bound that actually holds; the throttle's limits are stated in the entry rather than implied by its existence.
- **Guest personal data is now stored, and this project has no deletion path.** → Out of scope to solve here, in scope to record: it joins the unreferenced-storage entry as the second thing this product accumulates and cannot yet remove.
- **A returning client's rename re-labels historical bookings**, because `Booking` snapshots price and deposit but not the client's name. → Accepted by decision, recorded as debt. The alternative — snapshotting contact onto `Booking` while the table is still empty — was considered and declined, and the declining is written down because the table will not be empty forever.
- **The flow ends at a held slot and no payment.** → A truthful Spanish disclosure on the confirmation page, which is the same answer B1, B2 and B3 gave for the inert control. Worse than a booking, better than a button that lies.
- **The Worker sits near the free plan's size ceiling.** → Measured after build rather than assumed, and no new runtime dependency is introduced by any decision above.

## Migration Plan

**There is no database migration.** B3 created both tables, the index and the check constraint ahead of their writer specifically so that the story carrying the concurrency-critical transaction would not also be altering a live schema. That property is preserved; if a column proves necessary it is a decision to surface, not a convenience to add.

Deployment is the ordinary sequence: spec artifacts updated first, then code, then `lint` / `typecheck` / `test`, then the gate script against the live database, then preview on the Workers runtime, then deploy. The gate is a hard stop rather than a report — the roadmap forbids starting B5, B6, B7 and D2 until it passes.

**Rollback** is a redeploy of the previous Worker. Nothing here is destructive: the change adds rows and alters no existing one, and a rolled-back deployment leaves any created bookings intact and readable by the availability rule, which already understands every status they can be in.

**Four documents are corrected before any code is written**, because they currently disagree with each other and with this design: `frontend-standards.md` (it names Server Actions for exactly the flow `backend-standards.md` forbids them in), `data-model.md` §10 and §11 (email normalization, the AR phone rule, the hold bounds), `backend-standards.md` (rate limiting the public write, and the guard's third entry), and the roadmap (B4's dependency list, and B2's superseded note about where this story would post).

## Open Questions

- **What the per-client hold cap should be.** Three is the working number and it is a guess of the same kind as the lead time and the horizon. The first real shop will produce evidence; until then it is set where a legitimate client is never inconvenienced and a script is stopped early.
- **Whether the throttle should become a Cloudflare rate-limiting rule rather than application code.** That is the answer T47 has been pointing at for three stories, and it covers the read surface too. Out of scope here; this change adds the first write to the surface that entry describes and re-costs it.
- **Whether `Booking` should snapshot the client's name.** Declined for this change, and the table is empty exactly once. Recorded as debt so the decision is revisited while it is still cheap rather than after the first hundred rows.
