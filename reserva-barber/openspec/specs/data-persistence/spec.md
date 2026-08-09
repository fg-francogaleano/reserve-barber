# data-persistence Specification

## Purpose

Prisma schema (`Location` model), versioned initial migration, idempotent seed, and the driver-adapter client connected through the Supavisor pooler (runtime) vs. direct URL (migrations).
## Requirements
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
`PrismaLocationRepository` SHALL implement `ILocationRepository` and map Prisma rows to the domain `Location` entity via a `toDomain` mapper. The domain entity MUST NOT expose Prisma types.

Every method on the contract SHALL take the owning `ownerId` as a required parameter, so that an unscoped location query cannot be expressed by a caller. The contract SHALL provide: a listing of all of an owner's locations ordered by name; a single-location lookup scoped to an owner, returning `null` when the id does not exist *or* belongs to someone else; a create; a count for the per-owner cap; and an update whose predicate carries `ownerId` directly, so a mismatched owner affects zero rows rather than depending on a prior read having been performed. A zero-row update result SHALL be interpreted as not-found — never as "nothing changed", since PostgreSQL reports an affected row even when the new values are identical to the old ones. A unique-constraint violation raised by the database SHALL be translated into a domain error at the application boundary, so no Prisma error text reaches the presentation layer.

#### Scenario: Mapping and owner scoping
- **WHEN** the owner listing runs against a mocked Prisma client returning rows for several owners
- **THEN** only the requested owner's rows are returned, as domain `Location` instances

#### Scenario: Lookup of a foreign location
- **WHEN** a single-location lookup runs with an id belonging to a different owner
- **THEN** it returns `null`, indistinguishably from a non-existent id

#### Scenario: Update scoped by owner
- **WHEN** an update runs with an id that belongs to a different owner
- **THEN** zero rows are affected and no data is modified

#### Scenario: Zero-row update means not found
- **WHEN** an update reports zero affected rows
- **THEN** the caller raises a not-found domain error rather than reporting success

### Requirement: Location name uniqueness enforced by the database
`prisma/schema.prisma` SHALL declare a composite unique constraint on `Location(ownerId, name)`, realising the rule stated in `docs/data-model.md` §4 that has so far existed only as prose. The constraint is the authoritative guarantee against duplicates: application-level checking cannot be, because the check and the insert run as separate round trips against a transaction-mode pooler and may not even share a connection. Names are normalized by the application before reaching the database, so the constraint compares already-canonical values.

#### Scenario: Duplicate insert rejected by the database
- **WHEN** a second location with the same `ownerId` and normalized `name` is inserted
- **THEN** the database rejects the write with a unique-constraint violation

#### Scenario: Same name under different owners is allowed
- **WHEN** two locations carry the same name but different `ownerId` values
- **THEN** both are accepted

### Requirement: Constraint migration is safe against existing data
The migration adding the unique constraint SHALL be verified against live data before it is applied: duplicate `(ownerId, name)` pairs MUST be queried for first, because creating a unique index over existing duplicates aborts. The migration SHALL run over `DIRECT_URL` (session-mode pooler, port 5432) while the runtime continues to use the transaction-mode pooler (port 6543). If the constraint cannot be created, the migration MUST fail loudly rather than leave partial state.

#### Scenario: Duplicates checked before applying
- **WHEN** the migration is prepared
- **THEN** the locations table has been queried for duplicate owner-and-name pairs and none exist

#### Scenario: Migration connection path
- **WHEN** `prisma migrate deploy` runs
- **THEN** it connects via `DIRECT_URL` and completes without hanging through the transaction-mode pooler

### Requirement: Owner-scoped location queries are indexed
`Location` SHALL carry an index on `(ownerId, isActive)` to back the dashboard list query, which always filters by owner. The list SHALL be satisfied by a single query per render, selecting only the fields the page renders.

#### Scenario: List query access path
- **WHEN** the locations list renders for an owner
- **THEN** a single indexed query returns that owner's rows, ordered by name ascending

### Requirement: Connection secrets never committed
`DATABASE_URL` and `DIRECT_URL` SHALL exist only in `.dev.vars` / local env files (git-ignored before first use) and in Wrangler secrets. A `.env.example` SHALL document both variables without real values. If a connection string ever lands in git history, credentials MUST be rotated.

#### Scenario: Repository hygiene check
- **WHEN** the git history and tracked files are inspected
- **THEN** no file contains a real connection string, and `.env.example` documents the required variables with placeholder values

### Requirement: Owner model linked to Supabase Auth
`prisma/schema.prisma` SHALL define the `Owner` model per `docs/data-model.md` §1 (as updated by this change): `id` (cuid PK), `email` (VarChar 255, unique, required, stored lowercase), `authUserId` (unique, nullable until provisioned — maps to the Supabase `auth.users.id`), `createdAt`, `updatedAt`, with a one-to-many relation to `Location`. Credentials (passwords, tokens) MUST NOT be stored in the domain database; authentication state lives entirely in Supabase Auth.

#### Scenario: Owner table created
- **WHEN** the A1 migration runs
- **THEN** the `Owner` table exists with the columns, uniqueness constraints, and defaults above

#### Scenario: No credential material in domain tables
- **WHEN** the domain schema is inspected
- **THEN** no column stores passwords, hashes, or session tokens

### Requirement: FK backfill migration is safe and single-step
A single migration SHALL (1) create the `Owner` table, (2) insert the owner row with a fixed known id and update every `Location` row holding the `SEED_OWNER_ID` placeholder to reference it, and (3) add the `Location.ownerId → Owner.id` foreign key constraint. If any location still references an unknown owner when the constraint is added, the migration MUST fail loudly rather than leave partial state.

#### Scenario: Placeholder rows backfilled
- **WHEN** the migration runs against the S0 database
- **THEN** every location previously holding `SEED_OWNER_ID` references the real owner row and the FK constraint is active

#### Scenario: Unbackfilled data fails the migration
- **WHEN** a location references an owner id that does not exist at constraint-creation time
- **THEN** the migration fails and no FK constraint is left partially applied

### Requirement: Owner provisioning is idempotent and separate from seed
A provisioning script (`scripts/provision-owner.ts`) SHALL create the Supabase auth user for the owner's email (using the service-role key, never bundled into the app) and write the resulting `authUserId` onto the `Owner` row. The script MUST be idempotent (lookup by email before create) and re-runnable after partial failure. `prisma db seed` SHALL seed domain data only, remain idempotent, reference the fixed owner id, and MUST NOT require the service-role key. The `SEED_OWNER_ID` placeholder constant SHALL be removed.

#### Scenario: Provisioning runs twice
- **WHEN** the provisioning script is executed twice
- **THEN** exactly one auth user exists for the owner email and the `Owner.authUserId` is set to it

#### Scenario: Seed after provisioning
- **WHEN** `prisma db seed` runs repeatedly after the migration
- **THEN** exactly one owner and the same two locations exist, all locations referencing the owner

### Requirement: Exactly one Owner
The system SHALL contain exactly one `Owner` row. No application code path (page, server action, or seed) SHALL create an `Owner`; only the migration and the provisioning script may write it. The provisioning script SHALL refuse to run if an `Owner` row with a different email already exists.

#### Scenario: Second owner rejected
- **WHEN** the provisioning script runs with an email different from the existing `Owner`
- **THEN** it exits with an English error and creates neither an auth user nor an `Owner` row

#### Scenario: No application path creates owners
- **WHEN** the application code is inspected
- **THEN** no page, server action, or seed statement performs an `Owner` create

### Requirement: Owner repository maps rows to domain entities
`PrismaOwnerRepository` SHALL implement `IOwnerRepository` (`findByAuthUserId`, `findByEmail`) and map rows to the domain `Owner` entity via a `toDomain` mapper. The domain entity MUST NOT expose Prisma types.

#### Scenario: Lookup by authUserId
- **WHEN** `findByAuthUserId` runs against a mocked Prisma client
- **THEN** the matching row is returned as a domain `Owner` instance, or `null` when absent

### Requirement: Barber model as single source of truth
`prisma/schema.prisma` SHALL define the `Barber` model exactly per `docs/data-model.md` §5: `id` (cuid PK), `locationId` (FK → `Location`), `displayName` (VarChar 120, required), `bio` (VarChar 500, optional), `avatarUrl` (optional), `isActive` (Boolean, default true), `createdAt`, `updatedAt`. `Location` SHALL gain the inverse relation.

The barber → location relation SHALL use `onDelete: Restrict`, per the referential-integrity principle that entities with historical value are never cascaded away: a location with barbers cannot be deleted out from under them.

`avatarUrl` SHALL exist as a nullable column and SHALL NOT be written by any code path in this change. Supabase Storage setup belongs to story P1; the column ships now so the avatar feature does not require a second migration on a table that will by then hold real rows.

#### Scenario: Migration creates the table
- **WHEN** the migration runs
- **THEN** the `Barber` table exists with the columns, types, defaults, and foreign key above

#### Scenario: Migration connection path
- **WHEN** the migration is applied
- **THEN** it connects via `DIRECT_URL` (session-mode pooler) while the runtime continues to use the transaction-mode pooler

#### Scenario: Avatar column is unused
- **WHEN** the application code is inspected
- **THEN** no create or update statement writes `avatarUrl`

### Requirement: Barber display-name uniqueness enforced by the database
`prisma/schema.prisma` SHALL declare a composite unique constraint on `Barber(locationId, displayName)`. The constraint is the authoritative guarantee against duplicates: application-level checking cannot be, because the check and the insert run as separate round trips against a transaction-mode pooler and may not even share a connection. Names are normalized by the application before reaching the database, so the constraint compares already-canonical values.

Scoping the constraint to the location rather than to the owner is deliberate: the same person's name appearing at two branches is legitimate, while two identically-named barbers at one branch cannot be told apart in the booking flow.

#### Scenario: Duplicate insert rejected by the database
- **WHEN** a second barber with the same `locationId` and normalized `displayName` is inserted
- **THEN** the database rejects the write with a unique-constraint violation

#### Scenario: Same name under different locations is allowed
- **WHEN** two barbers carry the same display name but different `locationId` values
- **THEN** both are accepted

### Requirement: Barber repository scopes through the location relation
`PrismaBarberRepository` SHALL implement `IBarberRepository` and map Prisma rows to the domain `Barber` entity via a `toDomain` mapper. The domain entity MUST NOT expose Prisma types, and MUST NOT carry joined location data — a listing that needs the location name SHALL return a separate read model rather than widening the entity.

Every method on the contract SHALL take the owning `ownerId` as a required parameter, so that an unscoped barber query cannot be expressed by a caller, even though `Barber` has no `ownerId` column. Scoping SHALL be expressed as a predicate over the `location` relation. The contract SHALL provide: a listing of all of an owner's barbers; a single-barber lookup scoped to an owner, returning `null` when the id does not exist *or* belongs to someone else; a count per location for the cap; a case-insensitive duplicate check per location with an exclusion for the row being edited; a create; and an update whose predicate carries the ownership scope directly, so a mismatched owner affects zero rows rather than depending on a prior read having been performed. A zero-row update result SHALL be interpreted as not-found.

The case-insensitive duplicate check MUST NOT be implemented with Prisma's `mode: 'insensitive'`, which compiles to `ILIKE` on PostgreSQL and would treat `%` and `_` in a submitted name as wildcards. The comparison SHALL be performed over a row set bounded by the per-location cap.

#### Scenario: Listing scopes through the relation
- **WHEN** the owner listing runs against a mocked Prisma client
- **THEN** the query filters on the location relation's owner, and results are returned as domain instances

#### Scenario: Lookup of a foreign barber
- **WHEN** a single-barber lookup runs with an id whose location belongs to a different owner
- **THEN** it returns `null`, indistinguishably from a non-existent id

#### Scenario: Update scoped through the relation
- **WHEN** an update runs with an id whose location belongs to a different owner
- **THEN** zero rows are affected and no data is modified

#### Scenario: Zero-row update means not found
- **WHEN** an update reports zero affected rows
- **THEN** the caller raises a not-found domain error rather than reporting success

#### Scenario: Duplicate check does not interpret metacharacters
- **WHEN** the duplicate check runs for a name containing `%` or `_`
- **THEN** those characters are compared literally and no false duplicate is reported

### Requirement: Barber queries are indexed and free of N+1
`Barber` SHALL carry an index on `(locationId, isActive)`. The barbers list SHALL be satisfied by a **single** query that joins the location for its display name, selecting only the fields the page renders — never one query per location or per barber.

#### Scenario: List query access path
- **WHEN** the barbers list renders for an owner
- **THEN** one query returns that owner's barbers together with their location names, ordered by location name then display name

### Requirement: Unique-violation translation is bounded to one business constraint
A unique-constraint violation raised by the database during a barber write SHALL be translated into the duplicate-display-name domain error, so no Prisma error text reaches the presentation layer. This blanket translation is correct **only while `Barber` participates in exactly one business unique constraint**. The limitation SHALL be recorded with the trigger that invalidates it, because story M4 introduces `BarberService(barberId, serviceId)`, after which an unrelated violation would render a message about a name the owner never touched.

#### Scenario: Constraint violation translated
- **WHEN** the database rejects a barber write with a unique-constraint violation
- **THEN** the caller receives the duplicate-display-name domain error and the response carries no constraint name, column name, or SQL fragment

#### Scenario: The limitation is documented
- **WHEN** `docs/tech-debt.md` is reviewed after this change
- **THEN** it records that the translation is unqualified and names M4 as the trigger to qualify it

### Requirement: A vanished location is reported as unavailable, not as a technical failure
A foreign-key violation raised when writing a barber means the destination location ceased to exist between the ownership check and the write. It SHALL be translated into the same "location unavailable" domain error the ownership check produces, rather than falling through to the generic infrastructure message. A not-found condition wearing an infrastructure error's clothes sends the owner looking for a problem that does not exist.

#### Scenario: Foreign-key violation on write
- **WHEN** the database rejects a barber write because the referenced location no longer exists
- **THEN** the caller receives the location-unavailable domain error, not the generic infrastructure error

