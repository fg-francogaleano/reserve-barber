## Why

M3 shipped a service catalogue, but a service alone is not bookable. `data-model.md` §6–§7 make a `BarberService` row the condition for a service to appear in the public booking flow, so today every service the owner creates is inert: there is no way to record who performs it, and no way to see that nobody does. M4 is the gate to the booking flow — B2 depends on it, never directly on M3 — and it is the last catalogue story before the public surface begins.

The story also forces a structural first: this is the project's first many-to-many relation, and therefore the first write whose input is a *set* rather than a row. The failure modes of a set write (stale baselines, partial application, silent removals) have no precedent in M1–M3 and must be settled here rather than discovered in B2.

## What Changes

- Introduce the `BarberService` join table with a composite unique constraint on `(barberId, serviceId)`, an index on `serviceId`, and `onDelete: Cascade` on both foreign keys.
- Add a dedicated assignment editor at `/barberos/[id]/servicios`: a native checkbox list of the owner's assignable services, saved as one set.
- Persist the set as a **diff against a rendered baseline** — the form submits both the ids it rendered and the subset that was checked — inside a single batched transaction. A blind replace against stored state is rejected: it lets a stale tab delete an assignment it never displayed.
- Enforce the same-owner rule in the application at write time. It has **no database backing**: `Barber` carries no `ownerId` (ownership is derived through `location`), so no constraint can express the comparison. One choke point, proven by an executable cross-owner test.
- Surface bookability on `/servicios` as the conjunction of three facts — service active, at least one assignment, at least one of those barbers active — derived at read time, never cached in a column.
- Show each barber's assigned-service count on `/barberos`, so an unconfigured barber is visible without opening it.
- Close tech debt whose documented trigger is this change: **T20** (raw driver messages logged from `barberos/actions.ts`) and **T18** (barbers list overflows on a long unbroken name). Re-audit **T15** (unqualified `P2002` translation, now that a second unique constraint exists) and narrow **T11** (cross-owner isolation has no executable proof).
- No breaking changes. No new HTTP endpoint — Server Actions only, consistent with M1–M3.

## Capabilities

### New Capabilities
- `barber-service-assignment`: the owner records which services each barber performs — the assignment editor, rendered-baseline set semantics, the same-owner invariant, the assignable-set rule for inactive services, per-barber cardinality, and the Spanish (es-AR) states of the editor.

### Modified Capabilities
- `data-persistence`: the `BarberService` model as single source of truth, cascade and index rationale, the batched set-diff write, idempotence of a re-submitted assignment, and the re-audit that bounds unique-violation translation now that a second constraint exists.
- `service-catalog`: the services list gains a bookability state. Requirement-level change — a service with no active assigned barber must be presented as not bookable, which the M3 spec had no way to express.
- `barber-management`: the barbers list gains an assigned-service count and a route into the editor; long-name overflow (T18) is corrected; the barber write path stops logging raw driver messages (T20).

## Impact

**Schema** — new `BarberService` model and migration `add_barber_service`; back-relations added to `Barber` and `Service`; both Prisma clients regenerated (`prisma` and `prisma-cli`).

**Server layers** — new `IBarberServiceRepository`, `PrismaBarberServiceRepository`, `BarberServiceAssignmentService`, `barberServicesSchema`, and `BarberServiceErrors`. `ServiceCatalogService` and `BarberCatalogService` are re-audited but not restructured.

**Presentation** — new route group `app/(dashboard)/barberos/[id]/servicios/`; modifications to `app/(dashboard)/barberos/page.tsx`, `app/(dashboard)/barberos/actions.ts`, `app/(dashboard)/servicios/page.tsx`, and `src/lib/copy.ts`.

**Runtime risk** — first use of `$transaction` in its batched array form and of `createMany({ skipDuplicates })` on `workerd` over the Supavisor transaction-mode pooler. Both are confirmed present in the generated client; runtime behaviour is gated by the first implementation task, with a designed fallback so a negative result does not reopen the design.

**Docs** — `docs/data-model.md` §6–§7 already updated ahead of this change per `base-standards.md` §7; `docs/tech-debt.md` (T20, T18, T15, T11, new T21) and `docs/roadmap.md` close out with it.

**Downstream** — unblocks B2. `Booking` is untouched; no story that depends on payments or availability is affected.
