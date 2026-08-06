## Why

The dashboard that every Phase 1 story (M1, M3, P1, PC1, PC2) builds on does not exist yet, and nothing protects administrative functionality: S0 deliberately shipped the location list on a public page with a placeholder `ownerId` and no `Owner` model. A1 introduces the single administrative identity (the **Owner**), authentication in front of the dashboard, and pays off the S0 deferral by converting `Location.ownerId` into a real foreign key (design D4 of the archived S0 change; `docs/s0-versions-decision.md`).

## What Changes

- Introduce the `Owner` model in Prisma and the database, and add the `Location.ownerId → Owner.id` FK constraint, backfilling the seeded `SEED_OWNER_ID` placeholder with the real owner row (migration must be additive-safe: insert owner → update locations → add constraint).
- **Auth mechanism decided:** Supabase Auth (email/password) with `@supabase/ssr` cookie sessions. `Owner.passwordHash` from `data-model.md` §1 is replaced by `Owner.authUserId` (unique, maps to `auth.users.id`) — `docs/data-model.md` is updated in this change (spec-first).
- Add a public login page (`app/login`) with a Server Action for sign-in, and a logout action in the dashboard shell. No self-registration: the single owner is provisioned by script/seed.
- Add the auth guard: `middleware.ts` session check on `(dashboard)` routes plus server-side re-check in the dashboard layout and every server action (never trust middleware alone).
- Create the `(dashboard)` route group with a minimal authenticated shell (header, owner identity, "Cerrar sesión") and **move the S0 location list from the public home page into the dashboard home** — **BREAKING**: the location list is no longer publicly accessible.
- Extend the layered architecture: `Owner` domain entity, `IOwnerRepository`, `AuthService` (TDD), `PrismaOwnerRepository`, Supabase auth client factory validated on `workerd` through the three-environment gate (dev → preview → deployed).
- Security hardening from the edge-case analysis: generic credential errors (no user enumeration), login throttling, HttpOnly/Secure/SameSite cookie, same-origin-only post-login redirect, full session invalidation on logout, no cached protected pages after logout.
- New environment variables (`SUPABASE_URL`, `SUPABASE_ANON_KEY`) documented in `.env.example` and set as Wrangler secrets.

## Capabilities

### New Capabilities

- `owner-authentication`: Owner login/logout with Supabase Auth cookie sessions; middleware + server-side guarding of all `(dashboard)` routes and server actions; anti-enumeration, throttling, session-invalidation and redirect-safety requirements; Spanish (es-AR) UI states for the login flow.

### Modified Capabilities

- `data-persistence`: Adds the `Owner` model as a first-class entity; `Location.ownerId` becomes a real FK with a safe backfill migration of the S0 placeholder; seed provisions the owner (auth user + `Owner` row, atomically consistent) before locations and drops the `SEED_OWNER_ID` constant.
- `location-listing`: The active-locations list moves from the public home page to the authenticated dashboard home; the requirement that it renders on the *public* home page is replaced by rendering inside the protected `(dashboard)` shell. UI states (loading/empty/error) carry over unchanged.

## Impact

- **Code:** new `middleware.ts`, `app/login/**`, `app/(dashboard)/**` (layout + relocated home), `src/server/domain/models/Owner.ts`, `src/server/domain/repositories/IOwnerRepository.ts`, `src/server/application/services/AuthService.ts`, `src/server/infrastructure/prisma/PrismaOwnerRepository.ts`, `src/server/infrastructure/supabase/authClient.ts`; modified `prisma/schema.prisma`, `prisma/seed.ts`, `src/lib/copy.ts`, `app/page.tsx` (removed/relocated).
- **Dependencies added:** `@supabase/ssr`, `@supabase/supabase-js`.
- **Docs:** `docs/data-model.md` §1 updated (`authUserId` replaces `passwordHash`); `README.md` gains owner-provisioning and new env vars; any `workerd` quirks appended to `docs/s0-versions-decision.md`.
- **External systems:** Supabase Auth enabled on the existing project (email/password provider, sign-ups disabled); two new Wrangler secrets.
- **Data migration:** one migration creating `Owner` and adding the FK with backfill — must be verified against the seeded database before deploy; rollback is non-trivial once the FK exists (restore = drop constraint).
- **Downstream:** unblocks M1, M3, P1, PC1, PC2; establishes the auth pattern every later dashboard story re-checks in its server actions.
