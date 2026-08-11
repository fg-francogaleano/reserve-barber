## Context

M5a established the project's stored-time convention: recurring schedules are wall-clock minutes, points in time are UTC instants in `timestamptz`, and every conversion lives in one domain module. `TimeOff` is the first table to actually store an instant under that rule — every `createdAt` so far is written by the database and compared to nothing.

`data-model.md` §9 predates the convention and says `startDate`/`endDate` are "date/datetime". Those are different types. A date has no instant; an instant has no timezone-free meaning. The ambiguity has to be resolved here, because B3 will compare these values against bookings and against working hours, and the three must agree about what a boundary means.

The owner's product decisions are already settled: absences are per barber, business holidays are out of scope, and a closed branch is handled by location deactivation rather than by absences.

## Goals / Non-Goals

**Goals:**
- One representation for whole-day and partial-day absences.
- Boundaries that agree with `Booking`'s `[start, end)` so B3 does not have to reconcile two conventions.
- A create that is safe to retry, given the write has no other idempotence.
- Keep `reason` inside the dashboard.

**Non-Goals:**
- Business holidays — a separate entity that does not exist (recorded debt from M5a).
- Recurring absences ("every Monday off") — that is a working-hours change, not an absence.
- Editing an absence in place. Remove and re-add is two clicks and one code path instead of three.
- Warning that an absence collides with existing bookings — no bookings exist; that is B4's problem and is already recorded as T29.

## Decisions

### D1 — One representation: a half-open instant range
`startsAt` and `endsAt` are UTC instants in `@db.Timestamptz`, and the range is `[startsAt, endsAt)`.

Half-open because `Booking` already uses `[startTime, endTime)`. If absences were inclusive at the end, a booking starting exactly when an absence ends would be blocked or allowed depending on which rule the availability code reached first — a disagreement that would surface as a mysterious unbookable slot, not as a failing test.

*Alternative considered — a `date` range plus an `isAllDay` flag:* rejected. Two representations of one fact can disagree, and the flag would have to be consulted at every read. The whole-day case is expressible in the instant range without it.

### D2 — Whole days are expressed by omitting the times, and the end date is inclusive
The form asks for a start date and an end date, each with an **optional** time.

- Both times empty → `[startDate 00:00 local, endDate + 1 day 00:00 local)`.
- Both times present → `[startDate startTime, endDate endTime)`.
- One present and one empty → rejected, named. Same shape as M5a's half-filled day.

The asymmetry is deliberate and is the part most likely to be got wrong: **"hasta el 15" means the 15th is a day off**, so a whole-day range must extend to the start of the 16th. A timed range means what it says and ends at the instant given. Both meanings are correct for their input, and the translation lives in one function with its own tests, because an off-by-one here silently gives the barber a day back.

*Alternative considered — always require times:* rejected. "Vacaciones del 1 al 15" would force the owner to type `00:00` and then reason about whether the end is the 15th or the 16th. That is exactly the arithmetic this design exists to do for them.

### D3 — Bounds on duration and distance, because the failure mode is silent
An absence may not exceed **365 days**, may not start more than **2 years** ahead, and may not start more than **1 year** in the past.

Without bounds, `2026-01-01` to `2099-12-31` is accepted and permanently disables a barber with no error anywhere. A mistyped year produces the same. The numbers are conservative rather than principled — they exist to make a typo visible, not to encode a policy.

Past absences are allowed rather than forbidden: recording an absence after the fact is legitimate, and it is also what a mistyped year looks like, which is why the backward bound is tighter than the forward one.

### D4 — Zero-length is rejected; overlaps are not
`endsAt` must be strictly after `startsAt`. A zero-length range blocks nothing and is a data-entry error wearing the shape of a record.

Overlapping absences are **allowed**. They union naturally when availability is computed, and rejecting them would mean an owner who books a long holiday cannot then record a specific appointment inside it. There is nothing to reconcile.

### D5 — The create is made idempotent by a unique key, not by a diff
`@@unique([barberId, startsAt, endsAt])`.

Unlike M5a's schedule, this write is a row-level create with no natural replacement semantics, so a retry after a committed-but-timed-out save would insert a duplicate. The unique key plus a skip-on-conflict insert makes the retry a no-op. Two absences with identical boundaries are the same absence — the only thing that could differ is `reason`, and a duplicate range with a different note is not a second fact.

### D6 — `reason` is confined by type, not by discipline
The repository exposes a projection that omits `reason` for any consumer other than the editor, and no log line may carry it.

"Cirugía" and "tratamiento oncológico" are realistic values. Discipline alone fails the first time someone passes the entity to a public component; a projection that does not carry the field cannot leak it. The M4 logging rule (`toErrorLogContext`) covers driver errors but not a deliberate log line, so this is stated separately.

### D7 — The list is ordered newest-first and bounded
Ordered by `startsAt` descending, capped at **100 per barber**.

Descending puts upcoming and recent absences at the top, which is what the owner is looking for; ascending would lead with a year of expired entries. The cap is advisory in the same way M3's and M2's are — count and insert are separate round trips against a transaction-mode pooler — and is recorded as such rather than presented as a guarantee.

### D8 — Removal is a delete, and deleting twice is a success
No confirmation dialog, consistent with M4's stance: a dialog on a cheap, re-creatable action trains people to click through dialogs. A delete that matches no row reports success rather than not-found — from the owner's point of view the absence is gone either way, and two tabs must not produce an error.

## Risks / Trade-offs

- **The inclusive-day conversion is off by one** → The single most likely defect in this change. It is one function, tested at both boundaries (a one-day absence and a multi-day one), and verified against the database.

- **`@db.Timestamptz` is new to this schema** → A round-trip check confirms an instant survives storage and read without drifting. Low risk: PostgreSQL stores UTC either way; the column type governs how it is interpreted on the way in.

- **`reason` leaks through a future consumer** → Mitigated by the projection (D6), not by a comment. A reviewer should treat any new read that selects `reason` as needing justification.

- **Bounds reject a legitimate long absence** → A sabbatical over a year would be refused. Accepted: the owner can record two consecutive absences, and the alternative is that a typo silently removes a barber for decades.

- **DST** → An all-day absence is computed as local midnight to local midnight, which is 23 or 25 hours on a transition day rather than 24. The conversion module already computes offsets per instant, so it is prepared; the assumption is recorded in T28 from M5a.

## Migration Plan

1. Schema-only migration `add_time_off` — purely additive, no backfill.
2. Regenerate both Prisma clients.
3. Confirm the `timestamptz` round trip before building on it.
4. Ship the write path, then the editor, then the route from the barbers list.

**Rollback:** additive migration, feature reachable only from a new route. Reverting the application code leaves an unused table that nothing reads until B3.

## Open Questions

None. The product questions were answered before M5a was written, and the one this change adds — inclusive versus exclusive end date — is answered in D2 rather than left to the implementation.
