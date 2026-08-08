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
`.dev.vars` (used by `npm run preview`). Fill in both URLs from your Supabase
project (Settings → Database):

| Variable | Purpose | Port |
| --- | --- | --- |
| `DATABASE_URL` | App runtime — Supavisor pooler, **transaction mode** | 6543 |
| `DIRECT_URL` | `prisma migrate` / `prisma db seed` only | 5432 |

Never commit `.env` or `.dev.vars` (both are git-ignored).

### 3. Migrate and seed the database

```bash
npx prisma migrate dev   # applies migrations via DIRECT_URL
npx prisma db seed       # idempotent — upserts 2 locations
```

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

First deploy only — set the production secret (pooler URL). Pipe the exact bytes;
a trailing newline or BOM in the value breaks the connection at runtime:

```bash
npx wrangler secret put DATABASE_URL
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
app/                    Next.js App Router pages (RSC)
src/components/ui/      shadcn/ui components
src/lib/                utilities + Spanish user-facing copy constants
src/server/domain/          entities + repository interfaces (zero dependencies)
src/server/application/     services (business logic)
src/server/infrastructure/  Prisma repositories, client factory, logger
prisma/                 schema, migrations, seed
docs/                   SDD constitution documents (source of truth)
openspec/               change specs and tasks
```
