## 1. Timezone gate — runs before the schema exists

- [x] 1.1 Write `scripts/m5a-gate.ts` proving `Intl.DateTimeFormat` with `America/Argentina/Buenos_Aires` is supported and does a correct wall-clock → UTC → wall-clock round trip
- [x] 1.2 Prove the check **detects a silent UTC fallback** rather than passing on it — a runtime without tzdata must fail the gate, not appear to succeed
- [x] 1.3 Prove the weekday resolver disagrees with the runtime clock at 21:00–23:59 local, which is the window where a UTC-derived weekday is wrong
- [x] 1.4 Run the gate on `next dev` and on the local `workerd` preview
- [x] 1.5 Fallback not triggered — `workerd` carries tzdata, so the `Intl` path stands and the fixed-offset constant remains only as documented contingency. **Task 4.1 was pulled forward** so both gate legs exercise the real module instead of a copy that could drift

## 2. Specification (spec-first, before any code)

- [x] 2.1 Update `docs/data-model.md` §8: one window per day in the product, schema capable of more, wall-clock minutes, no midnight crossing, and the reason the wider unique constraint is kept
- [x] 2.2 Record the stored-time convention in `docs/data-model.md` — wall clock for recurring schedules, UTC `timestamptz` for points in time, and that `Booking.startTime` must follow the latter
- [x] 2.3 Record in `docs/tech-debt.md`: the split-shift gap (B3 will offer slots during a midday break), the 1440-minutes-per-day assumption with its DST trigger, and retroactive edits stranding bookings (trigger B4)

## 3. Schema and migration

- [x] 3.1 Add the `WorkingHours` model with `@@unique([barberId, dayOfWeek, startMinute])`, `@@index([barberId, dayOfWeek])`, `onDelete: Cascade`, and no `updatedAt`
- [x] 3.2 Add the `Barber.workingHours` back-relation
- [x] 3.3 Create migration `add_working_hours` and confirm it is purely additive
- [x] 3.4 Regenerate both Prisma clients and confirm `typecheck` passes

## 4. Domain layer

- [x] 4.1 Create the business timezone module: the constant, `localToInstant`, `instantToLocal`, and the weekday resolver. This is the **only** place any conversion lives
- [x] 4.2 Create the weekday module: storage index (0 = Sunday) and the es-AR display order (Monday first). The mapping exists once
- [x] 4.3 Create `WorkingHours` domain model and `IWorkingHoursRepository`, every method taking `ownerId`
- [x] 4.4 Create `WorkingHoursErrors`

## 5. Application layer (TDD)

- [x] 5.1 Failing tests for the schema parser: half-filled day rejected naming the weekday; both-empty accepted as a non-working day; end not after start rejected; zero-length rejected
- [x] 5.2 Failing tests for granularity: a start off the 5-minute grid rejected; a window crossing midnight rejected
- [x] 5.3 Failing tests for weekday validation: 7, -1 and 0.5 each reject the **whole** submission rather than dropping one day
- [x] 5.4 Failing test proving an all-empty week parses successfully
- [x] 5.5 Implement `workingHoursSchema.ts` until 5.1–5.4 pass
- [x] 5.6 Failing tests for `BarberScheduleService`: unknown or foreign barber rejected with no write; the submitted week becomes the stored week; an unchanged save is still a valid save
- [x] 5.7 Implement `BarberScheduleService.ts`

## 6. Infrastructure (TDD)

- [x] 6.1 Failing test: the write issues exactly two statements — delete-all then insert — inside one batched `$transaction`, in array form
- [x] 6.2 Failing test: applying the same write twice leaves one window per configured day, proving replacement rather than append
- [x] 6.3 Failing tests: the read and the delete both carry the owner predicate through `barber.location.ownerId`
- [x] 6.4 Failing test: the list indicator is one aggregate for the whole owner
- [x] 6.5 Implement `PrismaWorkingHoursRepository.ts`, selecting only the needed columns

## 7. Editor

- [x] 7.1 Add the `workingHours` block to `src/lib/copy.ts` and `src/lib/formatTime.ts` (minutes → "HH:mm"), Spanish values only
- [x] 7.2 Create `formState.ts` echoing the submitted values, not the stored ones
- [x] 7.3 Create `actions.ts` with `requireOwner()` first, failures as form state, `toErrorLogContext` for every log, and `revalidatePath('/barberos')`
- [x] 7.4 Create the page: resolve the barber scoped to the owner, load the week, not-found for an unknown or foreign id
- [x] 7.5 Create `WeeklyScheduleForm.tsx` — seven day rows, native `type="time"`, no `step`, Monday first
- [x] 7.6 `min-w-0` on every fieldset and row from the start: the UA stylesheet's `min-width: min-content` on `<fieldset>` is the defect M4 hit at 360px
- [x] 7.7 Disable the whole form while pending, and key the rejected re-render so the echoed values win over stale DOM state
- [x] 7.8 Move focus to the first offending day on rejection
- [x] 7.9 Add `loading.tsx` and `not-found.tsx`

## 8. Barbers list

- [x] 8.1 Failing component test: a barber with no windows shows the no-schedule indication; one with windows shows the opposite; the editor route carries an accessible name identifying the barber
- [x] 8.2 Add the indicator and the route to `app/(dashboard)/barberos/page.tsx`, sourcing state from the single aggregate

## 9. Verification

- [x] 9.1 `npm run typecheck`, `npm run lint`, `npm run test:coverage` clean, domain and application at or above 90%
- [x] 9.2 `npm run build` and `opennextjs-cloudflare build` both succeed — the production build catches `'use server'` export violations that unit tests cannot
- [x] 9.3 Add a test that fails if `getDay()`, `getHours()`, `getDate()` or `toISOString().slice` reappears in scheduling code — the ban is a convention and conventions decay
- [x] 9.4 Manually verify: set a week, reload, confirm the wall-clock times are unchanged; clear a day; clear the whole week
- [x] 9.5 Verify the editor at a 360px viewport
- [x] 9.6 Verify the editor submits before hydration and with JavaScript disabled
- [x] 9.7 Verified on `next dev`, on the local `workerd` preview, and against the deployed Worker (version `b8c1f185`, on the owner's explicit authorisation). On both runtimes: wall-clock round trip exact (07:45 stored as 465 and returned as 07:45 — an offset leak would have shown 04:45 or 10:45), the schedule indicator and its `groupBy` correct, a half-filled day rejected naming the weekday, echo-back returning the submitted value rather than the stored one, and the whole week cleared. The post-deploy HTML was requested twice before concluding anything, per the M4 propagation lesson

## 10. Closeout

- [x] 10.1 Update `docs/tech-debt.md` with anything found during implementation — T27 (split shift), T28 (1440-minute assumption), T29 (retroactive edits) added ahead of the code per the spec-first policy; nothing further surfaced during implementation
- [x] 10.2 Tick M5a in `docs/roadmap.md` and split the M5 line into M5a and M5b
- [x] 10.3 `openspec validate`, then archive and sync — archived as `2026-08-11-m5a-barber-weekly-working-hours`; `barber-working-hours` created with 11 requirements, 6 more added across `data-persistence` and `barber-management`
- [x] 10.4 Commit to `feat/m5a-barber-weekly-working-hours` and open the PR to `main` — commit `a209ce5`, PR #8

## 11. Notes from the run

- [x] 11.1 Task 4.1 (timezone module) was pulled ahead of the gate so both gate legs exercise the real module rather than a copy that could drift
- [x] 11.2 The `workerd` leg ran in an **isolated worker** with the project's own wrangler and `compatibility_date`, rather than a temporary route in the app. The route guard is deny-by-default, and weakening it — even briefly — to reach a diagnostic was not worth it. All six probes passed: `workerd` carries tzdata, so the fixed-offset fallback stays a documented contingency
- [x] 11.3 **Focus-after-remount defect found and fixed.** Bumping `renderKey` and calling `focus()` in the same effect silently loses the focus, because the remount destroys the element just focused. M4's equivalent form was unaffected — its only error lives outside the remounted block — so this was new here. A regression test now pins it, and the test was confirmed to fail against the pre-fix code
- [x] 11.4 The browser observation that surfaced 11.3 was **not itself valid evidence**: the automated window has `document.hasFocus() === false`, and Chrome makes `focus()` a no-op in that state. The defect was confirmed by reverting the fix and watching the test fail, not by the browser
- [x] 11.5 `*.probe.ts` excluded from coverage — gate harness, not shipped logic. Counting it would let test scaffolding move the threshold that protects business rules
- [x] 11.6 A stale `next dev` from an earlier session was still holding port 3001: `TaskStop` had killed the npm wrapper but not the Next child process. Worth knowing before trusting that a background server is down
