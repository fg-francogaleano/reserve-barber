# Reserva Barber

Barbershop appointment booking web app. A single owner manages locations, barbers and
services from a private dashboard; clients book as guests through a public link and
confirm with a mandatory deposit (Mercado Pago or bank transfer).

**Stack:** Next.js (App Router) on Cloudflare Workers (`@opennextjs/cloudflare`),
Supabase PostgreSQL + Prisma (driver adapters), Tailwind CSS + shadcn/ui.

See `docs/` for the SDD constitution documents (source of truth) and
`docs/s0-versions-decision.md` for the validated stack version matrix.

## Prerequisites

- Node.js 20+
- A [Supabase](https://supabase.com) project (PostgreSQL)
- A [Cloudflare](https://dash.cloudflare.com) account with Workers enabled
- Windows only: **Developer Mode enabled** (the Cloudflare build creates symlinks)

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Environment variables

Copy `.env.example` to `.env` (used by `next dev` and the Prisma CLI) and to
`.dev.vars` (used by `npm run preview`). Fill in the values from your Supabase
project (Settings → Database for the connection strings, Settings → API for the
auth keys):

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | App runtime — Supavisor pooler, **transaction mode** (port 6543) |
| `DIRECT_URL` | `prisma migrate` / `prisma db seed` only (port 5432) |
| `SUPABASE_URL` | Supabase Auth — project URL |
| `SUPABASE_ANON_KEY` | Supabase Auth — anon/publishable key (safe client-side) |
| `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` | **Build-time** — keeps Server Action ids stable across deploys |

> **`NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` must be the same for every build.** It is
> read when `next build` runs, not at runtime, so a Wrangler secret will not do —
> it belongs in `.env`. Without it Next.js generates a new key per build, every
> deploy invalidates the Server Actions of already-open browser tabs, and users
> hit "Server action not found" until they reload. If a build ever ships with a
> different key, that deploy breaks open tabs exactly the same way.

Never commit `.env` or `.dev.vars` (both are git-ignored). The **service-role key
is never stored in either file** — it is passed inline only when provisioning the
owner (step 4).

### 3. Migrate and seed the database

```bash
npx prisma migrate dev   # applies migrations via DIRECT_URL
npx prisma db seed       # idempotent — seeds 2 locations (never creates the Owner)
```

### 4. Provision the owner account

Authentication uses **Supabase Auth** (email/password). Enable the email provider
and **disable public sign-ups** in the Supabase dashboard — there is exactly one
administrative user and no registration flow.

The migration creates the `Owner` row; this script creates the matching Supabase
auth user and links it via `Owner.authUserId`. It is idempotent and refuses to run
if an `Owner` with a different email already exists:

```bash
# bash
SUPABASE_SERVICE_ROLE_KEY=... OWNER_EMAIL=... OWNER_INITIAL_PASSWORD=... npm run provision-owner
```

```powershell
# PowerShell
$env:SUPABASE_SERVICE_ROLE_KEY="..."; $env:OWNER_EMAIL="..."; $env:OWNER_INITIAL_PASSWORD="..."; npm run provision-owner
```

**Changing the owner's email** is a two-step operation, because Supabase Auth is the
source of truth and `Owner.email` is a denormalized copy: change it in the Supabase
dashboard first, then re-run this script to refresh the copy.

> **Logging in only works over `localhost` / `127.0.0.1`.** Session cookies are set
> `Secure`, and browsers accept those over plain HTTP only for those hosts. The LAN
> address `next dev` prints (e.g. `http://192.168.1.43:3000`) will loop back to the
> login form without ever storing the session — use an HTTPS tunnel to test on a phone.

## Development

```bash
npm run dev        # next dev on http://localhost:3000
npm run lint       # ESLint
npm run typecheck  # tsc --noEmit
npm test           # Vitest (watch)
npm run test:coverage  # enforces 90% coverage on domain + application layers
npm run format     # Prettier
```

## Preview & Deploy (Cloudflare)

Verification order is dev → preview → deploy; each must pass before the next.

```bash
npm run preview    # OpenNext build + local workerd runtime (http://127.0.0.1:8787)
```

First deploy only — set the production secrets. Pipe the exact bytes; a trailing
newline or BOM in the value breaks the connection at runtime:

```bash
npx wrangler secret put DATABASE_URL      # pooler URL
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_ANON_KEY
```

Then:

```bash
npm run deploy
```

> **Note:** `patches/` contains a `patch-package` fix for `@opennextjs/cloudflare`
> on Windows (path-separator bug in the Turbopack runtime patcher). It is applied
> automatically by the `postinstall` script.

## Project layout

```
middleware.ts           Session refresh + auth guard (runs on every request)
app/login/              Public login page + server action
app/(dashboard)/        Private owner dashboard — `/` lives here, behind auth
src/components/ui/      shadcn/ui components
src/lib/                utilities + Spanish user-facing copy constants
src/server/domain/          entities + repository interfaces (zero dependencies)
src/server/application/     services (business logic)
src/server/infrastructure/  Prisma repositories, Supabase auth client, logger
prisma/                 schema, migrations, seed
scripts/                one-off operational scripts (owner provisioning)
docs/                   SDD constitution documents (source of truth)
openspec/               change specs and tasks
```

**Routing note:** `/` is the authenticated dashboard home — it is not public.
Unauthenticated visitors are redirected to `/login`. The public booking flow will
live at `/b/[slug]` (story B1) and does not exist yet.
