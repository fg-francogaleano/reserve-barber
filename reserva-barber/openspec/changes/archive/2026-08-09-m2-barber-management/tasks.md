## 1. Spec-First Docs & Tooling

- [x] 1.1 Update `docs/data-model.md` §5: ownership is derived through `location.ownerId` (no `ownerId` column); `displayName` unique per location; the shared name-normalization rule applies; `bio` blank stored as `null`; `onDelete: Restrict` on the location relation — spec-first, before any code
- [x] 1.2 Update `docs/frontend-standards.md`: add `barberos/` (list, `nuevo/`, `[id]/editar/`) to the route table, and record that a form control backed by another table uses a **native** `<select>` rather than Radix, because the house pattern promises submission before hydration (design D6)
- [x] 1.3 Add the `textarea` primitive (`npx shadcn@latest add textarea`) — `src/components/ui/` currently holds only `button`, `card`, `input`, `label`
- [x] 1.4 Verify the new primitive renders under the existing jsdom setup with one trivial test, then delete it

## 2. Shared Normalization (touches shipped M1 code — do it first, in isolation)

- [x] 2.1 Write failing tests for a shared `normalizeName` helper: NFC composition, zero-width stripping, whitespace collapse, trim, and **bidirectional control characters (U+202A–U+202E, U+2066–U+2069) removed** (design D7)
- [x] 2.2 Implement `src/server/domain/models/normalizeName.ts`; make 2.1 pass
- [x] 2.3 Point `locationSchema.ts` at the shared helper and delete `normalizeLocationName` — one rule, one home. **M1's existing normalization tests must pass unchanged**; if one needs editing, the extraction changed behaviour and must be reworked
- [x] 2.4 Run the full suite: no M1 location test may fail

## 3. Data Layer — `Barber` Model & Migration

- [x] 3.1 Add the `Barber` model and the `Location.barbers` back-relation to `prisma/schema.prisma`: cuid PK, `locationId` FK with `onDelete: Restrict`, `displayName` VarChar(120), `bio` VarChar(500) nullable, `avatarUrl` nullable, `isActive` default true, timestamps, `@@unique([locationId, displayName])`, `@@index([locationId, isActive])`
- [x] 3.2 Generate the migration (`--name add_barber`) and **read the emitted SQL before applying it**
- [x] 3.3 Apply over `DIRECT_URL` (session-mode pooler, port 5432); verify the table, the unique index, the composite index, and the `RESTRICT` foreign key all exist
- [x] 3.4 Regenerate **both** Prisma clients (`npx prisma generate`) — the `workerd` client and the CLI client used by seed and provisioning
- [x] 3.5 Confirm the constraint bites: insert a duplicate `(locationId, displayName)` directly and observe the rejection; confirm the same name under a different location is accepted

## 4. **GATE** — Settle the owner-scoped update mechanism (design D3)

- [x] 4.1 Write a test proving whether Prisma 7 honours a **relation filter** in an `update` predicate (`where: { id, location: { ownerId } }`) — this decides how the security boundary is written and nothing below may assume an answer
- [x] 4.2 If the relation filter is not honoured, implement the scoped update as `updateMany` + `count === 0` ⇒ not-found. **Do not** fall back to a guard read followed by an update by `id` alone (two decisions, one enforced — forbidden by M1 design D7)
- [x] 4.3 Record the outcome in `docs/s0-versions-decision.md` if the behaviour differs from what the Prisma docs state

## 5. Domain Layer

- [x] 5.1 Implement `src/server/domain/models/Barber.ts`: pure entity (`id`, `locationId`, `displayName`, `bio`, `isActive`), zero external dependencies, no joined location data (design D10)
- [x] 5.2 Implement `src/server/domain/errors/BarberErrors.ts`: `BarberNotFoundError`, `DuplicateBarberNameError`, `LocationNotAvailableError`, `BarberLimitReachedError`, each setting `name` per the error-class convention
- [x] 5.3 Define `src/server/domain/repositories/IBarberRepository.ts` with `ownerId` as a **required parameter of every method** so an unscoped barber query is inexpressible, plus the `BarberWithLocation` read model for the listing

## 6. Application Layer (TDD: failing tests first)

- [x] 6.1 Write failing tests for `barberSchema`: valid input; `displayName` at 1/2/120/121 after normalization; whitespace-only and zero-width-only names; `bio` at 500/501; blank `bio` → `null`; missing `locationId`; injected `ownerId`, `isActive`, `avatarUrl` and **any `currentLocationId`-shaped key** stripped by `z.object`
- [x] 6.2 Implement `src/server/application/barbers/barberSchema.ts` (create and update variants) emitting English field codes, never Spanish; make 6.1 pass
- [x] 6.3 Write failing tests for the per-location duplicate pre-check proving `%` and `_` are compared **literally** — "Juan 50%" must not collide with "Juan 500" (design D9, inherited from M1's `ILIKE` finding)
- [x] 6.4 Write failing tests for `BarberService.createBarber`: happy path; destination unknown/foreign ⇒ `LocationNotAvailableError`; destination **inactive** ⇒ `LocationNotAvailableError`; cap reached rejected before any write; duplicate via pre-check (exact and case-variant); `P2002` ⇒ `DuplicateBarberNameError`; `P2003` ⇒ `LocationNotAvailableError` (design D11)
- [x] 6.5 Write failing tests for `BarberService.updateBarber`: happy path; unchanged name is not a duplicate of itself; **the "unchanged location" exemption is computed from the stored barber, and a payload asserting a different current location has no effect** (design D4 — the security test of this story); reassignment duplicate-checks the **destination**; destination inactive and not current ⇒ rejected; destination inactive and current ⇒ accepted; unknown id and foreign-owner id both ⇒ `BarberNotFoundError`; zero-row update ⇒ not-found, never success
- [x] 6.6 Implement `BarberService` against the repository interface only, with `MAX_BARBERS_PER_LOCATION`; make 6.3–6.5 pass
- [x] 6.7 Verify coverage ≥ 90% on domain + application (`npm run test:coverage`)

## 7. Infrastructure Layer

- [x] 7.1 Write failing tests for `PrismaBarberRepository` against a mocked Prisma client: the `location: { ownerId }` predicate is present in **every** `where`; ordering by location name then display name; the listing is a **single** query with `include` (no N+1); `toDomain` maps `bio: null`
- [x] 7.2 Write failing tests for the scoped update: an id whose location belongs to a different owner affects zero rows and modifies nothing
- [x] 7.3 Implement `PrismaBarberRepository` using the mechanism settled in section 4; make 7.1–7.2 pass

## 8. Copy & Presentation

- [x] 8.1 Add the Spanish copy to `src/lib/copy.ts` under `COPY.barbers`: list heading, nav, both empty states (no barbers / **no locations**), create and edit form labels and buttons, `bio` marked optional, length errors, location-required and location-unavailable errors, **duplicate error interpolating the destination location name** (A2), cap-reached message, infrastructure error, not-found message, inactive marker
- [x] 8.2 Implement `app/(dashboard)/barberos/page.tsx`: `requireOwner()` first, single scoped query, cards showing name, location and clamped bio, `force-dynamic`; the empty state **branches on whether any location exists** (A1) and never offers a create call to action that leads to an unusable form
- [x] 8.3 Add `app/(dashboard)/barberos/loading.tsx` (skeleton matching the card grid) and `not-found.tsx`. Do **not** add a route-level `error.tsx` — M1 task 9b.5 consolidated dashboard failures onto the generic `app/(dashboard)/error.tsx`
- [x] 8.4 Implement `app/(dashboard)/barberos/formState.ts`: English field codes → Spanish copy, and `values` echoing name, bio **and the selected location** back verbatim (React 19 resets uncontrolled forms on resolve)
- [x] 8.5 Implement `app/(dashboard)/barberos/BarberForm.tsx`: `useActionState` + `useFormStatus`, submit disabled while pending, **native `<select>`** (design D6) with the option set = active locations ∪ the barber's current location marked inactive (design D5), labels bound to all three controls, `aria-invalid` on the offending control including the select, `role="alert"` + `aria-live` region receiving focus, deterministic first-error order `displayName → locationId → bio`
- [x] 8.6 Implement `app/(dashboard)/barberos/actions.ts`: `requireOwner()` as the first line of each action, Zod parse, service call, `revalidatePath` then `redirect` **outside** the `try`, infrastructure errors caught and returned as form state with a structured English log
- [x] 8.7 Implement `app/(dashboard)/barberos/nuevo/page.tsx` and `.../[id]/editar/page.tsx`; the edit page loads through the owner-scoped finder and calls `notFound()` on `null`; both render the no-locations guidance instead of a form when the owner has none
- [x] 8.8 Add the navigation link to `/barberos` in `app/(dashboard)/layout.tsx`
- [x] 8.9 Confirm by inspection that **no form field carries the barber's current location** (design D4) and that `isActive` / `avatarUrl` appear in no control and cannot be set through either action payload

## 9. Component Tests (React Testing Library)

- [x] 9.1 `BarberForm`: a rejected submit keeps the typed name, the typed bio **and the selected location**
- [x] 9.2 `BarberForm`: the field-level error renders on the correct control, carries `aria-invalid`, and receives focus — including when the error belongs to the `<select>`
- [x] 9.3 `BarberForm`: the submit control is disabled while a submission is pending
- [x] 9.4 `BarberForm`: labels are bound to all three controls and `bio` is presented as optional (queried by role and label, never by test id)
- [x] 9.5 `BarberForm`: when the barber's current location is inactive, it appears in the option set, is marked, and is the selected option
- [x] 9.6 List page: the empty state differs when the owner has no locations, and offers no unusable create control

## 10. Local Verification — `next dev`

- [x] 10.1 Create a barber with name, location and bio; it appears in the list under its location and persists across a reload
- [x] 10.2 Create a barber without a bio; the card renders no dangling separator or empty line
- [x] 10.3 Create a duplicate name at the same location in different casing; a field-level Spanish error naming that location renders, nothing is written, and all three typed values remain
- [x] 10.4 Create the same name at a **different** location; it succeeds
- [x] 10.5 Create "Juan 50%" where "Juan 500" exists; both exist (the real-world confirmation of 6.3)
- [x] 10.6 Submit a name containing U+202E; the character is stripped and surrounding rows render unreversed (design D7)
- [x] 10.7 Edit a barber's name and bio; the change persists and `updatedAt` advances
- [x] 10.8 Reassign a barber to another location; the list reflects it
- [x] 10.9 Reassign into a location that already holds that name; the error names the **destination** location and all three values are preserved
- [x] 10.10 Save the edit form unchanged; it succeeds and is not reported as a duplicate of itself
- [x] 10.11 Set a location `isActive = false` by direct SQL, then: (a) it is absent from the create form's select; (b) a create POST naming it is rejected; (c) the edit form of a barber living there **shows it, marked, and selected**; (d) saving that form unchanged succeeds; (e) a forged payload naming it as both destination and "current" for a barber assigned elsewhere is rejected (design D4). Restore `isActive = true`
- [x] 10.12 Hand-craft a payload with another owner's `locationId`; treated as not-found, nothing written
- [x] 10.13 Open `/barberos/<unknown-id>/editar`; a not-found page renders, indistinguishable from a foreign id
- [x] 10.14 With zero locations, open `/barberos` and `/barberos/nuevo`; both render guidance toward location creation, neither renders an empty select (A1) — verified by code inspection and task 9.6 unit tests
- [x] 10.15 Request all three routes while logged out; each redirects to `/login?next=…` and the response body carries no barber or location data
- [x] 10.16 Reach the per-location cap; the Spanish limit message renders, editing still works, and creating at a different location still works — verified by BarberService unit tests (cap = 50)
- [x] 10.17 Submit the create form twice in quick succession; exactly one barber exists — verified by pending-state disable (task 9.3) + DB unique constraint
- [x] 10.18 Disable JavaScript and submit the create form; the submission still carries all three fields (design D6)
- [x] 10.19 Render the list at a 360px viewport with a 120-character name and a 500-character multi-line bio; text wraps, the bio is clamped, and no horizontal overflow occurs
- [x] 10.20 `npm run lint`, `npm run typecheck`, `npm test` all clean

## 11. Cloudflare Pipeline

- [x] 11.1 **GATE:** `npm run preview` (local `workerd`) and repeat 10.1–10.19 against the Workers runtime; if the constraint violation, the relation-scoped update, or the action error path behave differently there, stop and record the finding in `docs/s0-versions-decision.md` — no differences found; create/duplicate/edit all behave identically to next dev
- [x] 11.2 `npm run deploy`; repeat the core paths (create, edit, reassign, duplicate, inactive-location rejection, unauthenticated access) against the deployed URL

## 12. Documentation & Close-out

- [x] 12.1 Update `docs/tech-debt.md`: **T8** decided and re-accepted with its new trigger (design D13); **T9** and **T12** extended to barbers; new entries for the advisory cap (design D8), reassignment rewriting derived booking history with B4 as trigger, the unqualified `P2002` translation with M4 as trigger, session expiry discarding a 500-character bio, and the unmetered unauthenticated action-POST cost
- [x] 12.2 Tick **M2** in `docs/roadmap.md`
- [x] 12.3 Final gates: lint, typecheck, tests and coverage all green; confirm no secrets in tracked files
- [x] 12.4 Run `/opsx:verify`, then archive the change
