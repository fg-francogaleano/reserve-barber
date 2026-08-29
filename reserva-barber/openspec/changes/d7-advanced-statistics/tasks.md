> Order is dependency order, and it is TDD throughout: every implementation task
> is preceded by the failing test that defines it (`base-standards.md` §1).
> Nothing in groups 2–7 requires a database; the database appears in group 8 and
> is where the change is actually proven.

## 1. Calendar arithmetic

- [x] 1.1 Write failing tests in `bookingCalendar.test.ts` for `hourEdgesBetween(first, last)`: a one-day span yields 25 edges, a seven-day span 169, a 31-day span 745; the first edge is the local midnight of `first` and the last is the midnight after `last`; every edge is computed from its own wall-clock reading rather than by adding an hour
- [x] 1.2 Implement `hourEdgesBetween` on `localToInstant`, following `hourEdgesOf` and `dayEdgesBetween`
- [x] 1.3 Write a failing test that the hour read back from an edge is the business's hour and not the runtime's, at an instant where the two disagree
- [x] 1.4 Expose whatever reader that test needs from `bookingCalendar` (never a runtime local getter — `businessTime.test.ts` scans this directory for them)

## 2. Range plumbing

- [x] 2.1 Write failing tests in `statisticsRangeParams.test.ts` for `hourBucketEdgesFor(range, today)`: every range resolves, the span matches `intervalFor` exactly at both ends, `mes` in February yields 673 edges and in August 745
- [x] 2.2 Implement `hourBucketEdgesFor` beside `bucketEdgesFor`, reusing the same week and month resolution

## 3. Domain types and folds

- [x] 3.1 Write failing tests for `rankTopN`: count-descending order, ascending label tie-break, the remainder folded into one aggregated entry, and the post-condition that the returned counts sum to the input counts
- [x] 3.2 Write failing tests for `fillHourlyDistribution`: 24 buckets always, empty hours at zero, a bucket index outside the span dropped rather than clamped
- [x] 3.3 Write failing tests for `disambiguateLabels`: a repeated label is qualified by its sublabel, a unique label is not
- [x] 3.4 Write the failing reconciliation test: over one set of rows, the service counts, the barber counts and the hourly counts each sum to the number of confirmed bookings those rows represent
- [x] 3.5 Implement `BreakdownRow`, `RankedEntry`, `HourlyBucket`, `BusinessBreakdowns` and the three functions in `statistics.ts`, with the header comments that carry the rules they encode

## 4. The port

- [x] 4.1 Add `readBreakdowns({ ownerId, range, edges })` to `IStatisticsRepository`
- [x] 4.2 Write rules 13–16 into the port's header: the breakdowns share one row set with the counts; every branch carries its own owner predicate and reaches the owner only through `barber → location → ownerId`; the hour is domain-decided and SQL only compares against edges; top-N is a domain fold and never a `LIMIT`
- [x] 4.3 Record in the header that no payment row may enter the counted row set, and why (the partial unique index admits unlimited rejected attempts on purpose)

## 5. The statement

- [x] 5.1 Write failing repository tests asserting the statement's shape: a `confirmed` CTE, three grouped branches, an owner predicate present in every branch, no timestamp truncation, no hour extraction, no timezone name
- [x] 5.2 Write a failing test that `bigint` counts are narrowed to `number` at the boundary and that the projection uses only `text` and `bigint`
- [x] 5.3 Implement `readBreakdowns` in `PrismaStatisticsRepository`: the shared CTE, the three `UNION ALL` branches, `width_bucket` over the `float8[]` of epoch seconds, the service join taken for its name only
- [x] 5.4 Write the comment block explaining why this is one statement and not three, why not `json_agg` (T58), and why the service branch does not scope through `Service.ownerId`

## 6. The service

- [x] 6.1 Write a failing `StatisticsService.test.ts` case: the breakdown read raising leaves `statistics` and `charts` populated, and vice versa in both directions
- [x] 6.2 Add `breakdowns: Loaded<BusinessBreakdowns>` to `StatisticsView` and a third leg to the existing `Promise.all`, caught in its own private method
- [x] 6.3 Assert that the three reads share no transaction and that the hour edges passed down are the ones the view carries

## 7. The page

- [x] 7.1 Add every new string to `src/lib/copy.ts` in Spanish (es-AR), including the sentence forms for a single service and a single barber, and confirm `copyIsNotInline.test.ts` still passes
- [x] 7.2 Write failing `chartGeometry.test.ts` cases for horizontal-bar geometry: a zero peak draws zero-width bars rather than `NaN`, the longest bar fills the plot, bar slots do not overlap
- [x] 7.3 Implement the horizontal-bar geometry beside `barsFor`, reusing `labelStrideFor` for the 24-column hour axis
- [x] 7.4 Write failing `page.test.tsx` cases for every state: read failed alone, read failed with the figures, all three failed, empty shop, empty period, **cancellations with no confirmations**, single barber, single service, populated
- [x] 7.5 Add the confirmed-activity predicate as one named definition beside `hasSomethingToReport`, and gate the breakdown section on it
- [x] 7.6 Build `RankingChart.tsx` and `HourlyChart.tsx` as Server Components — inline SVG plus a text equivalent, no colour-only encoding, element ids namespaced from a stable prop
- [x] 7.7 Render the section in `page.tsx` beneath the charts, with the aggregated remainder entry tabulated and not drawn
- [x] 7.8 Extend `loading.tsx` so the skeleton is shaped like the new blocks and the page does not jump

## 8. Proof against the live database

- [x] 8.1 Write `scripts/d7-gate.ts` following `d5-gate.ts` and `d6-gate.ts`: a two-owner fixture, the raw statement issued to the live database, teardown that removes the fixture
- [x] 8.2 Add the counterfactual probes: the owner predicate removed changes the totals; the confirmed predicate removed changes the totals; the hour taken from the runtime's clock disagrees with the business's
- [x] 8.3 Add the reconciliation probe against real rows, and assert it separately from the domain-level one
- [x] 8.4 Run the gate and record `EXPLAIN (ANALYZE, BUFFERS)` for the new statement against the real owner
- [x] 8.5 Measure the `float8[]` payload and the round trip for `mes`; if it fails or hangs, fall back to the design's anchor arithmetic and add its precondition to the spec and a test
- [x] 8.6 Decide the T81 index in writing — taken with the measurement that justifies it, or refused with the measurement that makes it unnecessary

## 9. Runtime verification

- [x] 9.1 Run the page on Node with `TZ` set to a hostile zone; confirm every ranking row, count and hourly bucket is identical to the Argentine-clock run
- [x] 9.2 Run the page on `workerd`; confirm the same, byte for byte, authenticated, against real rows
- [x] 9.3 Confirm a late-evening appointment lands in its business hour on both runtimes — the discriminator D6 records as available at any hour
- [x] 9.4 Measure the page at a real 360 px viewport with the grid forced to one column; report horizontal overflow and overlapping labels as numbers
- [x] 9.5 Render the page with JavaScript disabled in a production build; confirm both rankings, the distribution and their text equivalents are in the served markup
- [x] 9.6 Measure the client bundle against `main` and report the delta

## 10. Close-out

- [x] 10.1 `npm run lint`, `tsc --noEmit` and the full `vitest` suite green
- [x] 10.2 Run the adversarial pass **after** the story reads as done, looking specifically for copy that asserts a state nothing checked — the shape of both defects D6 found there
- [x] 10.3 Update `docs/roadmap.md`: tick D7 and record what implementation overturned, with measurements rather than claims
- [x] 10.4 Update `docs/tech-debt.md` with anything measured and deferred, and close or amend T81's entry according to 8.6
- [ ] 10.5 Commit, open the PR, and run `/opsx:verify` before archiving
