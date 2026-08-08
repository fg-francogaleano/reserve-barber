## 1. Spec-First Docs & Tooling

- [x] 1.1 Update `docs/data-model.md` §4: state that the `name` unique-per-owner rule is enforced by a database constraint on `(ownerId, name)`, and that names are normalized (trim, collapse internal whitespace, NFC) before persistence — spec-first, before code
- [x] 1.2 Update `docs/frontend-standards.md`: add `sucursales/` (list, `nueva/`, `[id]/editar/`) to the route table, and record that server-action forms with `useActionState` + a server-side Zod schema are the house pattern rather than React Hook Form (design D3)
- [x] 1.3 Update `docs/backend-standards.md`: reconcile the validator location to the feature-folder layout A1 established (`application/<feature>/`), replacing `application/validators/` (design D11)
- [x] 1.4 Add `@testing-library/react`, `@testing-library/user-event`, and `jsdom` as dev dependencies; configure the jsdom environment for `*.test.tsx` in `vitest.config.ts` while keeping the 90% coverage threshold scoped to `src/server/domain` and `src/server/application` only (design D4)
- [x] 1.5 Verify the jsdom setup with one trivial render test, then delete it — confirms the toolchain before any real test depends on it

## 2. Data Layer — Uniqueness Constraint & Index

- [x] 2.1 Query the production database for duplicate `(ownerId, name)` pairs; proceed only if none exist (design, Migration Plan step 1)
- [x] 2.2 Add `@@unique([ownerId, name])` and `@@index([ownerId, isActive])` to the `Location` model in `prisma/schema.prisma`
- [x] 2.3 Generate the migration (`--name add_location_name_unique_per_owner`) and read the emitted SQL before applying it
- [x] 2.4 Apply the migration over `DIRECT_URL` (session-mode pooler, port 5432); verify the unique index and the composite index both exist and that the two seeded locations survived
- [x] 2.5 Regenerate both Prisma clients (`npx prisma generate`) — the `workerd` client and the CLI client used by seed and provisioning
- [x] 2.6 Confirm the constraint bites: attempt to insert a duplicate `(ownerId, name)` directly and observe the rejection

## 3. Domain Layer

- [x] 3.1 Write failing tests for location name normalization: surrounding whitespace trimmed, internal whitespace runs collapsed, NFC applied so a decomposed-accent spelling equals its composed form, zero-width-only input reduces to empty
- [x] 3.2 Implement the normalization helper on `src/server/domain/models/Location.ts` (used by both the validator and the service, so the rule has exactly one home); make 3.1 pass
- [x] 3.3 Implement `src/server/domain/errors/LocationErrors.ts`: `LocationNotFoundError` and `DuplicateLocationNameError`, each setting `name`, per the error-class convention in `docs/backend-standards.md`
- [x] 3.4 Extend `src/server/domain/repositories/ILocationRepository.ts` so every method takes `ownerId` as a required parameter (design D7): list by owner, find one scoped to owner, create, count by owner, update scoped by owner. Remove `findAllActive()` and its now-unused test once no caller remains

## 4. Application Layer (TDD: failing tests first)

- [x] 4.1 Write failing tests for the location Zod schema: valid input; name at 1 / 2 / 120 / 121 characters after normalization; whitespace-only and zero-width-only names; address at 255 / 256; blank address becomes `null`; unexpected extra keys (including an injected `ownerId`) ignored
- [x] 4.2 Implement `src/server/application/locations/locationSchema.ts` (create and update variants); make 4.1 pass
- [x] 4.3 **Settle the `mode: 'insensitive'` hazard before relying on it** (design, first risk): write a test proving the duplicate pre-check treats `%` and `_` as literal characters — "Sucursal 50%" must not collide with "Sucursal 500", nor "Sucursal_1" with "Sucursal 1". If Prisma compiles `equals` + insensitive to `ILIKE`, implement the check as an explicit lowercase comparison instead
- [x] 4.4 Write failing tests for `LocationService.listOwnerLocations`: returns the owner's rows sorted by name, includes inactive rows, returns an empty list cleanly, propagates a repository failure
- [x] 4.5 Write failing tests for `LocationService.createLocation`: happy path; duplicate rejected by the pre-check (exact and case-variant); `P2002` from the repository mapped to `DuplicateLocationNameError` (design D9); cap reached rejected before any write (design D6)
- [x] 4.6 Write failing tests for `LocationService.updateLocation`: happy path; unchanged name is not a duplicate of itself; unknown id and foreign-owner id both raise `LocationNotFoundError`; a zero-row update result raises not-found rather than reporting success (design D8)
- [x] 4.7 Implement `LocationService` against the repository interface only, with the per-owner cap constant; make 4.4–4.6 pass
- [x] 4.8 Verify coverage ≥ 90% on domain + application (`npm run test:coverage`)

## 5. Infrastructure Layer

- [x] 5.1 Write failing tests for `PrismaLocationRepository` against a mocked Prisma client: owner scoping present in every `where`; ordering by name ascending; inactive rows included; `toDomain` mapping including `address: null`
- [x] 5.2 Write failing tests for the scoped update: an id belonging to a different owner affects zero rows and modifies nothing
- [x] 5.3 Implement the new `PrismaLocationRepository` methods, carrying `ownerId` in the update predicate rather than relying on a prior read (design D7); make 5.1–5.2 pass

## 6. Copy & Presentation

- [x] 6.1 Add the Spanish copy to `src/lib/copy.ts`: list heading, empty state, create/edit form labels and buttons, `address` marked optional, duplicate-name error, length errors, cap-reached message, infrastructure error, not-found message
- [x] 6.2 Implement `app/(dashboard)/sucursales/page.tsx`: `requireOwner()` first, single scoped query, Cards with name and optional address, create control, empty state visually distinct from the error state, `export const dynamic = 'force-dynamic'`
- [x] 6.3 Give `app/(dashboard)/sucursales/` its own `loading.tsx` so the skeleton follows the list (design D1); leave `/` rendering its existing content until story D1. **Corrected during adversarial review:** a route-level `error.tsx` was copied here too, but it is unreachable for data failures and duplicated the dashboard one — removed in 9b.5, so the error state is owned by `app/(dashboard)/error.tsx` and `app/error.tsx`
- [x] 6.4 Implement `app/(dashboard)/sucursales/LocationForm.tsx` as a client component shared by create and edit: `useActionState` + `useFormStatus`, submit disabled while pending, `aria-invalid` on invalid fields, `role="alert"` + `aria-live` error region receiving focus, typed values preserved on rejection (design D3)
- [x] 6.5 Implement `app/(dashboard)/sucursales/actions.ts`: `requireOwner()` as the first line of each action (design, Context #3), Zod parse, service call, `revalidatePath` then `redirect` **outside** the `try`, and infrastructure errors caught and returned as form state with an English structured log (design D10)
- [x] 6.6 Implement `app/(dashboard)/sucursales/nueva/page.tsx` and `app/(dashboard)/sucursales/[id]/editar/page.tsx`, the latter loading through the owner-scoped finder and calling `notFound()` when it returns `null`
- [x] 6.7 Add the navigation link to `/sucursales` in `app/(dashboard)/layout.tsx`
- [x] 6.8 Confirm `isActive` appears in no form control and cannot be set through either action payload

## 7. Component Tests (React Testing Library)

- [x] 7.1 `LocationForm`: a rejected submit keeps the typed name and address in their fields
- [x] 7.2 `LocationForm`: the field-level error renders on the correct input, carries `aria-invalid`, and receives focus
- [x] 7.3 `LocationForm`: the submit control is disabled while a submission is pending
- [x] 7.4 `LocationForm`: labels are bound to their inputs and `address` is presented as optional (queried by role and label, never by test id)

## 8. Local Verification — `next dev`

- [x] 8.1 Create a location with name and address; it appears in the list and persists across a reload
- [x] 8.2 Create a location without an address; the card renders no dangling separator or empty line
- [x] 8.3 Create a duplicate name in different casing; a field-level Spanish error renders, nothing is written, and the typed values remain
- [x] 8.4 Create "Sucursal 50%" alongside an existing "Sucursal 500"; both exist (the real-world confirmation of 4.3)
- [x] 8.5 Edit a location's name and address; the change persists and `updatedAt` advances
- [x] 8.6 Save the edit form unchanged; it succeeds and is not reported as a duplicate of itself
- [x] 8.7 Open `/sucursales/<unknown-id>/editar`; a not-found page renders with no distinction from a foreign id
- [x] 8.8 Request `/sucursales`, `/sucursales/nueva`, and an edit page while logged out; each redirects to `/login?next=…` and the response body carries no location data
- [x] 8.9 Invoke the create action with no valid session; no row is written and the client is not broken by a plain HTML redirect — **partially verified**: an action-shaped POST without a session was not answered with an HTML redirect (the middleware branch works) and wrote no row. The remaining half — that `requireOwner()` itself issues the redirect — needs a valid runtime action id, which only exists inside a session, so it cannot be driven from outside one. Covered at unit level by `requireOwner.test.ts`.
- [x] 8.10 Point `DATABASE_URL` at an unreachable host and submit the create form — **not executable as written**: with the database down the create page cannot load at all, because session resolution fails in the dashboard layout first. The inline-form-state behaviour (design D10) covers write failures *after* the owner resolves, and was observed in 8.3: the duplicate rejection travels the same `toFailureState` path and preserved both typed values. Spec updated to state the boundary between the two cases.
- [x] 8.11 With the database unreachable, load `/sucursales`; the error boundary renders with a retry control and no stack trace, SQL, connection string, or constraint name — initially FAILED (infinite redirect loop), fixed by design D12 plus a root error boundary; re-verified: Spanish message + "Reintentar", 5 bounded log entries per navigation instead of an unbounded loop
- [x] 8.12 Submit the create form twice in quick succession; exactly one location exists and the second response does not present success as failure
- [x] 8.13 Reach the per-owner cap; the Spanish limit message renders and editing still works
- [x] 8.14 Render the list at a 360px viewport with a 120-character name; no horizontal overflow — verified by mechanism, not at a real 360px viewport: Chrome on Windows would not shrink below ~1366px and these tools expose no device emulation. Confirmed with a 120-character name that `overflow-wrap: break-word` applies, the title element does not overflow (scrollWidth == clientWidth), the document has no horizontal overflow, and the grid is single-column below the `sm` (640px) breakpoint by construction. Accepted as verified per the owner's call.
- [x] 8.15 `npm run lint`, `npm run typecheck`, `npm test` all clean

## 8b. Session Resolution Fix (design D12 — found by 8.11)

- [x] 8b.1 Write failing tests for `resolveOwnerFromSession`: a repository **failure** propagates instead of resolving to `null`; a repository **success returning no row** still resolves to `null` (redirect preserved); a missing session still resolves to `null`
- [x] 8b.2 Change `resolveOwnerFromSession` so a repository failure propagates, keeping the structured English log; leave the auth-provider `catch` as it is — an Auth outage makes the middleware and the page agree that there is no session, so it cannot loop
- [x] 8b.3 Confirm `AuthService` login still maps an owner-lookup failure to the generic Spanish infrastructure error (unchanged half of the requirement)
- [x] 8b.4 Re-run 8.10 and 8.11 against `next dev` with `DATABASE_URL` pointed at an unreachable target, then restore `.env`
- [x] 8b.5 Re-confirm the authenticated happy path still works after the change (list, create, edit)
- [x] 8b.6 Add a root `app/error.tsx`: a route group's `error.tsx` wraps its layout's children, not the layout itself, so a session-resolution failure reached Next.js's built-in English error page

## 9. Cloudflare Pipeline

- [x] 9.1 **GATE:** `npm run preview` (local workerd) and repeat 8.1–8.14 against the Workers runtime; if the constraint violation, the scoped update, or the action error path behave differently there, stop and record the finding in `docs/s0-versions-decision.md`
- [x] 9.2 `npm run deploy`; repeat the core paths (create, edit, duplicate, unauthenticated access) against the deployed URL — redeployed after the adversarial-review fixes (version `cc2074fe`, superseding `3f49cc39`) so the boundary consolidation reaches production

## 9b. Adversarial Review Fixes (pre-archive)

- [x] 9b.1 `prisma/seed.ts`: replace the unscoped `findFirst({ where: { name } })` with an `upsert` on the `(ownerId, name)` key. The old lookup was a workaround for the unique constraint not existing — M1 added it, so the workaround became both unnecessary and, with a second owner, actively harmful: it would match another owner's location by name and reassign it via `ownerId`
- [x] 9b.2 Verify the `data-persistence` idempotency requirement still holds: run `npx prisma db seed` twice and confirm the table is unchanged (same ids, same addresses, unrelated rows untouched)
- [x] 9b.3 `vitest.config.ts`: widen the `server` project to `{app,src}/**/*.test.ts`. A `.test.ts` under `app/` previously matched neither project, so it would be collected nowhere — never running and never failing
- [x] 9b.4 Add `app/(dashboard)/sucursales/formState.test.ts` — the code-to-copy mapping had no test at all, and its natural path was inside the gap 9b.3 closed; it now also pins that configuration
- [x] 9b.5 Consolidate the error boundaries: delete the unreachable `app/(dashboard)/sucursales/error.tsx`, and make `app/(dashboard)/error.tsx` generic — it covers every dashboard route but said "no pudimos cargar las sucursales", which would have been wrong copy on `/servicios` in M3. `COPY.locations.error`/`retry` became orphaned and were removed in favour of `COPY.common`

## 10. Documentation & Close-out

- [x] 10.1 Update `docs/tech-debt.md` (extended after the adversarial review with T11 cross-owner isolation assurance and T12 double-submit reporting): close the three T3 items RTL covers and leave the fourth open with its trigger (design D4); add the accepted last-write-wins behaviour with its M2 trigger (design D5); add the case-variant race accepted under D2
- [x] 10.2 Tick **M1** in `docs/roadmap.md`
- [x] 10.3 Final gates: lint, typecheck, tests and coverage all green; confirm no secrets in tracked files
- [x] 10.4 Run `/opsx:verify`, then archive the change
