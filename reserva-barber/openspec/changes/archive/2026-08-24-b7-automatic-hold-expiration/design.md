# B7 — Design

## Context

`blocksAvailability` (`src/server/domain/models/Booking.ts`) has decided since B3 whether a booking removes its time from sale, and it decides it **at read time** from `holdExpiresAt`. Every consumer calls it: the availability read, the booking write's transactional re-check, the late-payment confirmation, the receipt write, the storage policy's own SQL equivalent, and the confirmation page's state table. That is why an abandoned checkout has never blocked a slot past its deadline, and why this story has no user-visible effect.

The other half was always deferred. `EXPIRED` is a status nothing writes. `bookingHorizon.ts`, `Booking.ts`, `schema.prisma`, `IBookingRepository`, three spec files and `PrismaPaymentRepository.confirmIfSlotFree` all contain a sentence naming B7 as the thing that will collect. This change is that collection, and it is deliberately small: one scheduled job, one port, one service, one repository, two indexes.

Two constraints shape it more than the booking domain does:

- **The generated Worker has no `scheduled` export.** `@opennextjs/cloudflare@1.20.1` emits `.open-next/worker.js` with `fetch` and three Durable Object classes, and rewrites it on every build.
- **A scheduled invocation is not a request.** `getPrismaClient()` is wrapped in React `cache()` and reads `process.env.DATABASE_URL`. Neither exists outside `runWithCloudflareRequestContext`.

## Goals / Non-Goals

**Goals:**

- `EXPIRED` becomes a written status, produced by exactly one job.
- `PENDING_APPROVAL` gains the time-based exit B6 specified and could not ship (half of T64).
- A late Mercado Pago approval keeps working exactly as well as it does today.
- The job's failure is loud, because its natural failure is silent.
- Cross-owner behaviour is stated, bounded and tested — the first such write in the product.

**Non-Goals:**

- Freeing slots. Already done, at read time, by a predicate this change does not touch.
- Any user-facing change. No route, component or copy string is modified.
- Telling the owner that a hold expired. That needs a surface, and the surface is D1.
- Refund handling, receipt retention (T65), or guest-data deletion (T56).
- Making `PENDING_APPROVAL` answerable by time. Only its *appointment* expires it, never its upload deadline.

## Decisions

### D1 — The sweep is its own Worker

`worker/sweep.ts` with `wrangler.cron.jsonc`: `name: reserva-barber-cron`, `main: worker/sweep.ts`, the same compatibility date and flags as the app, and `triggers.crons`. It exports **only** `scheduled`. The application's `wrangler.jsonc` goes back to `main: .open-next/worker.js` and declares no schedule.

**This is not the option originally chosen, and the reason it changed is a measurement.** The plan was a committed entrypoint wrapping the generated worker (option A below), and it was built, and it worked: the app served correctly through it, `sweepExpiredHolds` shipped in the bundle, and `tsc` was clean with the build artifact present and absent. It was abandoned at `wrangler deploy --dry-run`:

| entrypoint | gzip | note |
| --- | --- | --- |
| B6, before this story | 2924.08 KiB | |
| wrapper, `scheduled` body stubbed out | 2924.23 KiB | the wrapper costs **0.15 KiB** |
| wrapper importing the sweep | **3812.20 KiB** | **over the 3072 KiB ceiling** |
| separate Worker: app | 2924.14 KiB | back to B6 |
| separate Worker: cron | 878.62 KiB | |

The +888 KiB was **the Prisma query compiler bundled twice** — the dry-run `outdir` held the same 1.85 MB wasm under two names. Anything a custom entrypoint imports from `src/` is compiled by wrangler's own esbuild pass, separately from the copy the OpenNext build already placed inside `.open-next/server-functions/default/handler.mjs`.

**The general rule, worth more than this story: a custom entrypoint cannot import application code that reaches Prisma.** It is a structural property of having two bundlers, not a quirk to work around, and it recurs for any future scheduled or queue handler.

**Alternatives considered:**

- *A wrapping entrypoint (the original choice).* Over the ceiling, as measured. It would have needed Workers Paid to ship at all.
- *An `/api/cron/expire-holds` route invoked over `fetch`.* Keeps one deploy and no duplication, because all application code stays inside OpenNext's bundle. Rejected: `routeGuard` is deny-by-default and every public door in this product is opened by an exact-match constant with a written justification. This would add a fourth, plus a `CRON_SECRET`, plus a constant-time comparison, plus a header-not-query-string rule — new attack surface bought with money saved, on a job the runtime can invoke directly.
- *Workers Paid (US$5/month, 10 MiB).* Would have kept option A verbatim with no code change, and remains T51's standing recommendation for N1 regardless. Not taken here because the separate Worker is free, costs no security, and leaves *more* headroom rather than spending it.

**What the split costs**, stated plainly: two deploys, two `DATABASE_URL` secrets holding the same value, and a second Worker to remember when rotating it. `npm run deploy:cron` and `npm run preview:cron` exist so neither is typed from memory.

**What it buys beyond fitting:** the sweep Worker exports no `fetch` handler at all, so the job is unreachable over HTTP by construction — no guard entry, no secret, no rate limit, nothing to get wrong. And it needs no Next.js build, because nothing in the sweep imports a page, a route or a component.

**One refactor was required by the split.** `getPrismaClient` is memoized with React's `cache()`, so importing `client.ts` executes `cache(...)` at module load and pulls React into whatever bundle the importer belongs to. `createPrismaClient` moved to `createClient.ts`, which `client.ts` re-exports; the sweep Worker imports the former and carries no React.

**The residual risk is unchanged in kind:** nothing in the test suite executes a Worker entrypoint. It is proven by a local scheduled fire and a real deploy, in that order, and by nothing else.

### D2 — The sweep builds its own database client from the invocation's environment

The composition root for the scheduled path calls `createPrismaClient(env.DATABASE_URL)` and throws a named error when it is absent. `getPrismaClient()` is not reachable from here.

This is the single most likely way this story ships broken, and the symptom is *nothing* — pages render, availability is correct, and the job quietly does no work forever. It is called out in the spec, in the deployment capability, and enforced in practice by D10's mandatory summary log.

### D3 — A ten-minute grace window before a lapsed hold is eligible

`EXPIRY_GRACE_MINUTES = 10`, declared in `bookingHorizon.ts` beside the four constants already there, with the same disclosure that it is a judgement rather than a measurement (T53's family; this is the fifth).

**Why it is not optional.** `confirmIfSlotFree` is guarded on `PENDING_PAYMENT`. Expire the row and the same approved notification takes the `notPending` branch and reports `bookingUnavailable`: the charge stands, the appointment does not, and a human arranges a refund. The preference expiry set at `holdExpiresAt` prevents an attempt *begun* after the hold lapsed — it does nothing about one begun thirty seconds before it and approved a minute after. **Without the grace, this story is a net regression to the worst path in the product.**

The grace costs nothing: the slot has been sellable since the hold lapsed, ten minutes earlier.

**Alternative considered:** teaching `confirmIfSlotFree` to revive an `EXPIRED` booking whose slot is still free. Rejected — it makes a terminal status non-terminal, and every future reader of `EXPIRED` would have to learn that it sometimes is not.

### D4 — SQL narrows the candidate set; `blocksAvailability` decides

The candidate query filters on status, one instant bound and a `LIMIT`. Eligibility is then decided in TypeScript by the shared predicate, against the run's single instant.

`IBookingRepository` already forbids the alternative in writing: the predicate reads a deadline, and a SQL copy drifts from the read side the first time either is refined. The sweep would be the fourth copy of a rule this project has spent four stories keeping to one.

Note that the predicate answers `false` for `CANCELLED` and `EXPIRED` too — so the **query's status filter is what confines the sweep** and the predicate is what confirms it. Both are load-bearing.

**Amended during implementation: the grace window is checked in the service as well as in the query bound.** Writing the tests made the gap visible — with a mocked repository, every assertion about the grace passed for the wrong reason, because `blocksAvailability` answers "is this still holding the slot", which has been `false` since the deadline passed. The grace asks a different question ("could a payment still be in flight for it") and the two disagree for exactly the ten minutes that matter. Leaving it in the `WHERE` clause alone would rest the story's only money-losing property on a bound no unit test can see, catchable only by the live gate. This is the one rule in the change deliberately expressed twice, and the reason is written at the call site.

### D5 — Its own port, because it cannot be owner-scoped

`IExpiredHoldRepository`, not a method on `IBookingRepository`. That contract states that an unscoped query is inexpressible through it, and a sweep is unscoped by nature.

`findByPublicSlug` set the precedent for how this project handles such a case: a named exception carrying its reason, bounded by a projection. This one is bounded by its projection (id, status, the two instants), by its `LIMIT`, and by the fact that it can only ever write one column to one value.

A two-owner fixture is a hard requirement in the tests, because nothing else in the system constrains this query.

### D6 — No advisory lock

Every existing lock caller *places* a booking into a slot. The sweep only releases, and a release cannot double-book — the reasoning D2's rejection path already records. Safety comes from D7's guarded update.

Taking the lock would serialize a cross-shop maintenance job against the live booking write for a guarantee it does not need.

### D7 — Select, decide, then one guarded `updateMany` per batch

Per batch: select up to `SWEEP_BATCH_SIZE` candidates → filter with the predicate → `updateMany({ where: { id: { in: eligible }, status: <the expected status> }, data: { status: 'EXPIRED' } })`.

The status in the `where` is what makes the interleavings safe. A client attaching a receipt between the read and the write flips the row to `PENDING_APPROVAL`; the update then matches zero rows instead of stamping `EXPIRED` over it. The same guard makes a second run, and two overlapping invocations, report zero rather than reasserting a decision.

**No explicit transaction.** One statement is already atomic, and wrapping the batch would hold a pooler connection (`max: 5`, `maxUses: 1`, shared with the dashboard and the public write) across a decision made in application code.

**The two rules are separate loops**, each with its own status, instant column and index. They are disjoint by status, so a row at the clamp boundary — `holdExpiresAt === startTime`, which `holdExpiresAtFor` can produce — can only ever match one of them. Double-counting is impossible by construction rather than by a de-duplication step.

Bounds: `SWEEP_BATCH_SIZE` rows per statement, `MAX_BATCHES_PER_RULE` batches per rule per invocation (so `× 2` for one invocation, since the two rules are bounded independently), stop early on an empty batch. The first production run faces every abandoned hold ever created, including everything the gate scripts left behind, and must not meet it in one statement.

### D8 — Two partial indexes, in raw SQL

`("holdExpiresAt") WHERE status = 'PENDING_PAYMENT'` and `("startTime") WHERE status = 'PENDING_APPROVAL'`.

`(barberId, startTime)` cannot serve either: the sweep names no barber. Partial rather than full, because eligible rows are a shrinking minority of a table that grows with every appointment ever made, and a row leaves both indexes the moment it is swept.

Prisma cannot declare partial indexes, so they live in the migration with a pointer in `schema.prisma` — the convention `Booking_pending_payment_requires_hold_expiry` and `Payment_one_live_per_booking` already follow. The comment currently claiming a partial index was "rejected as premature" is replaced by that pointer.

### D9 — The sweep writes one column and nothing else

- **`Payment` is untouched.** A late notification must still be able to complete the payment's own history, and the sweep's concern is the slot.
- **`cancelledAt` / `cancelledBy` stay null.** `CancelledBy` has only `OWNER` and `CLIENT`; adding a `SYSTEM` member would erase the distinction `EXPIRED` versus `CANCELLED` exists to make — a deadline is not a decision.
- **`holdExpiresAt` is preserved**, deliberately unlike the confirmation and rejection writes which null it. Those finish a booking that has no hold left to describe; this one records *why* the booking ended.

### D10 — One summary per run, and one error for an expired booking that was paid

Every invocation emits a structured line — `candidatesScanned`, `expiredPendingPayment`, `expiredPendingApproval`, `batches`, `durationMs` — **including runs that expire nothing**. This is what makes "the job is dead" distinguishable from "the job had nothing to do", and it is the only instrument this capability has.

After a non-empty batch, one indexed read over the ids actually expired finds any `APPROVED` payment among them and logs it at `error` with the booking, the payment and the amount. That combination is `confirmIfSlotFree`'s slot-lost ending, and once swept it stops looking anomalous anywhere. Keyed on the ids actually written, so the common path — nothing swept — spends nothing.

### D11 — Every five minutes

Cadence is data freshness, not correctness: availability released the slot when the hold lapsed. Every minute would spend twelve times the connections against a shared pooler for a staleness nobody can observe.

### D12 — One clock per run

`now` is taken once at the start of the invocation and passed into both the query bound and the predicate. The Worker's clock and Postgres's clock never both decide inside one run.

## Risks / Trade-offs

- **The wrapper does not survive the OpenNext build or the deploy** → proven locally with `wrangler dev --test-scheduled` before any deploy, and the fallback (D1's second Worker) is documented rather than improvised. This is the only part of the change that no test can cover.
- **The job silently never runs** → D10's unconditional summary makes it observable; the deployment spec requires the schedule to be visible on the Worker after deploy; the local fire proves the handler executes at all.
- **A late payment lands after the grace anyway** → unchanged from today for anything past ten minutes, and reported exactly as it is now (`bookingUnavailable`, logged at error, owed a refund). The grace narrows the window; it does not close it, and the design does not claim otherwise.
- **The Worker crosses the free-plan size ceiling (T51)** → ~148 KiB of headroom after B6, and wrangler's figure is a lower bound Cloudflare's own check does not agree with. `--dry-run` before deploy; T51 re-costed in this change; the standing recommendation to take Workers Paid before N1 restated.
- **The first run meets a large backlog** → bounded by `SWEEP_BATCH_SIZE` × `MAX_BATCHES_PER_RULE` × 2, spread across as many five-minute runs as it takes.
- **A predicate bug writes across every shop** → this is the only cross-tenant write in the product; mitigated by the dedicated port, the status-guarded update (which can only ever set one column to one value), and a mandatory two-owner test plus a two-owner gate probe.
- **~~Grace-window abuse~~ — withdrawn, it was not a risk.** This entry claimed a client could hold a slot for `HOLD_DURATION_MINUTES + EXPIRY_GRACE_MINUTES`, bounded by `MAX_LIVE_HOLDS_PER_CLIENT`. Both halves are false, and the adversarial pass before archiving caught it. Availability reads `holdExpiresAt`, not the status, so the slot is released at the deadline and nothing is held during the grace; and `countLiveHoldsForClient` uses the same `holdExpiresAt > now` predicate, so the row stops counting against the cap at the deadline too. **The grace delays the status write and nothing else.** Kept struck through rather than deleted, because "the grace has a cost somewhere" is the intuitive reading and the next person will have it too.

## Migration Plan

1. Apply `b7_expired_hold_indexes` (index-only, no data touched, safe against a live database).
2. Deploy the entrypoint **with** the cron trigger. Order matters only in this direction: a schedule firing before the indexes exist would run the slow query against production traffic.
3. Confirm the schedule is registered on the Worker, then watch for the first summary line.

**Rollback:** deploy with `triggers.crons` removed. The indexes are harmless and stay.

**Rollback does not un-expire anything, and does not need to.** A swept row and an unswept lapsed row are indistinguishable to availability, to the booking write and to the confirmation page. The only path that can tell them apart is a late Mercado Pago approval — which is exactly what D3's grace window is sized to protect.

## Open Questions

None blocking. Three things this change must *measure* rather than assume:

- The Worker's gzip size after the entrypoint (T51).
- Whether the wrapper survives a real deploy (D1's fallback exists if not).
- The plan's actual limits on scheduled invocations, confirmed from the platform rather than from memory, before the cadence is treated as settled.
