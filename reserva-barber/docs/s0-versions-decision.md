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

- ~~**`Location.ownerId` is a plain (non-FK) `String` column.**~~ **Resolved in A1** (2026-08-02): the `Owner`
  model ships, the seeded placeholder was backfilled, and the FK constraint is active. `SEED_OWNER_ID` no
  longer exists.

---

# A1 Addendum — workerd findings (2026-08-02)

Change **a1-owner-auth** (Supabase Auth + protected dashboard) added the first per-request auth calls and a
`middleware.ts`, which exposed two `workerd` issues S0's single-request smoke test never triggered. Both were
caught at the preview gate, before deploy — the three-environment protocol working as intended.

## Additional validated versions

| Component | Version | Notes |
| --- | --- | --- |
| @supabase/ssr | 0.12.4 | Cookie-adapter API only (`getAll`/`setAll`); works on workerd |
| @supabase/supabase-js | 2.111.0 | — |

## Findings & workarounds

5. **A module-scoped Prisma client breaks on workerd — use one client per request.**
   S0 cached the client at module scope (`let cachedClient`). Workers cannot reuse a socket opened in an
   earlier request context, so from the second request onward every query hung until the 10s
   `query_timeout` (`Error: Query read timeout`), surfacing as ~10s page loads, the error boundary on the
   location list, and intermittent logout failures. This was **latent since S0** — a single smoke request per
   isolate never hit it; A1's multi-request login flow did. Fix: `getPrismaClient()` is wrapped in React
   `cache()` (per-request dedup, fresh client per request) and the adapter sets `maxUses: 1` so no connection
   is ever carried across requests. This matches OpenNext's Prisma guidance ("never create a global client")
   and the `data-persistence` spec, which already required reuse *within* — not across — an invocation.

   **Load-validated (2026-08-03).** A per-request client that is never `$disconnect()`ed looks like a
   connection and memory leak, so it was measured before being trusted. Supabase's ceiling is
   `max_connections = 60`, with ~12 in use at rest.

   | Test | Result |
   | --- | --- |
   | Bursts of 10 / 25 / 50 concurrent queries (85 clients kept alive) | 85/85 succeeded; server-side connections 12 → 24 |
   | 300 sequential requests in one long-lived process | connections **flat at 24**, zero failures |
   | Same, releasing each client (what `cache()` does) with forced GC | heap **flat at 21–22 MB** |

   Conclusion: **no leak on either axis.** `maxUses: 1` retires each socket after a single use, so pools
   never hold connections open, and Supavisor multiplexes the rest — 85 client pools cost 12 extra
   server connections, not 85. An un-disconnected client is fully garbage-collectable, so `$disconnect()`
   is unnecessary. (An earlier run showed ~40 MB of growth; that was an artifact of the harness retaining
   every client in an array, which the app does not do.)

6. **`@supabase/ssr` cookie defaults are not secure — override them.**
   `DEFAULT_COOKIE_OPTIONS` ships `httpOnly: false` and sets no `secure` flag. Both `createServerClient` call
   sites (`middleware.ts` and `authClient.ts`) must pass
   `cookieOptions: { httpOnly: true, secure: true, sameSite: 'lax', path: '/' }`.

7. **Keep `middleware.ts`; do not migrate to `proxy.ts` yet.**
   Next.js 16 deprecates `middleware.ts` in favour of `proxy.ts` and warns on every dev start. `proxy.ts`
   forces the Node.js runtime with no way to opt into Edge, while `middleware.ts` stays on the Edge runtime
   that `@opennextjs/cloudflare` was validated against. Next.js's own guidance: "If you want to continue using
   the edge runtime, keep using middleware." Migrating would put unvalidated runtime risk into the auth guard.
   Revisit only after verifying `proxy.ts` + OpenNext + workerd compatibility on its own.

8. **A second Prisma generator is required for CLI scripts.**
   The `runtime = "workerd"` client cannot be imported by Node scripts run through `tsx` — its wasm query
   compiler fails to instantiate under Node's ESM loader (`LinkError: ... function import requires a
   callable`). `prisma/schema.prisma` therefore declares a second generator (`cliClient` →
   `src/generated/prisma-cli`, Node-targeted) used by `prisma/seed.ts` and `scripts/provision-owner.ts`.
   Application code always imports the workerd client.

9. **Server Action ids must be pinned with `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`, or every deploy breaks open tabs.**
   Next.js derives Server Action ids from a key it regenerates on each build. Self-hosting therefore means a
   deploy invalidates the actions of any browser tab already open: clicking a button answers
   `UnrecognizedActionError: Server Action "…" was not found on the server`, and the user is stuck on an error
   screen until they reload. Vercel solves this with Skew Protection; Cloudflare has no equivalent.

   Measured across six builds (identical code unless noted):

   | Build | Key | Code | `loginAction` id |
   | --- | --- | --- | --- |
   | 1 | none | original | `6081983b7b2b…` |
   | 2 | none | original | `609d7a90b2cd…` — **changed** |
   | 3 | A | original | `60e53f3c11e0…` |
   | 4 | A | original | `60e53f3c11e0…` — **stable** |
   | 5 | B | original | `6053aa9c1f17…` — **changed** (rules out build caching) |
   | 6 | A | **modified** | `60e53f3c11e0…` — **stable** |

   Conclusion: the id is a function of **key + file path + exported name — not file contents**. A pinned key
   keeps ids stable across deploys *even when the action's own code changes*; only renaming an action or
   moving its file changes its id. That closes the skew problem for the normal workflow, at $0.

   **Operational cost, deliberately accepted:** the key must be identical for every build anywhere (a build
   without it ships different ids and the problem returns), it lives in `.env` because it is consumed at
   build time rather than runtime, and pinning it trades Next.js's per-build key rotation for a long-lived
   secret — it encrypts data Server Actions send to the client, so a leak has a wider window. Next.js
   documents pinning as the supported approach for self-hosting.

   **Caveat found while verifying:** `npm run build` (plain `next build`) and `npx opennextjs-cloudflare
   build` produce *different* ids from the same key and the same source. Each path is stable with itself —
   two consecutive OpenNext builds match exactly — and deploys only ever go through the OpenNext path, so
   production is consistent. But do not compare ids across the two commands and conclude the key is broken.

   *Related:* middleware must never answer a Server Action POST with a redirect (finding 10) — that produces
   the same user-visible symptom from a completely different cause, which made this one harder to isolate.

10. **Middleware must let Server Action requests through.**
    Redirecting a Server Action POST hands the client an HTML page where it expects an encoded action
    result, producing `"An unexpected response was received from the server"`. The auth guard now detects the
    `Next-Action` header and continues instead of redirecting; actions enforce auth themselves via
    `requireOwner()`, whose `redirect()` Next.js encodes in a form the client can follow.

11. **Deploy from a clean build.** A deploy that reused `.next` shipped without a source change that was
    definitely present in the working tree, which sent an investigation down the wrong path. `rm -rf .next
    .open-next` before `npm run deploy` when the change must be trusted.

## A1 gate result

Passed: login, the authenticated location list, and logout all work on the local `workerd` preview and on the
deployed URL, with sub-second responses after finding 5 was fixed.

## Stack Validation Gate — Result

Per `docs/roadmap.md` Dependency Notes, the gate (task 8.2) **passed**: the seeded location list renders
through the pooler on the local `workerd` runtime and on the deployed URL
(`https://reserva-barber.franco-galeano.workers.dev`). No stack revisit needed.

## References

- OpenNext workerd how-to (serverExternalPackages / conditional exports): https://opennext.js.org/cloudflare/howtos/workerd
- Prisma driver adapters: https://www.prisma.io/docs/orm/overview/databases/database-drivers
- Supabase connection pooling: https://supabase.com/docs/guides/database/connecting-to-postgres#connection-pooler
- Prisma 7 wasm-on-Workers issue (context for the workerd runtime requirement): https://github.com/prisma/prisma/issues/28657
