## Why

**The dashboard can say what happened today and it cannot say what happened last week.** D1's counters are fixed to the business's today and this month; D3's calendar shows one barber and one day; D4's directory counts a client's whole history with no period at all. There is no surface anywhere in the product where an owner can ask *"was this week better than the last one"* — which is the question that decides whether they keep a barber on Tuesdays, whether the deposit policy is working, and whether the shop is growing.

The brief has named this since intake — `project-context.md` §69: *"Estadísticas: filtro por rango de tiempo (botones: hoy, ayer, esta semana, etc.). Tarjetas: reservas totales, ingresos totales, cancelaciones, promedio por turno, clientes únicos."* It is also the story two others are queued behind: **D6's charts and D7's advanced breakdowns are both written against whatever read this change creates**, which is why the decisions here are worth more than the five numbers.

**And the numbers are easy to get wrong in a way nothing surfaces.** Every defect in this feature is a plausible integer. D1 and D4 both wrote their tenancy rules against exactly that class of bug — *"a leaked aggregate produces no row that can look wrong, only a plausible integer"* — and this change compounds it by adding money, a caller-chosen period, and a division.

**T58 names this story by name.** Its trigger is *"the next raw-SQL call added anywhere (B5, **D5**)"*, and its warning is specific: *"`GROUP BY` aggregates are exactly where the driver's type mapping is easiest to get wrong."* B4's advisory lock returned `void`, the pg driver adapter could not deserialize it, **every booking write failed in the runtime**, and twenty-four green tests certified the call that could not work. The entry requires the new raw call to be added to a gate **in the same change**, not after it.

## What Changes

### The capability

- **A statistics page** at `/estadisticas`, with a nav entry: five figures and one range control, entirely server-rendered, no client JavaScript.
- **A closed enum of six preset ranges**, resolved from `?rango=` — `hoy` (canonical, unparameterised), `ayer`, `semana`, `semana-anterior`, `mes`, `mes-anterior`. Not a free date range: an arbitrary pair of dates is an unbounded family of URLs on a page that issues an aggregate over the shop's whole booking history, and nothing in the brief asks for one.
- **All five figures over one set of appointments, selected by `startTime`** — see the decision below, which is the change's centre of gravity.
- **Every figure counts confirmations, never rows.** A row count is a count of *checkout attempts*; abandoned holds accumulate without bound relative to real business. D1's rule for its historical counter, D4's for its per-client count.
- **Income joins through the booking's status.** `data-model.md` §Payment and the roadmap both state it: B5 and B6 each produce an `APPROVED` payment whose booking never confirmed — the late-payment case, where the hold lapsed and the slot was resold. That is money the owner **owes back**, not revenue.
- **The average is a domain computation over integer cents**, and is **absent** rather than zero when the period has no confirmed bookings.
- **A cancellation breakdown by `cancelledBy`**, shown only when non-zero. One extra `FILTER` clause in the same statement, and *"my clients cancelled three"* against *"I cancelled three on them"* are opposite facts about a business — the argument D4 used for `inactiveCount`.
- **A new owner-scoped read-only port**, `IStatisticsRepository`, answering from **one statement and one round trip**.
- **New calendar arithmetic in the domain**: `weekBoundsOf` (Monday-based, es-AR) and `previousMonth`, built on `localToInstant` like every other boundary in `bookingCalendar.ts`.
- **No migration.** D5 is read-only and adds no column, no table and — unless the measurement asks for one — no index.

### The decision this change exists to make

**Every figure is keyed on the booking's `startTime`.** Confirmed by Franco on 2026-08-28, over the two alternatives.

The five cards are a **set**, and a set is only comparable when its members answer over the same rows. `Seña promedio por turno` is `señas ÷ turnos`; with the numerator bounded on `Payment.approvedAt` and the denominator on `Booking.startTime` the division is a ratio between two different populations and means nothing. The same argument applies to `Clientes únicos` and to the cancellation rate an owner reads off the first two cards.

**This diverges from D1 on purpose, and it makes D1's own card ambiguous, which is why `dashboard-home` is a modified capability.** D1's `monthDepositIncome` is bounded on `approvedAt` — deliberately, because that card is cash-in an owner reconciles against a bank statement. D5's is deposits belonging to the period's appointments. Two correct numbers that will not match, on two pages of the same dashboard, is a support question waiting to happen unless **both** state their basis. D1's spec already forbids the label implying turnover; it does not yet require it to say *when*.

The cash-collected figure is not lost. It is **deferred to D6**, where the income-evolution chart gives it a time axis and a place to live without competing with the average, and it is recorded as debt in this change rather than left to memory.

### What the edge-case pass forced into scope

- **A booking can carry many `Payment` rows, and joining them into the main `FROM` inflates every other figure.** `Payment_one_live_per_booking` is `ON ("bookingId") WHERE status <> 'REJECTED'`, so any number of declined attempts coexist with one live payment — deliberately, per `isLivePayment`: *"a declined card is exactly the client who will try again"*. A client who was declined twice before paying multiplies that booking's row three times through `turnos confirmados` and `cancelaciones`, while `count(DISTINCT clientId)` absorbs it — which makes the inconsistency look like a rounding quirk rather than a join defect. **Income is a correlated sub-select**, as D1's is.
- **`date_trunc` is refused twice over.** A unit string derived from `?rango` inside a `$queryRaw` template is a caller-influenced identifier reaching SQL. And even hard-coded it truncates in the **session's** timezone — UTC on Supavisor and `workerd` — so a 21:30 ART appointment lands in the next day and a 23:30-on-the-31st one in the next month. It is the SQL twin of the runtime calendar readers `bookingCalendar.ts` bans in prose. **No date arithmetic inside the statement**: the range arrives as two `Date` parameters.
- **`toCanonicalDecimal` has two branches that disagree, and an SQL-computed average is what makes them disagree.** Its `Decimal` branch is `toFixed(2)` — it rounds; its string branch is `(fractionPart + '00').slice(0, 2)` — it **truncates**. Identical over a `Decimal(12,2)` column and its `SUM`, divergent over a quotient carrying PostgreSQL's default division scale. This is why the average is computed in the domain over integer cents, and it is an argument from the code rather than from taste.
- **The range control disappearing during `loading.tsx` is a real defect, not a cosmetic one.** A static loading file cannot know which range is selected, so on every click the six-link nav vanishes and returns highlighted differently, roughly four tenths of a second at a time, on the one page whose entire purpose is comparing periods.
- **Three states that must not look alike**: a period with no bookings, a shop that has never had one, and a read that failed. D1's rule that zero and failure never render alike, plus D4's rule that an empty page and an empty business are different facts.
- **A shop with no barbers returns one row of zeros, not zero rows** — the aggregate has no `GROUP BY`. D1's `row === undefined` guard is for a wrong shape, never an empty shop, and the next reader will "fix" it into a failure state unless the comment says so.

### What is deliberately not here

- **No charts.** D6 owns them, and it owns the charting dependency with them. `main` measures 3167.86 KiB gzip against the paid plan's 10 MiB ceiling (T51); reaching for Tremor "just for the stat cards" spends D6's budget in D5.
- **No most-popular-service, most-active-barber or hourly distribution.** D7, explicitly, per the roadmap.
- **No cash-collected income figure.** Deferred to D6 and opened as debt here.
- **No custom or arbitrary date range.** The closed enum is the design, not a shortcut.
- **No per-location or per-barber filter.** Not in the brief's §69. `data-model.md` §418 already anticipates it — *"Location-filtered statistics join through Barber"* — so the port must not make it awkward to add, but D5 ships without it.
- **No comparison against the previous period**, no CSV or PDF export, no live refresh (D8's family).
- **No index on `Booking.clientId` unless the measurement asks for one.** D1 set the rule that indexes come from measurement; T81 is the entry that got it right by running `EXPLAIN` instead of guessing, and it is the entry this change re-measures.

## Capabilities

### New Capabilities

- `business-statistics`: the owner's measurement of their business over a chosen period. What each of the five figures counts and which instant bounds it, why all five share one clock and how that relates to the dashboard home's differently-clocked income, the closed range vocabulary and how a submitted `?rango` is resolved and degraded, the Monday-based week and the business-calendar boundaries every range is built from, the absent-versus-zero rule for the average, the cancellation breakdown, the one-statement one-round-trip owner-scoped read contract, the injection and timezone prohibitions on the statement itself, every empty and failure state, and the gate that proves all of it against the live database.

A capability of its own rather than a section of `dashboard-home`: that spec governs a fixed set of counters bound to today and this month plus a bounded recent list, and its requirements are written about those figures on that page. A caller-chosen period with its own vocabulary, its own clock and its own derived value is not a subsection of it.

### Modified Capabilities

- `dashboard-home`: the **Income joins through the booking, is bounded by approval, and is named as deposits** requirement gains a fourth condition. Its condition 3 already forbids any string implying turnover; it does not yet require the label to say *when* the money is counted. Once a second income figure exists on another page under a different clock, a card reading only "señas cobradas" is ambiguous between the two. The requirement is amended so the label states the basis — deposits **approved during** the month — and a scenario is added for it.

## Impact

**New:**
- `app/(dashboard)/estadisticas/` — `page.tsx`, `layout.tsx` (the range nav, hoisted so it survives the suspense boundary), `loading.tsx`, the composition root, and their tests including the source-level composition-root assertion C2, D3 and D4 established.
- `src/server/domain/models/statistics.ts` — the aggregate's shape, the range vocabulary, and the average's rounding rule.
- `src/server/domain/repositories/IStatisticsRepository.ts` — the port.
- `src/server/infrastructure/prisma/PrismaStatisticsRepository.ts` — the adapter, one `$queryRaw`.
- `src/server/application/services/StatisticsService.ts` — the composition.
- `src/server/application/dashboard/statisticsRangeParams.ts` — the `rango` resolver.
- `scripts/d5-gate.ts` and, if the runtime pass needs seeded rows, `scripts/d5-runtime-fixture.ts`.

**Modified:**
- `src/server/domain/models/bookingCalendar.ts` — `weekBoundsOf` and `previousMonth`.
- `src/server/application/services/DashboardSummaryService.ts` — `Loaded<T>` moves to a shared module rather than being declared a second time.
- `app/(dashboard)/layout.tsx` — one nav entry.
- `src/lib/copy.ts` — the `statistics` namespace, and `dashboard.monthIncomeHelp` re-worded to state its basis.
- `openspec/specs/dashboard-home/spec.md` — via the delta above.
- `docs/tech-debt.md` — T58 answered for this call site, T81 re-measured, and new entries for the invisible late-payment money and anything the `EXPLAIN` surfaces.
- `docs/roadmap.md` — the D5 entry.

**Dependencies:** none added. No package, no provider, no environment variable, no external call. The composition root builds a Prisma client and a logger — no cipher, no storage client, no payment gateway — so the count of surfaces permitted to decrypt a Mercado Pago credential is unchanged, and a test asserts it.

**Verification:** `scripts/d5-gate.ts` against the live database — two-owner isolation in both directions **including the income sum specifically**, an `APPROVED` payment on an `EXPIRED` booking excluded, a booking with two `REJECTED` payments plus one `APPROVED` counted exactly once, half-open boundaries at both ends, a client with three confirmed bookings counted once, the `2000.50` trailing zero, the average absent at zero, the round-trip count measured through a query extension rather than claimed, and `EXPLAIN (ANALYZE, BUFFERS)` captured. Then an authenticated runtime pass on Node and `workerd`, including D3's cheap timezone technique — a server whose own calendar has already rolled to the next date.

> ⚠ **T68 hygiene is not optional on this gate.** The entry is **intermittent**, which D4 established the hard way: `repeat('x', 1400)` never returned at 11:30 and two megabytes came back in 347 ms at 17:40 on the same connection string from the same machine, with none of the listed fixes applied. A green gate is therefore not evidence the fault is gone and a hanging gate is not evidence of a product defect. Run the documented payload check **first**, keep `probeOrSkip`, and report every probe that cannot run as **not run** — never as passed. This story's own payload is small by construction — five integers and a decimal — so the ceiling should not bite here; confirm that rather than assume it.
