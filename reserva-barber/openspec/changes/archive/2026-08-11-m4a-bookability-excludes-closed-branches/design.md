## Context

`data-model.md` §5 already establishes that a barber may **remain** at a location deactivated after the fact — that is a legal state, not a broken one — while refusing to **move** one there. What it never said is whether such a barber counts toward a service being bookable. M4 had to pick something to implement and picked "barber's own flag only", which is how an unmade decision becomes a shipped rule.

The booking flow resolves the ambiguity from outside. B2 is ordered **location → service → barber**, so a branch that is closed cannot appear at step 1 and nothing behind it is reachable.

## Goals / Non-Goals

**Goals:**
- Make the dashboard's bookability claim true rather than approximately true.
- Turn a provisional requirement into a normative one, with the reasoning recorded.
- Keep the filter in one place so callers cannot disagree about it.

**Non-Goals:**
- **Per-location bookability.** See D2 — deliberately deferred, not overlooked.
- Any change to the assignment write path, the editor, or the schema.
- Deactivation controls for locations or services (M6).

## Decisions

### D1 — The location term joins the conjunction, and lives in the aggregate
Bookability becomes: service active **∧** ≥1 assignment **∧** ≥1 of those barbers active **∧** that barber's location active.

The term is added inside `countActiveBarbersByService`, not at the page. M4's design D8 already put the `barber.isActive` filter there for the same reason: a filter each caller applies for itself is a filter two callers will eventually disagree about. The count arriving pre-filtered is what lets `isBookable` stay a two-term expression at the call site.

*Alternative considered — leave it and let B2's location filter handle it:* rejected. B2's filter governs what a **client** can reach; the dashboard marker is a claim made to the **owner** about whether revenue is possible. Those are different surfaces, and only one of them is wrong today.

*Alternative considered — treat a closed branch as still bookable:* rejected. It contradicts the plain meaning of deactivating a branch and would make the location-first booking flow and the dashboard disagree about the same service.

### D2 — Bookability is per (service, location); this change does not implement that
Because the client picks a branch first, the honest unit is the pair. A service with active barbers at Centro and none at Norte is bookable at Centro and not at Norte, and today's global boolean reports a single "bookable" that hides the second half.

Not implemented here: B2 has not defined how it presents services per branch, and building a per-location dashboard against a spec that does not exist is designing for an imagined consumer. The aggregate already groups by `serviceId`; extending it to group by `(serviceId, locationId)` is a mechanical follow-up once B2 fixes the shape.

This keeps T23 open in its second half rather than closing the entry wholesale.

### D3 — Ship the rule while it is unobservable
No location can be deactivated today, so this change alters no behaviour anyone can see. That is the argument for doing it now, not against: the cost of the rule being wrong is paid the first time a branch closes, and the cost of fixing it now is one predicate and a test.

## Risks / Trade-offs

- **The rule could be wrong for some business** — an owner might close a branch administratively while its barbers still serve clients elsewhere. The model forbids that: `Barber` belongs to exactly one location (`data-model.md` §5), so "serving elsewhere" is not representable. If that ever changes, this rule must be revisited with it.

- **The dashboard becomes more conservative than the booking flow in one direction** — it can only ever show "not bookable" for something a client also cannot book. The asymmetry is deliberate: over-reporting unbookability sends the owner looking for a problem, while under-reporting it asserts revenue that does not exist.

- **The per-location gap stays open and is now the more misleading of the two** — a service bookable at one branch and dead at another still reads as simply bookable. Recorded in T23 with B2 as the trigger.

## Migration Plan

None. No schema change, no data change. The predicate is additive within an existing query, and the current data has no inactive location for it to exclude.

## Open Questions

None for this change. The per-location question (D2) is deferred with a named trigger, not left unanswered.
