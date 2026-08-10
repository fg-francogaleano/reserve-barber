## 1. Spec-First Docs & Prerequisites

- [x] 1.1 Update `docs/data-model.md` §6 **before any code**: `name` normalized by the shared rule and unique per owner (`(ownerId, name)`); `description` blank stored as `null`; `price` precision, scale and maximum; `durationMinutes` integer, granularity multiple, min and max. Add `services` to §1's `Owner` relationships — spec-first per `docs/base-standards.md` §7
- [x] 1.2 Update `docs/frontend-standards.md`: add `servicios/` (list, `nuevo/`, `[id]/editar/`) to the route table, and record that a monetary or numeric input uses `type="text" inputMode="decimal"` — never `type="number"`, which submits an empty string for values its parser rejects (design D5/D7)
- [x] 1.3 Decide **T10** explicitly: fix the anchor-background bug or re-defer it in `docs/tech-debt.md` with a new trigger. The "Nuevo servicio" call to action is its third copy, which is the case the entry says not to let happen silently

## 2. Rename (touches shipped M2 code — do it first, in isolation)

- [x] 2.1 Rename `src/server/application/services/BarberService.ts` → `BarberCatalogService.ts` and the class with it (design D1), so M4 can introduce a Prisma model named `BarberService` without a collision
- [x] 2.2 Update all importers (`app/(dashboard)/barberos/{page,actions}.ts`, `PrismaBarberRepository.ts`, `BarberService.test.ts` → `BarberCatalogService.test.ts`); `npm run typecheck` must be clean
- [x] 2.3 Run the full suite: **no barber test may need editing**. If one does, the rename changed behaviour and must be reworked

## 3. Data Layer — `Service` Model & Migration

- [x] 3.1 Add the `Service` model and the `Owner.services` back-relation to `prisma/schema.prisma`: cuid PK, `ownerId` FK, `name` VarChar(120), `description` VarChar(500) nullable, `price` `@db.Decimal(12, 2)`, `durationMinutes` Int, `isActive` default true, timestamps, `@@unique([ownerId, name])`, `@@index([ownerId, isActive])`
- [x] 3.2 Generate the migration (`--name add_service`) and **read the emitted SQL before applying it** — confirm `price` is `DECIMAL(12,2)` and not Prisma's default `DECIMAL(65,30)`
- [x] 3.3 Apply over `DIRECT_URL` (session-mode pooler, port 5432); verify the table, the unique index, the composite index and the foreign key all exist
- [x] 3.4 Regenerate **both** Prisma clients (`npx prisma generate`) — the `workerd` client and the CLI client — and confirm `prisma/seed.ts` still runs
- [x] 3.5 Confirm the constraint bites: insert a duplicate `(ownerId, name)` directly and observe the rejection

## 4. **GATE** — Money on the Workers runtime (design D3, D12)

Two properties of this change fail only at runtime on `workerd`: they pass `next build` and pass Vitest under Node. Settle both before the presentation layer is written; nothing below may assume an answer.

- [x] 4.1 Insert a service row by direct SQL, then render it through a throwaway Server Component under `npm run preview`: confirm the Prisma decimal converts via `toFixed(2)` on the `workerd` client and that the resulting string crosses to a Client Component without a serialization error
- [x] 4.2 Under the same run, evaluate `Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(4500.5)` and record the exact output. A trimmed ICU dataset degrades **silently** to `ARS 4500.00` instead of `$ 4.500,00`
- [x] 4.3 If 4.2 degrades, implement a hand-written es-AR formatter as the fallback and record the finding in `docs/s0-versions-decision.md`. If it does not, record that `Intl` is safe so the next story does not re-litigate it
- [x] 4.4 Delete the throwaway probe

## 5. Domain Layer

- [x] 5.1 Implement `src/server/domain/models/Service.ts`: pure entity (`id`, `name`, `description`, `price: string`, `durationMinutes`, `isActive`), zero external dependencies, **no Prisma decimal type anywhere in its signature** (design D3)
- [x] 5.2 Implement `src/server/domain/models/slotGranularity.ts` with `SLOT_GRANULARITY_MINUTES` and the duration bounds, plus tests. It lives in the domain layer because B3 and B5 consume the same definition (design D6)
- [x] 5.3 Implement `src/server/domain/errors/ServiceErrors.ts`: `ServiceNotFoundError`, `DuplicateServiceNameError`, `ServiceLimitReachedError`, each setting `name` per the error-class convention
- [x] 5.4 Define `src/server/domain/repositories/IServiceRepository.ts` with `ownerId` as a **required parameter of every method** so an unscoped service query is inexpressible, including a count that takes only active rows (design D8)

## 6. Application Layer (TDD: failing tests first)

- [x] 6.1 Write failing tests for **price parsing** — the largest surface in this change: `"4500"`, `"4500.50"`, `"4500,50"` all canonicalize identically; `"4.500"` and `"4,500"` rejected as ambiguous; `"4500.555"` rejected and **never rounded to `4500.55` or `4500.56`**; `"abc"`, `""`, `"1e5"`, `"Infinity"`, `"-1"` rejected; `"0"` accepted; a value above the maximum rejected by validation, never reaching the database
- [x] 6.2 Write failing tests for **duration**: `30` accepted; `37` rejected as a non-multiple; `0`, `-15`, `481`, `"4.5"`, `"abc"` rejected
- [x] 6.3 Write failing tests for `name` and `description`: normalization (whitespace collapse, NFC, zero-width and bidi stripping); 1/2/120/121 characters **after** normalization; whitespace-only and invisible-only names; `description` at 500/501; blank `description` → `null`; injected `ownerId`, `isActive` and `id`-on-create stripped by `z.object`
- [x] 6.4 Implement `src/server/application/servicesCatalog/serviceSchema.ts` (create and update variants) emitting English field codes, never Spanish; make 6.1–6.3 pass
- [x] 6.5 Write failing tests for the per-owner duplicate pre-check proving `%` and `_` are compared **literally** — "Corte 50%" must not collide with "Corte 500" (design D9, inherited from M1's `ILIKE` finding)
- [x] 6.6 Write failing tests for `ServiceCatalogService.createService`: happy path; cap reached rejected before any write; **the cap count excludes inactive rows** (design D8); duplicate via pre-check, exact and case-variant; `P2002` ⇒ `DuplicateServiceNameError`
- [x] 6.7 Write failing tests for `ServiceCatalogService.updateService`: happy path; unchanged name is not a duplicate of itself; unknown id and foreign-owner id both ⇒ `ServiceNotFoundError`; zero-row update ⇒ not-found, **never success**
- [x] 6.8 Implement `src/server/application/services/ServiceCatalogService.ts` against the repository interface only, with `MAX_SERVICES_PER_OWNER`; make 6.5–6.7 pass
- [x] 6.9 Verify coverage ≥ 90% on domain + application (`npm run test:coverage`)

## 7. Infrastructure Layer

- [x] 7.1 Write failing tests for `PrismaServiceRepository` against a mocked Prisma client: the `ownerId` predicate is present in **every** `where`; the listing is a **single** query with a deterministic order; `toDomain` converts the decimal to a two-place string and maps `description: null`
- [x] 7.2 Write failing tests for the scoped update: an id belonging to a different owner affects zero rows and modifies nothing; `P2025` maps to `null`
- [x] 7.3 Write failing tests for the active-only count backing the cap
- [x] 7.4 Write failing tests for **constraint-violation logging** (design D11): a recognized violation logs the driver code and the operation and **no** business value; an unrecognized error still logs its message
- [x] 7.5 Implement `PrismaServiceRepository` and the logging change; make 7.1–7.4 pass

## 8. Copy & Presentation

- [x] 8.1 Add the Spanish copy to `src/lib/copy.ts` under `COPY.services`: list heading, nav, empty state, create and edit form labels and buttons, `description` marked optional, **the expected price format and the duration granularity as idle-state hints**, name/price/duration/description errors, duplicate, cap-reached, not-found, and an infrastructure error that **directs the owner to check the list before retrying**
- [x] 8.2 Implement `src/lib/formatCurrency.ts` with tests for `0`, `4500`, `4500.5`, and the maximum — using whichever implementation task 4.3 settled
- [x] 8.3 Implement `app/(dashboard)/servicios/page.tsx`: `requireOwner()` first, single scoped query, `force-dynamic`, cards showing name, formatted price, duration and clamped description. Price formatting happens **here, on the server**, never in a Client Component (design D12)
- [x] 8.4 Add `app/(dashboard)/servicios/loading.tsx` (skeleton matching the card grid) and `not-found.tsx`. Do **not** add a route-level `error.tsx` — dashboard failures are consolidated on `app/(dashboard)/error.tsx`
- [x] 8.5 Implement `app/(dashboard)/servicios/formState.ts`: English field codes → Spanish copy, and `values` echoing **all four** fields back verbatim (React 19 resets uncontrolled forms on resolve)
- [x] 8.6 Implement `app/(dashboard)/servicios/ServiceForm.tsx`: `useActionState` + `useFormStatus`, submit disabled while pending, labels bound to all four controls, `aria-invalid` on the offending control, `role="alert"` + `aria-live` region receiving focus, deterministic first-error order `name → price → durationMinutes → description`. The price and duration controls are `type="text" inputMode="decimal"` with **no `min`, `max`, `step` or `pattern`** (design D7)
- [x] 8.7 Implement `app/(dashboard)/servicios/actions.ts`: `requireOwner()` as the first line of each action, Zod parse, service call, `revalidatePath` then `redirect` **outside** the `try` — a redirect caught by the write handler would report a successful create as an infrastructure failure
- [x] 8.8 Implement `app/(dashboard)/servicios/nuevo/page.tsx` and `.../[id]/editar/page.tsx`; the edit page loads through the owner-scoped finder and calls `notFound()` on `null`
- [x] 8.9 Add the navigation link to `/servicios` in `app/(dashboard)/layout.tsx`
- [x] 8.10 Confirm by inspection that `isActive` appears in no control and cannot be set through either action payload, and that no `Decimal` is imported outside `PrismaServiceRepository`

## 9. Component Tests (React Testing Library)

- [x] 9.1 `ServiceForm`: a rejected submit keeps the typed name, price, duration **and** description
- [x] 9.2 `ServiceForm`: the field-level error renders on the correct control, carries `aria-invalid`, and receives focus
- [x] 9.3 `ServiceForm`: the submit control is disabled while a submission is pending
- [x] 9.4 `ServiceForm`: labels are bound to all four controls, `description` is presented as optional, and the price-format and granularity hints are present **before** any error (queried by role and label, never by test id)
- [x] 9.5 `ServiceForm`: the price control is not `type="number"` and carries `inputMode="decimal"`; no `min`, `max`, `step` or `pattern` attribute is present on price or duration (design D7 — the regression guard for the highest-frequency failure in this change)
- [x] 9.6 List page: the empty state and a working create call to action render when the owner has no services

## 10. Local Verification — `next dev`

- [x] 10.1 Create a service with all four fields; it appears in the list with its price formatted in es-AR and persists across a reload
- [x] 10.2 Create a service without a description; the card renders no dangling separator or empty line
- [x] 10.3 Type `4500,50` and submit; it persists as 4500.50 — **not** rejected as missing, and not blanked by the browser (the real-world confirmation of design D5)
- [x] 10.4 Submit `4.500`; rejected as ambiguous with the format message, and the typed text remains in the control
- [x] 10.5 Submit `4500.555`; rejected, and no rounded value is written
- [x] 10.6 Submit a price of `0`; accepted
- [x] 10.7 Submit a duration of `37`; rejected with the Spanish granularity message — confirm the message is the application's, not a native browser tooltip
- [x] 10.8 Create a duplicate name in different casing; a field-level Spanish error renders, nothing is written, and all four typed values remain
- [x] 10.9 Create "Corte 50%" where "Corte 500" exists; both exist (the real-world confirmation of 6.5)
- [x] 10.10 Submit a name containing U+202E; the character is stripped and surrounding rows render unreversed
- [x] 10.11 Edit every field of a service; the changes persist and `updatedAt` advances
- [x] 10.12 Save the edit form unchanged; it succeeds and is not reported as a duplicate of itself
- [x] 10.13 POST the create action directly with a 121-character name; rejected. **This must be driven at the action, not through the input** — `maxLength` truncates the paste and makes the boundary unreachable from the UI (design D7)
- [x] 10.14 Hand-craft a payload carrying `isActive = false` and an `ownerId`; the service is created active for the session owner and both values are ignored
- [x] 10.15 Open `/servicios/<unknown-id>/editar`; a not-found page renders, indistinguishable from a foreign id
- [x] 10.16 Request all three routes while logged out; each redirects to `/login?next=…` and the response body carries no service name or price
- [x] 10.17 Reach the per-owner cap; the Spanish limit message renders and editing still works
- [x] 10.18 Set one service `isActive = false` by direct SQL while at the cap; a create is now accepted (design D8 — the M6 dead-end that this rule prevents). Restore the row
- [x] 10.19 Simulate a write failure; the form re-renders in place with all four values intact, the message directs the owner to check the list, and the full-page error boundary is not shown
- [x] 10.20 Submit the create form twice in quick succession; exactly one service exists
- [x] 10.21 Disable JavaScript and submit the create form; the submission still carries all four fields
- [x] 10.22 Render the list at a 360px viewport with a 120-character name, a 500-character multi-line description and a maximal price; text wraps, the description is clamped, and no horizontal overflow occurs
- [x] 10.23 `npm run lint`, `npm run typecheck`, `npm test` all clean

## 11. Cloudflare Pipeline

- [x] 11.1 **GATE:** `npm run preview` (local `workerd`) and repeat 10.1–10.22 against the Workers runtime, paying particular attention to the price round-trip and the rendered currency format. If anything behaves differently, stop and record the finding in `docs/s0-versions-decision.md`
- [x] 11.2 `npm run deploy`; repeat the core paths (create, edit, duplicate, price parsing, unauthenticated access) against the deployed URL

## 12. Documentation & Close-out

- [x] 12.1 Update `docs/tech-debt.md`: **T8** re-evaluated at M3; **T9** and **T12** extended to services; **T15**'s M4 trigger re-affirmed for `Service`; new entries for the advisory per-owner cap, the raw driver messages still logged by the location and barber write paths (design D11) with the trigger to correct them, and session expiry discarding a 500-character description; **T10** resolved or re-deferred per task 1.3
- [x] 12.2 Tick **M3** in `docs/roadmap.md`
- [x] 12.3 Final gates: lint, typecheck, tests and coverage all green; confirm no secrets in tracked files
- [x] 12.4 Run `/opsx:verify`, then archive the change
