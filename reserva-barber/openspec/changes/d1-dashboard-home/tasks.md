## 1. Source-of-truth documents first (`base-standards.md` §7)

- [x] 1.1 `docs/tech-debt.md` **T64**: record that the receipt queue over-reports — a `PENDING` receipt on a booking the sweep expired stays in the queue with an approve control that can only answer `noLongerPending` — and that D1 closes the _visibility_ half by narrowing the queue's predicate and adding a counter over it. State plainly that the painful half (a receipt for an appointment three weeks out blocking its slot) is untouched.
- [x] 1.2 `docs/tech-debt.md` **T67**: record which half closes here — the owner now has a surface that shows an expired hold (the recent list's `EXPIRED` badge and the "reservas sin confirmar hoy" line) — and that the second gap, a dead cron indistinguishable from a healthy one, is **not** closed by any counter on this page.
- [x] 1.3 `docs/tech-debt.md` **T54**: re-cost the entry. Its justification ("a migration over a table with zero rows") is no longer true. Record the decision from design D10: the fix belongs with **D4**, because it is a schema change plus an edit to B4's booking transaction and D1 contains no write at all; note that D1's ten-row recent list makes it reachable but only weakly.
- [x] 1.4 `docs/tech-debt.md` **T29**: note that D1 has shipped and does **not** surface a confirmed appointment stranded outside its barber's working hours, so the trigger this entry names is not satisfied.
- [x] 1.5 `docs/backend-standards.md` → Performance: state that a dashboard aggregate is one owner-scoped statement, that a monetary aggregate crosses the repository boundary as a canonical decimal string, and that income joins through the booking's status.
- [x] 1.6 `docs/data-model.md` §12: extend the existing "a payment may be `APPROVED` while its booking is not `CONFIRMED`" note with the bounding column — an income figure is bounded on `approvedAt`, not on `createdAt` and not on the appointment's `startTime`.

## 2. The domain: month bounds and the page's constants

- [x] 2.1 Write failing tests for `monthBoundsOf(date: LocalDate): Interval` in `src/server/domain/models/bookingCalendar.test.ts`: the last evening of a month at 23:30 ART falls inside that month and not the next; a 31→1 rollover; February in a leap and a non-leap year; the range is half-open `[first, next first)`.
- [x] 2.2 Implement `monthBoundsOf` in `src/server/domain/models/bookingCalendar.ts` beside `dayBoundsOf`, built from `localToInstant` on two month firsts. Document why it is not `new Date(y, m, 1)` and not "add 30 days".
- [x] 2.3 Confirm `businessTime.test.ts`'s literal scan still passes — no banned calendar reader entered this directory.
- [x] 2.4 Create `src/server/domain/models/dashboardSummary.ts` with `RECENT_BOOKINGS_LIMIT = 10`, disclosed as a guess in the register style `bookingHorizon.ts` uses, and the `DashboardSummary` / `RecentBooking` shapes.

## 3. The aggregate port

- [x] 3.1 Create `src/server/domain/repositories/IDashboardSummaryRepository.ts`: `readSummary(input: { ownerId, dayRange, monthRange, now })` returning the six figures, and `findRecentForOwner(input: { ownerId, barberId?, limit })` returning the explicitly projected list.
- [x] 3.2 Document in the contract itself why this is a separate port from `IBookingRepository` (design D6 — the shape differs, not the scoping), that every method is owner-keyed, and that the recent projection carries **no client email and no telephone**.

## 4. The application service (TDD)

- [x] 4.1 Write failing tests for the income rule in `DashboardSummaryService.test.ts`: an `APPROVED` payment whose booking is `EXPIRED` is excluded; one whose booking is `CANCELLED` is excluded; one approved on 31 August for a 3 September appointment counts in August; an empty sum surfaces as a canonical zero.
- [x] 4.2 Write failing tests for the cancellation rule: an `EXPIRED` booking is not counted, including one carrying a non-null `cancelledAt`; a cancellation made today for a past appointment counts today.
- [x] 4.3 Write failing tests for the two "today" figures: confirmed and live-held are separate numbers and are never summed; the live-held figure is decided by `blocksAvailability` rather than by a status filter.
- [x] 4.4 Write failing tests for the barber filter resolution: an id matching no barber of this owner is discarded and the unfiltered list returned; a repeated parameter (`string[]`) does not throw; an over-long value is refused before use.
- [x] 4.5 Write failing tests for degradation: a failed aggregate read yields a failed _state_, never zeros; a failed list read leaves the counters intact; neither rethrows into the route boundary.
- [x] 4.6 Implement `src/server/application/dashboard/recentBookingsParams.ts` (+ tests) — the matched-never-parsed resolution against the loaded barber list.
- [x] 4.7 Implement `src/server/application/services/DashboardSummaryService.ts` — one injected clock, day and month ranges computed once and passed down, the three reads issued under `Promise.all`, per-region failure captured and logged via `toErrorLogContext`.
- [x] 4.8 Verify no SQL-shaped copy of the blocking rule and no `Number()` on a monetary value exists anywhere in the service.

## 5. The receipt queue narrowing (design D7)

- [x] 5.1 Write failing tests: a `PENDING` receipt whose booking is `EXPIRED` is absent from `findPendingForOwner`; the same row is absent from `countPendingForOwner`; the count equals the listing's length over the same fixture; another owner's rows appear in neither.
- [x] 5.2 Extract one exported `where` fragment in `PrismaTransferReceiptRepository.ts` carrying `status: 'PENDING'` **and** `payment.booking.status === 'PENDING_APPROVAL'`, and build both the listing and the new count from it.
- [x] 5.3 Add `countPendingForOwner(ownerId)` to `ITransferReceiptRepository` with the contract note that the predicate is shared with the listing and why (a counter that disagrees with its queue is worse than no counter).
- [x] 5.4 Confirm `ReceiptReviewService` and `/comprobantes` still pass their existing tests, and that no row the narrowed queue now returns would be refused by `approve()`.

## 6. The aggregate repository (TDD)

- [x] 6.1 Write failing tests for `PrismaDashboardSummaryRepository`: the summary is one statement; it is scoped through `barber → location → ownerId`; the monetary sum is converted with `toCanonicalDecimal`; a null sum becomes a canonical zero; the recent read applies its limit and the optional barber filter **in addition to** the owner scope.
- [x] 6.2 Implement `src/server/infrastructure/prisma/PrismaDashboardSummaryRepository.ts` — one `$queryRaw` of aggregates for the six figures, one projected `findMany` for the list. Comment why one statement rather than six (design D5: consistency, not only speed).
- [x] 6.3 Verify the raw statement narrows by status, owner and instant range only — no re-expression of the hold-deadline rule.

## 7. The page

- [x] 7.1 Move the home into a route group: `app/(dashboard)/(home)/page.tsx` with its own `loading.tsx`, leaving `app/(dashboard)/loading.tsx` as the generic fallback the four create/edit routes inherit (design D14). Confirm the URL is still `/`.
- [x] 7.2 Add the `COPY.dashboard` block — six labels naming their predicates, the "señas cobradas" qualifier, the empty-shop state, the filtered-empty state with its clear control, and the two failure strings. Spanish only in the values.
- [x] 7.3 Create `app/(dashboard)/(home)/dashboardSummaryService.ts` — composition root, `import 'server-only'`, mirroring `comprobantes/receiptReviewService.ts`. No cipher, no storage client.
- [x] 7.4 Implement the page: `requireOwner()` in its own right, `dynamic = 'force-dynamic'`, `metadata.robots` noindex, the counter grid, the recent list with per-status badges, and the failure states. All `Intl` formatting server-side.
- [x] 7.5 Implement `RecentBookingsFilter.tsx` as a Server Component: `<form method="get">` + native `<select>` styled with the `Input` ring/border tokens + submit. No `'use client'`. Hidden when the owner has no barbers. Options include inactive barbers that have bookings.
- [x] 7.6 Add the **Inicio** link to `app/(dashboard)/layout.tsx`.
- [x] 7.7 Write `app/(dashboard)/(home)/page.test.tsx`: populated, empty-shop, filtered-empty, failed-counters and failed-list states; assert the failed state renders neither `0` nor a formatted zero; assert `CANCELLED` and `EXPIRED` badges differ; assert no email or phone appears in the output.

## 8. Verification

- [x] 8.1 Write `scripts/d1-gate.ts` following `b5`–`b7-gate.ts`: seed two owners; for the owner under test seed bookings in all five statuses, an `APPROVED` payment on an `EXPIRED` booking, a `PENDING` receipt on a swept booking, a cancellation made today for a past appointment, and a deposit of exactly `2000.50`.
- [x] 8.2 The gate asserts every one of the six figures, asserts none of the other owner's rows contributed, and asserts the sum reads `2000.50` and not `2000.5`.
- [x] 8.3 The gate runs `EXPLAIN` on the aggregate statement and prints the plan, so design D13's index question is answered by measurement.
- [x] 8.4 The gate prints the wall-clock duration of the page's three reads; record the figure and flag it if it exceeds ~1.2 s.
- [x] 8.5 **Answered by 8.3: no index ships.** `EXPLAIN` on both the owner-scoped aggregate and the income subquery reports hash joins over sequential scans at costs of 3.32 and 4.55 — the planner is right at this table size, and an index it would not descend is dead weight plus a migration. Design D13 said the measurement decides; it did. **The evidence is weak in one direction and that is stated rather than glossed:** nineteen bookings prove the index is unnecessary _now_, not that it stays unnecessary. The trigger is a real shop's first busy month, and the candidates remain `Booking(status, startTime)` and `Payment(status, approvedAt)`.
- [x] 8.6 `npm run typecheck`, `npm run lint`, `npm test` clean; coverage ≥ 90 % on domain and application.
- [x] 8.7 `wrangler deploy --dry-run` and record the bundle size against **T51**'s ceiling; confirm no client JavaScript and no new dependency were added.
- [x] 8.8 **Driven on both runtimes against the live database.** `next dev` and `wrangler dev` render identically: the five counters, the "señas cobradas" qualifier, the filter with all five barbers, an `EXPIRED` booking shown with its own badge, the filtered-empty state naming the barber and offering the way back, and an unmatched `?barbero=` discarded without reaching the query. The `(home)` loading skeleton was observed during navigation. `/comprobantes` and the counter both read zero over the one `PENDING` receipt whose booking the sweep expired — the D7 repair, confirmed on production data rather than a fixture. T68 made the unfiltered list fail on both runtimes, which incidentally exercised the real degradation path: counters intact, list region reporting the failure, no fall-through to the error boundary, and `dashboard.summary` absent from both logs. **The JavaScript-disabled pass was run and it failed**, which is what withdrew design D8's claim: the skeleton never resolves, because the segment's `loading.tsx` makes the route stream and the swap-in scripts do not run. Not a regression — `/` has sat behind that boundary since A1 — and recorded as a widening of T44's Cause 1. **One check remains for Franco**, not drivable from here: the page at ~01:30 UTC, to see "today" resolve to the business's day rather than the runtime's.

## 9. Close the change

- [x] 9.1 Update `docs/roadmap.md`: tick **D1**, and record the decisions worth carrying forward — the counter definitions, the receipt-queue repair, the income label, the no-JS filter, and what was deliberately left open.
- [x] 9.2 Confirm every tech-debt edit from group 1 matches what actually shipped, including 8.5's outcome either way.
- [ ] 9.3 Commit on `feat/d1-dashboard-home`, branched from an updated `main` (the shared database makes a stale branch propose `migrate reset`).
