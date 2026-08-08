## ADDED Requirements

### Requirement: Location model as single source of truth
`prisma/schema.prisma` SHALL define the `Location` model exactly per `docs/data-model.md` §4: `id` (cuid PK), `ownerId` (String), `name` (VarChar 120), `address` (VarChar 255, optional), `isActive` (Boolean, default true), `createdAt`, `updatedAt`. No other models are introduced in this change. The `ownerId` FK constraint is deferred to A1 (no `Owner` model yet); the placeholder `ownerId` value used by the seed MUST be a single documented constant.

#### Scenario: Migration creates the table
- **WHEN** `npx prisma migrate dev` runs against a fresh database
- **THEN** a versioned migration creates the `Location` table with the columns, types, and defaults above

#### Scenario: Placeholder ownerId is consistent
- **WHEN** seeded rows are inspected
- **THEN** every row carries the same documented placeholder `ownerId` constant, enabling A1's future FK backfill

### Requirement: Idempotent seed
The seed script (`prisma/seed.ts`) SHALL insert exactly 2 locations using upsert-by-name semantics so repeated executions never create duplicates and keep stable ids.

#### Scenario: Seed runs twice
- **WHEN** `npx prisma db seed` is executed twice in a row
- **THEN** exactly 2 location rows exist, with unchanged ids and the documented placeholder `ownerId`

### Requirement: Driver-adapter client through the Supavisor pooler
The runtime Prisma client SHALL be created via a `createPrismaClient(connectionString)` factory using the `PrismaPg` driver adapter, pointed at the Supabase Supavisor pooler URL (transaction mode, port 6543). Migrations SHALL use a separate direct connection URL (`DIRECT_URL`). The client MUST be reused within a Worker invocation context and MUST configure an explicit connection timeout.

#### Scenario: Runtime connects through the pooler
- **WHEN** the deployed app executes the location query
- **THEN** the connection goes through the Supavisor pooler URL, not the direct Postgres port

#### Scenario: Migrations use the direct URL
- **WHEN** `prisma migrate dev` or `prisma migrate deploy` runs
- **THEN** it connects via `DIRECT_URL` and completes without hanging through the transaction-mode pooler

### Requirement: Repository maps rows to domain entities
`PrismaLocationRepository` SHALL implement `ILocationRepository`, filter on `isActive = true` for `findAllActive()`, and map Prisma rows to the domain `Location` entity via a `toDomain` mapper. The domain entity MUST NOT expose Prisma types.

#### Scenario: Mapping and filtering
- **WHEN** `findAllActive()` runs against a mocked Prisma client returning active and inactive rows
- **THEN** only active rows are returned, as domain `Location` instances

### Requirement: Connection secrets never committed
`DATABASE_URL` and `DIRECT_URL` SHALL exist only in `.dev.vars` / local env files (git-ignored before first use) and in Wrangler secrets. A `.env.example` SHALL document both variables without real values. If a connection string ever lands in git history, credentials MUST be rotated.

#### Scenario: Repository hygiene check
- **WHEN** the git history and tracked files are inspected
- **THEN** no file contains a real connection string, and `.env.example` documents the required variables with placeholder values
