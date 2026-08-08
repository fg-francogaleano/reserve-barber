## 1. Risk Gate & Version Verification (D1)

- [x] 1.1 Verify `@opennextjs/cloudflare` compatibility with Next.js 16.2.x; if unsupported, pin Next.js to the latest supported minor and note the decision
- [x] 1.2 Confirm Prisma version supporting `driverAdapters` + `@prisma/adapter-pg` on `workerd`; record target versions

## 2. External Provisioning

- [x] 2.1 Create the Supabase project (region closest to AR); obtain the Supavisor pooler URL (port 6543, transaction mode) and the direct URL (port 5432)
- [x] 2.2 Verify Cloudflare account and Wrangler login work (`wrangler whoami`)

## 3. Toolchain Scaffold

- [x] 3.1 Add Prettier + `prettier-plugin-tailwindcss` with `.prettierrc`; add `format` script
- [x] 3.2 Add Vitest with `vitest.config.ts` enforcing 90% coverage (branches/functions/lines/statements) on `src/server/domain` and `src/server/application`; add `test` and `test:coverage` scripts
- [x] 3.3 Configure `tsconfig.json`: confirm `strict: true`, add `@/*` → `./src/*` path alias; add `typecheck` script
- [x] 3.4 Initialize shadcn/ui (`components.json`, `src/lib/utils.ts` with `cn()`), add the `Card` component to `src/components/ui/`
- [x] 3.5 Git-ignore `.dev.vars` and `.env*` (before any secret exists); create `.env.example` documenting `DATABASE_URL` and `DIRECT_URL` with placeholder values

## 4. Data Layer (TDD where testable)

- [x] 4.1 Add Prisma with `prisma/schema.prisma`: datasource with `DATABASE_URL`/`DIRECT_URL`, driver-adapter config, and the `Location` model exactly per `data-model.md` §4
- [x] 4.2 Run `npx prisma migrate dev --name init_location` against Supabase via `DIRECT_URL`; verify the table and columns
- [x] 4.3 Write `prisma/seed.ts`: idempotent upsert-by-name of 2 locations using the exported `SEED_OWNER_ID` placeholder constant; wire `prisma db seed`; run twice and verify exactly 2 rows with stable ids
- [x] 4.4 Implement `src/server/infrastructure/prisma/client.ts` — `createPrismaClient()` with `PrismaPg` adapter and explicit connection timeout

## 5. Layered Read Path (TDD: failing tests first)

- [x] 5.1 Write failing tests for `LocationService.listActiveLocations()` (mocked repository: returns data / empty list / propagates errors; no DB connection)
- [x] 5.2 Implement `src/server/domain/models/Location.ts` (zero-dependency entity) and `src/server/domain/repositories/ILocationRepository.ts` (`findAllActive(): Promise<Location[]>`)
- [x] 5.3 Implement `src/server/application/services/LocationService.ts` against the interface; make 5.1 tests pass
- [x] 5.4 Write failing tests for `PrismaLocationRepository` (`toDomain` mapping; filters `isActive: true`; mocked Prisma client)
- [x] 5.5 Implement `src/server/infrastructure/prisma/PrismaLocationRepository.ts`; make 5.4 tests pass
- [x] 5.6 Implement `src/server/infrastructure/logger.ts` (structured JSON, debug/info/warn/error, contextual fields) and fail-fast env validation naming missing variables in English
- [x] 5.7 Verify coverage ≥ 90% on domain + application layers (`npm run test:coverage`)

## 6. Presentation Layer

- [x] 6.1 Create the Spanish copy constants module (heading "Nuestras sucursales", empty state "Todavía no hay sucursales cargadas.", error message "No pudimos cargar las sucursales. Intentá de nuevo más tarde.")
- [x] 6.2 Implement `app/page.tsx` (RSC): call `LocationService`, render active locations with shadcn/ui `Card` (name + optional address, no dangling separators); render the empty state when the list is empty
- [x] 6.3 Implement `app/loading.tsx`: skeleton of 2–3 placeholder cards matching the card layout
- [x] 6.4 Implement `app/error.tsx`: generic Spanish message + retry affordance; log the failure via the structured logger; assert no stack trace/connection string in the response body
- [x] 6.5 Verify mobile viewport rendering and a 120-char location name without layout overflow

## 7. Local Verification — Environment 1 (next dev)

- [x] 7.1 `npm run dev` with `.dev.vars`/local env: both seeded locations render from Supabase
- [x] 7.2 Simulate failure (wrong `DATABASE_URL`): error boundary renders the Spanish message within bounded time; one structured English error log; no internals in the response
- [x] 7.3 `npm run lint`, `npm run typecheck`, `npm test` all clean

## 8. Cloudflare Pipeline — Environments 2 & 3

- [x] 8.1 Add `@opennextjs/cloudflare` + Wrangler: `open-next.config.ts`, `wrangler` config, `preview` and `deploy` scripts
- [x] 8.2 **GATE:** `npm run preview` (local `workerd`): page renders seeded locations through the pooler — if this fails, stop and trigger the stack-revisit protocol (`docs/roadmap.md` Dependency Notes)
- [x] 8.3 Set the production secret: `wrangler secret put DATABASE_URL` (pooler URL)
- [x] 8.4 `npm run deploy`; open the deployed URL and verify the seeded location list renders end to end

## 9. Documentation & Close-out

- [x] 9.1 Write the decision note in `docs/` (validated Next.js/OpenNext/Prisma versions, adapter + pooler config, workarounds); reference the `ownerId` FK deferral for A1
- [x] 9.2 Update `README.md`: Supabase setup, env vars, migrate/seed, dev/preview/deploy commands
- [x] 9.3 Final quality gates: lint, typecheck, tests + coverage all green; confirm no secret in tracked files or git history
