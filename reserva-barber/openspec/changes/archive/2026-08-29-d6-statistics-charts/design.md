## Context

D5 shipped `/estadisticas`: five figures over a closed set of six preset periods, read in one statement, rendered entirely by Server Components. Two properties of that page are load-bearing for this change and are easy to break by accident.

**The page depends on no client JavaScript, and the spec tests it.** Every interaction is an ordinary navigation. The period control is a Server Component rendered from both `page.tsx` and `loading.tsx` — deliberately, because a `layout.tsx` receives no `searchParams` and a Client Component reading `useSearchParams` would have spent the promise on a highlight.

**Every figure is keyed on `Booking.startTime`, and that decision is the story D5 told.** A booking offers three instants and a payment a fourth; the cards are a set and the average divides one member by another, so one clock governs all of them. `dashboard-home`'s income counter stays on `Payment.approvedAt` and the two deliberately disagree — **T83** records that, names the missing figure, and hands it to this change.

The constraints this change inherits: no row-level security on these tables, so the `barber → location → ownerId` join *is* the tenancy boundary; a connection pool shared with the public booking flow (**T47**); a 10 MiB Worker bundle ceiling with 3186.22 KiB gzip currently spent; a UTC runtime and pooler against a UTC−3 business calendar; and `IStatisticsRepository`'s eight standing rules, of which rules 4 and 5 are the ones this change is most likely to violate.

## Goals / Non-Goals

**Goals:**

- Two charts on the existing page — deposit income over time, and the Mercado Pago / bank transfer split — bounded by the period the owner already selected.
- Close **T83** with a sixth figure: cash collected in the period, on `approvedAt`, labelled with its basis.
- Keep the no-client-JavaScript property intact, and keep the bundle flat.
- Keep the figures and the charts numerically reconcilable on screen.

**Non-Goals:**

- **T82** — money owed back (approved payments on non-confirmed bookings). Declined here on purpose; see Decisions.
- D7's metrics: popular services, most active barber, hourly distribution.
- Custom date ranges, CSV export, comparison against a previous period, live updates (D8).
- Any write path. This change adds no endpoint, no Route Handler and no Server Action.

## Decisions

### D1 — Server-rendered inline SVG, not Recharts

`frontend-standards.md` (:58, :232, :371) and `project-context.md` (:97, :99) name Recharts/Tremor for exactly these views. The `business-statistics` spec carries a bolded, tested requirement that the page depend on no client JavaScript. **Both cannot hold**, and this change resolves it in favour of the spec.

Recharts is client-only: `ResponsiveContainer` measures the DOM, so it renders nothing on the server and different markup on hydration — on a surface displaying money, which is the precise failure the page's existing "all `Intl` on the server" rule exists to prevent.

*Alternatives considered.* **Recharts behind `next/dynamic({ ssr: false })`**: narrows a shipped guarantee, costs ~90–110 KiB gzip, and still requires the accessible data table to be written as the real content — so it buys nothing the SVG does not, and pays for it. **Tremor**: the same objection plus a second design system.

*What it costs.* Scale, axis, ticks and labels by hand: roughly 150–200 lines of pure functions from data to geometry, plus their tests. That is real work, not a free win. The compensation is that pure geometry is exactly the kind of code that is cheap to unit-test, and there is no third-party API to learn or pin.

*Why this does not violate `base-standards.md` §8.* That rule forbids introducing a technology the stack decision did not choose. It does not compel using one. The named options stay available to the project — they stop being the default for this page, and the two documents are amended to say so and why.

*What would reverse it.* Genuine interaction — hover tooltips, zoom, brushing — or D7 arriving with three more chart shapes that are not bars. The port returns data, not markup, so swapping the renderer would touch neither the domain nor the repository.

### D2 — The evolution chart is keyed on `startTime`; T83's figure is a card, not a second series

The chart sits directly under the deposits card and must reconcile with it, so it shares that card's basis and its buckets sum to it exactly. That gives the sum a test that can fail.

T83's cash-collected figure is bounded on `approvedAt`. Drawing it as a second series on the same axis would be D5's original defect in new clothing: two populations on one x-axis invite point-by-point comparison, and the gap at any single bucket is meaningless — it is a deposit for an appointment in another period, not a shortfall.

So it ships as a **sixth card** carrying its own basis sentence, which is the mitigation D5 already established when `dashboard-home`'s income label gained its fourth condition. One pattern, one explanation.

*Alternative considered.* A second chart for cash-in over time. Defensible, and rejected as scope: it needs its own bucketing on a second column, and the question T83 actually records is a total, not a trend.

### D3 — Bucket edges are computed in the domain; SQL only assigns

`IStatisticsRepository` rule 5 forbids date arithmetic in any implementation, and D5 recorded the two reasons: `date_trunc`'s unit is an identifier position that parameterisation does not cover, and it truncates in the **session's** timezone — UTC on Supavisor and `workerd` — so a 21:30 appointment lands in the next day and a 23:30-on-the-31st one in the next month. Silently, plausibly, for three hours of every day.

The domain computes every edge from `bookingCalendar` (`dayBoundsOf`, `addDays`, `monthBoundsOf`), which is already DST-safe because it derives each day from both midnights rather than by adding 24 hours. The edges cross to SQL as a `float8[]` of epoch seconds and the statement assigns rows with `width_bucket(...)` — pure narrowing, no calendar knowledge, and the rule survives untouched.

Granularity is a property of the range, not of the data: `hoy`/`ayer` → 24 hourly buckets; `semana`/`semana-anterior` → 7 daily; `mes`/`mes-anterior` → 28–31 daily.

*Alternatives considered.* **`date_trunc(... AT TIME ZONE 'America/Argentina/Buenos_Aires')`** — a hard-coded literal is injection-safe and timezone-correct, but it puts a calendar rule in SQL where nothing tests it and duplicates the definition `bookingCalendar` owns. **Bucketing in the isolate** from per-booking rows — correct and simple, but it loads a month of rows to compute a sum, which `backend-standards.md` rejects for aggregates and which scales with the shop rather than with the period.

### D4 — One grouped statement for both charts, sharing a snapshot with the figures

A single grouped read — `GROUP BY bucket, method` — serves the evolution chart and the method split at once. Summing that result over methods gives the series; summing it over buckets gives the split.

Two statements now exist where D5 had one, and the apparent risk is **coherence**: under `ReadCommitted` each statement takes a fresh snapshot, so a booking confirming between them leaves the chart's bars not summing to the card above them.

**The two reads nonetheless do not share a transaction, and that was reconsidered during implementation.** The original design here said `RepeatableRead`; three things overturned it:

- `PrismaBusinessProfileRepository` already records the house rule: an interactive `$transaction` holds a connection open across round trips against a **transaction-mode pooler**, *"which is the thing every other repository here is careful not to do"* — on the pool the public booking flow shares (**T47**).
- The grouped read is the heavier one, and **T68** is a standing record of this pooler *hanging* rather than raising. Inside a shared transaction that failure takes the five figures down with the charts, which is a regression against what the page does today.
- So the likelier failure is asymmetric, which makes independent recoverability worth more than snapshot coherence.

*What the skew actually costs.* A booking confirming into the selected period within one pooler round trip (~0.35–0.40 s) of the first read. The bars then sum to one deposit less than the card until the next render. Rare, silent, self-correcting.

*What replaces the guarantee.* Reconciliation is proven where it is decidable: `sumIncomeSeries(fillIncomeSeries(rows, edges))` equals the total those rows represent, tested in the domain with no database. That is the property a reader depends on, and the transaction never proved it — it only closed one way of breaking it.

*Alternative considered.* Folding the grouped rows into the existing statement. `$queryRaw` returns one result set, so this means either a wider row set the aggregate re-derives, or `json_agg` — which puts shaping in SQL and returns a type the driver's mapping has never been proven on here.

### D5 — Each dataset carries its own `Loaded<T>`

`StatisticsView` gains the chart data as a separately-loadable member rather than widening the existing one. If the grouped read fails and the aggregate does not, the owner keeps five real figures and loses only the charts. Collapsing both into one failure would throw away correct information; collapsing the charts into zeros would state something false about the business.

### D6 — T82 is declined, in writing

T82 offers this page as a possible home for money the owner owes back. A chart surface is the wrong place for a refund to-do list: the figure is not a trend, it does not share this page's clock, and putting it beside revenue invites exactly the reading the exclusion exists to prevent. The entry gets a line recording that D6 looked at it and said no, so the next reader does not re-litigate it.

## Risks / Trade-offs

- **A dropped owner predicate leaks a plausible chart** → Every sub-query and the grouped statement carry their own `ownerId`. Proven by a two-owner fixture in both directions, with the counterfactual measured — a probe that would pass equally without the predicate is not a probe.
- **`REJECTED` payments inflating the method split** → `Payment_one_live_per_booking` is `ON ("bookingId") WHERE status <> 'REJECTED'`, so retries are unlimited by design. The split filters `p.status = 'APPROVED'`; the gate seeds a booking with two rejected attempts and asserts one payment.
- **Empty buckets omitted by the read** → The fill happens in the domain, tested over a series with a hole in the middle. Left unfilled the chart still looks fine, which is what makes it dangerous.
- **`bigint` reaching a React prop** → `width_bucket` and `count(*)` return wide integers; a `TypeError: Do not know how to serialize a BigInt` at render is a blank page. Narrowed at the repository boundary, as rule 7 already requires.
- **A hung pooler read (T68)** → Intermittent and observed to hang rather than raise. Gate probes run inside `withTimeout` so cleanup still happens; if the plan capture will not run, take it over the Supabase SQL API and report the probe as NOT RUN.
- **Extra load on the shared pool (T47)** → One more grouped aggregate per page view, on a dashboard with no rate limit, against the pool the booking flow uses. Measure the plan; T81 already records that `hasAnyBookingEver` costs the range predicate its place in the outer `Index Cond`.
- **Hand-rolled SVG is more code to get wrong than a library call** → Accepted. Mitigated by keeping the geometry pure and unit-testing it, and by the accessible table, which is the same numbers rendered by a different path — a divergence between them is a visible test failure.
- **A 31-label axis on a 360 px phone** → Labels thin out; measured rather than eyeballed, because D5's window would not resize.
- **The two income figures still will not agree** → By design. Copy is the whole mitigation, which is why the spec requires the basis sentence rather than leaving it to the implementer.
- **T10 will look like a chart bug** → If an SVG fill renders transparent in the developer's browser, check a clean profile before touching code. That symptom has cost this project three milestones already.

## Migration Plan

No data migration, no schema change, no new dependency. Deployment is the standard build; rollback is a revert, since nothing is persisted and no contract outside the repository changes.

Documentation changes land in the same commit as the code they describe: `frontend-standards.md` and `project-context.md` for D1, `tech-debt.md` for T83 (closed), T82 (annotated) and T81/T47 (re-measured), `roadmap.md` for the D6 entry with measurements rather than arithmetic.

## Open Questions — resolved during the runtime pass

- **Bar or line for the evolution chart? → Bars, and the empty days settled it.** The argument for bars was that they avoid implying interpolation between discrete daily totals. What decided it was seeing a real week with three zero days: a bar chart draws those as *gaps in a row of bars*, which reads as "nothing happened on Thursday". A line through them reads as a value declining to zero and recovering — a shape that describes a trend the shop did not have. The chart's most important state is the one a line would misdescribe.

- **Do 24 hourly buckets earn their place for `hoy`? → Yes, but the labels do not.** The fear was a mostly empty axis. Rendered, a single day with one paid appointment is legible and *informative* — one bar at 13:00 against 23 empty hours says "one appointment, early afternoon", which no single total can. What did not survive contact was labelling all 24: `labelStrideFor` thins them to every third (00, 03, 06 … 21), and the runtime pass confirmed zero overlapping pairs. The buckets stay; the labels thin.

- **Does the method split need its own empty-vs-degenerate copy? → Two sentences, not one, and they are not interchangeable.** `methodsChartEmpty` ("no se cobraron señas") is an *absence*; `methodsChartSingle` ("todas las señas entraron por Mercado Pago: $ 900,00 en 1 pago") is an *answer* that happens to have one part. Collapsing them would tell an owner whose every deposit arrived by transfer that nothing was collected. The runtime pass rendered the degenerate case for real — including the singular "1 pago" — and it reads as a statement about the business rather than as a missing chart.

## Open Questions — still open

- **The `workerd` timezone check found a better technique than the one this project has been using**, and it may generalise beyond this page: an hourly axis discriminates the business calendar from the runtime's at *any* hour of the day, where D3's `TZ` trick cannot reach `workerd` at all and the genuine 21:00–23:59 window only opens in the evening. Whether other surfaces can be verified the same way is worth a look the next time one needs it.
