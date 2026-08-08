## Why

Locations exist today only as rows a developer seeded: A1 gave the owner a protected dashboard but no way to create or edit a single branch of their own business. M1 is the first story where the owner writes to their own data, and it gates the rest of Phase 1 — M2 assigns barbers to a location, B2 makes the client pick one. It is also the moment two holes A1 left behind stop being invisible: `Location.name` is documented as unique per owner (`docs/data-model.md` §4) but nothing enforces it, and `ILocationRepository` exposes a single unscoped `findAllActive()` that reads every owner's rows — harmless while exactly one owner exists, wrong the moment that stops being true.

## What Changes

- Add a dedicated dashboard route `/sucursales` where the owner lists, creates, and edits their locations. **BREAKING**: the location list moves off `/`, which `docs/frontend-standards.md` reserves for the dashboard home (story D1). `/` keeps rendering the list until D1 replaces it, so nothing is left without a page.
- Make ownership structural, not incidental: every repository finder and mutator takes `ownerId` as a required parameter, so an unscoped query cannot be expressed. A location belonging to another owner resolves as not-found — never as forbidden, which would confirm it exists.
- Enforce `name` uniqueness per owner at the database level (`@@unique([ownerId, name])`), with names normalized on input (trim, collapse internal whitespace, NFC) so `Sucursal  Centro` and a decomposed-accent spelling cannot slip past as distinct rows. A case-insensitive pre-check in the application layer turns the constraint violation into a readable field error; the constraint remains the only real guarantee, because the check and the insert cannot share a transaction on a transaction-mode pooler.
- Add an index on `(ownerId, isActive)` to back the list query.
- Keep A1's form pattern: `useActionState` + a server-side Zod schema, no React Hook Form. `docs/frontend-standards.md` is corrected to describe what the project actually does, rather than leaving the document and the code disagreeing.
- Add a server-side cap on the number of locations per owner. M1 ships create and edit but no delete, and deactivation belongs to M6 — without a ceiling, a runaway client leaves rows the owner cannot remove from the app.
- Introduce component testing with React Testing Library + jsdom, and cover the form's error, pending, and value-preservation states. This closes three of the four items in `docs/tech-debt.md` T3; the fourth (a failed login answers `200`, not `401`) is not observable under jsdom and stays open with its trigger intact.
- Do **not** ship: deactivating or deleting locations (M6), barbers (M2), services (M3), or any public rendering of a location (B1/B2). The edit form does not expose `isActive`.

## Capabilities

### New Capabilities

- `location-management`: The owner creates and edits their own locations from the dashboard — input validation and name normalization, uniqueness per owner, ownership enforcement on every read and write, the per-owner cap, and the Spanish (es-AR) UI states for both forms (idle, submitting, field-level invalid, duplicate name, infrastructure error, not-found).

### Modified Capabilities

- `location-listing`: The list moves from the dashboard home to `/sucursales` and becomes owner-scoped rather than globally active-filtered; a management list shows every location the owner owns, including inactive ones, so a location can never become invisible and therefore uneditable. The existing loading, empty, error, copy-isolation, and responsive requirements move with the route unchanged.
- `data-persistence`: `Location` gains the `(ownerId, name)` unique constraint and the `(ownerId, isActive)` index, applied by a migration that must refuse to run against pre-existing duplicates. `ILocationRepository` grows owner-scoped reads and writes; the update path is scoped by `ownerId` in its predicate so a mismatched owner affects zero rows rather than relying on a prior read.
- `owner-authentication`: Session resolution must distinguish an *answer* from the *absence of an answer*. A completed lookup reporting no `Owner` stays an authentication outcome and still redirects to `/login`; a lookup that could not run at all (database unreachable) is an infrastructure failure and must surface to the route error boundary instead. Added after runtime verification of this change found that the existing rule — "session resolution SHALL treat the request as unauthenticated" — traps the owner in an infinite redirect loop whenever PostgreSQL is down while Supabase Auth is up, which is precisely what the free tier does when it pauses the database.
- `project-scaffold`: The test toolchain requirement extends to component tests — React Testing Library with a jsdom environment, tests alongside sources as `*.test.tsx`. The existing rule that unit tests never touch a real database continues to apply.

## Impact

- **Code (new):** `app/(dashboard)/sucursales/{page,actions}.tsx`, `.../nueva/page.tsx`, `.../[id]/editar/page.tsx`, `.../LocationForm.tsx`, `.../{loading,error}.tsx`; `src/server/application/locations/locationSchema.ts`; `src/server/domain/errors/LocationErrors.ts`.
- **Code (modified):** `prisma/schema.prisma`, `src/server/domain/models/Location.ts` (name normalization), `src/server/domain/repositories/ILocationRepository.ts`, `src/server/application/services/LocationService.ts`, `src/server/infrastructure/prisma/PrismaLocationRepository.ts`, `src/lib/copy.ts`, `app/(dashboard)/layout.tsx` (navigation), `vitest.config.ts` (jsdom environment).
- **Dependencies added:** `@testing-library/react`, `@testing-library/user-event`, `jsdom` (dev only).
- **Data migration:** one migration adding the unique constraint and the index. It takes a lock on a live table and aborts if duplicate `(ownerId, name)` pairs exist, so the data must be checked first. DDL travels over `DIRECT_URL` (session-mode pooler, port 5432) while the runtime stays on transaction mode (6543) — see `docs/s0-versions-decision.md`.
- **Docs:** `docs/data-model.md` §4 (uniqueness now DB-enforced), `docs/frontend-standards.md` (route table + form pattern), `docs/backend-standards.md` (validator folder naming reconciled with A1's feature-folder layout), `docs/tech-debt.md` (T3 partially closed; the accepted last-write-wins behaviour and the case-variant race recorded), `docs/roadmap.md` (M1 ticked).
- **Accepted risk, recorded rather than fixed:** two tabs editing the same location silently last-write-wins — no version column, no precondition. Cheap for one owner; revisit when M2 makes a location name load-bearing for staffing.
- **Downstream:** unblocks M2 (barbers belong to a location) and, through it, B2. Establishes the owner-scoping pattern every later dashboard resource (services, barbers, clients) repeats.
