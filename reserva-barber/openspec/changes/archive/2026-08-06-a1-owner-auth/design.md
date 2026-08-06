## Context

S0 validated the deploy stack and left the scaffold: layered `src/server/` tree, Prisma 7.8 with the `prisma-client` generator (`runtime = "workerd"`), the `Location` model with a plain-`String` `ownerId` (placeholder `SEED_OWNER_ID`), and a public home page listing active locations. There is no `Owner` model, no auth, no dashboard.

A1 introduces the single administrative identity and the protected dashboard shell every Phase 1 story builds on. The auth mechanism was decided during refinement: **Supabase Auth** (email/password) — the Supabase project already exists, and hand-rolling password hashing + session management on `workerd` is fragile (native crypto/bcrypt availability) and duplicates what the stack provides.

Constraints: TypeScript strict, DDD layering per `docs/backend-standards.md`, Spanish (es-AR) copy isolated per `docs/frontend-standards.md`, three-environment verification gate (dev → workerd preview → deployed) per S0's pattern, spec-first policy (docs updated with the code), ~$0 budget.

## Goals / Non-Goals

**Goals:**
- Owner can log in and log out; all `(dashboard)` routes and server actions require a valid session.
- `Owner` model exists in Prisma/Postgres; `Location.ownerId` is a real FK; S0's placeholder rows are backfilled safely.
- The S0 location list moves into the authenticated dashboard home; the public home page no longer exposes it.
- Auth pattern (middleware + layout re-check + per-action re-check) established for all later dashboard stories.
- `docs/data-model.md` §1 updated: `authUserId` replaces `passwordHash` (spec-first).

**Non-Goals:**
- No self-registration, password recovery, or email verification flows (single owner, provisioned by script; recovery deferred until real usage demands it — owner can be re-provisioned via Supabase dashboard meanwhile).
- No barber logins, roles, or multi-tenancy.
- No dashboard navigation/sidebar beyond a minimal header (M1+ builds the real shell out).
- No `BusinessProfile`/`PaymentConfig` relations (P1/PC1-2).
- No public `/b/[slug]` route — the public home page becomes a placeholder (B1 owns the public presence).

## Decisions

### D1 — Supabase Auth with `@supabase/ssr` cookie sessions
Email/password provider on the existing Supabase project, sign-ups **disabled**. Sessions ride in HttpOnly/Secure/SameSite=Lax cookies managed by `@supabase/ssr` (`getAll`/`setAll` cookie adapter — the only non-deprecated API). *Alternative considered:* custom credentials (argon2 + signed cookie) — rejected: more security surface, hashing libraries are unreliable on workerd, and session refresh comes free with Supabase. **Risk accepted:** `@supabase/ssr` on workerd is the new S0-style unknown; it is gated by the preview environment before deploy (see Risks).

### D2 — `Owner.authUserId` links domain to auth; email duplicated in both
The domain `Owner` row carries `authUserId` (unique, maps to `auth.users.id`) and `email` (unique, normalized lowercase). Auth concerns (password, tokens) live entirely in Supabase; the domain never stores credentials. `data-model.md` §1's `passwordHash` note resolves to this mapping. *Alternative:* store only `authUserId` and read email from auth — rejected: dashboard queries and future stories (client dedup per owner) need the email relationally without an auth API call.

**Source of truth for email:** Supabase Auth is authoritative; `Owner.email` is a denormalized copy. Sessions resolve through `authUserId` (never through email), so a divergence cannot break login — it only makes the displayed email stale. Re-running `scripts/provision-owner.ts` refreshes the copy; changing the owner's email is therefore a two-step operation (Supabase dashboard, then re-run the script), documented in the README.

### D3 — Three-layer guard: middleware, layout, actions
`middleware.ts` gives fast redirects (no session → `/login`; session on `/login` → `/`). The `(dashboard)/layout.tsx` re-checks the session server-side (middleware matchers can be bypassed by RSC payload requests or future route additions). Every server action calls a `requireOwner()` helper that resolves the session + `Owner` row or throws a redirect. *Alternative:* middleware only — rejected explicitly by `backend-standards.md` ("enforce auth in middleware and re-check in each server action").

### D4 — `requireOwner()` as the single auth chokepoint
One helper in `src/server/infrastructure/supabase/` resolves session → `authUserId` → domain `Owner` (via `IOwnerRepository`), caching per request (React `cache()`). Every protected page/action uses it. Establishes the pattern M1+ copies; avoids scattering session parsing.

### D5 — Additive three-step FK migration with in-migration backfill
Single migration file, three statements: (1) create `Owner` table; (2) `INSERT` the owner row with a **fixed known cuid** and `UPDATE "Location" SET "ownerId" = <owner id> WHERE "ownerId" = 'SEED_OWNER_ID'`; (3) add the FK constraint. The `authUserId` column is nullable at migration time and set by the provisioning script (auth users cannot be created from SQL migrations). *Alternative:* backfill in a separate script before a constraint-only migration — rejected: two-step deploys invite running the constraint against unbackfilled data. Rollback = drop constraint + drop table (locations revert to orphan strings, acceptable pre-production).

### D6 — Owner provisioning script, not seed-embedded
`prisma/seed.ts` seeds domain data only (idempotent, as in S0, now referencing the fixed owner id). A separate `scripts/provision-owner.ts` (run once per environment with the **service-role key**, never bundled) creates the Supabase auth user with the owner's email and writes `authUserId` onto the `Owner` row. Idempotent: looks up by email first. *Alternative:* create the auth user inside `seed.ts` — rejected: seed must stay runnable with only `DIRECT_URL`, and the service-role key should not be a seed dependency.

### D7 — Login via Server Action; generic errors; bounded calls; quantified throttling
`app/login/actions.ts` validates with Zod (trim + lowercase email), calls `signInWithPassword`, and returns a single generic failure message ("Email o contraseña incorrectos.") for any credential error — no enumeration, no field-level detail. Infrastructure failures return the distinct generic message "No pudimos iniciar sesión. Intentá de nuevo más tarde." plus one structured English error log.

**Bounded, no retry.** Every auth provider call carries an explicit **5-second timeout** (`AbortSignal.timeout`), mirroring S0's bounded-DB-read decision (D5 there): a hung provider must degrade into the infrastructure error rather than burn Worker time. Failures are **not** retried automatically — a retry doubles worst-case latency and, for credential errors, is meaningless; the owner retries by resubmitting.

**Throttling.** Supabase Auth provides baseline rate limiting on its endpoint; the action adds an in-memory counter as defense-in-depth: **5 failed attempts per (email + IP) within 15 minutes → 60-second cooldown**, reset on success. Throttled attempts return the *credential* error, not a distinct "too many attempts" message — a distinguishable throttle response would confirm that an email exists. Best-effort on Workers (per-isolate memory; see Risks).

### D8 — Same-origin-only post-login redirect
Login accepts an optional `next` param (set by middleware on redirect). Only relative paths starting with `/` and not `//` are honored; anything else falls back to `/`. Prevents open redirects.

### D9 — Protected pages are dynamic and non-cacheable
All `(dashboard)` pages render dynamically (`force-dynamic` inherited from the data reads) with `Cache-Control: no-store` semantics so Back-button/bfcache after logout cannot show stale protected content. Logout calls Supabase `signOut` (invalidates refresh token server-side), clears cookies, and redirects to `/login`.

### D10 — `/` becomes the dashboard home directly; no public placeholder
**Correction during implementation:** the original plan ("replace `app/page.tsx` with a public placeholder, move the list into `app/(dashboard)/page.tsx`") is impossible — route groups add no URL segment, so `app/page.tsx` and `app/(dashboard)/page.tsx` would both resolve to `/`, which Next.js rejects as a duplicate route at build time.

`docs/frontend-standards.md`'s canonical route table already settles this: it lists `(dashboard)/page.tsx` at `/` and the public flow at `/b/[slug]` (B1) — it never lists a public `app/page.tsx`. So the correct move is: **delete** `app/page.tsx`, `app/loading.tsx`, and `app/error.tsx` (S0's public versions) and recreate them under `app/(dashboard)/` unchanged. `/` becomes the protected dashboard home; there is no placeholder to build or maintain. *Alternative considered (original plan):* keep a public placeholder at `/` — rejected as both impossible (routing conflict) and unnecessary (no roadmap story ever puts public content at bare `/`; B1 owns `/b/[slug]`).

### D11 — Errors render inline, not as toasts
Login failures render in an `aria-live="polite"` region directly below the form. Inputs stay enabled with the email preserved and the password cleared, and focus moves to the error region so screen readers announce it. *Alternative:* toast notifications — rejected: a transient toast is easy to miss, disappears before a screen reader finishes, and detaches the error from the field the owner must correct. This is the presentation pattern later dashboard forms (M1+) copy.

### D12 — Keep `middleware.ts`, do not migrate to `proxy.ts`
Next.js 16 deprecates the `middleware.ts` convention in favor of `proxy.ts` (renamed export, same file-based hook). `next dev` emits a deprecation warning but `middleware.ts` still works. **This change does not migrate**, because `proxy.ts` forces the Node.js runtime and is not configurable to run on Edge, while `middleware.ts` defaults to the Edge runtime — the one `@opennextjs/cloudflare` was built and validated against in S0. Next.js's own migration guidance states: "If you want to continue using the edge runtime, keep using middleware." Adopting `proxy.ts` here would introduce an unvalidated workerd-compatibility risk into security-critical auth-guard code, exactly what S0 exists to avoid. Revisit only after `proxy.ts` + OpenNext + workerd compatibility is explicitly verified, as its own follow-up.

### D13 — Logging is an injected port, not a direct infrastructure import
`AuthService` needs to log, but `project-scaffold`'s layering rule forbids application modules from
importing `src/server/infrastructure/**`. The logger is therefore an outbound port (`ILogger` in
`src/server/domain/repositories/`, alongside `IAuthProvider`) injected through the constructor; the call
sites in `app/**` wire the infrastructure logger. *Alternative:* import `logger` directly — rejected: it
violates the dependency direction the scaffold spec enforces with an explicit scenario, and it makes the
service untestable without stubbing a module. Every later service that logs follows this pattern.

### D14 — Constant-time login floor closes a measured enumeration oracle
The anti-enumeration requirement covers "observable timing", and an adversarial pass found the
implementation did not honour it. Measured against the live provider, interleaved, 6 pairs:

| | unknown email | real email + wrong password |
| --- | --- | --- |
| range | 85–99 ms | 163–178 ms |
| mean | ~92 ms | ~170 ms |

The distributions do not overlap — a single request reveals whether an address is registered, because
only the existing-user path runs a password comparison. `AuthService.login()` therefore pads every
outcome to `MIN_LOGIN_DURATION_MS` (500 ms), above both observed paths. Time and sleep come from an
injected `IClock`, so tests assert the padding without waiting.

*Alternative:* accept the leak and weaken the spec — defensible in isolation (there is exactly one
account, and its address already appears in a committed migration), but rejected: the property is cheap
to actually provide, and a spec asserting a security guarantee the code does not deliver is worse than
either honest option. Successful logins are padded too, so the floor needs no branching to reason about.
*Trade-off:* every login now costs at least 500 ms — imperceptible for an admin sign-in.

## Risks / Trade-offs

- **[`@supabase/ssr` misbehaves on workerd]** (cookie adapters, fetch, token refresh) → same protocol as S0: the workerd preview is the gate; failures stop the change and any workaround lands in `docs/s0-versions-decision.md`. Mitigation groundwork: use only the cookie-adapter API, no Node-specific imports.
- **[Middleware/matcher gaps leave a route unguarded]** → D3's layout + `requireOwner()` re-checks make middleware an optimization, not the security boundary; specs include a direct-URL access scenario.
- **[Migration runs against a DB whose placeholder differs]** → the `UPDATE` matches the exact `SEED_OWNER_ID` literal; migration fails loudly on FK creation if any row remains unbackfilled (that failure is the safety net, not a bug). Verified against the seeded database before deploy.
- **[Auth user and Owner row drift]** (provisioning half-completes) → provisioning script is idempotent and re-runnable; `authUserId` nullable until set; login fails closed (no `Owner` row with matching `authUserId` → generic error + error log).
- **[In-memory throttling resets per isolate]** (an attacker hitting different isolates gets a fresh 5-attempt budget) → accepted at $0; Supabase's own auth rate limits are the real backstop and the counter still blunts naive single-connection spraying. Revisit with Cloudflare Rate Limiting when traffic is real.
- **[Session refresh races with streamed RSC responses]** (cookies set after headers sent) → follow `@supabase/ssr` middleware-refresh pattern: refresh happens in `middleware.ts`, pages only read.

## Migration Plan

1. Enable email/password provider in Supabase Auth; disable sign-ups.
2. Apply the A1 migration via `DIRECT_URL` (creates `Owner`, backfills, adds FK); run `prisma db seed` (updated) and verify 1 owner + 2 locations.
3. Run `scripts/provision-owner.ts` (service-role key, local env only) → auth user created, `authUserId` set.
4. Verify environment 1 (`next dev`): login, guarded routes, logout.
5. Verify environment 2 (`npm run preview` on workerd) — **gate**, per S0 protocol.
6. Set new Wrangler secrets (`SUPABASE_URL`, `SUPABASE_ANON_KEY`); deploy; verify environment 3 on the deployed URL.
7. Update `docs/data-model.md`, `README.md` (provisioning + env vars), and append any workerd findings to `docs/s0-versions-decision.md`.

Rollback: redeploy previous Worker version; DB rollback = drop FK + `Owner` table (pre-production, acceptable).

## Open Questions

- None blocking. (Supabase Auth free-tier rate limits are conservative but sufficient for a single owner; revisit only if login UX degrades.)
