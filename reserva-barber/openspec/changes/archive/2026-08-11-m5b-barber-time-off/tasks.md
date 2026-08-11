## 1. Specification (spec-first, before any code)

- [x] 1.1 Rewrite `docs/data-model.md` §9: `startsAt`/`endsAt` as UTC instants in `timestamptz`, the half-open range, the whole-day conversion with its inclusive end date, the bounds, overlaps allowed, and the privacy rule on `reason`
- [x] 1.2 Record in `docs/tech-debt.md`: the per-barber absence cap is advisory like T13/T19, and the DST caveat on whole-day ranges points at T28 rather than repeating it

## 2. Schema and migration

- [x] 2.1 Add the `TimeOff` model with `@db.Timestamptz` on both boundaries, `@@unique([barberId, startsAt, endsAt])`, `@@index([barberId, startsAt])`, `onDelete: Cascade`, and no `updatedAt`
- [x] 2.2 Add the `Barber.timeOffs` back-relation
- [x] 2.3 Create migration `add_time_off`; confirm it is purely additive **and that both boundary columns are `TIMESTAMPTZ`, not `TIMESTAMP`** — the whole point of the declaration
- [x] 2.4 Regenerate both Prisma clients and confirm `typecheck` passes

## 3. Instant round-trip gate

- [x] 3.1 Prove against the real database that a known instant survives a write and read unchanged — first zone-aware column in the schema, and a silent drift would look like correct data
- [x] 3.2 Prove a whole-day range built from local midnight lands on the expected UTC instants

## 4. Domain layer

- [x] 4.1 Create the `TimeOff` domain model and a projection type that omits `reason`
- [x] 4.2 Create `ITimeOffRepository`, every method taking `ownerId`
- [x] 4.3 Create `TimeOffErrors`

## 5. Application layer (TDD)

- [x] 5.1 Failing tests for the whole-day conversion: a single day covers that day and ends at the start of the next; a range from the 1st to the 15th includes the 15th and excludes the 16th
- [x] 5.2 Failing tests for the timed conversion: the range is exactly the instants named, and the end instant is outside it
- [x] 5.3 Failing tests for the half-filled time pair, end not after start, and zero-length
- [x] 5.4 Failing tests for the bounds: over 365 days, more than two years ahead, more than one year in the past
- [x] 5.5 Failing tests for `reason`: blank stored as null, over 255 rejected
- [x] 5.6 Implement `timeOffSchema.ts` until 5.1–5.5 pass
- [x] 5.7 Failing tests for `BarberTimeOffService`: unknown or foreign barber rejected with no write; the cap refuses a create; a delete that matches nothing succeeds
- [x] 5.8 Implement `BarberTimeOffService.ts`

## 6. Infrastructure (TDD)

- [x] 6.1 Failing tests: the list read is scoped by owner, ordered `startsAt` descending, and selects only the editor's fields
- [x] 6.2 Failing test: the insert requests skip-on-duplicate so a retry is a no-op
- [x] 6.3 Failing tests: the delete carries the owner predicate and reports success when it matches nothing
- [x] 6.4 Failing test: the availability projection does not select `reason`
- [x] 6.5 Implement `PrismaTimeOffRepository.ts`

## 7. Editor

- [x] 7.1 Add the `timeOff` block to `src/lib/copy.ts` and a server-side es-AR date formatter
- [x] 7.2 Create `formState.ts` echoing the submitted values, not the stored ones
- [x] 7.3 Create `actions.ts` — create and remove — with `requireOwner()` first, failures as form state, `toErrorLogContext` for every log, and **no `reason` in any log line**
- [x] 7.4 Create the page: resolve the barber scoped to the owner, load the list, not-found for an unknown or foreign id
- [x] 7.5 Create `TimeOffForm.tsx`: `type="date"` for the dates, optional `type="time"` for the times, no `step`, `min` or `max`
- [x] 7.6 Create the list with a remove control per row, ordered newest first, with an empty state
- [x] 7.7 `min-w-0` on the fieldset and rows from the start
- [x] 7.8 Disable the form while pending; key the rejected re-render so the echoed values win over stale DOM state; move focus to the error
- [x] 7.9 Add `loading.tsx` and `not-found.tsx`

## 8. Barbers list

- [x] 8.1 Failing component test: each barber offers a labelled route into its absences editor
- [x] 8.2 Add the route to `app/(dashboard)/barberos/page.tsx`

## 9. Verification

- [x] 9.1 `npm run typecheck`, `npm run lint`, `npm run test:coverage` clean, domain and application at or above 90%
- [x] 9.2 `npm run build` and `opennextjs-cloudflare build` both succeed
- [x] 9.3 Manually verify against the real database: a whole-day absence, a multi-day one whose last day is included, a timed one, a duplicate submit, and a removal
- [x] 9.4 Verify the editor at a 360px viewport and without client-side JavaScript
- [x] 9.5 Verified on `next dev` against the real database. The `workerd` preview and the deployed Worker are **not done** — both need a login on those origins and the deploy needs explicit authorisation. The runtime risk they would cover is already discharged by the instant round-trip gate in group 3

## 10. Review — inside the window this time

- [x] 10.1 Run `/opsx:verify` **before** archiving, not after. M5a skipped this and shipped gaps that a follow-up change had to repair
- [x] 10.2 Run `/adversarial-review` **before** archiving
- [x] 10.3 Act on the findings, or record each as debt with a trigger, before the archive

## 11. Closeout

- [x] 11.1 Update `docs/tech-debt.md` with anything found during implementation
- [x] 11.2 Tick M5b in `docs/roadmap.md`
- [x] 11.3 `openspec validate`, then archive and sync — archived as `2026-08-11-m5b-barber-time-off`; `barber-time-off` created with 13 requirements and 5 added to `data-persistence`. **No MODIFIED blocks at all**, so the scenario-dropping failure that aborted both the M4 and M5a1 archives could not arise
- [x] 11.4 Commit and open the PR to `main`

## 12. Findings from the pre-archive review

- [x] 12.1 **No `formState.test.ts`** — the same gap M5a shipped and M5a1 had to repair. Added: eight tests pinning that each rejection code maps to its own Spanish message, including that a mistyped year points at the year rather than at the format
- [x] 12.2 **The "overlaps are allowed" scenario had no test.** It is a decision, not an absence of behaviour, so it needed one. Added two: an absence inside another, and two that partially overlap
- [x] 12.3 **A failed removal tells the owner nothing.** `removeAbsenceAction` is a plain form action with no state to carry a message, so the persisting row is the only signal. Made an explicit scenario in the spec rather than left as an omission, and recorded as **T31** with its trigger
- [x] 12.4 Running the review before the archive is what made 12.1–12.3 cheap. M5a ran it after and needed a follow-up change and a second PR to repair the same class of gap
