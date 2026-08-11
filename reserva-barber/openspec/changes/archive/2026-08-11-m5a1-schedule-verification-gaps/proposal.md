## Why

M5a was archived and merged without running the verification pass. When it was finally run, it surfaced one spec-versus-code divergence and a set of coverage gaps that are — almost exactly — the ones the same pass caught in M4. The step that was skipped is the step that would have stopped them.

The divergence matters more than the gaps. `barber-working-hours` currently states that a submission carrying a weekday outside 0–6 rejects the whole save. It does not: the action builds its payload from a hardcoded seven-day loop, so an injected `start-7` is never read, silently ignored, and the save succeeds. The outcome is safe — no invalid row can be written — but a permanent spec now promises a rejection that never happens, and the story that builds slot generation will read it.

## What Changes

- **Correct the spec to describe what the code actually does**: the action normalizes to the seven known weekdays, which bounds the payload by construction; the parser's weekday validation is defence for a direct caller, not the HTTP surface. The requirement is reworded rather than the code changed — bounding a payload by construction is a better property than validating it afterwards, and the code already has it.
- Add `actions.test.ts` for the schedule action, covering the three scenarios that had no test: authentication before parsing, an infrastructure failure returned as form state, and no internal detail in the response.
- Add `page.test.tsx` for the schedule editor, covering the tenancy boundary — an unknown or foreign barber resolving to not-found rather than a distinguishable response.
- Add a test for the form-state mapping, so each rejection code maps to its Spanish message.
- Extend `docs/tech-debt.md`: **T8** (last-write-wins) never mentioned working hours, and **T25** (the route parameter being decorative for the write) named only the assignment route while the schedule route has the same shape.

No behaviour change. No schema change, no migration.

## Capabilities

### New Capabilities
_(none — this corrects and covers an existing capability)_

### Modified Capabilities
- `barber-working-hours`: the out-of-range weekday requirement is reworded to state the actual guarantee — the action accepts only the seven known days, and the parser rejects anything else for callers that reach it directly. The requirement currently describes a rejection that the HTTP surface cannot produce.

## Impact

**Tests** — three new files under `app/(dashboard)/barberos/[id]/horarios/`: `actions.test.ts`, `page.test.tsx`, `formState.test.ts`. No production file changes.

**Docs** — `docs/tech-debt.md` (T8, T25).

**Not affected** — no schema, no migration, no runtime behaviour, nothing deployed changes meaning.

**Process note** — this change exists because verification ran after archiving rather than before. The lesson belongs in the record, not only in this proposal: the M4 flow ran `/opsx:verify` and `/adversarial-review` inside the verification window, and both found real work; M5a skipped them and shipped the same class of gap.
