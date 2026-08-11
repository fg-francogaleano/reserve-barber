## 1. Specification

- [x] 1.1 Update `docs/data-model.md` §6 availability rule to four terms, before any code (spec-first policy)
- [x] 1.2 Record the answer in `docs/tech-debt.md` T23: the decision half is closed, the per-location half stays open with B2 as its trigger

## 2. Implementation (TDD)

- [x] 2.1 Write the failing repository test: an active barber at an inactive location does not contribute to the service's active-barber count
- [x] 2.2 Write the failing test proving the location filter adds no second query — still exactly one `groupBy`
- [x] 2.3 Add `location: { isActive: true }` to the relation filter in `countActiveBarbersByService`, reusing the existing traversal rather than adding a clause beside it
- [x] 2.4 Confirm `countServicesByBarber` is deliberately **not** filtered — the barbers list count answers "how many services is this barber assigned to", which is true regardless of whether the branch is open

## 3. Presentation

- [x] 3.1 Write the failing component test: a service assigned only to barbers at a closed branch is marked not bookable
- [x] 3.2 Write the failing component test: one open branch among several is enough to clear the marker
- [x] 3.3 Confirm `servicios/page.tsx` needs no change — the count arrives pre-filtered, which is the point of D1

## 4. Verification

- [x] 4.1 `npm run typecheck`, `npm run lint`, `npm run test:coverage` clean, coverage at or above 90%
- [x] 4.2 Prove the filter against the real database: seed an inactive location with an active assigned barber and confirm the count excludes it, then restore
- [x] 4.3 Confirm no migration was generated and `prisma/schema.prisma` is untouched

## 5. Closeout

- [x] 5.1 Promote the `service-catalog` bookability requirement from provisional to normative in the delta spec
- [x] 5.2 `openspec validate`, then archive and sync
- [x] 5.3 Commit onto `feat/m4-barber-service-assignment` (PR #6 is still open and holds the M4 specs this amends)

## 6. Notes from the run

- [x] 6.1 The database gate needed three attempts, all of them **my assumptions failing, not the code**: it assumed an empty table (the owner had created a service and an assignment mid-session), then collided with the unique constraint by picking an already-assigned pair, then asserted "exactly one fewer" when the chosen barber shared a branch with a pre-existing one — so closing it correctly removed both. Final form measures the row it creates rather than an absolute total, which is immune to whatever else the owner has
- [x] 6.2 `countServicesByBarber` deliberately keeps no location filter, and a test now pins that asymmetry so it reads as a decision rather than an omission
