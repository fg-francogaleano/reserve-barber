# D7 — Advanced statistics (services, barbers, hour-of-day)

> Pre-spec enrichment. Input for `/opsx:new` or `/opsx:ff` on this same change
> folder. **No code is proposed here** — this document exists so the spec that
> follows it cannot be written thin.
>
> Branch: `feat/d7-advanced-statistics`, cut from `main` at `2cf3aa6` (D6 merged).

---

## Original

> **D7** — As the owner, I want advanced statistics (most popular services, most
> active barber, hourly distribution of bookings), so that I can optimize
> staffing and offerings. — _depends on: D5_

That is the whole ticket, as it stands in `docs/roadmap.md` (Phase 3 —
Could-Have). It names three analyses and nothing else: no basis, no period
vocabulary, no ranking rule, no ordering, no empty states, no failure states, no
read budget, and no statement of how "hourly" is to be computed on a runtime
whose clock is UTC.

**It is not implementable as written.** Three specific gaps make it so:

1. **"Hourly distribution" is ambiguous and the ambiguity is load-bearing.** D6
   already draws an *income* chart bucketed by hour when the range is `hoy` or
   `ayer`. D7's chart is a different measure over a different axis — appointments
   per **hour of day**, folded across every day of the period — and reading it as
   "the same chart with a different metric" produces a one-day-only feature that
   answers nothing about staffing.
2. **The page already carries a tested budget of two round trips**, and a third
   read violates a shipped requirement. `base-standards.md` §7 makes that a spec
   amendment before it is a line of code.
3. **`extract(hour …)` and `date_trunc` are banned in this capability**, twice
   over and in writing (`IStatisticsRepository` rules 5 and 11). The story's
   central chart is precisely the one that invites them.

---

## Enhanced

### 1. Story

**As** the owner of the barbershop,
**I want** to see, for the period I already select on `/estadisticas`, which
services are booked most, which barber works the most appointments, and how my
confirmed appointments spread across the hours of the day,
**so that** I can decide what to offer, how to price it, and when to have people
on the floor.

**Placement.** Three new sections on the **existing** `/estadisticas` page,
beneath D6's two charts. No new route, no new query parameter, no new navigation
entry. The range control (`?rango=`) and its closed set of six periods are reused
verbatim.

---

### 2. Scope

#### In scope

| # | Analysis | Measure | Axis / order |
|---|---|---|---|
| **A** | Most popular services | `CONFIRMED` bookings whose `startTime` falls in the period, grouped by `Booking.serviceId` | Ranked descending by count |
| **B** | Most active barber | The same row set, grouped by `Booking.barberId` | Ranked descending by count |
| **C** | Hour-of-day distribution | The same row set, grouped by the **business-local hour** of `startTime`, folded across every day of the period | Fixed axis `00`–`23`, never re-ordered |

All three share **one row set** — the confirmed bookings of the period — which is
what makes the reconciliation invariant in §5.4 decidable.

#### Explicit non-goals (recorded so they are not re-litigated in design)

- **No revenue-per-service or revenue-per-barber.** `IStatisticsRepository`
  rule 4 forbids joining `Payment` into a counted row set (a booking carries any
  number of `REJECTED` rows by design, so the join multiplies it). Money per
  service would need its own sub-aggregate, and the story says *popular*, not
  *profitable*. If it is wanted, it is a separate story.
- **No date picker and no `?top=` parameter.** The range vocabulary stays the
  closed set D5 shipped, for the reason recorded there: every accepted value is
  an aggregate over the shop's whole booking history against a pool the public
  booking flow shares (T47), and an arbitrary range is an unbounded family of
  them.
- **No per-location breakdown.** Barbers carry their location for
  disambiguation (§3.2), not as a grouping of its own.
- **No cancellation or expiry breakdown by service/barber.** Confirmed only, so
  the three sections reconcile against `confirmedCount`.
- **No comparison against the previous period.** Ranked deltas are a different
  feature with a different read.

---

### 3. Functional specification

#### 3.1 Most popular services

- **Row set:** `Booking` where `status = 'CONFIRMED'` and
  `startTime ∈ [range.start, range.end)`, scoped to the owner through
  `barber → location → ownerId`.
- **Label:** `Service.name`, read **live**. `Booking` snapshots
  `priceAtBooking` and `depositAmount` but **not** the service name, so renaming
  a service relabels its history. That is a known and accepted asymmetry — record
  it in the spec's purpose so the next reader does not report it as a defect. A
  service cannot vanish (`Booking.service` is `onDelete: Restrict`).
- **An inactive service still appears** when it has bookings in the period. It is
  history, and hiding it would make the section fail to sum to `confirmedCount`.
- **Order:** count descending, then `Service.name` ascending as the tie-break, so
  two renders of the same period never swap two rows. Ordering is decided in the
  domain, over the returned groups, not left to the statement's default.
- **Top-N:** the top **8**, with every remaining service folded into a single
  `Otros` entry carrying the summed count. The fold happens in the **domain**
  (testable without a database) and **must preserve the total**. `Otros` is
  rendered but never labelled with a service name and never linked.
- **Presentation:** a horizontal bar list — service name, bar, count, and the
  share of the period as a percentage. Percentages are computed over
  `confirmedCount`, in the domain, and are display-only.

#### 3.2 Most active barber

Identical shape to §3.1, grouped by `Booking.barberId`, labelled with
`Barber.displayName`.

**Two properties are specific to this section and both come from the schema:**

- **Display names are unique per location, not per owner**
  (`@@unique([locationId, displayName])`, `data-model.md` §5). A multi-location
  shop can legitimately have two "Nico". The projection therefore carries
  `Location.name` alongside the barber, and the surface disambiguates **only when
  the display name is not unique within the rendered result set** — appending the
  location to every row would be noise for the single-location shop that is the
  common case.
- **A barber's `locationId` is mutable.** A barber who moves branches carries
  their whole history to the new location's label, because the location is read
  live and `Booking` does not snapshot it. Accepted; stated in the spec.

**A shop with exactly one barber is not drawn as a chart.** A ranking of one is
not a ranking; it is stated in a sentence — the precedent D6 set for a period
with a single payment method (`A single payment method is stated rather than
drawn as a whole`).

#### 3.3 Hour-of-day distribution

- **The measure is confirmed appointments per hour of the business's day**,
  summed across every day of the period. For `semana` it answers "across these
  seven days, how many appointments started at 15:00"; for `hoy` it degenerates
  to that single day's shape, which is correct and noisy, and the copy says so.
- **The axis is always the full 00–23**, in the business's calendar, whatever the
  period contains. Empty hours are drawn as zero, never skipped — the same rule
  and the same reason as `fillIncomeSeries`: a chart that omits a quiet hour draws
  a plausible shape on an axis that is too short, and nothing looks wrong.
- **The axis is not trimmed to working hours.** A barber's schedule can change
  within the period and an appointment can exist outside it (a manual booking, a
  schedule edited afterwards); a trimmed axis would silently drop it.
- **A day that is not 24 hours long stays correct** if this market ever restores
  daylight saving (T28). See §4.3 — this is the single reason the recommended
  read design costs an array instead of a scalar.

---

### 4. Read design

#### 4.1 One additional round trip, and the requirement it breaks

`business-statistics` currently requires **"The page costs no more than two round
trips"** and proves it. D7 adds a third. Per `base-standards.md` §7 the spec is
amended **first**: the requirement becomes *no more than three*, and its scenario
is updated in the same change rather than deleted.

**Why a third read rather than a sixth column on `readStatistics`.** The
breakdowns are three `GROUP BY`s over a row set that the figures statement
deliberately does **not** group (its whole row set is every booking the owner has,
with each figure narrowing it through a `FILTER` — that is what makes
`hasAnyBookingEver` free). Folding grouped results into it is not expressible
without a lateral join or a JSON aggregate, and either would put the five figures
behind the failure of the heavier part.

**Why one read rather than three.** The three breakdowns share one row set and
must reconcile with each other (§5.4). Three reads answer from three instants and
cannot be reconciled on screen — the argument `readCharts` already makes for
serving two charts from one grouped statement.

**Failure is recovered independently**, like D6's chart read: a third
`Loaded<BusinessBreakdowns>` on `StatisticsView`. The three reads are issued
together via `Promise.all` and each catches its own failure. **They share no
transaction**, for the reason `IStatisticsRepository` rule 9 already records: an
interactive transaction holds a connection open across round trips against a
transaction-mode pooler, on the pool the public flow shares (T47).

#### 4.2 Statement shape

One statement, three CTEs over a shared `confirmed` CTE, `UNION ALL`'d into a
single normalized shape:

```
(kind text, key text, label text, sublabel text, count bigint)
```

- `kind` ∈ `'service' | 'barber' | 'hour'`, discriminated in the domain.
- `label` is the service name, the barber's display name, or nothing for hours.
- `sublabel` carries `Location.name` for barbers and is null otherwise.
- Counts cross as `bigint` and are narrowed to `number` at the repository
  boundary, like every other count in this port (rule 7).
- **No `json_agg`.** A JSON column would need a driver-deserialization probe
  before it can be trusted on `workerd` — the exact shape of T58, where a mock
  certified a call that could not work against the real database. `text` /
  `bigint` are already proven across this adapter.

Every predicate reaches the owner through `barber → location → ownerId`. The
service breakdown joins `Service` **for its name only**; scoping through
`Service.ownerId` instead would be a second tenancy path that agrees today and is
one edit away from not agreeing.

#### 4.3 How the hour is computed, and the two candidates

**Both `date_trunc` and `extract(hour …)` on a bare timestamp are refused**, for
the reason already written into rules 5 and 11: they resolve in the **session's**
timezone, which is UTC on Supavisor and on `workerd`, so every appointment from
21:00 local onward lands in the next day's hours. Silently, plausibly, for three
hours of every day.

**Recommended — the edges array.** The domain computes the hourly edges spanning
the whole period (`24n + 1` instants, via a new `hourEdgesBetween` built on
`localToInstant` exactly as `hourEdgesOf` and `dayEdgesBetween` are), crosses them
as a `float8[]` of epoch seconds, and the statement only calls
`width_bucket(extract(epoch FROM pb."startTime")::float8, $edges)`. The domain
then folds bucket index → hour-of-day by reading `instantToLocal(edges[i])`.

- Keeps rule 11 intact and unamended: *SQL assigns a row to a bucket, it never
  decides where a bucket begins.*
- Correct through a daylight-saving transition without any arithmetic knowing a
  day is 1440 minutes long.
- Cost: a `mes` range crosses **745 thresholds**; returned rows are bounded by
  hours-that-have-bookings. **Must be measured**, not assumed — T68 records this
  development machine failing on responses over ~1.4 KB, and the array travels in
  the other direction.

**The cheap alternative, recorded so design does not rediscover it:** a single
domain-supplied anchor instant and integer arithmetic —
`floor((extract(epoch FROM "startTime") - $anchor) / 3600)::int % 24`. One scalar
instead of 745 floats, no timezone function, no session dependency. **Its
precondition is that every local day is exactly 24 hours**, which is true today
(T28: Argentina observes no DST) and is the one assumption `bookingCalendar`
refuses to make anywhere else. If design takes it, the spec must state the
precondition and a test must pin it.

`AT TIME ZONE $zone` with the zone as a bound parameter is safe from injection —
it is a value position — and is still rejected: it moves a calendar decision into
SQL, which is the boundary this capability is built on.

---

### 5. Domain rules and types

#### 5.1 New types (`src/server/domain/models/statistics.ts`)

```
BreakdownRow       { kind, key, label, sublabel, count }   — as read
RankedEntry        { key, label, sublabel?, count, share } — after ranking
HourlyBucket       { hour: 0..23, count }
BusinessBreakdowns { services: RankedEntry[], barbers: RankedEntry[],
                     hours: HourlyBucket[] }
```

#### 5.2 Functions, all pure and all tested without a database

- `rankTopN(rows, limit, total)` — sort by count desc, tie-break by label asc,
  keep `limit`, fold the remainder into one `Otros` entry, compute shares.
  **Post-condition: the returned counts sum to the input counts.**
- `fillHourlyDistribution(rows, edges)` — 24 buckets, zeros present, rows outside
  the span **dropped rather than clamped** (`fillIncomeSeries`'s rule, and its
  reason: clamping moves a real appointment into an hour it did not happen in).
- `disambiguateLabels(entries)` — appends `sublabel` only where `label` repeats.

#### 5.3 Where nothing goes

No counting rule enters the service or the component. The service orchestrates
and recovers failures; the page renders states. This is the split
`StatisticsService`'s header already states.

#### 5.4 The reconciliation invariant — the strongest new requirement

For any period, **each of the three breakdowns sums to `confirmedCount`**:

```
Σ services.count  ==  Σ barbers.count  ==  Σ hours.count  ==  confirmedCount
```

This is decidable **in the domain, with no database**, and it is the property
that catches the whole family of silent defects this page is exposed to: a
`Payment` join multiplying rows, a top-N fold losing the remainder, an hour bucket
dropped at a boundary, a tenancy predicate missing from one CTE.

**The one accepted exception is skew**, and it must be stated: the figures and the
breakdowns come from two independent reads, so a booking confirming between them
leaves the sums one short until the next render. That is the same cost D6 accepted
and for the same reason. The invariant is therefore asserted **in the domain over
one row set**, never as a cross-read assertion on screen.

---

### 6. Files to create or modify

| File | Change |
|---|---|
| `openspec/changes/d7-advanced-statistics/specs/business-statistics/spec.md` | Delta: new requirements; **amends** "The page costs no more than two round trips" |
| `src/server/domain/models/bookingCalendar.ts` | `hourEdgesBetween(first, last)`; a business-local hour reader if the fold needs one |
| `src/server/domain/models/statistics.ts` | Types of §5.1, functions of §5.2 |
| `src/server/domain/repositories/IStatisticsRepository.ts` | `readBreakdowns(...)`; rules 13–16 (own row set, own tenancy predicate per CTE, hour is domain-decided, top-N is not SQL's) |
| `src/server/infrastructure/prisma/PrismaStatisticsRepository.ts` | The statement of §4.2 |
| `src/server/application/dashboard/statisticsRangeParams.ts` | `hourBucketEdgesFor(range, today)` |
| `src/server/application/services/StatisticsService.ts` | Third `Loaded` on `StatisticsView`; third leg of the `Promise.all` |
| `app/(dashboard)/estadisticas/page.tsx` | `Breakdowns` section, gated on §7.3's state rules |
| `app/(dashboard)/estadisticas/RankingChart.tsx` (new) | Horizontal bars + table, shared by services and barbers |
| `app/(dashboard)/estadisticas/HourlyChart.tsx` (new) | 24-bar column chart + table |
| `app/(dashboard)/estadisticas/chartGeometry.ts` | Horizontal-bar geometry; reuse `labelStrideFor` |
| `app/(dashboard)/estadisticas/loading.tsx` | Skeleton extended to the new blocks |
| `src/lib/copy.ts` | Every new string, Spanish (es-AR) |
| `scripts/d7-gate.ts` (new) | Live-database gate, counterfactual probes |
| `docs/roadmap.md` | Tick D7 and record what implementation overturned |
| `docs/tech-debt.md` | Any index or measurement this produces; T81's recorded index if it is taken |

**Tests** (TDD — failing first, per `base-standards.md` §1): `statistics.test.ts`
(ranking, tie-break, fold total, hour fill, out-of-span drop),
`bookingCalendar.test.ts` (edge count across a month, boundary instants),
`PrismaStatisticsRepository.test.ts` (statement shape, tenancy predicate present
in every CTE, `bigint` narrowing), `StatisticsService.test.ts` (third read fails
alone), `page.test.tsx` (every state of §7.3), `copyIsNotInline.test.ts` (passes
unchanged), `chartGeometry.test.ts` (bars, zero-peak, label stride).

---

### 7. Non-functional requirements

#### 7.1 Security and tenancy

- The page keeps `requireOwner()` in its own right — the read must never start
  for a request without a session — plus `dynamic = 'force-dynamic'` and
  `robots: noindex`.
- **Every CTE carries its own owner predicate.** Redundant while the outer query
  is correct, and no longer redundant the first time somebody edits it. This is
  the read where a leak produces a plausible integer rather than a visible row.
- **No new parameter surface.** Nothing D7 adds is reachable from the query
  string, so D5's bound-match-degrade rules cover the page unchanged.
- No client name, email, phone, booking id or token in the projection. Barber and
  service names are business data and are rendered; **neither reaches a log
  line**, and no failure log carries money.

#### 7.2 Performance

- Three round trips per render, stated and tested. Against a pool the public
  booking flow shares (T47) — an owner clicking through six periods issues
  eighteen.
- `EXPLAIN (ANALYZE, BUFFERS)` on the live database for the new statement, over
  the real owner, recorded in the gate output. T81 already names the index to
  reach for on `Booking (barberId, startTime)`; take it or record why not.
- The `float8[]` payload for `mes` is measured, not assumed (§4.3, T68).

#### 7.3 States — every one of them enumerated

| State | Behaviour |
|---|---|
| Read failed | Its own card. **Says nothing about the figures when the figures also failed** — D6's adversarial finding: vouching for a half that did not succeed |
| Shop with no bookings ever | Suppressed entirely (`hasAnyBookingEver`) |
| Period with nothing to report | Suppressed (`hasSomethingToReport`) |
| **Period with cancellations but no confirmations** | **Suppressed.** `hasSomethingToReport` is true here, and all three breakdowns are confirmed-only — three empty charts under a figures block that explains nothing. This is the D6 defect one layer down and the spec must name it |
| Single barber | Stated in a sentence, not drawn as a ranking |
| Single service | Same |
| More services than the cap | Top 8 + `Otros`, total preserved |
| Hours with no appointments | Drawn as zero — never skipped |

#### 7.4 Frontend

- **No client JavaScript and no charting library.** Server Components and inline
  SVG, as D6 established. `Intl` formatting happens on the server only.
- **SVG element ids must be namespaced per chart.** The page will carry four or
  five inline SVGs; a shared `clipPath` or `pattern` id is a duplicate DOM id and
  a real cross-chart rendering bug. Ids must be derived from a stable prop, never
  from a random value or a render counter — a random id is also a hydration
  mismatch waiting to happen.
- Legible at **360 px**, measured with the grid forced to the single column a real
  phone gets — D6 records that forcing the container alone does not move
  Tailwind's breakpoints and produces a measurement that is simply wrong.
- Long service and barber names wrap rather than overflow (the T18 family).
- Every chart has a table equivalent that does not require seeing it, and the
  ranking is readable without colour.
- `loading.tsx` matches the final layout so the page does not jump.

#### 7.5 Language

Code, comments, tests, commits and this document in English; every user-facing
string in Spanish (es-AR) and in `src/lib/copy.ts`, enforced by the existing
`copyIsNotInline` scan.

---

### 8. Definition of done

1. Spec delta written and validated **before** implementation, including the
   amendment to the round-trip requirement.
2. Failing tests first, then implementation, in the increments §6 implies.
3. `npm run lint`, `tsc --noEmit`, and the full `vitest` suite green.
4. `scripts/d7-gate.ts` green against the **live database**, with:
   - the raw statement executed, not mocked;
   - the reconciliation invariant of §5.4 asserted against real rows;
   - **counterfactual probes** — D5's rule, that an assertion which would hold
     equally without the mechanism it names is worse than none. At minimum: the
     owner predicate removed yields a different total; the confirmed predicate
     removed yields a different total; the hour fold computed from the runtime's
     clock disagrees with the business's.
5. **Both runtimes.** Node with `TZ` set to a hostile zone, and `workerd`, produce
   byte-identical output. The hour axis is a discriminator available at any hour —
   D6 records this and it applies directly here.
6. Phone layout measured at a real 360 px viewport; overflow and label overlap
   reported as numbers.
7. Bundle size measured against `main` and reported; the delta is copy and markup.
8. `docs/roadmap.md` ticked with what implementation overturned; `tech-debt.md`
   updated with anything measured and deferred.
9. Adversarial pass run **after** the story reads as done — D6 found two defects
   there, both copy asserting a state nothing had checked.

---

### 9. Open decisions for the design step

1. **§4.3 — edges array or anchor arithmetic.** Recommendation: the edges array,
   with the payload measured. The alternative is cheaper and carries a
   precondition that must be written down if taken.
2. **Top-N = 8.** A number, not a principle. Confirm against a real shop's
   catalogue size.
3. **Whether `Otros` is charted or only tabulated.** Charting it invites reading
   a bar that is an aggregate of unlike things.
4. **Whether the hour chart is drawn for `hoy`/`ayer` at all**, where it is one
   day of data on a 24-hour axis and reads as noise.

---

## Edge-case analysis

> Produced by `/edge-case-hunter` against the enhanced story above. No code is
> proposed. This is context for the spec, not a task list.

### 1. 🛑 Critical Vulnerabilities & Failures

**V1 — The tenancy join is the only boundary, and D7 triples the places it can be
forgotten.** There is no row-level security on these tables; `barber → location →
ownerId` **is** the tenancy check. The new statement has three CTEs, and a missing
predicate in any one of them leaks another shop's ranking as a **plausible
integer** — no row that can look wrong, nothing a reviewer would notice. The
service breakdown is the likeliest: `Service.ownerId` is a real column and joining
on it *looks* like scoping while actually filtering on a second, different path.

**V2 — The hour is computed on a UTC runtime, and the failure window is three
hours of every single day.** `workerd`'s clock is UTC and ignores `TZ`; Supavisor
sessions are UTC. `extract(hour FROM "startTime")` or `date_trunc('hour', …)`
answers for the wrong hour for every appointment from 21:00 ART onward — and it
answers with a number in `0..23`, so nothing raises, nothing looks broken, and the
staffing conclusion the owner draws is simply wrong. This is the single most
dangerous line D7 will write.

**V3 — A `Payment` join anywhere in the new statement inflates every count.**
`Payment_one_live_per_booking` is `ON ("bookingId") WHERE status <> 'REJECTED'`,
so a booking carries unlimited declined attempts on purpose. A join added later
for "revenue per service" multiplies that booking's row per attempt. The counts
would read as a busy month; the reconciliation invariant (§5.4) is the only thing
that catches it.

**V4 — The `float8[]` threshold payload is unbounded by the same parameter the
owner controls.** `mes` crosses 745 thresholds. It is bounded by the closed range
set today, so it is not an injection or a DoS vector — but T68 records this
environment failing on database responses over ~1.4 KB and hanging rather than
raising, and T68 is intermittent. An unmeasured payload here is an outage that
looks like a code defect.

**V5 — Three round trips per render, on the pool the public booking flow shares.**
The page is authenticated so this is not an anonymous vector, but nothing rate
limits an owner (or a logged-in tab left refreshing) from issuing eighteen
aggregates by clicking through six periods. T47's saturation consequence is
unchanged and now cheaper to reach; the affected surface is the **public booking
flow**, not the dashboard.

**F1 — Pooler hangs rather than raises.** T68 documents the failure mode: no
error, no timeout, an indefinite wait. A third read that is not independently
recovered turns a slow breakdown query into a page that never renders — and,
because `loading.tsx` streams, into a permanent skeleton with **no console error
and no failed request**, which reads exactly like a broken React stream. T10's
four controls exist for this.

**F2 — A partial failure that vouches for the part that failed.** D6 shipped this
defect and its adversarial pass caught it: the chart failure copy reassured the
owner that "the numbers above are current", rendered directly beneath the card
apologising for those numbers. D7 adds a **third** independently-failing block and
therefore a third opportunity, plus a new one D6 did not have — two of three
failing, where the surviving copy must not describe the other two.

**F3 — Driver deserialization certified by a mock.** T58's exact shape: a
repository test that mocks `$queryRaw` will happily certify a `json_agg` column,
an `interval`, or any type the pg driver adapter cannot deserialize on `workerd`.
`UnsupportedNativeDataType` surfaces as a generic `P2010`. This is why §4.2
constrains the projection to `text` and `bigint`.

### 2. 🔀 Alternative Flows (Bad Paths)

**A1 — A period with cancellations and no confirmations.** `hasSomethingToReport`
returns `true` (it ORs `cancelledCount`), the figures block renders, and all three
D7 breakdowns — which are confirmed-only — are empty. Three empty charts under a
populated figures block, explaining nothing. This is D6's adversarial finding one
layer down.

**A2 — A single barber, or a single service.** The permanent state of most shops
in this product's market. A "most active barber" bar chart of one bar is not a
ranking; a 100% share is not information. Both need a sentence, not a chart.

**A3 — Two barbers with the same display name at different locations.** Legal by
schema (`@@unique([locationId, displayName])`). Two identically-labelled rows in
the ranking with different counts, and the owner cannot tell which is which.

**A4 — A service renamed mid-period.** `Booking` snapshots the price, not the
name. The ranking relabels history — including retroactively splitting nothing and
merging nothing, since the grouping is by id. It is the *label* that lies, and only
to an owner who remembers the old name.

**A5 — A barber moved between locations mid-period.** Their whole history follows
the new location's label, since `Location` is read live. Combined with A3's
disambiguation, a barber can appear under a location where they worked none of the
counted appointments.

**A6 — A shop with 40 services.** Nothing in the schema caps the catalogue. Without
the top-N fold this is a 40-row chart on a phone; with a fold that drops the
remainder instead of aggregating it, the section silently stops summing to
`confirmedCount`.

**A7 — Ties.** Three services with four bookings each. Without an explicit
tie-break the statement's row order decides, and it can differ between two renders
of the same period — the owner sees the ranking "change" while nothing changed.

**A8 — An appointment outside every working hour.** Reachable through a schedule
edited after the booking, or a `TimeOff` added later. A chart whose axis is trimmed
to working hours drops it and stops reconciling.

**A9 — Concurrency, and what it is not.** D7 is read-only and takes no advisory
lock; nothing here claims a range, so the lock note in `docs/roadmap.md` does not
apply. The only concurrency effect is **skew between the three independent reads**
— a booking confirming mid-render leaves the breakdowns one short of
`confirmedCount`, self-correcting on the next render. It must never be asserted
across reads on screen.

**A10 — An `EXPIRED` booking counted as anything.** B7's sweep produces these
continuously. Counting them in "most popular services" would rank abandoned
checkouts as demand.

### 3. 🎨 Required UI/UX States

Per new block (services, barbers, hours), and for the section as a whole:

- **Loading** — `loading.tsx` skeleton shaped like the final blocks, so the page
  does not jump when they stream in. The range control must survive the loading
  state, as D5 already requires.
- **Empty business** — no bookings ever: the whole section is absent, not zeroed.
- **Empty period** — nothing to report: absent.
- **Cancellations-only period (A1)** — absent, and the figures block keeps its own
  message.
- **Degenerate ranking (A2)** — a sentence naming the single barber or service and
  its count; no bars, no 100% share.
- **Failed read** — a card stating the breakdowns could not be loaded, that says
  **nothing** about the figures or the charts unless those succeeded.
- **Populated** — horizontal bars for the two rankings, a 24-column chart for the
  hours, **each with a table equivalent** that is readable without seeing the image
  and without colour.
- **Zero-height bars** — an hour with no appointments draws a zero-height bar on a
  drawn axis, never a gap and never a `NaN` (D6's `peak === 0` guard).
- **SSR/hydration** — every block is a Server Component; no `Intl` on the client,
  no random SVG ids, no `useId`-free duplicate `clipPath`/`pattern` ids across the
  four or five SVGs now on one page.
- **360 px** — measured on a real single-column layout, not a forced container;
  long service and barber names wrap rather than overflow (T18 family); hour labels
  thinned by a stride rather than overlapped.

### 4. 📋 Extended Acceptance Criteria (BDD Gherkin)

```gherkin
Feature: Advanced statistics — edge cases

  Scenario: A late-evening appointment is counted in the business's hour, not the runtime's
    Given the deployment runtime's clock is UTC and the business is at UTC-3
    And a CONFIRMED booking starts at 21:30 in the business's calendar
    When the owner opens the statistics page for the period containing that day
    Then the hour-of-day chart counts that appointment in hour 21
    And no statement in the read has computed a date or truncated a timestamp

  Scenario: A period with cancellations and no confirmations shows no breakdowns
    Given the selected period contains 3 CANCELLED bookings and 0 CONFIRMED bookings
    When the owner opens the statistics page
    Then the figures block reports the cancellations
    And no service ranking, barber ranking or hour chart is rendered

  Scenario: A client who retried a declined card does not inflate any ranking
    Given a CONFIRMED booking in the period whose client was declined twice before paying
    And the booking therefore carries 2 REJECTED payments and 1 APPROVED payment
    When the breakdowns are read
    Then the service ranking counts that booking exactly once
    And the barber ranking counts it exactly once
    And each breakdown's counts sum to the confirmed appointments figure

  Scenario: Another owner's appointments are unreachable in both directions
    Given two owners each have CONFIRMED bookings in the same period
    When each owner's breakdowns are read
    Then neither owner's ranking contains a service or barber belonging to the other
    And removing the owner predicate from any one branch of the statement changes the totals

  Scenario: Two barbers sharing a display name at different locations are told apart
    Given two active barbers named "Nico" at two different locations of the same owner
    And both have CONFIRMED appointments in the period
    When the barber ranking is rendered
    Then each row is qualified by its location
    And a shop whose barber names are all distinct shows no location qualifier

  Scenario: A catalogue larger than the ranking keeps its total
    Given the period contains CONFIRMED bookings across 12 distinct services
    When the service ranking is rendered with a limit of 8
    Then 8 named services and one aggregated remainder entry are shown
    And the sum of all rendered counts equals the confirmed appointments figure

  Scenario: The breakdown read failing costs neither the figures nor the charts
    Given the figures read and the chart read both succeed
    And the breakdown read raises
    When the page renders
    Then the six figures and the two charts are unchanged
    And the breakdown block states its own failure without describing the figures as stale
    And no breakdown renders as a zero ranking

  Scenario: Every read failing produces one honest message, not three reassurances
    Given all three reads raise
    When the page renders
    Then the page states that the statistics could not be loaded
    And no block claims that any other block's numbers are current

  Scenario: The charts render with scripting disabled
    Given the browser has JavaScript disabled
    When the owner opens the statistics page in a production build
    Then the two rankings and the hour chart are present in the served markup
    And their table equivalents are present
    And the bundle contains no charting library

  Scenario: A tie does not reorder between two identical renders
    Given three services each have exactly 4 CONFIRMED appointments in the period
    When the page is rendered twice for the same period
    Then the three services appear in the same order both times
```
