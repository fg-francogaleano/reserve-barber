## 1. Specification

- [x] 1.1 Reword the out-of-range weekday requirement to state the action's structural bound and the parser's rejection separately, keeping both existing scenarios rather than dropping them
- [x] 1.2 Extend `docs/tech-debt.md` T8 to name working hours — it lists locations, barbers and services but not the schedule, whose whole-week replacement has the same last-write-wins exposure
- [x] 1.3 Extend `docs/tech-debt.md` T25 to name the schedule route — it names only the assignment route, while the schedule action reads `barberId` from the body the same way

## 2. Tests the archived spec already claims

- [x] 2.1 `actions.test.ts`: the owner is resolved before the payload is parsed, and an unauthenticated submission writes nothing
- [x] 2.2 `actions.test.ts`: a failure raised after the owner is resolved is returned as form state, never thrown to the error boundary, and carries the generic Spanish message
- [x] 2.3 `actions.test.ts`: the response contains no stack trace, driver message, table or column name
- [x] 2.4 `actions.test.ts`: the submitted week is echoed back on rejection, and `revalidatePath` runs before the redirect
- [x] 2.5 `actions.test.ts`: an injected `start-7` is ignored and the seven valid days are still saved — the scenario the corrected spec now describes
- [x] 2.6 `page.test.tsx`: an unknown or foreign barber resolves to not-found, not to a distinguishable response
- [x] 2.7 `page.test.tsx`: the stored week reaches the form as pre-filled values, and the lookup is scoped to the session owner
- [x] 2.8 `formState.test.ts`: each rejection code maps to its own Spanish message rather than collapsing to a generic one

## 3. Verification

- [x] 3.1 `npm run typecheck`, `npm run lint`, `npm run test:coverage` clean
- [x] 3.2 Confirm **zero production files changed** — this change is documentation and tests; a red test would mean a test asserts something the shipped code does not do
- [x] 3.3 `openspec validate`, then archive and sync — **the archive aborted on the first attempt**, again on dropped scenarios. Renaming a scenario header counts as deleting it, which design D2 anticipated in principle and I then did anyway. Fixed by keeping both original headers verbatim and adding the new one alongside
- [x] 3.4 Commit and open the PR to `main`
