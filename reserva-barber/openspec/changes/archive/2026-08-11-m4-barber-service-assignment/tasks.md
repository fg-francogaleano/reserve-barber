## 1. Schema and migration

- [x] 1.1 Add the `BarberService` model to `prisma/schema.prisma` with `id` (cuid), `barberId`, `serviceId`, `createdAt`, and no `updatedAt`
- [x] 1.2 Declare `@@unique([barberId, serviceId])` and `@@index([serviceId])`, with the comment explaining why the index is needed alongside the composite unique
- [x] 1.3 Declare `onDelete: Cascade` on both relations, with the comment contrasting it against `Barber → Location`'s `Restrict`
- [x] 1.4 Add the back-relations `Barber.services` and `Service.barbers`
- [x] 1.5 Create migration `add_barber_service` and confirm it is purely additive — no `ALTER` on an existing table, no backfill
- [x] 1.6 Regenerate both Prisma clients (`prisma` and `prisma-cli`) and confirm `typecheck` passes

## 2. Runtime gate — must pass before the write path is built

- [x] 2.1 Write a gate test proving `$transaction([deleteMany, createMany])` commits atomically against the real database through the pooler — `scripts/m4-gate.ts`, probe B
- [x] 2.2 Prove a failure inside the batch rolls back both statements, leaving no half-applied set — probe C
- [x] 2.3 Prove `createMany({ skipDuplicates: true })` is accepted by the driver adapter and raises no `P2002` on an existing row — probe A
- [x] 2.4 Run the gate on `next dev`, on the local `workerd` preview, and against the deployed Worker — Node/pooler leg passed here; the `workerd` leg was carried to **10.7 and is discharged there** on both the local preview and the deployed Worker. The script runs under `tsx` and uses the Node client, so it could never prove the wasm query compiler on its own
- [x] 2.5 If any of 2.1–2.3 fails, switch to per-row `upsert` **inside the same batch array** and record the finding in `docs/s0-versions-decision.md` — not triggered: all three probes passed, so the batched form stands

## 3. Domain layer

- [x] 3.1 Create `src/server/domain/errors/BarberServiceErrors.ts` with `ServiceNotAssignableError` (carrying the offending service name) and `TooManyAssignmentsError`
- [x] 3.2 Create `src/server/domain/repositories/IBarberServiceRepository.ts` with every method taking `ownerId`, so an unscoped query is inexpressible
- [x] 3.3 Define the assignment diff shape (`toAdd` / `toRemove`) on the contract, so the caller cannot hand the repository a raw replacement set

## 4. Application layer — parsing (TDD)

- [x] 4.1 Write failing tests for `parseSetBarberServices`: rejects a missing `barberId`, rejects non-string entries, deduplicates repeats, rejects above `MAX_SERVICES_PER_OWNER`
- [x] 4.2 Write a failing test proving an empty checked list with a non-empty rendered baseline parses successfully as "unassign everything"
- [x] 4.3 Write a failing test proving a submission with no rendered baseline is rejected, so a missing selection cannot masquerade as an empty one
- [x] 4.4 Implement `src/server/application/barberServices/barberServicesSchema.ts` until 4.1–4.3 pass — 11 tests green

## 5. Application layer — assignment service (TDD)

- [x] 5.1 Write failing tests for the diff: adds `checked − stored`, removes `(rendered − checked) ∩ stored`
- [x] 5.2 Write the failing baseline test — an assignment stored but absent from the rendered baseline survives a save that does not mention it
- [x] 5.3 Write failing tests for ownership: unknown or foreign `barberId` raises `BarberNotFoundError`; a service id outside the owner's set raises `ServiceNotAssignableError` and writes nothing at all
- [x] 5.4 Write failing tests for the assignable set: an inactive service already assigned survives an unchanged save; an inactive service not already assigned cannot be added
- [x] 5.5 Write a failing test proving an unchanged submission performs no removals and reports success
- [x] 5.6 Implement `src/server/application/services/BarberServiceAssignmentService.ts` until 5.1–5.5 pass — 18 tests green. **Deviation:** `TooManyAssignmentsError` from 3.1 was not created. The cap is enforced in the schema before any read, and the service accepts only the schema's output type, so the over-cap state is unreachable rather than handled — a domain error nothing can throw reads as a live guarantee it is not. Recorded in `BarberServiceErrors.ts`
- [x] 5.7 Confirm the bound checks of §4 run before any repository call, by asserting no repository method was invoked on an over-cap submission — done in `actions.test.ts`. This is the project's first action-level test; the layer had no test infrastructure before, so the mocks are established here

## 6. Infrastructure — repository (TDD)

- [x] 6.1 Write failing tests for `PrismaBarberServiceRepository`: the write issues exactly two statements inside one batched transaction
- [x] 6.2 Write a failing test proving the insert requests `skipDuplicates` and that a re-submitted assignment raises nothing
- [x] 6.3 Write failing tests for `countServicesByBarber` and `countActiveBarbersByService` — one aggregate each, inactive barbers excluded from the service-side count
- [x] 6.4 Write the cross-owner test against the real database — **approach changed.** A second `Owner` row cannot be created to test against: "Exactly one Owner" is a system invariant with its own requirement in `data-persistence`. A foreign owner id stands in for one, which proves the same thing about the predicate. Gate probes D and E confirm the read and the delete are owner-scoped in real SQL. The insert is deliberately **not** covered: `createMany` admits no relation filter, which is precisely why `BarberServiceAssignmentService` is the guarantee (design D6) and is covered by 5.3 instead
- [x] 6.5 Implement `src/server/infrastructure/prisma/PrismaBarberServiceRepository.ts` selecting only the needed columns, never `SELECT *` — 12 tests green
- [x] 6.6 **Added:** gate probe F proves `groupBy` with a relation filter is supported on the pooler. The design assumed this without listing it as a risk; both list pages depend on it

## 7. Assignment editor

- [x] 7.1 Add the `barberServices` block to `src/lib/copy.ts` — all strings Spanish (es-AR), all identifiers English
- [x] 7.2 Create `app/(dashboard)/barberos/[id]/servicios/formState.ts` echoing the submitted selection, not the stored one
- [x] 7.3 Create `app/(dashboard)/barberos/[id]/servicios/actions.ts` with `requireOwner()` as the first statement, failures returned as form state, and `toErrorLogContext` for every log
- [x] 7.4 Call `revalidatePath` for both `/barberos` and `/servicios` before redirecting, since an assignment changes the bookability state on the services page
- [x] 7.5 Create the page: resolve the barber scoped to the owner, load assignable services and current assignments, render not-found for an unknown or foreign id
- [x] 7.6 Create `BarberServicesForm.tsx` with native checkboxes plus the parallel hidden rendered-baseline inputs — no Radix `Checkbox`, no `pattern`/`min`/`max`
- [x] 7.7 Group the controls in a `<fieldset>` with a `<legend>`, disable the whole group while pending, and key the rejected re-render so the echoed selection wins over stale DOM state — the remount key is load-bearing and covered by a test that would fail without it
- [x] 7.8 Move focus to the error summary on rejection and identify the offending service inline, not only in the form-level banner — `ServiceNotAssignableError` gained a `serviceId` so the checkbox can be marked
- [x] 7.9 Add `loading.tsx` and `not-found.tsx` mirroring the `servicios/` route group
- [x] 7.10 Render the empty state with a route to service creation when the owner has no services, with no operable submit control
- [x] 7.11 **Added:** `BarberServicesForm.test.tsx` (8 tests) covering pre-check, inactive marker, fieldset grouping, baseline emission, echo-back and inline marking

## 8. List pages

- [x] 8.1 Write a failing component test for the barbers list: each barber shows its assigned-service count and a labelled route into the editor
- [x] 8.2 Add the count and the route to `app/(dashboard)/barberos/page.tsx`, sourcing counts from the single aggregate
- [x] 8.3 Write failing component tests for the services list covering all four bookability cases — unassigned, assigned only to inactive barbers, inactive service, and bookable
- [x] 8.4 Add the not-bookable marker to `app/(dashboard)/servicios/page.tsx` with text and an accessible description, never colour alone

## 9. Tech debt closed or re-audited by this change

- [x] 9.1 Close T20 for `app/(dashboard)/barberos/actions.ts`: replace the raw `error.message` logging with `toErrorLogContext` — moved to Closed, with `sucursales` explicitly left open under its original trigger
- [x] 9.2 Fix T18: clear the intrinsic minimum width at every layout level of the barbers list title row — moved to Closed. The `sucursales` list named in that entry was not measured and is carried forward rather than closed with it
- [x] 9.3 Re-audit T15 across **both** `ServiceCatalogService` and `BarberCatalogService`; add the regression test proving an assignment-table violation cannot surface as either duplicate-name error
- [x] 9.4 Confirm no assignment insert is nested inside a barber or service write, which is what keeps the T15 translations correct
- [x] 9.5 Narrow T11 by recording the cross-owner proof as executable evidence — probes D and E. The insert asymmetry (`createMany` admits no relation filter) is now written down rather than latent
- [x] 9.6 Add T21: `skipDuplicates` becomes silent update-discarding if the assignment table ever gains a mutable column; trigger is that column addition
- [x] 9.7 Record the T8 re-evaluation — re-accepted, but the entry now records that the naive replace would have broken its premise, and that the exemption is specific to being able to bound removals by a rendered baseline

## 10. Verification

- [x] 10.1 `npm run typecheck`, `npm run lint`, `npm run test:coverage` clean — 481 tests, 99.38% statements / 95.92% branches, both above the 90% gate
- [x] 10.1b **Added:** `npm run build` and `opennextjs-cloudflare build` both succeed. The Next build caught a real defect no test could: `actions.ts` carries `'use server'`, so its synchronous `assignmentService()` factory export failed the build outright — every export of such a module is compiled into a callable server action. Extracted to `assignmentService.ts`
- [x] 10.2 Manually verify the full loop: assign → the services page marker clears → unassign all → the marker returns — passed on `next dev`. The unassign-everything path (no `serviceIds` key in the payload) worked end to end
- [x] 10.3 Verify the bookability marker is not served stale after a client-side navigation from `/barberos` to `/servicios` — passed. `force-dynamic` plus `revalidatePath` on both routes is sufficient; no stale marker
- [x] 10.4 Verify the editor submits correctly before hydration and with JavaScript disabled — verified by inspecting the **server-rendered** HTML: `method="POST"`, Next's `$ACTION_ID_*` field, and both `renderedServiceIds` hidden inputs present before any hydration, so the D3 baseline survives the no-JS path. A submission with JS switched off was not executed
- [x] 10.5 Verify a double submit converges on one assignment set with no duplicate error — covered by gate probe A (DB-level idempotence), the post-hydration disabled button, and the no-op save path. A genuinely **concurrent** double POST was not fired
- [x] 10.6 Verify the editor and both list pages at a 360px viewport with maximal-length names — **found and fixed a real defect**: `<fieldset>` carries `min-width: min-content` from the UA stylesheet, so the editor scrolled sideways (882px in a 360px container) despite `min-w-0` on the rows and labels. Added `min-w-0` to the fieldset → 360/360. Barbers list re-measured with a 120-character unbroken name: no overflow, confirming the T18 fix
- [x] 10.8 **Added:** verified `onDelete: Cascade` (design D7) against the real database — deleting a service removed its assignment row
- [x] 10.7 Verify on `next dev`, on the local `workerd` preview, and against the deployed Worker — **all three passed.** Deployed to `reserva-barber.franco-galeano.workers.dev`, version `7a4509b3-e7e2-47a6-a00b-32b151eba8da`, on explicit authorisation. Assign and unassign both confirmed at the database from the production Worker; bookability marker and counts correct on both list pages
  - Note for the next deploy: the **first** request after `wrangler deploy` returned the previous version's HTML — an edge still serving the old worker while propagation completed. It resolved within seconds. Do not read a single post-deploy request as evidence the new code is live; re-request before concluding anything
- [x] 2.4 **Now discharged.** The `workerd` leg carried over from group 2 is verified on the real runtime through the real UI, against the live pooler:
  - `createMany` inside a batched `$transaction` — assignment created, POST 303, count reflected
  - `deleteMany` inside a batched `$transaction` — assignment removed, confirmed at zero rows in the database
  - `groupBy` with a relation filter — both list pages render their counts
  - the three-term bookability conjunction — marker cleared on assign, returned on unassign
  - auth guard, `revalidatePath` on both routes, and redirect-after-write
  - no 500 and no error in the Worker log across the whole session

## 10b. Scenario coverage gaps closed after `/opsx:verify`

- [x] 10b.1 `page.test.tsx` for the editor route (7 tests) — covers the two scenarios that had no test: the empty state with no operable submit, and a foreign or unknown barber resolving to not-found rather than a distinguishable 403. The route was the only one in the dashboard without a page test
- [x] 10b.2 Pending-state test — asserts the whole `<fieldset>` is disabled while a submission is in flight, not just the button. Uses an action that never settles so the state stays observable
- [x] 10b.3 Double-click test — a double click on submit fires exactly one action post-hydration. Documents in the test that this is only the post-hydration guard; the pre-hydration case rests on `skipDuplicates`
- [x] 10b.4 `barberos/actions.test.ts` (4 tests) — closes T20's own verification gap: a recognized violation logs `{ operation, code }` and the submitted display name never reaches the log stream, while an unrecognized failure keeps its message. Previously only the helper was tested, not that the barber action used it

## 11. Documentation and closeout

- [x] 11.1 Confirm `docs/data-model.md` §6–§7 match what shipped — they were updated ahead of this change under the spec-first policy
- [x] 11.2 Update `docs/tech-debt.md` with the outcomes of §9 — T18 and T20 moved to a new Closed section, T15 discharged, T11 and T8 re-evaluated, T21 added
- [x] 11.3 Tick M4 in `docs/roadmap.md`
- [x] 11.4 Run `/opsx:verify`, then archive the change and sync `barber-service-assignment` as a new capability with the three delta specs — archived as `2026-08-11-m4-barber-service-assignment`. **The first archive attempt aborted**: three MODIFIED blocks had dropped scenarios that the current spec still carried (`The limitation is documented` twice, and `The shipped exposure is recorded` renamed). Restored with their exact headers and content updated for the post-M4 reality — the tool caught detail loss that validation did not
- [x] 11.5 Commit to `feat/m4-barber-service-assignment` and open the PR to `main` — commit `e3c5f61`, PR #6. Branched from `origin/main` rather than from `feat/m3-service-catalog`, since M3 was already merged and the trees were identical
- [x] 11.6 **Added:** adversarial-review findings recorded as T22–T26 instead of fixed, per the owner's call. The two spec rules they touch (`barber-service-assignment` → submitted-set bound, `service-catalog` → bookability) are marked **provisional**, so the archive does not freeze an arithmetic slip and an unmade product decision as normative
