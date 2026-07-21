## ADDED Requirements

### Requirement: TypeScript strict mode and path alias
The project SHALL compile with `strict: true` and no implicit `any`. The `@/*` path alias MUST resolve to `./src/*`. Public functions in `src/server/**` MUST declare explicit return types.

#### Scenario: Type check gate
- **WHEN** `npm run typecheck` (`tsc --noEmit`) runs
- **THEN** it completes with zero errors under strict mode

### Requirement: Layered DDD folder structure
The server code SHALL be organized as `src/server/domain` (entities and repository interfaces, zero external dependencies), `src/server/application` (services depending only on domain interfaces), and `src/server/infrastructure` (Prisma repositories, adapters, logger). Domain and application modules MUST NOT import from infrastructure or from Next.js.

#### Scenario: Dependency direction respected
- **WHEN** imports in `src/server/domain/**` and `src/server/application/**` are inspected
- **THEN** no import references `@prisma/client`, `next`, or any module under `src/server/infrastructure`

### Requirement: Test toolchain with coverage thresholds
The project SHALL run unit tests with Vitest. Coverage on `src/server/domain` and `src/server/application` MUST meet a 90% threshold for branches, functions, lines, and statements, enforced by `vitest.config.ts`. Tests live alongside sources as `*.test.ts` and MUST NOT touch a real database.

#### Scenario: Coverage gate fails below threshold
- **WHEN** coverage on domain or application layers drops below 90%
- **THEN** `npm run test:coverage` exits non-zero

#### Scenario: Service tested against mocked repository
- **WHEN** `LocationService` tests run
- **THEN** they use a mocked `ILocationRepository` (returning data, empty list, and a thrown error) and no database connection is opened

### Requirement: Lint and format toolchain
The project SHALL enforce ESLint (Next.js + `@typescript-eslint`) and Prettier with `prettier-plugin-tailwindcss`. Lint MUST pass with zero errors before commit.

#### Scenario: Lint gate
- **WHEN** `npm run lint` runs on the completed scaffold
- **THEN** it reports zero errors

### Requirement: shadcn/ui integration
The project SHALL include shadcn/ui initialized with `components.json`, primitives under `src/components/ui/`, and the `cn()` helper in `src/lib/utils.ts`. UI components MUST use these primitives instead of raw HTML where an equivalent exists.

#### Scenario: Card primitive available
- **WHEN** the home page renders location entries
- **THEN** it composes the shadcn/ui `Card` component from `src/components/ui/card.tsx`

### Requirement: Structured logger stub
The infrastructure layer SHALL provide a structured JSON logger (`src/server/infrastructure/logger.ts`) with `debug`, `info`, `warn`, and `error` levels, accepting contextual fields. Server code MUST use it instead of scattered `console.log`.

#### Scenario: Error logged with context
- **WHEN** the location read fails
- **THEN** a single JSON log entry at `error` level is emitted including the operation name and failure cause, in English

### Requirement: Fail-fast environment validation
Server startup SHALL validate the presence of required environment variables (`DATABASE_URL`) and fail fast with a single clear English error naming the missing variable. Secrets MUST NOT be prefixed `NEXT_PUBLIC_` and MUST never reach client bundles.

#### Scenario: Missing DATABASE_URL
- **WHEN** the app starts without `DATABASE_URL` set
- **THEN** a single English log line names the missing variable and the visitor receives the generic error state, never a raw 500 body with internals
