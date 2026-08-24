# B7 — Automatic expiration of provisional holds

## Why

**This story does not free slots. That already works.** `blocksAvailability` evaluates `holdExpiresAt` at read time, so an abandoned checkout stops removing its time from sale at the exact instant its hold lapses — with nothing written anywhere. B3 built it that way on purpose, precisely because B7 was four stories away, and B4, B5 and B6 each restated the reasoning rather than let a status-only filter creep in.

What is missing is the **other half**: nothing in this product has ever written `EXPIRED`. A five-member status enum has a member no code produces, an abandoned hold stays `PENDING_PAYMENT` in the table forever, and every surface that will ever read a booking has to know — and remember — that a row's status is not the whole truth about it.

Three consequences make that worth closing now rather than later:

- **`PENDING_APPROVAL` has no exit that time can provide.** B6 gave the status one terminal path — a booking whose `startTime` has passed becomes sweepable — and shipped without the thing that sweeps. Half of **T64** is closed by writing this job and by nothing else.
- **D1 is the next story, and it is a page of counters.** A dashboard that filters on status is the most natural thing to write and the most likely to be wrong. Correctness today rests entirely on every future reader remembering to call a predicate; a swept row is correct even for a reader who forgets.
- **`confirmIfSlotFree` already defers to a sweeper that does not exist.** Its slot-lost branch says in writing that it "leaves the booking alone for the sweeper". Today nobody collects.

## What Changes

- **A Cloudflare Cron Trigger runs every five minutes** and sweeps eligible bookings into `EXPIRED`. Cadence is a data-hygiene choice, not a correctness one — availability releases the slot the moment the hold lapses regardless — so it is set against the cost of the run, not against the client's experience.
- **A `PENDING_PAYMENT` booking becomes eligible ten minutes after its hold lapsed**, not at the instant it lapsed. `EXPIRY_GRACE_MINUTES` is the whole reason this story is safe to ship: `confirmIfSlotFree` is guarded on `PENDING_PAYMENT`, so a sweeper with no grace converts every late-but-recoverable Mercado Pago approval into `bookingUnavailable` — money taken, appointment gone, refund arranged by hand. **B7 without the grace is a regression, not a feature.** The grace costs nothing, because the slot was already sellable throughout it.
- **A `PENDING_APPROVAL` booking becomes eligible once its own `startTime` has passed**, and `holdExpiresAt` is never consulted for it. That column is the deadline for *uploading* a receipt, not for *answering* one.
- **The job is the first cross-tenant write in the product.** Every repository in this codebase asserts that an unscoped query is inexpressible through it. A sweep cannot be owner-scoped, so it gets its **own port** whose contract names it as the second documented exception — after `findByPublicSlug`, where the slug *is* the key — rather than widening `IBookingRepository` and quietly voiding the property it states about itself.
- **SQL narrows; `blocksAvailability` decides.** The candidate query may filter on status, a time bound and a `LIMIT`. The eligibility rule itself is never re-expressed in SQL, for the reason `IBookingRepository` already gives: the predicate reads a deadline, and a second copy of it drifts from the read side the first time either is refined.
- **The sweep ships as a second Worker**, `reserva-barber-cron`, with its own config, its own `DATABASE_URL` and its own trigger. The application's Worker is unchanged: still the raw OpenNext build output, still no schedule. This was **not** the first plan — a committed entrypoint wrapping the generated worker was built first, and measured at **3812 KiB gzip against a 3072 KiB ceiling** because anything such an entrypoint imports from `src/` gets the Prisma query compiler bundled a *second* time. The rule that generalizes: a custom entrypoint cannot import application code that reaches Prisma.
- **The sweep Worker exports no `fetch` handler at all.** The job is unreachable over HTTP by construction — no route, no guard entry, no shared secret, no rate limit, nothing to get wrong.
- **The sweep cannot use `getPrismaClient()`.** It is memoized with React `cache()` and reads `process.env.DATABASE_URL`; inside `scheduled()` there is no request store and bindings arrive as the `env` argument. `createPrismaClient` moves to its own module so that importing it does not pull React into a Worker that has none, and the sweep refuses loudly when the binding is absent.
- **Two partial indexes on `Booking`.** `prisma/schema.prisma` records that a partial index "was considered and rejected as premature — it would optimize a predicate B7 may still refine". This is that moment.
- **Every run logs, including the runs that sweep nothing.** The defining property of this job is that its failure is invisible: if it never runs, or cannot reach the database, availability keeps behaving correctly and no page, no client and no owner sees anything wrong. A silent sweeper and a sweeper with nothing to do must not look the same.
- **No user-facing change of any kind.** `resolvePaymentPageState` already derives `holdLapsed` from the predicate, and the copy already says the slot is free again. Any edit under `app/` or `src/components/` in this change means something was misunderstood.

## Capabilities

### New Capabilities

- `booking-hold-expiration`: the scheduled sweep — which bookings are eligible and when, the grace window and what it protects, the batching and idempotency rules, the cross-owner exception, the writes it is forbidden to make (`Payment`, `cancelledBy`, `holdExpiresAt`), and its observability contract.

### Modified Capabilities

- `cloudflare-deployment`: the deployed artifact stops being OpenNext's generated worker and becomes a committed entrypoint that wraps it; the Worker gains a scheduled invocation whose environment is **not** the one every other requirement in this project assumes — no request context, no `process.env`, bindings by argument.
- `booking-availability`: "the sweeper remains named as a future caller" of the per-barber advisory lock is now settled, and settled the other way — **the sweep takes no lock**, because releasing a slot cannot double-book. The `PENDING_PAYMENT` and `PENDING_APPROVAL` blocking rules gain the statement that a swept row is `EXPIRED` and blocks by neither clause.
- `payment-mercado-pago`: the late-confirmation path gains a stated dependency on the grace window. Its guarantee — an approved payment against a lapsed hold still confirms when the slot survived — was unconditional only while nothing wrote `EXPIRED`.
- `data-persistence`: `Booking` gains two partial indexes, declared in a raw-SQL migration because Prisma cannot express them, joining the check constraint and the partial unique index already documented as invisible to the schema file.

## Impact

**Schema** — no columns, no tables, no enum members. One migration, `b7_expired_hold_indexes`, adding `("holdExpiresAt") WHERE status = 'PENDING_PAYMENT'` and `("startTime") WHERE status = 'PENDING_APPROVAL'`, plus the schema comment that points at it.

**Deployment** — a second Worker: `wrangler.cron.jsonc`, `worker/sweep.ts`, `npm run deploy:cron`, `npm run preview:cron`. `wrangler.jsonc` is left as it was. **One new secret**, and it is the same value as an existing one: `DATABASE_URL` set on the cron Worker as well, which is a second place to remember when rotating it. The rejected alternative is recorded rather than dropped: an `/api/cron` route invoked over `fetch` would keep a single deploy and duplicate nothing, at the cost of a door in a deny-by-default guard plus a shared secret to defend it.

**Code** — a new domain port, one application service, one repository, one worker entrypoint, one constant. Nothing existing is rewritten.

**Verification** — a live-database gate (`scripts/b7-gate.ts`), because **T58** is exactly this class of story: a mock will certify a sweeper that cannot run. The gate must prove both directions of both predicates, cross-owner isolation, idempotence on a second run, and that a concurrent status change makes the update match zero rows. Locally, `wrangler dev --test-scheduled` is the only way to fire the job by hand.

**Constraints to respect** — **T51** (the Worker sat ~148 KiB under the free-plan ceiling after B6, and Cloudflare's own measurement is stricter than the figure wrangler prints; this change must be re-costed and the paid-plan recommendation restated before N1), **T58** (mocks cannot certify this), **T64** (half of it closes here, and the entry must say which half), **T53** (`EXPIRY_GRACE_MINUTES` is a fifth guessed constant and is disclosed as one).

**Deliberately unresolved** — nothing tells the owner that a hold expired. The sweep is silent to everyone but the logs, and D1 is the story that gives an expiration a surface. Recording it here keeps the gap described rather than discovered.
