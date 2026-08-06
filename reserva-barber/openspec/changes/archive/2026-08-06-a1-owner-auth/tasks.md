## 1. External Provisioning & Spec-First Docs

- [x] 1.1 Enable the email/password provider in Supabase Auth for the existing project; disable sign-ups
- [x] 1.2 Update `docs/data-model.md` §1 (Owner): replace `passwordHash` with `authUserId` (unique, maps to `auth.users.id`), per design D2 — spec-first, before code
- [x] 1.3 Add `@supabase/ssr` and `@supabase/supabase-js` to dependencies

## 2. Data Layer — Owner Model & FK Backfill

- [x] 2.1 Add the `Owner` model to `prisma/schema.prisma` per the updated `data-model.md` §1: `id` (cuid PK), `email` (VarChar 255, unique), `authUserId` (unique, nullable), `createdAt`, `updatedAt`; add the `locations` relation
- [x] 2.2 Write the single migration (design D5): (1) create `Owner` table, (2) insert the owner row with a fixed known id and `UPDATE "Location" SET "ownerId" = <owner id> WHERE "ownerId" = 'SEED_OWNER_ID'`, (3) add `Location.ownerId → Owner.id` FK constraint
- [x] 2.3 Run the migration against Supabase via `DIRECT_URL`; verify the `Owner` table exists, both S0 locations reference the real owner, and the FK constraint is active
- [x] 2.4 Update `prisma/seed.ts`: seed domain data only, reference the fixed owner id, remove the `SEED_OWNER_ID` placeholder constant, create no `Owner` row; run twice and verify exactly 1 owner + 2 locations with unchanged ids
- [x] 2.5 Write `scripts/provision-owner.ts` (service-role key, never bundled client-side): idempotent lookup-by-email, create the Supabase auth user if absent, write `authUserId` onto the `Owner` row, and **refuse to run** if an `Owner` row with a different email exists
- [x] 2.6 Run the provisioning script locally; verify re-running it creates no duplicate auth user, `Owner.authUserId` is set, and running it with a different email exits with an English error without writing anything

## 3. Domain & Application Layer (TDD: failing tests first)

- [x] 3.1 Write failing tests for `AuthService` (mocked `IOwnerRepository` + mocked auth client): successful login, invalid credentials (indistinguishable error for unknown-email vs wrong-password), infrastructure failure, timeout, logout, session resolution
- [x] 3.2 Implement `src/server/domain/models/Owner.ts` (zero-dependency entity) and `src/server/domain/repositories/IOwnerRepository.ts` (`findByAuthUserId`, `findByEmail`)
- [x] 3.3 Implement `src/server/application/services/AuthService.ts` against the interfaces, with the 5-second `AbortSignal.timeout` on every provider call and no automatic retry (design D7); make 3.1 tests pass
- [x] 3.4 Write failing tests for `isSafeRedirect()`: relative path accepted; `//evil.com`, `https://evil.com`, backslash and percent-encoded variants, and empty input all fall back to the dashboard home
- [x] 3.5 Implement `src/server/application/auth/isSafeRedirect.ts` (application layer so the 90% coverage gate enforces this security control); make 3.4 tests pass
- [x] 3.6 Write failing tests for the login throttling policy: under threshold, at threshold (6th attempt rejected without calling the provider), cooldown expiry after 60s, counter reset on success, and that the throttled response is the generic credential error
- [x] 3.7 Implement `src/server/application/auth/loginThrottle.ts` (5 failures per email+IP / 15 min → 60s cooldown, per design D7); make 3.6 tests pass
- [x] 3.8 Write failing tests for `PrismaOwnerRepository` (`toDomain` mapping; lookups; mocked Prisma client)
- [x] 3.9 Implement `src/server/infrastructure/prisma/PrismaOwnerRepository.ts`; make 3.8 tests pass
- [x] 3.10 Verify coverage ≥ 90% on domain + application layers (`npm run test:coverage`)

## 4. Supabase Auth Client & Session Guard

- [x] 4.1 Implement `src/server/infrastructure/supabase/authClient.ts`: `@supabase/ssr` client factory using only the cookie-adapter API (no Node-specific imports), for workerd compatibility
- [x] 4.2 Write failing tests for `requireOwner()` deny paths (mocked auth client + repository): no session → denied; session whose `authUserId` matches no `Owner` row → denied and logged
- [x] 4.3 Implement `requireOwner()` (design D4): resolves session → `authUserId` → domain `Owner` via `IOwnerRepository`, cached per request (React `cache()`); make 4.2 tests pass
- [x] 4.4 Implement session refresh in `middleware.ts` (per D3/D9: refresh happens here so cookies are set before the response streams)
- [x] 4.5 Implement the middleware redirect guard: unauthenticated on `(dashboard)` routes → `307` to `/login?next=<path>`; authenticated on `/login` → `307` to the dashboard home

## 5. Login & Logout

- [x] 5.1 Add the Spanish copy to `src/lib/copy.ts`: login idle/submitting labels, credential error `"Email o contraseña incorrectos."`, infrastructure error `"No pudimos iniciar sesión. Intentá de nuevo más tarde."`, logout label
- [x] 5.2 Implement the login Zod schema (trim + lowercase email, valid email format, non-empty password) with its unit tests — validation before business logic
- [x] 5.3 Implement `app/login/page.tsx`: email + password form, submit disabled with loading indicator while pending, double-submit prevented, inline `aria-live="polite"` error region below the form (design D11)
- [x] 5.4 Implement `app/login/actions.ts`: schema (5.2) → throttle check (3.7) → `AuthService` (3.3) → generic error mapping; returns `200` with form-error state on failure, never `401`
- [x] 5.5 Wire `isSafeRedirect()` (3.5) into the post-login redirect so only same-origin relative `next` values are honored
- [x] 5.6 Implement the logout server action: `requireOwner()` re-check, Supabase `signOut`, clear session cookies, redirect to `/login`

## 6. Protected Dashboard Shell

- [x] 6.1 Create `app/(dashboard)/layout.tsx`: server-side `requireOwner()` re-check (redirect to `/login` on failure), minimal header (owner email, "Cerrar sesión"), dynamic rendering / no-store semantics (design D9)
- [x] 6.2 Move the S0 location list into `app/(dashboard)/page.tsx`, and relocate `app/loading.tsx` + `app/error.tsx` into `app/(dashboard)/` alongside it (unchanged content); delete the root `app/page.tsx`, `app/loading.tsx`, `app/error.tsx` — per design D10 (corrected), `/` is the dashboard home directly, there is no public placeholder, since `docs/frontend-standards.md` never lists a public page at `/`

## 7. Local Verification — Environment 1 (next dev)

- [x] 7.1 Successful login redirects to the dashboard home and renders the seeded locations
- [x] 7.2 Unknown-email and wrong-password attempts return the identical generic message with no observable difference in shape
- [x] 7.3 ` Owner@Example.com ` (padded, mixed case) authenticates as `owner@example.com`
- [x] 7.4 Direct URL access to a protected route while unauthenticated redirects (`307`) to `/login`, and logging in resumes the originally requested path; an external `next` value falls back to the dashboard home
- [x] 7.5 An authenticated visitor opening `/login` is redirected to the dashboard home
- [x] 7.6 Logout clears the session: replaying the previous cookie value and pressing Back no longer show protected content
- [x] 7.7 Inspect the session cookie: `HttpOnly`, `Secure`, and `SameSite=Lax` are all present
- [x] 7.8 Simulate an auth provider outage (unreachable `SUPABASE_URL`): the generic Spanish infrastructure message renders within the 5-second timeout, one structured English error log is emitted, and no provider detail appears in the response
- [x] 7.9 A session whose `authUserId` has no `Owner` row is denied and the mismatch is logged
- [x] 7.10 Throttling triggers on the 6th failed attempt (generic credential error, no provider call) and releases after the 60-second cooldown
- [x] 7.11 The public home page response contains no location names, addresses, or database-derived content
- [x] 7.12 The domain schema contains no column storing passwords, hashes, or session tokens
- [x] 7.13 `npm run lint`, `npm run typecheck`, `npm test` all clean

## 8. Cloudflare Pipeline — Environments 2 & 3 (three-environment gate)

- [x] 8.1 Add `SUPABASE_URL` and `SUPABASE_ANON_KEY` to `.env.example` and `.dev.vars`
- [x] 8.2 **GATE:** `npm run preview` (local workerd): repeat 7.1–7.12 against the workerd runtime — if session cookies, the auth call, or the timeout behave differently, stop and trigger the stack-revisit protocol, recording findings in `docs/s0-versions-decision.md`
- [x] 8.3 Set the production secrets: `wrangler secret put SUPABASE_URL`, `wrangler secret put SUPABASE_ANON_KEY`
- [x] 8.4 Run the provisioning script against the production Supabase project (or confirm the owner already exists there)
- [x] 8.5 `npm run deploy`; repeat 7.1–7.12 against the deployed URL

## 9. Documentation & Close-out

- [x] 9.1 Update `README.md`: owner provisioning step, the two-step email-change procedure (design D2), new env vars, and the note that the public home page no longer lists locations
- [x] 9.2 Append any workerd-specific auth findings/workarounds to `docs/s0-versions-decision.md`
- [x] 9.3 Final quality gates: lint, typecheck, tests + coverage all green; confirm no secrets (including the service-role key) in tracked files or git history
