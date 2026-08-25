# D1 — Design

## Context

`app/(dashboard)/page.tsx` is still S0's walking skeleton: it lists the owner's locations, which `/sucursales` has owned since M1, and its own docstring says it "becomes the Inicio summary in story D1". Nothing else in the dashboard links to it — `layout.tsx` has seven nav links and none is home.

Everything this page needs to read already exists and is already correct. What does not exist is a _reader_, and this project has repeatedly recorded that this particular reader is the one most likely to be written wrong:

- `backend-standards.md` rule 2: the sweep "records that the slot was released… so a reader that filters on status alone — **the shape a dashboard of counters naturally takes** — is correct rather than accidentally correct."
- B7's roadmap entry: "D1 is a page of counters and is the most natural place for that to be forgotten."
- `data-model.md` §12: "Statistics and income counters must therefore join through the booking's status rather than counting approved payments alone."
- The roadmap says it twice more, for D1 and again for D5.

So the interesting content of this change is almost entirely **definitional**. There is no concurrency, no external service, no secret, no write. There are six numbers, and each has a wrong version that is shorter to write than the right one.

Three constraints shape it:

- **A round trip to Supavisor costs ~0.35–0.40 s** from this deployment (measured, `docs/tech-debt.md`). Seven of them serially is a 2.5-second landing page.
- **T51**: the app Worker sits ~148 KiB under the free-plan ceiling, and Cloudflare's own measurement is stricter than the figure wrangler prints. This change may not spend any of that.
- **T44**: ten dashboard forms already depend on `useActionState` and none of them works without JavaScript. This change must not become the eleventh. (It does not — but see D8: it turned out not to escape the entry either, and widened its Cause 1 on the way.)

## Goals / Non-Goals

**Goals:**

- Six counters, each defined as a predicate over named columns, not as a label.
- Income that is honest about what it is and about what it excludes.
- A recent-bookings list that shows `EXPIRED` and `CANCELLED` rows — the first surface in the product that does.
- A queue narrowing that repairs a live defect in D2 rather than working around it.
- One consistent snapshot for the booking figures, in four concurrent round trips — one round trip of wall clock.
- Zero client JavaScript on the page.

**Non-Goals:**

- Live updates. The counters are a snapshot per render; polling is **D8**.
- Any write. No Route Handler, no Server Action, no mutation. An edit under `app/api/` means something was misunderstood.
- Contact details. Email and phone belong to **D4**.
- A per-barber calendar (**D3**), time-ranged statistics (**D5**) or charts (**D6**).
- Telling the owner _why_ a hold expired, or that the cron is alive — see D11 below.
- Detecting a confirmed appointment stranded outside its barber's working hours (**T29**).
- Snapshotting the client's name onto `Booking` (**T54**) — see D10.

## Decisions

### D1 — Every counter is a predicate in the spec, not a noun in a label

"Today's bookings" admits at least four readings: by `startTime` or by `createdAt`, confirmed-only or every status. They are not close to each other — on a shop with a broken checkout, one reads 0 and another reads 40.

Each of the six is written into `dashboard-home/spec.md` as a `WHERE` clause with the reason attached, and each label names what its predicate counts. "Turnos confirmados (histórico)" rather than "Turnos totales" is not cosmetic: it is the only thing that makes the number checkable by the person reading it.

**Alternative rejected:** define them in the repository and let the label follow. That puts the definition in the layer that is easiest to change and hardest to review, and it is how a counter's meaning drifts from its name.

### D2 — Two numbers for today, never one

"Turnos de hoy" counts `CONFIRMED`. Live holds get their own subordinate line.

Summing them produces a number that answers neither question — an owner planning their day needs the confirmed count, and an owner wondering whether the checkout is working needs the other. Keeping them apart also makes the diagnostic case legible: a big second number over a zero first number _is_ the diagnosis.

The second number uses `blocksAvailability`, not a status filter. It asks "could this still become an appointment", and that question reads a deadline. Re-expressing it in SQL is the drift `IBookingRepository.createProvisional` and `IExpiredHoldRepository.findLapsedHolds` both forbid, for the same reason.

### D3 — Cancellations are guarded twice, and the redundancy is deliberate

`status = 'CANCELLED'` **and** `cancelledAt` inside today. The sweep leaves `cancelledAt` null (`expire` writes one column), so either condition alone excludes expired rows today.

Both are kept because "correct by accident" is exactly the failure mode this project keeps naming. The status guard states the intent — a decision, not a deadline. The timestamp guard is what makes "today" mean the day the decision was made rather than the day of the appointment. A future path that sets `cancelledAt` without `CANCELLED`, or vice versa, breaks only one of them.

**A test asserts an `EXPIRED` row carrying a non-null `cancelledAt` is not counted**, so the redundancy is executable rather than a comment.

### D4 — Income: three conditions, and the third is a label

1. **Join through `booking.status = 'CONFIRMED'`.** `confirmIfSlotFree` produces `APPROVED` payments on bookings that never confirmed; B7 logs them at error with the amount because they are refunds owed. Counting them is reporting a liability as revenue.
2. **Bound on `approvedAt`.** Both writers set it — `PrismaPaymentRepository` on the Mercado Pago path, `PrismaTransferReceiptRepository.approve` on the transfer path — so it is reliable, and it is the only one of the candidate columns that means "the money moved". `createdAt` is when the checkout opened; `booking.startTime` is when the haircut is.
3. **Label it "señas cobradas".** This product never records the balance paid in the chair. An owner reading "Ingresos del mes" as turnover reads a number wrong by the whole service price minus the deposit. This is the same rule D2 followed under T66: a surface must not imply a fact the system does not have.

**Alternative considered for (2):** bound on the booking's `startTime`, giving "income earned for work done this month". That is a defensible accounting view and it is **D5's** to offer as a range filter. For a single at-a-glance number, cash-in is the one an owner can reconcile against a bank statement.

### D5 — One statement for six figures, and the reason is not only speed

A single `$queryRaw` returning one row — scalar subqueries, or `count(*) FILTER (WHERE …)` over one owner-scoped join. `backend-standards.md` → Performance already asks for this ("compute dashboard aggregates with SQL aggregate queries rather than loading rows into memory").

Speed is the obvious reason: six queries at ~0.37 s each is 2.2 s, and running them in parallel spends the isolate's outbound connection budget on the most-visited authenticated page in the product.

**The better reason is consistency.** Six queries answer from six instants. A booking confirmed mid-render would be counted by "Turnos de hoy" and not by "Turnos confirmados", and the owner would see two numbers that cannot both be true. One statement makes the six a snapshot.

Total budget: **four round trips, issued concurrently** — the aggregate, the pending-receipt count, the recent list, the barber options — under `Promise.all`. Because they are concurrent the wall-clock cost is one round trip, not four. Measured by the gate; if it lands above ~1.2 s that is a finding to record, not a number to accept quietly.

**The receipt count is the fourth read and not a sixth column of the statement, and that was a correction made during implementation.** The original plan folded all six figures into the aggregate. Writing it exposed the conflict: D7 requires the pending predicate to be expressed **once** and shared by the queue and its count, and a raw reporting statement cannot share a Prisma query fragment with the receipt repository. Folding it in would have re-created the exact drift this change exists to remove — the next narrowing of the queue would desynchronise the counter again, silently. The predicate is worth more than the round trip, and since the reads are parallel the round trip costs approximately nothing.

### D6 — A separate port, because the shape differs, not the scoping

`IDashboardSummaryRepository`, not three new methods on `IBookingRepository`.

`IBookingRepository` states about itself that every method is keyed by something owner-scoped so an unscoped query is inexpressible through it. That property survives either way here — the aggregate is owner-keyed. What does not survive is the contract's _shape_: it reads and writes bookings, and an aggregate returns counts and a sum. `IExpiredHoldRepository` set the precedent of writing a new port when an existing contract would have had to stretch; the exception there was to ownership, here it is to shape, but the move is the same and the reason is the same — the next reader should not have to tell a deliberate widening from an erosion.

The recent-bookings listing is a separate method with its own explicit projection, not a reporting method on the aggregate port.

### D7 — The receipt queue narrows at the source

`findPendingForOwner` gains `payment: { booking: { status: 'PENDING_APPROVAL' } }`, and `countPendingForOwner` is added beside it over **one exported `where` fragment**.

This is a fix to shipped code, and D1 is where it surfaces rather than where it originates. `expire()` writes `Booking.status` and nothing else — deliberately, so a late notification can still complete a payment's own history — so a receipt on a swept booking stays `PENDING` forever. Today `/comprobantes` renders it with an **Aprobar** button that can only answer `noLongerPending`. A counter over the unnarrowed predicate would climb monotonically and never return to zero.

**Alternative rejected: have the sweep also set the receipt to `REJECTED`.** That would put a review decision in a job that is explicitly forbidden from making one — `IExpiredHoldRepository.expire` says it "SHALL write `status` and nothing else", and `REJECTED` is a word that means a human looked. The read-side narrowing costs one clause and changes no write.

**Alternative rejected: filter in the counter only.** Then the counter and the queue disagree, which is worse than having no counter.

Per `base-standards.md` §7, the spec artifacts for this move land before the code: this change carries the `transfer-receipt-review` delta, and T64 is updated in the same change.

### D8 — The filter is a GET form, and that is the whole design

A `<form method="get">` with a native `<select name="barbero">` and a submit button. No `'use client'` anywhere in this change.

`frontend-standards.md` supplies both halves. Radix's `Select` "renders a button and a portalled listbox — it is not a form-associated control" and submits nothing without a client-side mirror. And the house form pattern's `useActionState` is what T44 is about — ten dashboard forms that silently accept a no-JS submission and report nothing back.

A GET form needs neither. It navigates, the server re-renders from the URL, and there is nothing to hydrate, so the page ships no client JavaScript at all.

**What this does NOT buy is a page that works with JavaScript disabled, and that was claimed here before it was measured.** Driven against the production build on `workerd` with JavaScript off, `/` renders the loading skeleton and never resolves: the segment has a `loading.tsx`, so Next streams the route — the fallback is sent first and the real markup is swapped in by inline scripts that do not run. The filter is never reached, because nothing below the boundary is.

**Removing `(home)/loading.tsx` would not fix it**: the route would inherit `(dashboard)/loading.tsx` instead, and `/` has sat behind that boundary since A1. So this is not a regression D1 introduced — it is a claim D1 got wrong, and the code is unchanged by the correction.

The finding is worth more than the claim was, and it is a **widening of T44's Cause 1 rather than a new cause**. That entry measured pages whose shell renders outside the boundary and whose _client components_ fall inside it — "the `<form>` is simply absent". This page is `force-dynamic` with its whole body awaiting a read, so everything is inside the boundary and the fallback is the entire response. **A route built from pure Server Components is not immune**, which is precisely the inference this design made and got wrong. Recorded there.

**The submitted id is matched against the owner's own barber list, never passed to the query.** This is `bookingSelectionParams.ts`'s rule, and it matters more here than it looks: unlike every other dashboard input this one is a _read_ filter, so nothing else guards it. Passed through with only `barberId` in the `where`, it turns the dashboard into an oracle — a valid foreign id returns that barber's bookings, an invalid one returns nothing. The query stays owner-scoped **in addition** to the filter.

The parameter is typed `string | string[] | undefined`. Next hands over an array for a repeated parameter; `bookingSelectionParams.ts` calls typing it otherwise "wrong about its own input", and that holds for an authenticated caller too.

### D9 — Zero and failure are different states, and the income card is why

Three states per counter block: loaded, zero, failed. A failed read renders a distinct state; it never defaults to `0` or `$ 0,00`.

`Promise.all` rejecting would send the owner's landing page to `error.tsx` and show a generic apology in place of five figures that were fine. Catching and defaulting to zero is worse: **an income card silently reading zero is a false statement about money**, and it is indistinguishable from a shop that earned nothing.

Granularity follows the query shape. The six counters come from one statement, so they succeed or fail together and share one failure state. The recent list is a separate read and fails separately. Both are caught in the page's fetch wrappers, logged via `toErrorLogContext`, and never rendered.

`0` for a shop with no bookings is a _loaded_ state and renders as an ordinary number.

### D10 — T54 is decided here and fixed elsewhere

`Client` deduplicates on `(ownerId, email)` and a returning client's rename overwrites the stored name; `Booking` snapshots no contact detail. T54 names "D1 or D4" as the first surfaces where this becomes visible, and says the fix — snapshotting `clientName`/`clientPhone` onto `Booking` — "only gets more expensive".

**Decision: not in D1, and the entry is re-costed rather than left implying it is still cheap.**

Three reasons. The recent list is ten rows ordered by `createdAt`, so the "a booking from March shows September's name" case is barely reachable through it — D4's client table and D3's calendar are where it bites. The fix is a schema change _plus_ an edit to B4's booking transaction, and D1 otherwise contains no write at all; adding two columns and a write path to a read-only story is the kind of ride-along B4 itself declined. And the entry's own justification ("a migration over a table with zero rows") is no longer true, so it needs updating in this change regardless of which way the decision goes — leaving a stale justification is what that entry warns against.

### D11 — T67 half-closes, and the half that does not is said out loud

The recent list's `EXPIRED` badges and the "Reservas sin confirmar hoy" line give the owner the first surface that says a hold lapsed. That is T67's first gap.

The second gap — a dead cron looking exactly like a healthy one — is **not** closed by any counter, because no figure on this page changes when the sweep stops running. A "última limpieza" line would need a new column or a log query, and neither is in scope. The entry is updated to say which half closed; claiming the counters covered both would leave the sharper gap looking handled.

### D12 — `monthBoundsOf`, in the domain, tested on the boundary that breaks

New in `bookingCalendar.ts` beside `dayBoundsOf`, built from `localToInstant` on the first of this month and the first of next.

The two wrong versions are both shorter: `new Date(y, m, 1)` builds the boundary in UTC and pulls the last three hours of the previous month into this one, and adding 30 days is wrong eight months a year. `businessTime.test.ts` scans this directory for the banned literals, so a lapse into `getDate()` fails the suite rather than shipping.

Tested at 23:30 ART on the last day of a month, across a 31→1 rollover and across February.

### D13 — Indexes are measured, not assumed

`Booking(barberId, startTime)` leads with `barberId` and serves none of these predicates — the same reason B7 needed its own two. Candidates: `Booking(status, startTime)` and `Payment(status, approvedAt)`.

`EXPLAIN` against the live database decides, in the gate, before any migration is written. If one ships it is raw SQL with the schema comment every invisible index here carries, and it touches no data.

Adding both on the assumption they help would be five guessed constants' worth of the same habit this project keeps disclosing rather than repeating.

### D14 — The loading boundary needs its own folder

`app/(dashboard)/loading.tsx` looks like the home's skeleton and is not only that: the four create/edit form routes (`sucursales/nueva`, `servicios/nuevo`, `barberos/nuevo`, `*/[id]/editar`) have no `loading.tsx` of their own and inherit it. Rewriting it into a counter grid gives those forms a counter-grid skeleton.

The home moves into a route group — `app/(dashboard)/(home)/page.tsx` with its own `loading.tsx` — leaving the group-level file as the generic fallback it actually is. The URL is unchanged; a route group contributes no path segment.

## Risks / Trade-offs

- **A counter is defined correctly and read wrongly by a human** → every label names its predicate, and the income card carries a one-line qualifier. The gate asserts the figures; the labels are what make them checkable.
- **The aggregate is written as raw SQL and drifts from the schema** → it is covered by the live gate, which is the only thing that can catch a column rename in a `$queryRaw`. `tsc` cannot.
- **Raw SQL invites a re-expression of the blocking rule** → the spec forbids it and the reviewer's test is simple: the statement may narrow by status, owner and an instant range, and nothing else. The live-hold figure goes through `blocksAvailability` above the repository.
- **Three concurrent reads on a runtime with a small outbound connection budget** → three is well inside it, and the alternative (seven) is what the single statement exists to avoid. Measured by the gate.
- **The narrowed receipt queue hides a row an owner was watching for** → it hides only rows whose approval the system would refuse. Anyone relying on seeing them was relying on a broken control.
- **`force-dynamic` on the most-visited page** → unavoidable: it reads a session and names clients. Same trade `/comprobantes` already makes.
- **No live update; two tabs disagree** → known and deferred to D8. A reload is always authoritative, and nothing here is optimistic.
- **The counters and the list can disagree by one booking** → they are separate reads. Unavoidable without a repeatable-read transaction, which is not worth a connection on a read-only page. Recorded here so the discrepancy is recognised rather than investigated.

## Migration Plan

**Schema:** nothing, unless D13's measurement calls for an index. Any migration adds indexes only.

**Deploy:** ordinary app deploy — `npm run deploy`. The cron Worker is untouched.

**Rollback:** revert the commit. The change adds no column, writes no row, and takes no lock, so there is nothing to undo in the database. The narrowed receipt queue reverts with it.

**Sequence:** spec artifacts (T64, the `transfer-receipt-review` delta) → domain (`monthBoundsOf`) → application → infrastructure → page → gate → `wrangler deploy --dry-run` for T51 → Franco runs the preview and the deploy.

## Open Questions

1. **Does either candidate index earn its place?** Resolved by `EXPLAIN` in the gate, before the migration is written. Not resolved by opinion.
2. **Is ten the right size for the recent list?** A guess, and disclosed as one — the sixth in this project's family of guessed constants. It is a named constant so the next answer is a one-line change.
3. **Does the aggregate stay inside the 10 ms CPU soft limit once a shop has real volume?** The gate prints the wall-clock cost against a seeded fixture, which is a floor, not an answer. The real answer arrives with the first shop that has a year of bookings.
