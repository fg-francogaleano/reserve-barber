## Context

M5a's action reads its payload from a fixed loop over days 0–6 (`actions.ts`, `submittedWeek`). Anything else a client sends — `start-7`, `start--1`, `start-0.5` — is never read. The parser it feeds therefore only ever receives the seven known keys, and its weekday validation, while correct and tested, cannot fire from the HTTP surface.

The archived spec says the opposite: that such a submission rejects the whole save. Both behaviours are safe; only one is true.

## Goals / Non-Goals

**Goals:**
- Make the permanent spec describe the guarantee the system actually provides.
- Cover the three scenarios that shipped with no test, and the tenancy boundary that had only indirect coverage.
- Record two pieces of debt that existed before this change but named the wrong routes.

**Non-Goals:**
- Changing runtime behaviour. Nothing deployed should mean something different afterwards.
- Broadening coverage beyond the scenarios the specs already claim.
- Revisiting the one-window-per-day decision or T27.

## Decisions

### D1 — Correct the spec, not the code
The action's normalization is the stronger property. Reading only the seven known keys means the payload is bounded **by construction**: no crafted field count, no unbounded loop, no reliance on a validator running. Rewriting the action to pass submitted keys through so the parser could reject them would trade that for a weaker guarantee plus more code.

So the requirement is reworded to state two things separately: the action accepts only the seven known weekdays and ignores anything else, and the parser rejects an out-of-range or fractional weekday for callers that reach it directly — which is what its tests exercise.

*Alternative considered — change the action to pass through submitted keys:* rejected. It converts a structural guarantee into a validated one for no gain.

### D2 — The MODIFIED block carries every existing scenario
M4's archive aborted because three `MODIFIED` blocks silently dropped scenarios the live spec still held, and `openspec validate` could not see it — only the archive step compares against the live spec. This change edits one requirement and keeps both of its scenarios, rewritten to match the corrected wording rather than deleted.

### D3 — Test the action and the page at the seams M5a left open
`actions.test.ts` mirrors the M4 pattern: mock `requireOwner`, the composition root, `next/cache` and `next/navigation`, and assert ordering and failure translation. `page.test.tsx` mirrors M4's: mock the service and assert `notFound()` is reached for a null result.

These are not new inventions — M4 has both files, added after its own verification pass flagged their absence. M5a simply did not get that pass.

### D4 — The debt entries are corrected, not duplicated
T8 lists locations, barbers and services but not working hours, and T25 names the assignment route but not the schedule route, which reads `barberId` from the body the same way. Both are extended in place rather than given new numbers: a second entry describing the same mechanism is how a debt list stops being read.

## Risks / Trade-offs

- **Rewording a requirement can weaken it by accident** → The new wording states a stronger structural property (bounded by construction) plus the parser guarantee that is actually tested, so nothing that was true stops being claimed.

- **Tests written after the fact tend to assert what the code does rather than what it should** → Each new test is written from the archived spec's scenario text, not from reading the implementation, and the action test asserts ordering (`requireOwner` before parsing) that a naive implementation would fail.

- **This change fixes documentation and tests, so it cannot be validated by behaviour** → The suite must stay green with zero production edits; any red test would mean a test asserts something the shipped code does not do, which is itself the finding.

## Migration Plan

None. No schema, no data, no deployment implication.

## Open Questions

None.
