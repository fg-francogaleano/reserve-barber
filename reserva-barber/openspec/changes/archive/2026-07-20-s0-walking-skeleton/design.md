## Context

Reserva Barber's stack (per `docs/project-context.md`) hinges on an unproven combination: Next.js (App Router) adapted to Cloudflare's `workerd` runtime by `@opennextjs/cloudflare`, querying Supabase Postgres with Prisma driver adapters (`@prisma/adapter-pg`) through the Supavisor pooler. The repo currently holds a bare `create-next-app` scaffold (Next.js 16.2.10, React 19, Tailwind v4, ESLint 9) — no Prisma, no tests, no deploy pipeline, no layered structure.

S0 builds the thinnest end-to-end slice that exercises every layer: a seeded `Location` list rendered on the deployed app. `docs/roadmap.md` (Dependency Notes) mandates that if S0 fails, the stack decision is revisited before any feature work.

Constraints: budget ~$0 (free tiers), Cloudflare hosting is a hard requirement, TypeScript strict, DDD layering per `docs/backend-standards.md`, Spanish (es-AR) user copy per `docs/frontend-standards.md`.

## Goals / Non-Goals

**Goals:**
- Prove the deploy stack: page renders DB data in `next dev`, `npm run preview` (workerd), and the deployed Cloudflare URL.
- Leave behind the permanent scaffold: layered `src/server/` tree, Prisma + migration + seed, Vitest with coverage gates, shadcn/ui, Prettier, logger stub, env validation, deploy scripts.
- Establish the UI state pattern (loading/empty/error, Spanish copy isolated) that every later page follows.
- Record the validated version matrix as a decision note.

**Non-Goals:**
- No auth (A1), no location CRUD (M1), no dashboard shell or navigation, no `/b/[slug]` route.
- No entities beyond `Location`; no `Owner` model or FK constraint (deferred to A1).
- No Playwright/E2E suite (lands with the booking flow).
- No rate limiting or caching beyond Next.js defaults (revisit when real traffic exists).

## Decisions

### D1 — Verify OpenNext/Next compatibility before writing code; pin Next.js if needed
`@opennextjs/cloudflare` support for Next.js 16.2.x must be checked first. If unsupported, pin Next.js down to the latest supported minor as part of this change and record it. *Alternative considered:* proceed and hope — rejected; this is the exact risk S0 exists to surface, and a version pin is cheapest at day zero.

### D2 — Server Component read, no REST endpoint
The location list is fetched in `app/page.tsx` (RSC) calling the application service directly. *Alternative:* a `GET /api/locations` Route Handler — rejected; `backend-standards.md` reserves Route Handlers for public/webhook endpoints, and an extra HTTP hop adds latency and surface without proving anything additional.

### D3 — Full DDD layering even for one query
`LocationService` → `ILocationRepository` → `PrismaLocationRepository` with a `toDomain` mapper. *Alternative:* inline Prisma call in the page — rejected; the walking skeleton's purpose includes validating the architecture pattern and seeding the folder structure all later stories copy.

### D4 — `ownerId` as plain column with documented placeholder constant
`Location.ownerId` ships as a non-FK `String`; the seed uses one exported constant (`SEED_OWNER_ID`). A1 introduces `Owner` and a migration adding the FK. *Alternative:* ship a minimal `Owner` model now — viable, but widens S0's surface and duplicates A1's design work. The deferral is recorded here and must be referenced in A1's spec.

### D5 — Two connection URLs: pooler for runtime, direct for migrations
Runtime uses the Supavisor transaction-mode pooler (port 6543) via `PrismaPg`; `prisma migrate` uses `DIRECT_URL` (port 5432). Rationale: migrations hang through transaction-mode pooling; Workers need pooled connections. Both documented in `.env.example`; explicit connection timeout configured so hung connections degrade into the error state within bounded time.

### D6 — Route-level `loading.tsx` + `error.tsx` for UI states
Skeleton cards during slow reads (paused Supabase wake-up), generic Spanish error boundary with retry, empty state distinct from error state (missing table `P2021` → error, empty result → empty). No stack traces or connection strings ever reach the response body.

### D7 — Spanish copy in a constants module
All user-facing strings live in one copy module imported by components; logs and errors stay English. Establishes the isolation pattern `frontend-standards.md` requires before the string count grows.

### D8 — Seed idempotent via upsert-by-name
`prisma/seed.ts` upserts 2 locations keyed by name, keeping stable ids across runs and safe re-execution against any environment.

## Risks / Trade-offs

- **[OpenNext incompatible with Next 16.2.x]** → D1: verify first, pin to supported minor, record decision. Worst case: stack revisit per roadmap protocol — which is S0 doing its job.
- **[Works in `next dev`, fails on `workerd`]** (Node built-ins, adapter issues, bundle limits) → three-environment gate in strict order (dev → preview → deployed); preview is the pass/fail gate, failures never reach deploy.
- **[Supabase free tier auto-pauses after inactivity]** → loading skeleton covers wake-up latency; error boundary covers hard failure; bounded query timeout prevents Worker hangs. Accepted trade-off at $0 budget.
- **[Connection spike from concurrent isolates]** → transaction-mode pooler absorbs it; read-only page, no correctness risk. Accepted for S0; caching/rate limiting revisited when traffic is real.
- **[Secret leakage]** → `.dev.vars`/`.env*` git-ignored before first commit; secrets only via `wrangler secret put`; error boundary guarantees no connection string in responses; rotation mandated if history is ever contaminated.
- **[Migration/runtime URL swap]** (migrate through pooler hangs; runtime on direct port exhausts connections) → distinct env var names, documented in `.env.example`, called out as an explicit task checklist item.
- **[Placeholder `ownerId` orphans rows]** → single exported constant, documented for A1's FK backfill.

## Migration Plan

Greenfield — no rollback concerns. Deploy order: (1) Supabase project + migration + seed via `DIRECT_URL`; (2) local verification `next dev`; (3) `npm run preview` on workerd — **gate**; (4) `wrangler secret put DATABASE_URL`; (5) `npm run deploy`; (6) verify deployed URL; (7) write decision note. Rollback = `wrangler` deploy of previous version (or delete the Worker); DB is additive-only.

## Open Questions

- Exact `@opennextjs/cloudflare`-supported Next.js version at implementation time (resolved by D1's verification step, first task).
- Supabase region choice (pick closest to AR users; low stakes for the skeleton, becomes fixed afterwards).
