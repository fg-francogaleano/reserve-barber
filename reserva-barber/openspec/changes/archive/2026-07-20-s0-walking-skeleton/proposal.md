## Why

The riskiest architectural assumption of Reserva Barber is unproven: Next.js (App Router) deployed to Cloudflare's `workerd` runtime via `@opennextjs/cloudflare`, using Prisma with driver adapters (`@prisma/adapter-pg`) through the Supabase Supavisor pooler. If this combination fails, the entire stack decision must be revisited before any feature work (see `docs/roadmap.md` → Dependency Notes). S0 builds the thinnest end-to-end slice — a seeded `Location` list rendered from the real database on the deployed app — to validate the stack and leave behind the project scaffold every later story depends on.

## What Changes

- Complete the project scaffold on top of the existing `create-next-app` output: Prettier (+ Tailwind plugin), Vitest (with 90% coverage threshold on domain/application layers), shadcn/ui, `@/*` path alias.
- Introduce the layered DDD folder structure `src/server/{domain,application,infrastructure}` per `backend-standards.md`.
- Add Prisma with the `Location` model only (per `data-model.md` §4), initial migration, and an idempotent seed script (2 locations).
- Configure the Prisma client with the `PrismaPg` driver adapter pointed at the Supavisor pooler URL (runtime) and a direct URL for migrations.
- Render the home page (`app/page.tsx`, Server Component) listing active locations through the layered read path (service → repository interface → Prisma implementation), with loading, empty, and error states in Spanish (es-AR).
- Add the Cloudflare deploy pipeline: `@opennextjs/cloudflare`, Wrangler config, `.dev.vars` / `.env.example`, secrets via `wrangler secret put`, `preview` and `deploy` scripts.
- Add a minimal structured JSON logger stub and fail-fast environment validation.
- Record the validated stack versions (Next.js / OpenNext / Prisma adapter config on `workerd`) as a decision note.

## Capabilities

### New Capabilities

- `location-listing`: Public home page renders the list of active locations read from the database through the layered architecture, with defined loading, empty, and error states; no secrets or technical details ever exposed to visitors.
- `project-scaffold`: Development toolchain and layered structure — TypeScript strict, ESLint/Prettier, Vitest with coverage thresholds, shadcn/ui, `src/server/{domain,application,infrastructure}` tree, structured logger, environment validation.
- `data-persistence`: Prisma schema (`Location` model), versioned initial migration, idempotent seed, and the driver-adapter client connected through the Supavisor pooler (runtime) vs. direct URL (migrations).
- `cloudflare-deployment`: Build, preview (`workerd` locally), and deploy pipeline via `@opennextjs/cloudflare` + Wrangler, with secrets management and the three-environment verification gate (dev → preview → deployed).

### Modified Capabilities

_None — this is the first change; no existing specs._

## Impact

- **Code:** new `prisma/`, `src/server/**`, `src/components/ui/`, `src/lib/`, `app/page.tsx` (+ `loading.tsx`, `error.tsx`), `open-next.config.ts`, `wrangler` config, `vitest.config.ts`, `.prettierrc`, `.env.example`, `.dev.vars` (git-ignored).
- **Dependencies added:** `prisma`, `@prisma/client`, `@prisma/adapter-pg`, `@opennextjs/cloudflare`, `wrangler`, `vitest`, `prettier`, `prettier-plugin-tailwindcss`, shadcn/ui deps (`clsx`, `tailwind-merge`, `lucide-react`).
- **External systems:** a Supabase project (Postgres + Supavisor pooler) and a Cloudflare account (Workers) must be provisioned; `DATABASE_URL` stored as a Wrangler secret.
- **Risk gate:** `@opennextjs/cloudflare` compatibility with Next.js 16.2.x must be verified up front; if unsupported, pin Next.js to the latest supported minor and record the decision.
- **Downstream:** unblocks A1 and, transitively, the entire roadmap; the placeholder `ownerId` convention on seeded locations must be documented for A1's FK migration.
