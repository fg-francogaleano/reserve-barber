# D7 — Advanced statistics: services, barbers, hour of day

## Why

The statistics page answers **how much** the business did in a period — six
figures, an income series and a payment-method split — and nothing about **what**
it sold, **who** performed it, or **when** the work actually lands in the day. The
owner's two operational decisions are exactly those: what to offer, and when to
have people on the floor. Today the only way to answer either is to page through
`/agenda` day by day.

Now, because D5 and D6 have shipped the whole apparatus this needs — the closed
range vocabulary, the business-calendar instants, the owner-scoping join, the
independent-failure pattern and the server-rendered SVG that keeps the page free
of client JavaScript. D7 is three more reads of the row set those stories already
count, not a new surface.

## What Changes

- **Three new sections on the existing `/estadisticas` page**, beneath D6's two
  charts: a ranking of the most-booked services, a ranking of the most-active
  barbers, and the distribution of confirmed appointments across the 24 hours of
  the business's day. No new route, no new navigation entry, no new query
  parameter.
- **One new read**, `IStatisticsRepository.readBreakdowns` — a single statement
  whose three grouped branches share one row set, recovered independently of the
  figures and the charts, sharing no transaction with either.
- **BREAKING (spec-level, not user-facing): the page's round-trip budget goes
  from two to three.** `business-statistics` carries a tested requirement that
  *"The page costs no more than two round trips"*. It is amended, not deleted,
  and its scenario is updated in this change — `base-standards.md` §7 requires the
  spec to move first.
- **A new reconciliation invariant**: each of the three breakdowns sums to the
  confirmed-appointments figure. It is asserted in the domain over one row set,
  never across reads on screen.
- **New business-calendar arithmetic**, `hourEdgesBetween`, so the hour of an
  appointment is decided by the business's calendar and never by the session's
  timezone — which is UTC on both Supavisor and `workerd`, and would silently
  misplace every appointment from 21:00 ART onward.
- **A third independently-recoverable block.** The page already tells zero from
  failure and a quiet period from an empty business; D7 adds a third `Loaded<T>`
  and, with it, the states where two of three reads fail.
- **One state correction the current page gets wrong for D7's data**: a period
  with cancellations and no confirmations passes `hasSomethingToReport` and would
  render three empty breakdowns under a populated figures block.
- No new dependency. The charts stay hand-rolled inline SVG — the requirement
  that this page adds no charting library is unchanged and still tested.

## Capabilities

### New Capabilities

None. D7 extends a capability that already exists.

### Modified Capabilities

- `business-statistics`: adds the three breakdowns, their ranking and folding
  rules, their empty/degenerate/failed states, the reconciliation invariant, and
  the rule that the hour of an appointment is a business-calendar fact computed
  outside SQL. **Amends** the existing round-trip requirement from two to three.

## Impact

**Domain** — `src/server/domain/models/statistics.ts` (breakdown types, ranking,
top-N fold, hour fill), `src/server/domain/models/bookingCalendar.ts`
(`hourEdgesBetween`), `src/server/domain/repositories/IStatisticsRepository.ts`
(the new port method and the rules that constrain it).

**Application** — `StatisticsService` (a third leg on the existing `Promise.all`,
caught separately), `statisticsRangeParams.ts` (the hour edges for a range).

**Infrastructure** — `PrismaStatisticsRepository` (one statement, three CTEs,
`UNION ALL` into a `text`/`bigint` projection; no `json_agg`, because a JSON
column would need a driver-deserialization probe on `workerd` before it could be
trusted — the shape of T58).

**Frontend** — `app/(dashboard)/estadisticas/`: `page.tsx`, two new Server
Components, `chartGeometry.ts`, `loading.tsx`, and `src/lib/copy.ts` for every
new Spanish string.

**Verification** — `scripts/d7-gate.ts` against the live database, with
counterfactual probes; both runtimes; a 360 px measurement.

**Database** — no migration. No schema change, no new column, no new enum.

**Operational** — three round trips per render instead of two, against the
connection pool the public booking flow shares (`docs/tech-debt.md` T47). The
saturation consequence recorded there is unchanged and becomes cheaper to reach.
