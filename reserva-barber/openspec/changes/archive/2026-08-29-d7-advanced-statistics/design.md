## Context

`/estadisticas` today is D5's six figures and D6's two charts. Everything D7
needs already exists and is tested: the closed range vocabulary resolved from
`?rango=`, the business-calendar instants that bound it, the
`barber → location → ownerId` join that is the tenancy boundary, the
`Loaded<T>` pattern that keeps zero and failure distinguishable, and the
hand-rolled server-rendered SVG that keeps the page free of client JavaScript.

D7 adds three groupings over the row set those stories already count: services,
barbers, and the hour of the day an appointment starts. It writes nothing, takes
no lock, and changes no schema.

**Four constraints shape every decision below**, and all four are pre-existing:

1. **The runtime's calendar is not the business's.** `workerd`'s clock is UTC and
   ignores `TZ`; a Supavisor session is UTC. `date_trunc` and `extract(hour …)`
   are banned in this capability in writing (`IStatisticsRepository` rules 5 and
   11) because they resolve in the session's timezone and misplace every
   appointment from 21:00 ART onward — plausibly, silently, for three hours of
   every day.
2. **The tenancy check is a join, not a policy.** There is no row-level security
   on these tables. A leaked aggregate produces no row that can look wrong, only
   a believable integer.
3. **The connection pool is shared with the public booking flow** (T47), and the
   pooler is on record hanging rather than raising (T68).
4. **The page depends on no client JavaScript**, and that is a tested guarantee,
   not an aspiration.

The full pre-spec analysis, including the edge cases these decisions answer, is
in `enrichment.md` in this folder.

## Goals / Non-Goals

**Goals:**

- Answer, for the period the owner already selected, which services are booked
  most, which barbers work the most appointments, and how those appointments
  spread across the hours of the business's day.
- Make the three answers **reconcilable against the figure above them** by
  construction, so a join defect or a lost remainder is caught by arithmetic
  rather than by a reviewer.
- Keep the hour a business-calendar fact decided in the domain.
- Fail in three independent pieces, so the heaviest read cannot cost the owner
  the figures.
- Add no dependency, no client bundle, no migration and no parameter surface.

**Non-Goals:**

- **Revenue per service or per barber.** `IStatisticsRepository` rule 4 keeps
  `Payment` out of any counted row set: the partial unique index admits unlimited
  `REJECTED` rows beside one live payment, deliberately, so the join multiplies a
  retried booking. Money per service needs its own sub-aggregate and its own
  story.
- **An arbitrary date range.** The closed set stays, for D5's recorded reason.
- **A per-location grouping.** Location appears as a disambiguator, never as an
  axis.
- **Cancellations or expiries broken down.** Confirmed only, so the three
  sections share one denominator.
- **Period-over-period comparison.**

## Decisions

### D1 — The hour of an appointment is decided by domain-computed edges, never by SQL

`readBreakdowns` receives the hourly edges spanning the whole period — `24n + 1`
instants for an `n`-day range — computed by a new `hourEdgesBetween` in
`bookingCalendar`, built on `localToInstant` exactly as `hourEdgesOf` and
`dayEdgesBetween` are. They cross as a `float8[]` of epoch seconds and the
statement only calls `width_bucket`. The domain folds bucket index → hour of day
by reading `instantToLocal(edges[i])`.

This keeps `IStatisticsRepository` rule 11 intact and unamended: *SQL assigns a
row to a bucket; it never decides where a bucket begins.* It is also correct
through a daylight-saving transition without any arithmetic assuming a day is
1440 minutes long — the property every function in `bookingCalendar` is built to
preserve (T28).

**Alternatives considered.**

- **Anchor arithmetic**: one scalar instant and
  `floor((extract(epoch FROM "startTime") - $anchor) / 3600)::int % 24`. Far
  cheaper — one parameter instead of up to 745 floats — and free of any timezone
  function. **Rejected** because its correctness rests on every local day being
  exactly 24 hours, which is the single assumption `bookingCalendar` refuses to
  make anywhere else. It is recorded here rather than discarded: if the payload
  measured in D3 turns out to be a real problem, this is the fallback, and taking
  it obliges the spec to state the precondition and a test to pin it.
- **`AT TIME ZONE $zone`** with the zone bound as a parameter. Safe from
  injection — it is a value position, not an identifier. **Rejected** because it
  moves a calendar decision into SQL, which is the boundary this whole capability
  is built on, and because it would make `bookingCalendar` no longer the only
  place a wall clock becomes an instant.

### D2 — One statement, three CTEs, one normalized projection

`readBreakdowns` issues a single statement: a `confirmed` CTE holding the
owner-scoped, status-filtered, range-bounded booking rows, and three grouped
branches over it, `UNION ALL`'d into

```
(kind text, key text, label text, sublabel text, count bigint)
```

`kind` discriminates in the domain. `sublabel` carries `Location.name` for
barbers and is null elsewhere.

**One read rather than three** because the three answers must reconcile with each
other (D8); three statements answer from three instants and cannot. This is the
argument `readCharts` already makes for serving two charts from one grouped read.

**A normalized `UNION ALL` rather than `json_agg`** because a JSON column would
need a driver-deserialization probe on `workerd` before it could be trusted, and
a mocked repository test would certify it regardless — the exact shape of T58,
where `pg_advisory_xact_lock`'s `void` return passed twenty-four green tests and
failed every booking write in the runtime. `text` and `bigint` are already proven
across this adapter.

**Every branch carries its own owner predicate**, even where the shared CTE
already applies it. Redundant today; not redundant the first time somebody edits
the CTE. The service branch joins `Service` **for its name only** — scoping
through `Service.ownerId` would be a second tenancy path that agrees today and is
one edit away from not agreeing.

### D3 — A third round trip, and the requirement it amends

`business-statistics` requires *"The page costs no more than two round trips"* and
tests it. D7 makes it three. Per `base-standards.md` §7 the requirement is
**amended in this change before any code is written**, not deleted and not
quietly outgrown.

The alternative — folding the breakdowns into `readStatistics` — was rejected on
shape. That statement's row set is deliberately *every* booking the owner has,
each figure narrowing it through a `FILTER`; that is what makes
`hasAnyBookingEver` free. Three `GROUP BY`s cannot ride on it without a lateral
join or a JSON aggregate, and either puts the five figures behind the failure of
the heavier part.

### D4 — A third `Loaded<T>`, and no shared transaction

`StatisticsView` grows `breakdowns: Loaded<BusinessBreakdowns>`. The three reads
are issued together under `Promise.all` and each catches its own failure.

**No transaction wraps them**, for the reason `IStatisticsRepository` rule 9
already records: an interactive transaction holds a connection open across round
trips against a transaction-mode pooler — the thing every other repository here
avoids — on the pool the public flow shares (T47). The accepted cost is skew, and
D8 says where the invariant is asserted so the skew never becomes a visible lie.

### D5 — Top-N is folded in the domain, and the fold preserves the total

The statement returns every group; the domain sorts, keeps the top **8**, and
folds the remainder into a single `Otros` entry carrying the summed count.

**In the domain rather than in SQL** because a `LIMIT` in the statement discards
the remainder, and a discarded remainder is exactly the silent defect D8 exists
to catch: the section stops summing to `confirmedCount` and nothing looks wrong.
It is also testable without a database.

`rankTopN`'s post-condition is that the returned counts sum to the input counts.
`Otros` is never labelled with a service or barber name.

### D6 — Ordering is decided in the domain, with an explicit tie-break

Count descending, then label ascending. Never the statement's natural row order:
three services with four bookings each would otherwise reorder between two
renders of the same period, and the owner would see the ranking "change" while
nothing changed.

### D7 — Labels are read live, and the consequences are stated rather than fixed

`Booking` snapshots `priceAtBooking` and `depositAmount`; it does not snapshot the
service name, the barber name, or the location. So renaming a service relabels its
history, and a barber who moves branches carries their history to the new
location's label.

**Accepted, not fixed.** Adding label snapshots to `Booking` is a data-model
change that D7 does not justify, and grouping is by id, so nothing merges or
splits — only the label is anachronistic, and only for an owner who remembers the
old name. Both facts go in the spec's purpose so the next reader does not file
them as defects.

**Barbers are disambiguated by location only when ambiguous.** `displayName` is
unique per location, not per owner (`data-model.md` §5), so two "Nico" at two
branches are legal. Appending the location to every row would be noise for the
single-location shop that is the common case, so the qualifier appears only when a
label repeats within the rendered set.

### D8 — The reconciliation invariant, and where it is allowed to be asserted

For any period:

```
Σ services.count == Σ barbers.count == Σ hours.count == confirmedCount
```

This is the strongest property in the change. It catches, by arithmetic, the
entire family of defects this read is exposed to: a `Payment` join multiplying a
retried booking, a top-N fold losing its remainder, an hour bucket dropped at a
boundary, an owner predicate missing from one branch.

**It is asserted in the domain, over one row set, with no database** — and in the
gate against real rows. It is **never** asserted across the reads on screen,
because D4's independence means a booking confirming between two round trips
leaves the breakdowns one short until the next render. Asserting it there would
turn an accepted, self-correcting skew into a rendered error.

### D9 — A new state predicate, because the existing one is wrong for this data

`hasSomethingToReport` is `confirmedCount > 0 || cancelledCount > 0`. A period
with three cancellations and no confirmations satisfies it — so the figures block
renders, and all three D7 breakdowns, which are confirmed-only, would render
empty beneath it.

The breakdowns are therefore gated on **confirmed activity** specifically, a
second predicate beside the first rather than a redefinition of it. `Figures` and
`Charts` keep the condition they have; the D6 finding that put them on a shared
condition stands, and this is a third condition for a third question, named so the
distinction survives.

### D10 — The hour chart is drawn for every range, including `hoy` and `ayer`

For a single day it is that day's shape on a 24-hour axis: correct, noisy, and
easy to misread as a trend. The copy names the period, so the sentence is true at
every range.

Suppressing it for two of six ranges was considered and rejected: it makes the
page's shape depend on the selection, which is the thing this page most needs to
keep stable — the owner's whole use of it is comparing one period against another.

### D11 — `Otros` is tabulated, never charted

A bar whose height aggregates unlike things invites being read as one thing, and
it will often be the longest bar in a shop with a wide catalogue. It appears in
the table equivalent, where the number is the whole content and cannot be read as
a shape.

### D12 — Geometry, and one hazard specific to having five SVGs on a page

Rankings are horizontal bars (labels are names, of unbounded length, and a
vertical axis of rotated names is unreadable at 360 px). The hour distribution is
a 24-column chart, reusing D6's `labelStrideFor` to thin the axis on a phone.

Everything is drawn from `chartGeometry`'s pure arithmetic — no measurement, no
`window`, no clock, no React — which is what makes a hand-rolled chart cheap
enough to justify against a library.

**SVG element ids must be namespaced per chart.** The page will carry four or five
inline SVGs; a shared `clipPath` or `pattern` id is a duplicate DOM id and a real
cross-chart rendering bug. Ids derive from a stable prop — never from a random
value or a render counter, which is also a hydration mismatch in waiting.

### D13 — Shares are display-only

The percentage beside each ranking row is computed in the domain over the counts
and is rounded for display. Nothing reconstructs a count from a share, and nothing
divides one share by another. It is a reading aid, not a figure.

## Risks / Trade-offs

- **A `mes` range crosses up to 745 `float8` thresholds** → Measure the payload
  and the round trip in the gate before the story is called done. T68 records this
  development machine failing on database responses over ~1.4 KB and hanging
  rather than raising; the array travels the other way, but neither direction is
  assumed. D1's anchor-arithmetic alternative is the recorded fallback.
- **Three round trips per render, on the pool the public booking flow shares** →
  Nothing rate-limits an owner clicking through six periods (eighteen aggregates).
  The affected surface is the public flow, not the dashboard. Measured and
  recorded against T47; no new mitigation in this change.
- **The pooler hangs rather than raising** → D4's independent recovery means a
  hung breakdown read costs three sections, not the page. The residual risk is a
  streamed segment that never resolves, which presents as a permanent skeleton
  with no console error and no failed request. T10 carries the four controls that
  separate that from a broken render in ten seconds.
- **A mocked repository test can certify a statement that cannot run** (T58) →
  The projection is constrained to `text` and `bigint` (D2), and `scripts/d7-gate.ts`
  executes the raw statement against the live database on both runtimes.
- **A counterfactual-free assertion is worse than none** (D5's rule) → The gate's
  probes must each differ with the mechanism removed: the owner predicate dropped
  changes the totals; the confirmed predicate dropped changes the totals; the hour
  fold taken from the runtime's clock disagrees with the business's.
- **Long service and barber names overflow at 360 px** (the T18 family) → Labels
  wrap in the table and are truncated with a title in the chart; measured on a real
  single-column layout, not a forced container — D6 records that forcing the
  container alone does not move Tailwind's breakpoints and produces a measurement
  that is simply wrong.
- **Skew between the figures and the breakdowns** (D4) → Accepted, one round trip
  wide, self-correcting on the next render. Never asserted on screen (D8).
- **Anachronistic labels after a rename or a branch move** (D7) → Accepted and
  documented in the spec's purpose.

## Migration Plan

No database migration: no schema change, no column, no enum, no index required by
correctness. Any index this produces comes from the `EXPLAIN` measurement and is a
separate, reversible change recorded against T81.

Deploy is the ordinary path — branch, PR, merge to `main`, deploy from `main`.
**Rollback is a revert**: the page degrades to exactly D6's shape, since D7 adds a
section and amends no existing read. No data is written, so nothing needs undoing.

## Open Questions

1. **Does the `float8[]` payload for `mes` survive the pooler from this machine?**
   Answered by measurement in the gate, not by argument. If it does not, D1's
   anchor arithmetic is the fallback and its precondition goes into the spec.
2. **Does the new statement warrant the index T81 already names on
   `Booking (barberId, startTime)`?** Decided from `EXPLAIN (ANALYZE, BUFFERS)`
   against the real owner; taken or refused in writing, never left unmeasured.
3. **Is 8 the right N?** A number, not a principle. Confirm against a real
   catalogue before the copy is written around it.
