## 1. Documentation first (spec-first policy, `base-standards.md` §7)

- [x] 1.1 Amend `docs/frontend-standards.md` (:58, :232, :371): record that `/estadisticas` renders its charts as server-side SVG, that no client charting library is used, and why (design D1). Keep Recharts/Tremor listed as available to the project.
- [x] 1.2 Amend `docs/project-context.md` (:97, :99) with the same divergence, in one sentence, pointing at the frontend-standards entry.
- [x] 1.3 Add a line to **T82** in `docs/tech-debt.md` recording that D6 considered it and declined it, with the reason (design D6). Do not close it.
- [x] 1.4 Confirm the delta spec at `openspec/changes/d6-statistics-charts/specs/business-statistics/spec.md` still matches the decisions above, and re-run `openspec validate d6-statistics-charts`.

## 2. Domain — types and the rules that have nowhere else to live

- [x] 2.1 Write failing tests in `src/server/domain/models/statistics.test.ts` for the bucket series: a series with a hole in the middle fills to `"0.00"`, a series with no rows fills to its full length, and the filled series sums to a given total.
- [x] 2.2 Add `IncomeBucket`, `PaymentMethodShare` and `BucketGranularity` to `src/server/domain/models/statistics.ts`, documenting that the buckets share the five figures' `startTime` basis and that the cash-collected figure does not.
- [x] 2.3 Implement the fill function so the tests in 2.1 pass. Filling happens here, never in SQL and never in a component.
- [x] 2.4 Write failing tests, then implement, the derivation of the method split totals from the grouped rows — including the degenerate single-method case and the zero case.

## 3. Application — which instants bound each bucket

- [x] 3.1 Write failing tests in `statisticsRangeParams.test.ts`: `hoy`/`ayer` yield 24 edges from the day's own bounds; `semana`/`semana-anterior` yield 7; `mes` yields 31 for a 31-day month and 28 for February; every edge set is contiguous, ascending, and its first and last edges equal the range's own bounds.
- [x] 3.2 Add a test asserting the edges are derived from `bookingCalendar` helpers and that no runtime calendar reader is used — mirror the scan `businessTime.test.ts` already performs.
- [x] 3.3 Implement `bucketEdgesFor(range, today)` and `granularityFor(range)` in `src/server/application/dashboard/statisticsRangeParams.ts`, computing every edge from both endpoints rather than by adding a fixed duration.

## 4. Port — the contract before the implementation

- [x] 4.1 Add the grouped-read method to `src/server/domain/repositories/IStatisticsRepository.ts`, taking the owner id, the interval and the bucket edges.
- [x] 4.2 Document the rules every implementation must hold, extending the existing eight: the `APPROVED` + `CONFIRMED` join, the mandatory `p.status = 'APPROVED'` filter and why (`Payment_one_live_per_booking` admits unlimited rejected rows), the snapshot requirement, its own owner predicate, no date arithmetic, and the wide-integer narrowing for bucket indexes.
- [x] 4.3 Document that the cash-collected figure is the single `approvedAt`-bounded value in this port and that nothing may divide it by an appointment-keyed figure.

## 5. Infrastructure — the statement

- [x] 5.1 Write failing tests in `PrismaStatisticsRepository.test.ts` for the new read's mapping: `bigint` bucket indexes and counts narrowed to `number`, amounts through `toCanonicalDecimal`, an empty result set yielding an empty series rather than a throw.
- [x] 5.2 Add a test asserting the statement contains no `date_trunc`, no interval arithmetic and no other date computation.
- [x] 5.3 Implement the grouped statement in `PrismaStatisticsRepository.ts`: `width_bucket` over the passed `float8[]` edges, `GROUP BY bucket, method`, filtered on `p.status = 'APPROVED' AND pb.status = 'CONFIRMED'`, scoped through `barber → location → ownerId` with its own owner predicate.
- [x] 5.4 Add the cash-collected figure bounded on `p."approvedAt"` within the same interval, over the same status pair.
- [x] 5.5 Keep the two reads independent and out of any shared transaction (design D4, revised). Add a test asserting no transaction wraps them, and a domain test that the filled series sums to the total the same rows represent.

## 6. Service — one view, independently loadable parts

- [x] 6.1 Write failing tests in `StatisticsService.test.ts`: the charts read failing while the figures succeed returns real figures and a failed chart state; the reverse holds; both derive from the same single clock read.
- [x] 6.2 Extend `StatisticsView` with the chart data as its own `Loaded<T>` member, and pass the bucket edges through from the resolved range.
- [x] 6.3 Verify the composition root still needs exactly three collaborators; update `statisticsService.ts` and its source-scanning test if the count changes.

## 7. Copy

- [x] 7.1 Add the chart headings, axis labels, method labels, and the empty, degenerate and failed sentences to `src/lib/copy.ts`, in Spanish (es-AR).
- [x] 7.2 Write the cash-collected card's label and basis sentence: it must state that it is bounded on approval and that it will not equal the deposits card beside it.
- [x] 7.3 Spell every composed sentence out in the tests rather than composing the expectation the same way the code does — D5's runtime pass found four wrong sentences that a self-comparing test had passed.

## 8. UI — geometry, then components

- [x] 8.1 Write failing tests for the pure geometry: a value-to-y scale over a max of zero does not divide by zero, a single-bucket series produces valid coordinates, and every generated coordinate stays inside the viewBox.
- [x] 8.2 Implement the scale and path/rect builders as pure functions, with no DOM access and no `window`.
- [x] 8.3 Build `IncomeChart.tsx` as a Server Component: inline SVG with a `viewBox`, `role="img"`, an accessible name naming what it shows, and the accompanying data table carrying identical values. Labels thin out rather than overlap on a 31-bucket axis.
- [x] 8.4 Build `PaymentMethodsChart.tsx` the same way: amounts as the encoding, counts beside them, a text label plus formatted amount on every part, and the single-method case stated rather than drawn as a whole.
- [x] 8.5 Render both charts and the sixth card from `page.tsx`, keeping every `Intl` call on the server. Charts are omitted entirely when `hasAnyBookingEver` is false.
- [x] 8.6 Add chart-shaped skeletons to `loading.tsx` beside the existing five, keeping `RangeNav` rendered there.
- [x] 8.7 Add a test asserting the segment still has no `layout.tsx` and that no new Client Component was introduced on this route.

## 9. Gate and fixture

- [x] 9.1 Write `scripts/d6-runtime-fixture.ts` following `d5-runtime-fixture.ts`: a marked two-owner fixture with a booking carrying two `REJECTED` plus one `APPROVED` payment, an `APPROVED` payment on a non-confirmed booking, a period with an empty bucket in the middle, rows on both half-open boundaries, and a deposit approved in one period for an appointment in another.
- [x] 9.2 Write `scripts/d6-gate.ts` following `d5-gate.ts`, every probe inside `withTimeout`, fixture removal in a `finally` that runs even when a probe hangs.
- [x] 9.3 Probes for: cross-owner isolation in both directions with the counterfactual measured (owner predicate removed, totals differ); declined attempts contributing one payment to one method; the non-confirmed approved payment absent from every bucket and both parts; buckets summing to the deposits figure; both boundary rows; the cash-collected figure differing from the deposits figure over the cross-period deposit.
- [x] 9.4 Capture the new statement's query plan. Add an index only if the plan asks for one; if the pooler hangs (T68), capture over the Supabase SQL API and report the probe as NOT RUN.

## 10. Verification

- [x] 10.1 `npm run typecheck`, `npm run lint`, `npm test` — all green.
- [x] 10.2 Run `scripts/d6-gate.ts` against the live database; confirm the fixture is gone afterwards.
- [x] 10.3 Render the page authenticated on **both** engines (`next dev` and `wrangler dev`) against real rows; every bucket, part and figure identical.
- [x] 10.4 Timezone check on Node with `TZ=Pacific/Kiritimati`, and on `workerd` in the genuine 21:00–23:59 ART window. Seed so a wrong answer differs by **which** rows it counts, not by how many.
- [x] 10.5 Measure the phone layout at a 360 px container with a 31-bucket month and the worst realistic sum: nothing wider than the container, no horizontal scroll. Measure, do not eyeball.
- [x] 10.6 Measure the bundle in gzip against `main`'s 3186.22 KiB and confirm no charting dependency entered it.
- [x] 10.7 Look at the page in a clean browser profile. If a fill renders transparent, that is **T10**, not a defect — do not change code.
- [x] 10.8 Run the adversarial pass over this change's own claims: find any probe or test that would pass equally if the mechanism it names were absent, and replace it.

## 11. Close out

- [x] 11.1 Close **T83** in `docs/tech-debt.md`, recording what shipped and where.
- [x] 11.2 Update **T81** and **T47** with the new read's measured plan and its cost against the shared pool.
- [x] 11.3 Write the D6 entry in `docs/roadmap.md` with measurements rather than arithmetic, and tick the story.
- [x] 11.4 Resolve the three open questions in `design.md` against real data, and record the answers where the decision lives.
- [x] 11.5 Run `openspec validate d6-statistics-charts`, then `/opsx:archive` once verification is green.
