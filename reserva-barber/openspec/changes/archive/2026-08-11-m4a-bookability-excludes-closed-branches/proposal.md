## Why

M4 shipped a bookability marker whose rule was never decided: it counts a barber as bookable on the barber's own `isActive` flag alone, ignoring whether that barber's **branch** is open. An adversarial review recorded the gap as `docs/tech-debt.md` T23 and the `service-catalog` requirement shipped marked **provisional** rather than normative, precisely so this decision would be made deliberately instead of inherited from whatever the code happened to do.

The decision is now made, and the booking flow settles it. B2 is **location → service → barber**: the client picks a branch first. A closed branch cannot be offered at step 1, so a barber working there is unreachable by any booking — which means the dashboard currently claims a service is bookable when no client can reach it. That is the exact defect M4 exists to prevent; the story's whole purpose is making "nobody can book this" visible.

Doing it now is close to free: no location can be deactivated yet (M1 shipped no such control), so the observable behaviour does not change. What changes is which rule is frozen before deactivation and B2 arrive.

## What Changes

- Add a fourth term to the bookability conjunction: the assigned barber's **location must be active**. A service is bookable only when it is active, has at least one assignment, and at least one of those barbers is active **and works at an open branch**.
- Promote the `service-catalog` bookability requirement from **provisional** to normative, and record the answer in `docs/data-model.md` §6.
- Close T23's decision half. The **per-location** half is explicitly *not* resolved here (see Non-Goals) and stays recorded with B2 as its trigger.
- No schema change, no migration, no new dependency.

## Capabilities

### New Capabilities
_(none — this refines an existing capability)_

### Modified Capabilities
- `service-catalog`: the bookability conjunction gains a fourth term and stops being provisional. This is a requirement-level change: a service assigned exclusively to barbers at deactivated branches must now be presented as not bookable.
- `data-persistence`: the active-barber-per-service aggregate must additionally exclude barbers whose location is inactive.

## Impact

**Code** — one predicate in `PrismaBarberServiceRepository.countActiveBarbersByService`, plus its tests. `app/(dashboard)/servicios/page.tsx` is untouched: the count already arrives pre-filtered, which is why the filter belongs in the repository rather than at each caller.

**Docs** — `docs/data-model.md` §6 (availability rule), `docs/tech-debt.md` T23.

**Not affected** — no migration, no change to the assignment write path, no change to the editor.

**Branch note** — this stacks on `feat/m4-barber-service-assignment` because PR #6 is still open and holds the archived M4 specs this change amends. Branching from `main` would target specs that are not there yet.
