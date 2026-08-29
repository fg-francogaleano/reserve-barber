## Context

Three read surfaces already exist on this dashboard and none of them answers a question about a *period*. D1's home is pinned to the business's today and this month; D3's calendar is one barber on one day; D4's directory counts a client's whole history with no bounds at all. D5 adds the first surface where the owner chooses the window.

The constraints it inherits are unusually specific for a read-only page:

- **Aggregate raw SQL is the one thing this project has already been broken by in production.** B4's `pg_advisory_xact_lock` returned `void`, the pg driver adapter raised `UnsupportedNativeDataType`, Prisma surfaced a generic `P2010`, and every booking write failed in the runtime while twenty-four mocked tests stayed green. T58 records it and names **D5** in its trigger, with the specific warning that `GROUP BY` aggregates are where the driver's type mapping is easiest to get wrong.
- **Money is a string in this codebase, everywhere, for a measured reason.** The driver returns a stored `2000.50` as `2000.5` (M3, then PC3 against the live database), and `JSON.stringify` at the RSC boundary drops the second decimal silently rather than raising.
- **Time is never read from the runtime.** The deployment runtime is UTC, the business is at UTC−3, and for three hours of every local day the runtime's calendar readers answer for tomorrow — with a plausible number. `businessTime.ts` is the only module permitted to touch `Intl`, and `businessTime.test.ts` scans the domain directory for the banned literals.
- **There is no row-level security.** Owner scope on a booking reaches through `barber → location → ownerId`, because a booking's location is deliberately not duplicated onto the row (`data-model.md` §11). For an aggregate, forgetting that join produces no row that looks wrong — only a plausible integer.
- **T81 measured what a page like this actually costs.** D4's directory scans every booking of the shop to draw one page, because `Booking` has no index on `clientId` and PostgreSQL creates none for a foreign key. The entry's conclusion was *"the planner is right at this size; indexes come from measurement"*, and D5 has to re-run that measurement rather than inherit its answer.

Two later stories are queued directly behind this one. **D6's charts and D7's breakdowns are written against whatever port this change creates**, which is why the clock decision below is worth more than the five numbers.

## Goals / Non-Goals

**Goals**

- Five figures over an owner-chosen period, from one statement and one round trip, comparable with each other.
- A closed, degrading range vocabulary that never lets a submitted value reach SQL.
- Every calendar boundary computed in the business's timezone, in the domain, and never in the statement.
- Money that survives the driver, the aggregate, the division and the render boundary without becoming a float.
- A gate that proves the statement against the live database, because T58 says a mock cannot.

**Non-Goals**

- Charts, and the charting dependency (**D6**).
- Popular services, most-active barber, hourly distribution (**D7**).
- A cash-collected income figure bounded on `Payment.approvedAt` (**D6**, opened as debt here).
- Arbitrary date ranges, per-location or per-barber filters, period-over-period comparison, export, live refresh.
- Fixing T81's scan shape, or adding an index the planner has not asked for.
- Any write. This change adds no migration and no mutation.

## Decisions

### D1 — Every figure is keyed on `Booking.startTime`

**Confirmed by Franco, 2026-08-28.** The range selects a set of appointments, and all five figures are computed over that set.

The reason is the average. `Seña promedio por turno` is `señas ÷ turnos`; with the numerator bounded on `Payment.approvedAt` and the denominator on `Booking.startTime`, the quotient is a ratio between two different populations and carries no meaning at all. `Clientes únicos` and the cancellation rate the owner reads off the first two cards depend on the same property. Five cards on one page are a *set*, and D1 already established what happens when members of a set answer from different instants: *"the owner would be shown two numbers that cannot both be true."*

**Alternatives considered.** Bounding income on `approvedAt` was the consistent-with-D1 option and is the one an owner reconciles against a bank statement — rejected because it breaks the average and the unique-client figure, which are the reason the cards share a page. Shipping both figures side by side was the honest option — rejected because it widens D5 to six cards and pre-empts what D6's income chart is for.

**The cost is paid in copy, on two pages.** D1's counter stays on `approvedAt`, so a deposit approved on 25 August for a 3 September appointment is in D1's August and in D5's September. Both are right; neither may be labelled just "señas cobradas". This is why `dashboard-home` is a modified capability in this change and not merely a neighbour.

### D2 — Cancellations take the same clock, and carry a `cancelledBy` breakdown

D1's `cancelledToday` is bounded on `cancelledAt`, which is correct for a *"what happened today"* counter. Here the figure is read against the appointment count as a rate, so it takes the appointment's clock: *of the appointments scheduled in this period, this many were cancelled*.

`EXPIRED` is excluded everywhere and unconditionally. `EXPIRED` against `CANCELLED` is how this product tells a deadline apart from a decision, and B7's sweep produces expired rows continuously.

The breakdown by `cancelledBy` costs one extra `FILTER` clause in the same statement and separates two opposite facts about a business — the argument D4 used to justify `inactiveCount`. It is rendered only when non-zero, for the reason D4 gives about that same field: a zero sub-figure is noise where the whole point was to disambiguate.

### D3 — A new port, `IStatisticsRepository`

`IDashboardSummaryRepository`'s own header states it is *"the dashboard home's reads"*, and its separation argument — written down, and echoed by `IClientDirectoryRepository` — is about **shape**, not scoping. Both ports are owner-scoped; what makes them separate is that one hands back an aggregate for one page and the other a projection for another.

D5 is a third shape: an aggregate over a caller-chosen interval, with a derived value. Folding it into the home's port would leave the next reader unable to tell what that port is for.

The port takes `{ ownerId, range: Interval }` and returns one `BusinessStatistics`. **The range arrives already computed**, because turning a business-local calendar boundary into an instant is a domain rule and infrastructure decides nothing — the property `IDashboardSummaryRepository` already states about `dayRange` and `monthRange`.

The port's contract restates, because a future implementer will read it and not this file: the owner join is the tenancy boundary; isolation is proven by a two-owner fixture in both directions; money crosses as canonical decimal strings; counts are narrowed from the driver's wide integer type at this boundary; and the statement narrows without deciding — no figure here asks whether a hold is live, so no clause reads `holdExpiresAt`, and any future one that does must apply `blocksAvailability`'s own clauses rather than a second copy of the rule.

### D4 — Income is a correlated sub-query, never a join into the counted row set

**This is the change's most likely silent defect and the reason the decision is written down.**

`Payment_one_live_per_booking` is `ON ("bookingId") WHERE status <> 'REJECTED'` — deliberately, so a declined card does not block the retry (`isLivePayment`: *"a declined card is exactly the client who will try again"*). A booking may therefore carry many payment rows. Joining `Payment` into `FROM "Booking" b` multiplies that booking's row once per attempt, inflating `count(*) FILTER (…)` on the appointment and cancellation figures while `count(DISTINCT b."clientId")` absorbs the duplication entirely. The result is a page where two numbers are wrong, one is right, and the discrepancy reads as a rounding quirk.

D1's `readSummary` already uses a sub-select for exactly this shape. D5 keeps it and adds the range bound on the **booking's** `startTime` rather than on `p."approvedAt"`.

**The sub-query keeps its own owner predicate** rather than relying on correlation to the outer query. It is redundant today. It stops being redundant the first time somebody edits the outer query, and this is the one place in the product where the failure is a plausible number rather than a visible row.

### D5 — No date arithmetic inside the statement, and `date_trunc` is refused twice

The obvious shortcut for "esta semana" and "este mes" is `date_trunc('week', b."startTime")`. It is refused for two independent reasons, either of which would be enough:

1. **A unit string derived from `?rango` inside a `$queryRaw` template is a caller-influenced identifier reaching SQL.** Parameterisation does not cover an identifier position. This project has never let a stranger's value reach a query, and the resolver family (`recentBookingsParams`, `barberCalendarParams`, `clientPageParams`) exists to keep it that way.
2. **Even hard-coded, `date_trunc` truncates in the session's timezone**, which is UTC on Supavisor and `workerd`. A 21:30 ART appointment would land in the next day; a 23:30 appointment on the 31st in the next month. It is the SQL twin of the runtime calendar readers `bookingCalendar.ts` bans in prose — and it fails the same way, silently, with a plausible answer, for three hours of every day.

The statement therefore receives **two `Date` parameters and an owner id**, and computes no dates at all.

### D6 — The range vocabulary is a closed enum of six, and `hoy` is the unparameterised URL

Six presets: `hoy`, `ayer`, `semana`, `semana-anterior`, `mes`, `mes-anterior`. The submitted value is **matched** against the set, never parsed — the property `recentBookingsParams` established for the barber filter and for the same reason: *an unvalidated read filter is an oracle*.

**No custom range.** Every accepted value is an aggregate over the shop's whole booking history against a pool the public flow shares (T47); an open range is an unbounded family of them, and nothing in `project-context.md` §69 asks for one.

**`hoy` carries no parameter**, following `clientPageHref`'s rule that a default link which spells out its own default makes two URLs for one view.

Resolution degrades to `hoy` for anything unusable — unknown, empty, over a length ceiling, non-canonical — and never raises or 404s. A repeated parameter takes its first occurrence, because the framework surfaces repeats as an array and a page that threw would break on a URL a rewrite produced.

### D7 — Range boundaries live in the domain, on `bookingCalendar.ts`

`dayBoundsOf`, `monthBoundsOf` and `addDays` already exist and are reused unchanged. Two functions are added beside them:

- **`weekBoundsOf(date)`** — Monday 00:00 to the next Monday 00:00, in the business timezone. Monday is an es-AR product decision written down and tested, not a library default; `getDay()` would have made it Sunday and is banned anyway.
- **`previousMonth(date)`** — calendar arithmetic that carries the year.

Both are computed from **both** boundaries rather than one boundary plus a duration, following the reasoning `dayBoundsOf` and `monthBoundsOf` already carry: a day or a month that is not a whole number of 24-hour periods stays correct if Argentina restores daylight saving (T28).

**One `now`, read once and threaded**, from which `businessToday` and then every interval derive. Two `new Date()` calls at 23:59:59.9 would make the heading say *Hoy, viernes* over Thursday's rows.

### D8 — The average is computed in the domain over integer cents, not in SQL

`sum(p.amount) / count(*)` inside the statement is one character away from correct and would be wrong twice.

**The concrete reason is in `toCanonicalDecimal`.** Its two branches disagree: the `Decimal` branch calls `toFixed(2)`, which rounds; the string branch does `(fractionPart + '00').slice(0, 2)`, which **truncates**. Over a `Decimal(12,2)` column and its `SUM` the branches are identical, which is why this has never mattered. A quotient arrives with PostgreSQL's default division scale — many decimals — and would be rounded down one path and rounded half-up the other, chosen by how the driver happened to represent the value.

So the statement returns the **sum and the count**, and `averageDepositPerBooking` in the domain divides over integer cents using `money.ts`'s existing helpers, rounding half-up to two decimals. This follows the precedent `data-model.md` §533 sets for the deposit rule: a monetary rule lives in one value object and *"is never reimplemented per surface"*.

**Zero appointments yields an absent average, not `"0.00"`.** The type makes it unrepresentable as money — `string | null` — because D1's rule is that zero and failure never render alike, and an average of `$ 0,00` over no appointments is a third thing that is neither.

Note the asymmetry the spec pins: a period *with* appointments and *no* approved deposits has an average of exactly zero, and renders as a formatted zero. Only the empty denominator is absent.

### D9 — The range control is rendered by both `page.tsx` and `loading.tsx`, and this segment has no `layout.tsx`

**Resolved during implementation, and it landed on neither option this decision originally wrote down.** The original text is preserved below the answer, because the reasoning that produced a third option is the useful part.

The problem is real: a `loading.tsx` is a static file, so a control placed only in the page disappears on every selection and returns highlighted differently — roughly four tenths of a second at a time, repeatedly, on the one page whose entire purpose is comparing periods.

**What was proposed:** hoist the control into `app/(dashboard)/estadisticas/layout.tsx`, which renders outside the suspense boundary and therefore persists.

**Why that could not work as written:** a layout **does not receive `searchParams`** in the App Router. It cannot know which period is selected. That left two bad endings — a control that never marks anything, or a Client Component reading `useSearchParams`, spending this page's no-JavaScript promise on a highlight.

**What was built instead:** one server component, `RangeNav`, rendered by `page.tsx` **and** by `loading.tsx`. The control never disappears, because something is always drawing it. It carries a correct `aria-current` in the settled state, because the page knows the resolved range. No client JavaScript is involved anywhere. The only artifact left is that the highlight is absent for the duration of the transition — the smallest of the three costs, and the only one that is not a lie about state.

So there is **no `layout.tsx` for this segment**, deliberately, and `RangeNav`'s header carries this argument where the next reader will meet it.

`aria-current` is set **only** on the selected link. `aria-current="false"` is a valid value that screen readers announce, so an unselected link carries no attribute rather than a falsy one.

### D10 — Six `<Link>`s, not a form, and `prefetch={false}`

Six fixed destinations need no form, which is what keeps the page free of client JavaScript — and unlike every dashboard *form*, this page can genuinely keep that promise (T44 does not reach it).

`prefetch={false}` follows D3's design D12 in its **corrected** form: it saves an RSC payload request per link for a range the owner may never open. **Not** because it saves a database round trip — this route has a `loading.tsx`, which is where the default prefetch stops.

### D11 — `Loaded<T>` moves to a shared module

`DashboardSummaryService` declares `Loaded<T>` and gives the argument for it: a discriminated union rather than a nullable, because *"an income card silently reading `$ 0,00` is a false statement about money"*. D5 needs exactly that type for exactly that reason.

It moves to a shared application module and both services import it. Declaring a second copy would put the same argument in two files and let them drift.

### D12 — One statement, and the reason is not speed

Everything comes back in one `$queryRaw`. A Supavisor round trip costs ~0.35–0.40 s from this deployment (measured in B2), so several serial reads would be slow — but the load-bearing reason is D1's: separate queries answer from separate instants, and a booking confirmed mid-render would be counted by one figure and not another.

It also matters that this is the natural place to lose the property. "Add a second query for the average" is the obvious refactor and it breaks the snapshot; D8 is what makes it unnecessary.

### D13 — T58 is answered for this call site, and T81 is re-measured rather than inherited

**T58** names D5 in its trigger and requires the new raw call to be added to a gate *in the same change*. `scripts/d5-gate.ts` is that gate. Its most important probes are the ones a mock structurally cannot run: that `count(DISTINCT …)` and `COALESCE(sum(…), 0)` come back as types the adapter can deserialize at all, on `workerd` as well as Node.

**T81** established the shape of D4's cost by running `EXPLAIN (ANALYZE, BUFFERS)` and correcting the design's own guess. D5 runs it again on its own statement rather than assuming the answer transfers. Two things differ: `count(DISTINCT b."clientId")` forces a sort or hash over the whole matched set, and the range predicate on `startTime` may or may not let the planner use `@@index([barberId, startTime])` given the owner scope lives on `Barber`. **No index is added unless the plan asks for one** — D1's rule, and T81's own conclusion at today's volume.

### D14 — The late-payment money becomes visibly invisible, and that is opened as debt

The spec requires an `APPROVED` payment on a non-`CONFIRMED` booking to be excluded from income. It is the roadmap's own stated requirement and it is right: that is money the owner owes back.

The consequence is that such money now exists in the database and appears on **no dashboard surface at all** — D1 excludes it, D5 excludes it, and the only trace is one error log line from B7's sweep. Before D5 the owner had no reporting surface to miss it from. Now they have one, and it is silent.

This change does not build that surface — it has no story, no design and no owner. It opens a tech-debt entry naming D5 as where the gap became structural, with the sweep's log line as the current mitigation.

## Risks / Trade-offs

- **The driver rejects an aggregate's return type on `workerd`** → exactly T58's failure, and the gate is the only thing that can see it. Run the gate before the page is wired, and run the runtime pass on both engines.
- **Someone later folds income into a join for tidiness** → D4's defect returns silently. The port's contract states the property, the repository carries the comment, and the gate has a two-`REJECTED`-plus-one-`APPROVED` fixture whose failure is unmistakable.
- **The statement's cost grows with the shop's whole history**, like T81's → measured in this change with the plan captured; not fixed, because at today's volume the planner is right and an unused index is worse than none.
- **The `layout.tsx` hoist cannot mark the current range without client JavaScript** → D9 states the fallback and the decision point. Either outcome is acceptable; an undocumented one is not.
- **Two income figures that disagree by design** → mitigated only by copy, on both pages, which is why `dashboard-home` is modified here rather than left alone. If the copy is wrong, the mitigation is absent.
- **No rate limit on an authenticated aggregate sharing the public flow's pool** → the closed enum bounds the URL space, not the request rate. Accepted for this change: it is the authenticated mirror of T47 and belongs with it rather than as a one-page fix.
- **Bundle** → `main` measures 3167.86 KiB gzip against a 10 MiB ceiling (T51). The risk is not this page's markup; it is reaching for a chart or dashboard library "just for the cards" and spending D6's budget early. Measure the delta and record it.

## Migration Plan

No migration. No schema change, no data change, no write path touched.

Deployment is the ordinary one. Rollback is reverting the change: the page disappears, the nav entry disappears, and nothing else in the product depends on either. The only edit outside the new capability is the copy on D1's income card and the shared `Loaded<T>` extraction — both inert on their own.

If the `EXPLAIN` does ask for an index on `Booking.clientId`, that becomes a migration and is added in this change with the plan that justified it recorded alongside it.

## Open Questions

- ~~**Does the `layout.tsx` hoist (D9) survive contact with the runtime?**~~ **Answered during implementation: no, and it did not need to.** A layout receives no `searchParams`, so the hoist could not mark the current period without client JavaScript. Rendering the same server component from `page.tsx` and `loading.tsx` keeps the control on screen *and* keeps `aria-current` correct, with no layout and no client bundle. See D9.
- **Does the plan ask for an index?** Unknown until `EXPLAIN (ANALYZE, BUFFERS)` runs against real rows. The answer is part of the deliverable, including "no".
- **Is `mes-anterior` enough, or does the owner want `últimos 30 días`?** The brief says *"hoy, ayer, esta semana, etc."* and stops. Six is a judgement; a seventh is a one-line addition to a closed enum if Franco asks for it after using the page.
