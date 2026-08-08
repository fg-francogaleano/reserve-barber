# S0 Walking Skeleton — Stack Validation Decision Note

**Date:** 2026-07-20 (initial verification 2026-07-18)
**Change:** s0-walking-skeleton
**Status:** ✅ Validated end to end — `next dev` → `npm run preview` (workerd) → deployed Cloudflare URL

## Validated Version Matrix

| Component | Version | Notes |
| --- | --- | --- |
| Next.js | 16.2.10 | Turbopack build (default); webpack build **fails** with the workerd Prisma client (see Workarounds) |
| @opennextjs/cloudflare | 1.20.1 | Requires `>=15.5.18 <16 \|\| >=16.2.6` — satisfied; **patched** (see Workarounds) |
| wrangler | 4.112.0 | `compatibility_date: 2025-09-01`, `nodejs_compat` flag |
| Prisma / @prisma/client / @prisma/adapter-pg | 7.8.0 | `prisma-client` generator with `runtime = "workerd"` |
| Node.js (build machine) | 24.5.0 | Windows 10; Developer Mode **required** (OpenNext creates symlinks) |

## Adapter & Pooler Configuration

- **Generator:** `provider = "prisma-client"`, `output = "../src/generated/prisma"`, `runtime = "workerd"`.
  The workerd runtime generates a wasm query compiler loaded via `import("./query_compiler_fast_bg.wasm?module")`,
  which OpenNext bundles statically. Without `runtime = "workerd"` the client crashes on Workers with
  `CompileError: Wasm code generation disallowed by embedder` (dynamic wasm compilation is blocked by workerd).
- **Runtime connection:** Supavisor **transaction-mode pooler**, port **6543**
  (`aws-1-sa-east-1.pooler.supabase.com`), via `PrismaPg` driver adapter with
  `connectionTimeoutMillis: 10_000`, `query_timeout`/`statement_timeout: 10_000`, `max: 5`.
- **Migrations/seed connection:** Supavisor **session-mode pooler**, port **5432**, via `DIRECT_URL`
  (the direct `db.<ref>.supabase.co` host is IPv6-only and unreachable from this network).
- **Secrets:** local dev uses `.env` (next dev / Prisma CLI) and `.dev.vars` (wrangler preview);
  production uses `wrangler secret put DATABASE_URL`.

## Workarounds Required

1. **OpenNext Turbopack patch on Windows (`patches/@opennextjs+cloudflare+1.20.1.patch`, applied via `patch-package`).**
   OpenNext's Turbopack runtime patcher builds its `requireChunk`/`loadWasmChunk` switch cases from traced file
   paths. On Windows those paths use backslashes, so the `.next/server/chunks/` filters never match and the
   generated worker throws `ChunkLoadError` (JS chunks) at runtime. The patch normalizes traced paths to forward
   slashes before matching. Revisit when upstream fixes Windows support (opennextjs-cloudflare).
2. **Webpack build is not usable** with the workerd Prisma client: webpack cannot parse the
   `.wasm?module` import (`Module parse failed`). Keep the default Turbopack build (`next build`).
3. **Windows Developer Mode required** for `opennextjs-cloudflare build` (it creates symlinks under
   `.open-next/`); without it the build fails with `EPERM: operation not permitted, symlink`.
4. **Secret hygiene:** `wrangler secret put` must receive the URL with no trailing newline or BOM/control
   characters — a polluted value produced `proxy request failed, cannot connect to the specified address`
   at runtime (the connection string was unparseable). Pipe the exact bytes (e.g. from a file) when setting it.

## Deferred Decisions

- **`Location.ownerId` is a plain (non-FK) `String` column.** The `Owner` model, its FK constraint, and the
  backfill of the seeded placeholder (`SEED_OWNER_ID` exported from `prisma/seed.ts`) are deferred to change
  **A1**, which must reference this note (design.md D4).

## Stack Validation Gate — Result

Per `docs/roadmap.md` Dependency Notes, the gate (task 8.2) **passed**: the seeded location list renders
through the pooler on the local `workerd` runtime and on the deployed URL
(`https://reserva-barber.franco-galeano.workers.dev`). No stack revisit needed.

## References

- OpenNext workerd how-to (serverExternalPackages / conditional exports): https://opennext.js.org/cloudflare/howtos/workerd
- Prisma driver adapters: https://www.prisma.io/docs/orm/overview/databases/database-drivers
- Supabase connection pooling: https://supabase.com/docs/guides/database/connecting-to-postgres#connection-pooler
- Prisma 7 wasm-on-Workers issue (context for the workerd runtime requirement): https://github.com/prisma/prisma/issues/28657
