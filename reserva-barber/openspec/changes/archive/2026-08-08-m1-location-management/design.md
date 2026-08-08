## Context

A1 delivered the owner identity, cookie sessions, a deny-by-default route guard, and a protected dashboard shell. What it did not deliver is any way for the owner to write their own data — the two locations on screen were put there by `prisma/seed.ts`. M1 is the first write path in the product, and the shape it takes is the shape every later dashboard resource (services, barbers, clients) will copy.

Three facts about the existing code constrain this design:

1. **`ILocationRepository` has exactly one method, `findAllActive()`, and it is unscoped.** It reads every owner's rows. With one `Owner` row in existence this is invisible, which is precisely why it needs fixing now rather than when a second owner makes it a bug.
2. **`docs/data-model.md` §4 says `Location.name` is unique per owner, and nothing enforces it.** A rule that lives only in prose is not a rule.
3. **The route middleware lets Server Action POSTs through on purpose** (`src/server/application/auth/routeGuard.ts`). Answering an action request with an HTML redirect breaks the action client, so actions are guarded from the inside by `requireOwner()`. That makes the first line of every action load-bearing.

The runtime constraints are unchanged from S0: Cloudflare `workerd`, a request-scoped Prisma client with `maxUses: 1` against the Supavisor **transaction-mode** pooler, and 10-second connection and query timeouts.

## Goals / Non-Goals

**Goals:**

- The owner can create and edit locations from the dashboard, in Spanish, on a phone.
- Ownership scoping is structural — expressible only one way — rather than a `where` clause someone has to remember.
- The uniqueness rule moves from prose into the database.
- Failures are legible: a duplicate name is a field error, a database outage is an inline message that keeps the owner's typing, and neither ever exposes a stack trace, a constraint name, or SQL.
- The form and repository patterns established here are worth copying for M2 and M3.

**Non-Goals:**

- Deactivating or deleting locations — story M6 owns the `isActive` management UI; the edit form does not expose the flag.
- Barbers (M2), services (M3), or any public rendering of a location (B1/B2).
- Replacing the dashboard home. `/` keeps its current content until story D1 builds the Inicio summary.
- Optimistic concurrency control. See D5.
- Rewriting `LocationService` into a rich domain model. `Location` stays a data entity; the one piece of behaviour it gains is name normalization, because two callers need it.

## Decisions

### D1 — The list moves to `/sucursales`

`docs/frontend-standards.md` reserves `/` for the Inicio summary (story D1 of the roadmap), and a management screen needs its own URL anyway for the create and edit sub-routes. The list therefore moves to `app/(dashboard)/sucursales/`, taking its `loading.tsx` and `error.tsx` with it.

*Alternative considered:* keep everything on `/` and move it when the Inicio page arrives. Rejected — the move happens either way, and doing it later means doing it with the create/edit routes already hanging off the wrong parent.

*Consequence:* the archived `location-listing` spec bound the list to the dashboard home. That requirement is **removed and replaced** rather than edited, because its identity changed, not merely its wording. `/` keeps rendering its existing content in the meantime, so no route is left blank.

### D2 — Uniqueness is a database constraint; the application check is only for the error message

`@@unique([ownerId, name])` in the schema, plus normalization before persistence: trim, collapse internal whitespace runs, and apply Unicode NFC. Normalization matters as much as the constraint — `Sucursal  Centro` with a double space and a decomposed-accent spelling of an existing name are byte-different and pixel-identical, and a constraint over raw input would wave both through.

The application-layer case-insensitive pre-check exists **only** to turn a violation into a readable field error. It cannot be the guarantee: the check and the insert are two round trips, and with `maxUses: 1` against a transaction-mode pooler they may not even share a connection. An interactive transaction is the wrong instrument on that pooler. So the constraint is the correctness boundary and `P2002` is a path that must be handled, not an impossibility.

*Alternative considered:* a unique index on `(ownerId, lower(name))`, which would also stop case-variant duplicates under a race. Rejected: Prisma cannot express an expression index in `schema.prisma`, so every subsequent `prisma migrate dev` would report drift that is not drift. Permanent friction in exchange for a case a single owner in a single tab cannot realistically produce.

*Accepted residual:* two case-variant names can both survive a genuine race. Recorded in `docs/tech-debt.md` rather than left implicit.

### D3 — Forms keep A1's `useActionState` + server-side Zod pattern

`docs/frontend-standards.md` prescribes React Hook Form, but RHF is not installed and A1 shipped `useActionState` with a server-side schema instead. For two text inputs, the existing pattern wins on every axis that matters here: it works before hydration and without JavaScript, it keeps one validation source instead of two that can drift, and it adds no dependency.

The document is corrected in this change to describe what the project does. A standards file that disagrees with the code teaches the wrong thing to whoever reads it next.

*Alternative considered:* install RHF to match the document. Rejected — writing code to satisfy a sentence, rather than fixing the sentence, is the wrong direction of causality.

### D4 — Component tests use React Testing Library + jsdom, not Playwright

The UI states this change introduces (values preserved after a rejected submit, disabled submit while pending, focus moved to the first error) are the kind of thing that silently regresses. RTL with jsdom covers them cheaply and runs in the same Vitest invocation as everything else.

*Alternative considered and rejected by the project owner:* Playwright, which `docs/frontend-standards.md` already names as the E2E tool and which would have closed all four items in tech-debt **T3**. It was declined in favour of familiarity with RTL. The consequence is recorded honestly rather than glossed: **T3 closes three of its four items.** The fourth — that a failed login answers `200` and not `401` — is a property of the HTTP response, which jsdom does not produce. It stays open with its original trigger.

*Boundary:* component coverage is deliberately excluded from the 90% threshold, which continues to measure `src/server/domain` and `src/server/application` only. Letting UI tests count toward that number would inflate the gate that protects business rules.

### D5 — Concurrent edits are last-write-wins, accepted and documented

No version column, no `updatedAt` precondition. Two sessions editing the same location means the later save silently discards the earlier one.

*Alternative considered:* carry the loaded `updatedAt` in the form and reject the write if it moved. Rejected for M1 — it adds a conflict-resolution UI to a two-field form for a system with exactly one administrative user.

*Why it is written down anyway:* the moment M2 attaches barbers to locations, a location name becomes load-bearing for staffing, and silent loss stops being harmless. The `docs/tech-debt.md` entry carries that trigger.

### D6 — A server-side cap on locations per owner

M1 ships create and edit but no delete, and deactivation is M6's. Without a ceiling, a runaway client leaves rows the owner cannot remove from the application. The cap is a constant checked in the application layer before the insert, producing a Spanish explanatory message.

*Alternative considered:* a throttle in the style of `LoginThrottle`. Rejected — that class is a per-isolate singleton that resets with the isolate, which is honest defense-in-depth for login but would be decorative as the only control here. A hard count is simple and actually holds.

### D7 — Ownership is a required parameter, not an optional filter

Every method on `ILocationRepository` takes `ownerId`. There is no method that can be called without it, so "forgot to scope the query" is not a mistake the contract permits. The update carries `ownerId` in its own predicate rather than trusting that a prior read checked it — a read-then-write pair is two decisions, and only one of them is enforced.

A location belonging to another owner resolves as **not-found**, never as forbidden. A `403` would confirm the row exists.

### D8 — A zero-row update means not-found, never "nothing changed"

PostgreSQL reports an affected row even when the new values equal the old ones, so a scoped update returning zero rows can only mean the predicate matched nothing — wrong id, or wrong owner. Treating zero as success would silently swallow both. This is called out because it is exactly the kind of thing that reads as harmless.

### D9 — Prisma errors are translated at the application boundary

`P2002` becomes a domain `DuplicateLocationNameError`; a missing row becomes `LocationNotFoundError`. Prisma error messages name constraints and columns, and the specs forbid that reaching the response. Translation happens in the service, not in the repository, so the repository stays a thin mapper and the policy lives in one place.

### D10 — Infrastructure failures inside an action return form state; they do not throw

A thrown error reaches the route error boundary, which replaces the page — and with it everything the owner typed. On a read that is the right behaviour and already specified. On a submit it is a data-loss bug wearing an error screen. Actions therefore catch, log in English with `operation` and cause, and return the generic Spanish message as form state. `redirect()` stays outside the `try`, since it signals through a thrown value that must reach Next.js — the same trap already annotated in `app/login/actions.ts`.

### D11 — Validators live in a feature folder, matching A1

`src/server/application/locations/locationSchema.ts`, mirroring `src/server/application/auth/loginSchema.ts`. `docs/backend-standards.md` says `application/validators/`; A1 already deviated and the deviation reads better as the tree grows. The standards document is reconciled to the code in this change, in the same spirit as D3.

### D12 — A failed owner lookup is an error, not a logged-out visitor

*Added during implementation, after runtime verification of task 8.11 failed.*

`resolveOwnerFromSession` collapsed three outcomes into one `null`: no session, a session with no `Owner` row, and **a database that could not be queried**. `requireOwner()` answers `null` with `redirect('/login')`, so a database outage was being reported to the visitor as "you are not logged in".

That is wrong on its own terms — the code has no evidence about the visitor's identity, only about its own inability to look — and in combination with the middleware it is worse than wrong. The middleware asks a different system: Supabase Auth, which is still up and still says the session is valid. So it bounces the visitor off `/login` back to the dashboard, whose `requireOwner()` bounces them to `/login` again. The result is an infinite redirect loop ending in a browser-generated error page: English, unexplained, no way out. The Supabase free tier pauses PostgreSQL while Auth keeps serving, so this is the *expected* outage shape for this project, not an exotic one.

The fix is to separate the two questions. A completed lookup that returns no row is an answer, and the redirect stays. A lookup that could not run is a failure, and it propagates so the route error boundary renders the Spanish message and its retry control — the same boundary M1 already relies on for the list read.

*Alternative considered:* patch the middleware to stop bouncing authenticated visitors off `/login` under some error condition. Rejected — it removes the symptom while leaving the lie in place, and would strand the owner on a login page they do not need with no explanation of why the dashboard refused them.

*Why the asymmetry is safe:* the change only ever converts a redirect into an error. It never converts a denial into access. The "session with no `Owner` row" path is unchanged and is pinned by its own test, so widening access is not a way this can fail.

*Scope note:* this is A1 code, shared by every dashboard route, so the fix improves the whole panel rather than the locations pages alone. Per `docs/base-standards.md` §7 it is not a code-only fix — the `owner-authentication` delta spec in this change carries the updated requirement.

## Risks / Trade-offs

- **Prisma's `mode: 'insensitive'` may compile to `ILIKE`, making `%` and `_` in a submitted name behave as wildcards** → this would make "Sucursal 50%" collide with "Sucursal 500" and report a duplicate that is not one.
  **Resolved during implementation by removing the question rather than answering it:** `existsByOwnerAndName` does not use `mode: 'insensitive'` at all. It selects the owner's names — a set bounded by `MAX_LOCATIONS_PER_OWNER` — and compares them lowercased in memory, so no pattern-matching operator ever sees user input. Two tests pin the behaviour: `%` and `_` are literal, and a name that genuinely contains them still matches case-insensitively. The trade-off is reading N names instead of using an index, which at a cap in the tens is not a cost worth an empirical investigation into Prisma's SQL generation. The constraint (D2) remains the guarantee either way.
- **The unique-constraint migration aborts if duplicate `(ownerId, name)` pairs already exist**, and takes a lock on a live table → query for duplicates before generating it. Only seeded rows exist today, so the window to do this cheaply is now.
- **DDL over the wrong connection** → migrations run over `DIRECT_URL` (session-mode pooler, port 5432); the runtime stays on transaction mode (6543). The S0 findings record that the direct Postgres host is IPv6-only and unreachable from this network, so the session pooler is the only path.
- **Double submit before hydration** → the disabled-while-pending state depends on JavaScript having loaded. For create, the unique constraint absorbs the second request, which is a genuine dividend of D2; for edit, the operation is idempotent. The residual is cosmetic: the second response must not present a successful outcome as a failure.
- **A stale tab meeting a missing Server Action** (tech-debt **T1**) → a half-filled create form is the worst place to hit that dead end. M1 does not fix T1; it raises the value of fixing it, and the entry's trigger ("before shipping the public booking flow") stands.
- **T3 closes only partially** (D4) → recorded in `docs/tech-debt.md` with the remaining item and its trigger intact, rather than marking the entry done.
- **Silent loss on concurrent edits** (D5) → accepted, documented, trigger recorded.

## Migration Plan

1. Query production for duplicate `(ownerId, name)` pairs. Proceed only if none exist.
2. Add `@@unique([ownerId, name])` and `@@index([ownerId, isActive])` to `prisma/schema.prisma`; generate the migration; read the generated SQL before applying it.
3. Apply over `DIRECT_URL`; regenerate both Prisma clients (the `workerd` client and the CLI client used by seed and provisioning).
4. Ship application code. The constraint is additive and no existing read breaks, so schema and code need not deploy together.
5. **Rollback:** dropping the unique index restores the previous state exactly; no data is transformed and nothing is destroyed. This is the cheap direction — unlike A1's FK, there is no backfill to undo.

## Open Questions

- **The exact cap value in D6.** A single-owner barbershop chain in Argentina is realistically under ten branches; the constant will be set generously (order of tens) so it never obstructs a real business while still bounding runaway writes. Worth a second look if the product ever serves franchises.
- **Whether `Location` should eventually own richer behaviour.** Today it gains only name normalization. If M2 and M3 keep pushing rules into `LocationService`, the entity is the place they belong — not a decision to force now, but a shape to watch.
