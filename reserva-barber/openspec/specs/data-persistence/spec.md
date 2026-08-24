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
A unique-constraint violation raised by the database during a barber write SHALL be translated into the duplicate-display-name domain error, so no Prisma error text reaches the presentation layer. This blanket translation is correct **only while `Barber` participates in exactly one reachable business unique constraint**.

This change introduces `BarberService(barberId, serviceId)`, a second unique constraint touching the barber aggregate. The translation nevertheless remains correct, and SHALL be kept correct by construction rather than by inspecting driver error metadata: assignments are written through their own repository and are never nested inside a barber write, and the insertion statement absorbs duplicates so a `BarberService` violation is not raised at all. Qualifying the translation by reading the driver's constraint metadata is rejected, because it would place the driver's error shape in the application layer — the coupling this boundary exists to prevent.

The bound SHALL be proven by test rather than documented, and the re-audit SHALL cover both the barber and service aggregates, not only the one this change edits.

#### Scenario: Constraint violation translated
- **WHEN** the database rejects a barber write with a unique-constraint violation
- **THEN** the caller receives the duplicate-display-name domain error and the response carries no constraint name, column name, or SQL fragment

#### Scenario: An assignment violation cannot be mistaken for a duplicate name
- **WHEN** a unique violation originating from the assignment table is raised
- **THEN** it does not surface as the duplicate-display-name domain error

#### Scenario: No nested cross-aggregate write exists
- **WHEN** the barber and assignment write paths are reviewed after this change
- **THEN** no assignment insert is nested inside a barber create or update

#### Scenario: The limitation is documented
- **WHEN** `docs/tech-debt.md` is reviewed after this change
- **THEN** it records that the M4 trigger is discharged, why the bound now holds by construction rather than by care, and the condition that would invalidate it again

### Requirement: A vanished location is reported as unavailable, not as a technical failure
A foreign-key violation raised when writing a barber means the destination location ceased to exist between the ownership check and the write. It SHALL be translated into the same "location unavailable" domain error the ownership check produces, rather than falling through to the generic infrastructure message. A not-found condition wearing an infrastructure error's clothes sends the owner looking for a problem that does not exist.

#### Scenario: Foreign-key violation on write
- **WHEN** the database rejects a barber write because the referenced location no longer exists
- **THEN** the caller receives the location-unavailable domain error, not the generic infrastructure error

### Requirement: Service model as single source of truth
`prisma/schema.prisma` SHALL define the `Service` model exactly per `docs/data-model.md` §6: `id` (cuid PK), `ownerId` (FK → `Owner`), `name` (VarChar 120, required), `description` (VarChar 500, optional), `price` (Decimal, required), `durationMinutes` (Int, required), `isActive` (Boolean, default true), `createdAt`, `updatedAt`. `Owner` SHALL gain the inverse relation.

`docs/data-model.md` §6 SHALL be updated **before** the schema is written. It currently states no uniqueness, normalization, precision or granularity rule for `Service`, all of which this change introduces; writing the schema first would make the schema the source of truth instead of the document, contrary to the spec-first change policy.

Unlike `Barber`, whose ownership is derived through its location, `Service` carries a real `ownerId` column. Scoping SHALL therefore be expressed as a predicate on that column rather than as a relation join. The derived-ownership pattern is a response to a schema that lacks an owner column and MUST NOT be applied to a schema that has one.

#### Scenario: Migration creates the table
- **WHEN** the migration runs
- **THEN** the `Service` table exists with the columns, types, defaults, and foreign key above

#### Scenario: Migration connection path
- **WHEN** the migration is applied
- **THEN** it connects via `DIRECT_URL` (session-mode pooler) while the runtime continues to use the transaction-mode pooler

#### Scenario: The data model document precedes the schema
- **WHEN** the change is reviewed
- **THEN** `docs/data-model.md` §6 states the uniqueness, normalization, price and duration rules the schema and application enforce

### Requirement: Monetary precision is declared once and validated more strictly than the column
The `price` column SHALL declare an explicit precision and scale of two decimal places, never Prisma's default numeric precision. The application's maximum accepted price SHALL be strictly below what the column can hold.

Validation being tighter than the column is what makes numeric overflow unreachable by construction. A value exceeding the column raises a database-level numeric-overflow error that is not a typed Prisma error code, so it would fall through to the generic infrastructure handler — presenting a field-level mistake as a technical failure the owner cannot act on.

#### Scenario: Column precision is explicit
- **WHEN** the emitted migration SQL is read before it is applied
- **THEN** the `price` column declares an explicit precision and scale of two decimals, not the default

#### Scenario: Overflow is unreachable
- **WHEN** a price above the application maximum is submitted
- **THEN** it is refused by validation and no database numeric-overflow error is ever raised

### Requirement: A monetary value is converted at the repository boundary and never crosses a layer as a driver type
The Prisma decimal type SHALL be read in exactly one place — the repository's row-to-entity mapper — and converted there to a canonical string representation with two decimal places. The domain entity SHALL carry that string. No layer above infrastructure may hold, pass, or serialize the driver's decimal type.

This rule exists because the driver's decimal is not a plain serializable value: it does not survive the boundary between a Server Component and a Client Component, and the failure appears only at runtime on the Workers runtime — not in a production build and not under the Node test runner. Floating-point representation is excluded separately by the money convention in `docs/data-model.md`.

This constraint SHALL apply to every monetary field introduced after this change, not only to `Service.price`.

#### Scenario: The driver type is confined
- **WHEN** the codebase is inspected
- **THEN** the Prisma decimal type appears only inside the repository's mapper, and the domain entity exposes a string

#### Scenario: A price survives the render path
- **WHEN** a service is listed on the deployed Workers runtime
- **THEN** its price renders without a serialization failure

### Requirement: Service name uniqueness enforced by the database
`prisma/schema.prisma` SHALL declare a composite unique constraint on `Service(ownerId, name)`. The constraint is the authoritative guarantee against duplicates: application-level checking cannot be, because the check and the insert run as separate round trips against a transaction-mode pooler and may not even share a connection. Names are normalized by the application before reaching the database, so the constraint compares already-canonical values.

Scoping the constraint to the owner rather than to a location is deliberate: a service is offered by the business as a whole, and `Service` has no location relation.

#### Scenario: Duplicate insert rejected by the database
- **WHEN** a second service with the same `ownerId` and normalized `name` is inserted
- **THEN** the database rejects the write with a unique-constraint violation

### Requirement: Service repository scopes on the owner column
`PrismaServiceRepository` SHALL implement `IServiceRepository` and map Prisma rows to the domain `Service` entity via a `toDomain` mapper. The domain entity MUST NOT expose Prisma types.

Every method on the contract SHALL take `ownerId` as a required parameter, so that an unscoped service query cannot be expressed by a caller. The contract SHALL provide: a listing of an owner's services; a single-service lookup scoped to an owner, returning `null` when the id does not exist *or* belongs to someone else; a count of active services for the cap; a case-insensitive duplicate check per owner with an exclusion for the row being edited; a create; and an update whose predicate carries the ownership scope directly, so a mismatched owner affects zero rows rather than depending on a prior read having been performed. A zero-row update result SHALL be interpreted as not-found.

The case-insensitive duplicate check MUST NOT be implemented with Prisma's `mode: 'insensitive'`, which compiles to `ILIKE` on PostgreSQL and would treat `%` and `_` in a submitted name as wildcards. The comparison SHALL be performed over a row set bounded by the per-owner cap.

#### Scenario: Listing scopes on the owner column
- **WHEN** the owner listing runs against a mocked Prisma client
- **THEN** the query filters on `ownerId`, and results are returned as domain instances

#### Scenario: Lookup of a foreign service
- **WHEN** a single-service lookup runs with an id belonging to a different owner
- **THEN** it returns `null`, indistinguishably from a non-existent id

#### Scenario: Update scoped by owner
- **WHEN** an update runs with an id belonging to a different owner
- **THEN** zero rows are affected and no data is modified

#### Scenario: Zero-row update means not found
- **WHEN** an update reports zero affected rows
- **THEN** the caller raises a not-found domain error rather than reporting success

#### Scenario: Duplicate check does not interpret metacharacters
- **WHEN** the duplicate check runs for a name containing `%` or `_`
- **THEN** those characters are compared literally and no false duplicate is reported

#### Scenario: The cap count excludes inactive rows
- **WHEN** the count backing the per-owner cap runs
- **THEN** it counts only services whose `isActive` is true

### Requirement: Service queries are indexed and free of N+1
`Service` SHALL carry an index on `(ownerId, isActive)`. The services list SHALL be satisfied by a **single** query selecting only the fields the page renders.

#### Scenario: List query access path
- **WHEN** the services list renders for an owner
- **THEN** one query returns that owner's services, in a deterministic order

### Requirement: Service unique-violation translation is bounded to one business constraint
A unique-constraint violation raised by the database during a service write SHALL be translated into the duplicate-name domain error, so no Prisma error text reaches the presentation layer.

This requirement is the `Service` counterpart of the identically-shaped barber rule already in this capability. They are kept as two requirements rather than one merged rule because each names its own table and its own domain error. This blanket translation is correct **only while `Service` participates in exactly one reachable business unique constraint**, and this change re-audits that bound now that `BarberService(barberId, serviceId)` exists: it holds because assignments are written through their own repository, are never nested inside a service write, and absorb duplicates at the statement level.

No foreign-key violation translation is required: `Service`'s only foreign key is its owner, and the session owner cannot cease to exist mid-request without the request having already failed at authentication.

#### Scenario: Constraint violation translated
- **WHEN** the database rejects a service write with a unique-constraint violation
- **THEN** the caller receives the duplicate-name domain error and the response carries no constraint name, column name, or SQL fragment

#### Scenario: An assignment violation cannot be mistaken for a duplicate service name
- **WHEN** a unique violation originating from the assignment table is raised
- **THEN** it does not surface as the duplicate-name domain error

#### Scenario: The limitation is documented
- **WHEN** `docs/tech-debt.md` is reviewed after this change
- **THEN** it records that the M4 trigger is discharged for the service aggregate as well, and that the re-audit covered both aggregates rather than only the one this change edits

### Requirement: Constraint-violation diagnostics exclude submitted business data
When a database error is recognized as a constraint violation, the log entry SHALL record the driver's error code and the operation, and MUST NOT record the driver's error message. A PostgreSQL unique-violation message embeds the offending column values, so logging it verbatim writes business data into the log stream and allows a submitted name containing quotes or newlines to forge fields in structured log output.

Errors that are **not** recognized SHALL continue to log their message: an unknown failure stripped of its detail cannot be diagnosed by anyone.

This requirement applies to the service write paths, to the assignment write and read paths introduced by this change, and — because this change edits that file for its own reasons — to the barber write path, whose exposure was previously recorded as technical debt. An assignment log entry MUST additionally exclude the submitted service ids and names. The equivalent exposure in the location write path remains recorded as technical debt rather than corrected here, because altering the observable behaviour of a closed change without updating its artifacts is forbidden by the spec-first change policy.

#### Scenario: A recognized violation logs only the code
- **WHEN** a unique-constraint violation is caught during a service write
- **THEN** the log entry contains the driver error code and the operation name
- **THEN** it contains no service name, no key value, and no SQL fragment

#### Scenario: The barber write path no longer logs raw driver messages
- **WHEN** a recognized constraint violation is caught during a barber write
- **THEN** the log entry contains the driver error code and the operation name and no driver message

#### Scenario: An assignment failure logs no business data
- **WHEN** a failure is caught during an assignment write
- **THEN** the log entry contains no service id, service name, or barber name

#### Scenario: An unrecognized failure keeps its detail
- **WHEN** an unexpected database error that is not a recognized constraint violation is caught
- **THEN** the log entry still records its message so the failure can be diagnosed

#### Scenario: The shipped exposure is recorded, not silently changed
- **WHEN** `docs/tech-debt.md` is reviewed after this change
- **THEN** it records that the barber write path is corrected, that the location write path still logs raw driver messages, and the trigger for correcting the latter

### Requirement: BarberService model as single source of truth
The `BarberService` join entity SHALL be defined in `prisma/schema.prisma` with `id` (cuid primary key), `barberId`, `serviceId`, and `createdAt`. It SHALL carry a composite unique constraint on `(barberId, serviceId)` and an index on `serviceId`.

The entity SHALL have no `updatedAt`: it holds no mutable field, so an assignment is created or destroyed, never edited. The index on `serviceId` is required in addition to the composite unique, because the bookability read and the booking flow's "which barbers perform this service" query lead with the service, a direction the composite unique does not serve.

Schema changes SHALL be applied through a migration; direct database edits are forbidden.

#### Scenario: Migration creates the table and its constraints
- **WHEN** the migration is applied
- **THEN** the table exists with the composite unique constraint on `(barberId, serviceId)` and an index on `serviceId`

#### Scenario: Migration is additive
- **WHEN** the migration runs against a database holding existing barbers and services
- **THEN** no existing table is altered, no backfill occurs, and no existing row is modified

### Requirement: Deleting either side of an assignment removes it
Both foreign keys SHALL declare `onDelete: Cascade`. A join row has no meaning without both endpoints, so it is the relationship rather than a child holding data of its own.

This deliberately differs from `Barber → Location`, which restricts deletion because a barber carries data that must not vanish silently. The rule is inert while the application has no hard-delete path and SHALL be stated in the schema so the behaviour is already correct whenever deletion arrives.

#### Scenario: The cascade rules are declared
- **WHEN** the schema is reviewed
- **THEN** both foreign keys declare cascade deletion and the contrast with the barber-to-location rule is recorded

### Requirement: An assignment set is persisted as one batched transaction
The repository SHALL apply an assignment change as a removal statement and an insertion statement submitted together in a single batched transaction, so the set is applied atomically or not at all.

The interactive transaction form MUST NOT be used: it holds a pooled connection open across application round trips against a transaction-mode pooler, which the two statements do not require of each other. Should the batched form prove unavailable at runtime, the replacement SHALL remain a single batch; a sequence of individually awaited writes is forbidden, because a runtime cutoff mid-sequence would leave the database holding a set the owner never chose while the interface reports failure.

#### Scenario: Both statements commit together
- **WHEN** an assignment change adds two services and removes one
- **THEN** all three effects are visible together after the write

#### Scenario: A failure applies nothing
- **WHEN** the write fails partway through
- **THEN** neither the removals nor the additions are visible and the stored set is unchanged

#### Scenario: No interactive transaction is used
- **WHEN** the repository implementation is reviewed
- **THEN** the write uses the batched form and holds no connection across application round trips

### Requirement: A repeated assignment insert is absorbed at the persistence layer
The insertion statement SHALL request that duplicate rows be skipped, so re-inserting an existing assignment is a no-op rather than a constraint violation. A violation on `(barberId, serviceId)` therefore never reaches the application layer and is never translated into a domain error.

#### Scenario: Re-inserting an existing assignment
- **WHEN** the write includes an assignment that already exists
- **THEN** the statement succeeds, the row is unchanged, and no unique-violation error is raised

### Requirement: The same-owner invariant is enforced in the application and proven by test
An assignment row SHALL only ever link a barber and a service belonging to the same owner. No database mechanism can enforce this: `Barber` has no `ownerId` column because its ownership is derived through `location`, so no composite foreign key, unique constraint, or check expression can compare the two sides.

Enforcement SHALL therefore live at exactly one write path, and no other code path may write the table.

The strength of the available proof differs by operation, and the difference SHALL be recorded rather than smoothed over:

- **Reads and deletes** carry the owner as a join predicate (`barber.location.ownerId`) and SHALL be proven against a real database — that the predicate is honoured in SQL, not merely present in the query object.
- **Inserts cannot be scoped at all.** A bulk insert admits no relation filter, so the foreign keys prove only that both ids exist, never that they agree about the owner. For this operation the application service is the whole guarantee, and it SHALL be proven at the application layer by a test that submits a foreign service id and asserts the repository is never reached.

The system permits exactly one `Owner` row, so a test using two real owners is not constructible; a foreign owner **id** stands in for one. This bounds what any of these tests can establish: they prove the predicate discriminates, not that two real tenants are isolated. That residual gap is tracked in `docs/tech-debt.md` (T11) and is not closed by this change.

#### Scenario: A cross-owner assignment is refused before any write
- **WHEN** an assignment is submitted pairing a barber with a service the owner does not own
- **THEN** the application service rejects it and the assignment repository is never called
- **THEN** a valid service id in the same submission is not written either

#### Scenario: The owner predicate discriminates in real SQL
- **WHEN** the assigned-service read and the assignment delete run with a foreign owner id against a real database
- **THEN** the read returns no rows and the delete removes none, while the same queries with the correct owner id succeed

#### Scenario: A single writer
- **WHEN** the codebase is reviewed after this change
- **THEN** the assignment table is written through exactly one repository, reached through exactly one application service

### Requirement: Assignment queries are indexed and free of N+1
The per-barber assigned-service count and the per-service active-barber count SHALL each be obtained with a single aggregate query per list page for the whole owner, joined in memory. Counting per rendered row is forbidden. Both result sets are bounded by the existing per-owner service cap and per-location barber cap.

The per-service count SHALL exclude barbers who are inactive **and** barbers whose location is inactive. Both exclusions belong in the aggregate rather than at the caller: a filter each caller applies for itself is a filter two callers will eventually disagree about, and the count is consumed as a bookability signal whose meaning must not vary by page. Adding the location term costs no extra query — it extends the existing relation filter, which already traverses `barber.location` to scope by owner.

#### Scenario: The barbers list issues one aggregate
- **WHEN** the barbers list renders with many barbers
- **THEN** the assigned-service counts are obtained by a single aggregate query, not one per barber

#### Scenario: The services list issues one aggregate
- **WHEN** the services list renders with many services
- **THEN** the active-barber counts are obtained by a single aggregate query, not one per service

#### Scenario: The per-service count excludes barbers at closed branches
- **WHEN** a service is assigned to an active barber whose location is inactive
- **THEN** that barber does not contribute to the service's active-barber count

#### Scenario: The location filter adds no query
- **WHEN** the services list renders after this change
- **THEN** the active-barber counts are still obtained by exactly one aggregate query

### Requirement: WorkingHours model as single source of truth
The `WorkingHours` entity SHALL be defined in `prisma/schema.prisma` with `id` (cuid primary key), `barberId`, `dayOfWeek`, `startMinute`, `endMinute`, and `createdAt`. It SHALL declare `onDelete: Cascade` on its foreign key and an index on `(barberId, dayOfWeek)`.

The unique constraint SHALL be `(barberId, dayOfWeek, startMinute)`, **not** `(barberId, dayOfWeek)`. The product currently offers one window per day, but the wider constraint keeps a split shift representable without a migration over live data. Narrowing it would trade a free index column today for a migration later.

`startMinute` and `endMinute` are integers, and the entity carries no `updatedAt`: the write replaces rows rather than editing them.

Schema changes SHALL be applied through a migration; direct database edits are forbidden.

#### Scenario: Migration creates the table and its constraints
- **WHEN** the migration is applied
- **THEN** the table exists with the composite unique on `(barberId, dayOfWeek, startMinute)` and an index on `(barberId, dayOfWeek)`

#### Scenario: Migration is additive
- **WHEN** the migration runs against a database holding existing barbers
- **THEN** no existing table is altered, no backfill occurs, and no existing row is modified

#### Scenario: Deleting a barber removes their schedule
- **WHEN** the schema is reviewed
- **THEN** the foreign key declares cascade deletion, because a window has no meaning without its barber

### Requirement: Stored time has one convention, recorded once
The project SHALL distinguish two kinds of stored time, and the distinction SHALL be documented in `docs/data-model.md` rather than inferred from column types:

- A **recurring schedule** is stored as wall-clock minutes from midnight in business local time, with no offset applied at rest.
- A **point in time** is stored as a UTC instant in a zone-aware column (`timestamptz`).

The project's migrations currently default to a zone-less `TIMESTAMP`, which is harmless for `createdAt` and wrong for anything compared against a human's clock. `Booking.startTime` SHALL therefore be `timestamptz` when it is created, and this requirement records that so the story that creates it does not inherit the default by omission.

#### Scenario: A recurring schedule survives a change of civil time
- **WHEN** a stored working window is read
- **THEN** it yields the wall-clock time that was entered, with no offset applied

#### Scenario: The convention is discoverable
- **WHEN** `docs/data-model.md` is reviewed after this change
- **THEN** it states which kinds of time are stored as wall clock and which as UTC instants, and names `timestamptz` for the latter

### Requirement: Timezone conversion is proven on the deployment runtime before it is relied upon
Converting between business local time and UTC requires timezone data, which is a different dataset from the locale data already verified for currency formatting. A runtime that lacks it typically falls back to UTC **silently** rather than raising.

Support SHALL therefore be proven against the deployment runtime by an executable check, and a fallback SHALL be specified rather than improvised: a fixed offset constant, which is exact while the market observes no daylight saving, together with the condition that would invalidate it.

#### Scenario: Round trip on the deployment runtime
- **WHEN** a wall-clock time is converted to a UTC instant and back on the deployment runtime
- **THEN** the original wall-clock time is returned

#### Scenario: A silent fallback is detected rather than assumed
- **WHEN** the check runs against a runtime without timezone data
- **THEN** it reports the failure instead of passing on a UTC-equivalent result

### Requirement: The weekly schedule is replaced as a whole inside one transaction
Saving a schedule SHALL delete the barber's existing windows and insert the submitted set, both statements submitted together in a single batched transaction, so the stored week is the submitted week or is unchanged.

An additive write is forbidden here. A working window has no natural business key, so a retry after a committed-but-timed-out write would insert a second copy of the whole week — the schedule would silently double. Replacement makes the end state depend on the submission rather than on how many times it was applied.

The interactive transaction form MUST NOT be used: it holds a pooled connection across application round trips against a transaction-mode pooler, which these two statements never require of each other.

#### Scenario: Both statements commit together
- **WHEN** a save replaces a five-day week with a six-day week
- **THEN** the stored schedule is the six-day week

#### Scenario: A failure applies nothing
- **WHEN** the write fails partway through
- **THEN** the previously stored schedule is intact

#### Scenario: Replaying the same write converges
- **WHEN** the identical save is applied twice
- **THEN** the stored schedule is the same as after one application

### Requirement: Schedule queries are indexed and scoped through the location relation
The schedule read SHALL be a single query per barber, scoped by owner through `barber.location.ownerId`, and served by the `(barberId, dayOfWeek)` index. The list-page indicator showing which barbers have a schedule SHALL be obtained with a single aggregate for the whole owner, never one query per barber.

#### Scenario: The editor issues one scoped read
- **WHEN** the schedule editor loads
- **THEN** the barber's windows are read in a single query carrying the owner predicate

#### Scenario: The barbers list issues one aggregate
- **WHEN** the barbers list renders with many barbers
- **THEN** the schedule indicator is obtained by a single aggregate query, not one per barber

### Requirement: TimeOff model as single source of truth
The `TimeOff` entity SHALL be defined in `prisma/schema.prisma` with `id` (cuid primary key), `barberId`, `startsAt`, `endsAt`, `reason` (nullable, at most 255 characters), and `createdAt`. It SHALL declare `onDelete: Cascade` on its foreign key and an index on `(barberId, startsAt)`.

`startsAt` and `endsAt` SHALL be zone-aware columns (`@db.Timestamptz`), per the stored-time convention: an absence is a point in time, not a recurring wall-clock fact. Prisma's default for `DateTime` is a zone-less `TIMESTAMP`, which is what this declaration exists to override.

The fields are named `startsAt`/`endsAt` rather than `startDate`/`endDate` deliberately: the earlier naming invited a `date`, and a date has no instant.

Schema changes SHALL be applied through a migration; direct database edits are forbidden.

#### Scenario: Migration creates the table with zone-aware columns
- **WHEN** the migration is applied
- **THEN** both boundary columns are zone-aware, not the zone-less default

#### Scenario: Migration is additive
- **WHEN** the migration runs against a database holding existing barbers
- **THEN** no existing table is altered, no backfill occurs, and no existing row is modified

#### Scenario: Deleting a barber removes their absences
- **WHEN** the schema is reviewed
- **THEN** the foreign key declares cascade deletion, because an absence has no meaning without its barber

### Requirement: An instant survives storage without drifting
Writing an instant and reading it back SHALL return the same instant. This SHALL be confirmed against the real database rather than assumed, because `Timestamptz` is the first zone-aware column in the schema and a silent three-hour drift would look like correct data.

#### Scenario: Round trip through the database
- **WHEN** a known instant is stored and read back
- **THEN** it equals the instant that was written

### Requirement: A repeated absence create is absorbed at the persistence layer
The table SHALL carry a unique constraint on `(barberId, startsAt, endsAt)`, and the insert SHALL request that duplicates be skipped, so re-creating an existing absence is a no-op rather than a constraint violation reaching the application layer.

Unlike the weekly schedule, this write is a row-level create with no replacement semantics, so a retry after a committed-but-timed-out save would otherwise insert a duplicate.

#### Scenario: Re-inserting an existing absence
- **WHEN** the write includes an absence whose barber and boundaries already exist
- **THEN** the statement succeeds, no second row appears, and no unique-violation error is raised

### Requirement: Absence queries are indexed and scoped through the location relation
Every read, create and delete SHALL carry the owner as a predicate through `barber.location.ownerId`. The list read SHALL be a single query per barber, ordered by `startsAt` descending and served by the `(barberId, startsAt)` index.

#### Scenario: The list issues one scoped read
- **WHEN** the absences editor loads
- **THEN** the barber's absences are read in a single query carrying the owner predicate

#### Scenario: A delete scoped to the owner
- **WHEN** a delete is attempted for an absence belonging to another owner
- **THEN** no row is removed

### Requirement: The reason is omitted from projections that do not need it
Reads intended for consumers other than the absences editor SHALL use a projection that does not select `reason`.

The field can hold medical information. A projection that does not carry it cannot leak it, which is a stronger guarantee than remembering not to pass the entity onwards.

#### Scenario: A projection without the reason
- **WHEN** absences are read for availability rather than for the editor
- **THEN** the returned rows carry no reason field

### Requirement: PaymentConfig model as single source of truth
The `PaymentConfig` entity SHALL be defined in `prisma/schema.prisma` with `id` (cuid primary key), `ownerId` (unique), `mpAccessToken`, `mpPublicKey`, `transferCbuCvu` (at most 30 characters), `transferAlias` (at most 60 characters), `transferHolderName` (at most 120 characters), `depositType`, `depositValue`, `createdAt` and `updatedAt`. A `DepositType` enum with values `FIXED` and `PERCENT` SHALL be declared alongside it.

The migration SHALL create the whole table, including the columns PC2 and PC3 will use. A single-row entity introduced piecemeal across three migrations invites the three stories to disagree about its shape; the cost of the alternative is two unused nullable columns for a few days.

`depositValue` SHALL be nullable, overriding the earlier declaration in `data-model.md` §14. The row must exist as soon as transfer details are saved, and no deposit policy is chosen until PC3. `depositType` SHALL retain its `PERCENT` default.

`depositValue` SHALL declare explicit precision and scale (`Decimal(12, 2)`) and SHALL NOT rely on Prisma's default `Decimal(65,30)`, matching the convention `Service.price` established.

Schema changes SHALL be applied through a migration; direct database edits are forbidden.

#### Scenario: Migration creates the table and the enum
- **WHEN** the migration is applied
- **THEN** the table and the `DepositType` enum exist, and `depositValue` is nullable with explicit precision and scale

#### Scenario: Migration is additive
- **WHEN** the migration runs against a database holding an existing owner
- **THEN** no existing table is altered, no backfill occurs, and no existing row is modified

#### Scenario: No configuration row is created by the migration
- **WHEN** the migration completes
- **THEN** no `PaymentConfig` row exists, because the row is created by the owner's first save and never by a migration, a seed or a provisioning script

### Requirement: The configuration is one row per owner, created by upsert
`ownerId` SHALL be unique, and every write SHALL be a single `upsert` keyed on it. The first save creates the row; later saves update it. No write SHALL read the row first and branch on its existence.

A read-then-branch is two round trips against a transaction-mode pooler with no shared connection, so two concurrent first saves both take the create path. The unique key is also what makes a retry after a committed-but-timed-out save idempotent rather than a duplicate.

#### Scenario: The first save creates the row
- **WHEN** the owner saves while no configuration row exists
- **THEN** exactly one row is created for that owner

#### Scenario: A repeated identical save
- **WHEN** the same save is applied twice
- **THEN** the row's transfer columns are unchanged after the second application and no second row appears

### Requirement: A lost race on the singleton row is retried, not reported as a failure
When a write raises a unique-constraint violation on `ownerId`, the operation SHALL be retried exactly once. The retry takes the update path, because the competing write has by then created the row.

Two concurrent saves against a not-yet-existing row both attempt the create branch; the loser receives a constraint violation despite having done nothing wrong, and reporting it as an infrastructure failure tells the owner their save failed when the data is correct. The retry SHALL be bounded to a single attempt; a second violation is a genuine failure.

#### Scenario: Two concurrent first saves
- **WHEN** a write fails with a unique-constraint violation on the owner
- **THEN** the write is retried once, succeeds through the update path, and a single row exists

#### Scenario: A persistent violation
- **WHEN** the retried write also fails
- **THEN** the failure is surfaced rather than retried again

### Requirement: A partial configuration write touches only its own columns
Each story's write SHALL name only the columns it owns and SHALL NOT include any other column in its update. Its create branch SHALL supply only those columns plus the schema defaults.

- The transfer write SHALL set `transferCbuCvu`, `transferAlias` and `transferHolderName`.
- The Mercado Pago write SHALL set `mpAccessToken` and `mpPublicKey`.
- The deposit policy write SHALL set `depositType` and `depositValue`.

Three stories write to one row. A write that supplies the whole entity would silently reset another story's columns to whatever the submitting editor happened to hold, and the write would report success while doing it.

#### Scenario: Saving transfer details with Mercado Pago already configured
- **WHEN** the transfer write is applied to a row holding Mercado Pago credentials and a deposit policy
- **THEN** the credentials and the deposit policy are unchanged

#### Scenario: The create branch of the transfer write
- **WHEN** the row is created by a transfer save
- **THEN** `depositValue` is null and `depositType` holds its default

#### Scenario: Saving Mercado Pago credentials with a transfer destination already configured
- **WHEN** the Mercado Pago write is applied to a row holding a transfer destination and a deposit policy
- **THEN** the destination and the deposit policy are unchanged

#### Scenario: The create branch of the Mercado Pago write
- **WHEN** the row is created by a Mercado Pago save
- **THEN** the transfer columns are null, `depositValue` is null, and `depositType` holds its default

#### Scenario: Removing Mercado Pago credentials
- **WHEN** the Mercado Pago write clears both credentials
- **THEN** only those two columns become null and every other column is unchanged

#### Scenario: Saving a deposit policy with both payment methods already configured
- **WHEN** the deposit policy write is applied to a row holding a transfer destination and Mercado Pago credentials
- **THEN** the destination and the credentials are unchanged

#### Scenario: The create branch of the deposit policy write
- **WHEN** the row is created by a deposit policy save
- **THEN** the transfer columns and both Mercado Pago columns are null

#### Scenario: Removing the deposit policy
- **WHEN** the deposit policy write clears the value
- **THEN** `depositValue` becomes null, `depositType` is left as stored, and every other column is unchanged

### Requirement: The public flow reads transfer details through a narrow projection
A read intended for the public booking flow SHALL use a projection selecting only `transferCbuCvu`, `transferAlias` and `transferHolderName`. The full entity SHALL NOT cross into the public surface.

`mpAccessToken` lives in the same row, and the security rule is that it never reaches the browser. A projection that does not carry it cannot leak it through a serialized prop, a logged object or an error payload — a stronger guarantee than every downstream consumer remembering to strip it.

#### Scenario: The booking flow reads the destination
- **WHEN** transfer details are read for the public flow
- **THEN** the returned object carries no Mercado Pago credential field

### Requirement: The public flow reads the deposit policy through a narrow projection
A read of the deposit policy intended for the public booking flow SHALL use a projection selecting only `depositType` and `depositValue`. The full entity SHALL NOT cross into the public surface.

This is the same control the transfer and public-key projections apply. `mpAccessToken` lives in this row and must never reach the browser, and a projection that does not select it cannot leak it — a stronger guarantee than every downstream consumer remembering to strip it.

#### Scenario: The booking flow reads the policy
- **WHEN** the deposit policy is read for the public flow
- **THEN** the query selects neither credential column and the returned object carries no credential field

#### Scenario: No policy is configured
- **WHEN** the projection is read for an owner whose `depositValue` is null
- **THEN** the read reports the policy as unconfigured rather than substituting a default value

### Requirement: The deposit value crosses the repository boundary as a string in both directions
The deposit value SHALL be converted from the driver's decimal to a canonical two-decimal string when read, and from that string form to the driver's decimal when written. No layer above infrastructure SHALL hold the driver's decimal type for this column, and no conversion SHALL pass through a floating-point intermediate.

The read direction is already required of every monetary field; stating the write direction here is what keeps a value the owner typed from being rounded by a `Number` conversion on its way into a column that decides what clients are charged.

#### Scenario: A value is written and read back
- **WHEN** a deposit value of 8000.50 is saved and read back
- **THEN** the domain receives the string `8000.50` and no floating-point conversion occurred on either leg

### Requirement: Configuration queries are owner-scoped and single-statement
Every read and write SHALL carry `ownerId` as a predicate. The editor read SHALL be one query, and the save SHALL be one statement; no transaction is required for a single-row write.

#### Scenario: A read for another owner
- **WHEN** a configuration is requested for an owner other than the authenticated one
- **THEN** no row is returned

### Requirement: Destinations are stored normalized, never as typed
`transferCbuCvu` SHALL be persisted as digits only and `transferAlias` in lowercase, both trimmed. Normalization SHALL occur before persistence, not at render time.

Two owners entering the same account with different spacing must not produce two different stored strings; any later comparison, deduplication or lookup would treat them as distinct accounts.

#### Scenario: A destination entered with separators
- **WHEN** a CBU containing spaces is saved and read back
- **THEN** the stored value contains digits only

### Requirement: BusinessProfile model as single source of truth
The `BusinessProfile` entity SHALL be defined in `prisma/schema.prisma` with `id` (cuid primary key), `ownerId`, `businessName` (at most 120 characters), `bio` (nullable, at most 1000 characters), `photoUrl` (nullable), `coverUrl` (nullable), `publicSlug` (at most 60 characters), `createdAt` and `updatedAt`. It SHALL declare a unique constraint on `ownerId` and a unique constraint on `publicSlug`.

Ownership is stored, not derived: `ownerId` is a real column, so every read and write scopes on it directly.

Schema changes SHALL be applied through a migration; direct database edits are forbidden.

#### Scenario: Migration is additive
- **WHEN** the migration runs against a database holding existing owners, locations, barbers and services
- **THEN** no existing table is altered, no backfill occurs, and no existing row is modified

#### Scenario: The profile is optional at the schema level
- **WHEN** the schema is reviewed
- **THEN** the relation from `Owner` is nullable, because no profile exists until the owner first saves one

### Requirement: SocialLink model as single source of truth
The `SocialLink` entity SHALL be defined with `id` (cuid primary key), `businessProfileId`, `platform` (the `SocialPlatform` enum), `url` (at most 500 characters), `orderIndex`, and `createdAt`. It SHALL declare `onDelete: Cascade` on its foreign key, a unique constraint on `(businessProfileId, platform)`, and an index on `(businessProfileId, orderIndex)`.

It SHALL carry no `updatedAt`: the set is replaced wholesale rather than edited row by row, following the weekly-schedule precedent.

Cascade is declared for the same reason as on assignments: the row *is* the relationship and has no meaning without either endpoint. It is inert while the application has no hard-delete path, and is declared so it is already correct when one arrives.

#### Scenario: The enum is created by the migration
- **WHEN** the migration is applied
- **THEN** the `SocialPlatform` enum exists with exactly the platforms the data model names

#### Scenario: Deleting a profile removes its links
- **WHEN** the schema is reviewed
- **THEN** the foreign key declares cascade deletion

### Requirement: One profile per owner is enforced by the database
The unique constraint on `ownerId` SHALL be the authority on there being exactly one profile per owner. The application SHALL NOT rely on having read the absence of a profile before creating one.

The check and the write are two round trips against a transaction-mode pooler and may not share a connection, so a read-then-create is not a guarantee. Two concurrent first-ever saves both observe no profile.

#### Scenario: Concurrent first-ever saves
- **WHEN** two saves are submitted simultaneously and no profile exists
- **THEN** exactly one row exists afterwards and the losing write fails on the constraint rather than creating a second

### Requirement: Slug uniqueness is enforced by the database
The unique constraint on `publicSlug` SHALL be the authority on slug uniqueness. A read-then-write check SHALL NOT be treated as one, for the same connection reason.

Slugs SHALL be normalized before persistence, so the constraint compares already-canonical values. The index compares raw bytes; a case- or accent-insensitive column type SHALL NOT be introduced to compensate for values that should have arrived canonical.

#### Scenario: A taken slug
- **WHEN** a save submits a slug already stored on another profile
- **THEN** the database rejects it and the failure surfaces as a field-level message on the slug

#### Scenario: The stored value is canonical
- **WHEN** a slug is persisted
- **THEN** the stored value is its normalized form

### Requirement: Unique-violation translation discriminates the three constraints this change can raise
A unique violation SHALL be translated by inspecting which constraint was violated. `ownerId`, `publicSlug` and `(businessProfileId, platform)` SHALL each map to a distinct domain error; no blanket mapping of any unique violation to a single outcome is acceptable.

The translation SHALL happen in the repository, and what leaves the repository SHALL be a domain error. The driver's error structure SHALL NOT be read outside the infrastructure layer, per the boundary `docs/tech-debt.md` T15 defends.

An owner who double-clicked save and collided on `ownerId` must not be told their slug is taken. This extends the existing rule that unique-violation translation is bounded to one business constraint — here there are three, so the discrimination has to be explicit.

#### Scenario: The discriminator is proven against the real driver
- **WHEN** the constraint identity is read from a unique violation
- **THEN** it is read from the location this stack actually populates, proven by a gate against the real database rather than assumed from Prisma's documented shape

#### Scenario: A profile-uniqueness collision
- **WHEN** a write violates the `ownerId` constraint
- **THEN** the outcome is a retry-oriented message, not a slug error

#### Scenario: A slug collision
- **WHEN** a write violates the `publicSlug` constraint
- **THEN** the outcome is a field-level slug error

#### Scenario: A platform collision
- **WHEN** a write violates the `(businessProfileId, platform)` constraint
- **THEN** the outcome names the duplicated platform

#### Scenario: An unrecognized constraint
- **WHEN** a unique violation names a constraint outside these three
- **THEN** it is treated as an infrastructure failure and logged without submitted business data

### Requirement: The profile and its links are written in one transaction
A save SHALL create or update the profile and replace its social links inside a single transaction: the profile is written, existing links for that profile are deleted, and the submitted links are inserted.

The set is edited as a whole, so an additive write would double the links on a retry after a committed-but-timed-out save. Replacement inside one transaction makes the retry idempotent, which is the same reasoning the weekly schedule follows.

#### Scenario: A retried save after a timeout
- **WHEN** a save is retried after a commit whose acknowledgement was lost
- **THEN** the stored link set equals the submitted set, with no duplicates

#### Scenario: A failed link insert
- **WHEN** inserting the links fails
- **THEN** the profile write is rolled back with them, leaving the previously stored state intact

### Requirement: Profile reads are a single query free of N+1
The editor read SHALL fetch the profile and its social links in one query, ordered by `orderIndex`, carrying `ownerId` as a predicate. A foreign owner's identifier SHALL resolve as absent.

#### Scenario: The editor read
- **WHEN** the profile editor loads
- **THEN** the profile and its links are read in a single owner-scoped query

#### Scenario: A foreign owner
- **WHEN** a read carries an owner identifier that does not own the row
- **THEN** it resolves as absent rather than returning the row

### Requirement: The Mercado Pago access token is ciphertext in the database
`mpAccessToken` SHALL be persisted as an encryption envelope, never as plaintext. `mpPublicKey` SHALL be persisted as plaintext.

The public key is disclosed to every client who reaches the payment step; encrypting it would add a decryption step to a public read path in exchange for nothing. The access token authorizes charges and is the opposite case.

No schema migration is required: the existing nullable string column holds the envelope.

#### Scenario: A stored token is inspected in the database
- **WHEN** the row is read directly from the database
- **THEN** `mpAccessToken` holds an encryption envelope and the token value is not recoverable from the row alone

#### Scenario: The public key is stored
- **WHEN** credentials are saved
- **THEN** `mpPublicKey` holds the value as submitted after normalization, unencrypted

### Requirement: Encryption is applied and removed at the persistence boundary
The persistence layer SHALL encrypt the access token as it writes and decrypt it as it reads, so that callers exchange plaintext with it and never handle an envelope.

This is the boundary that already converts the driver's decimal type to a string and reduces the stored token to a presence flag. Encryption belongs with those conversions: a layer above that handles envelopes is a layer that can log one, serialize one, or forget to decrypt one.

#### Scenario: A caller stores a token
- **WHEN** an application service saves Mercado Pago credentials
- **THEN** it passes the plaintext token and the persistence layer produces the envelope

#### Scenario: A caller reads a token
- **WHEN** the server-side token read is performed
- **THEN** the caller receives plaintext and never sees the stored envelope

### Requirement: The dashboard read reduces the token to a presence flag
The read serving the dashboard SHALL NOT return the access token's value. It SHALL return whether one is stored, and SHALL additionally return the configuration's last-changed timestamp and the last four characters of the stored token.

The value is reduced at the persistence boundary, so nothing above it can leak what it never received. The last-four and last-changed values are what let the dashboard distinguish a completed rotation from an uncertain one without ever handling the credential.

#### Scenario: The dashboard loads the configuration
- **WHEN** the dashboard read is performed on a row holding credentials
- **THEN** the result reports that credentials are present, with the last four characters and the last-changed timestamp, and carries no token value

### Requirement: The public key and the access token are read through separate narrow projections
Two distinct reads SHALL exist for the Mercado Pago columns:

- A projection returning **only** `mpPublicKey`, for the surface that renders the client-side checkout. It SHALL NOT select `mpAccessToken`.
- A projection returning **only** the decrypted access token, for server-side use. Its result SHALL NOT be passed to a component, serialized into a response, or logged.

Keeping them separate is the same control the transfer projection applies: a read that cannot carry the token cannot leak it, which is a stronger guarantee than every consumer remembering to strip it.

#### Scenario: The booking flow reads the public key
- **WHEN** the public key is read for the client-side checkout
- **THEN** the query does not select the access token column and the result carries no token field

#### Scenario: The server reads the access token
- **WHEN** the access token is read for a server-side call
- **THEN** the query selects no other credential or configuration field and returns the decrypted value alone

### Requirement: An unreadable stored token is distinguishable from an absent one
A read of the access token SHALL distinguish three outcomes: no credential stored, a credential stored and decrypted, and a credential stored that cannot be decrypted.

Collapsing the third into the first would report an owner's configured credentials as missing; collapsing it into the second would report them as usable. Both mislead, and both surface far from the cause.

#### Scenario: The stored envelope cannot be decrypted
- **WHEN** the access token read encounters an envelope it cannot decrypt
- **THEN** the caller receives a decryption failure distinct from the no-credential result

### Requirement: Client model as single source of truth
The `Client` entity SHALL be defined in `prisma/schema.prisma` with `id` (cuid primary key), `ownerId`, `name` (at most 120 characters), `email` (at most 255), `phone` (at most 30), `createdAt` and `updatedAt`. It SHALL declare `onDelete: Restrict` on its owner foreign key and a unique constraint on `(ownerId, email)`.

The entity is created by this change and **written by none of it**. `Booking.clientId` is a required foreign key, so the table is not optional scope — it arrives with the booking table or the booking table cannot exist. The deduplication the unique constraint enables belongs to B4.

`Restrict` rather than `Cascade`: a client row is the identity behind real appointments and real money, and it must not disappear because a parent row was removed.

Schema changes SHALL be applied through a migration; direct database edits are forbidden.

#### Scenario: Migration creates the table
- **WHEN** the migration is applied
- **THEN** the `Client` table exists with the unique constraint on owner and email

#### Scenario: Migration is additive
- **WHEN** the migration runs against a database holding existing owners and barbers
- **THEN** no existing table is altered, no backfill occurs, and no existing row is modified

#### Scenario: No application code writes a client
- **WHEN** the change is reviewed
- **THEN** no route, action or repository method in it inserts, updates or deletes a client row

### Requirement: Booking model as single source of truth
The `Booking` entity SHALL be defined in `prisma/schema.prisma` with `id` (cuid primary key), `clientId`, `barberId`, `serviceId`, `startTime`, `endTime`, `status`, `priceAtBooking`, `depositAmount`, `cancellationToken`, `holdExpiresAt`, `cancelledAt`, `cancelledBy`, `createdAt` and `updatedAt`, exactly as `docs/data-model.md` §11 defines them. `BookingStatus` and `CancelledBy` SHALL be native PostgreSQL enums.

Four declarations are load-bearing and SHALL be made in this migration rather than corrected later:

- `startTime`, `endTime`, `holdExpiresAt` and `cancelledAt` SHALL be zone-aware columns (`@db.Timestamptz`). Prisma's default for `DateTime` is a zone-less `TIMESTAMP`, and `docs/data-model.md` names inheriting it by omission as the failure mode the convention exists to prevent.
- `priceAtBooking` and `depositAmount` SHALL declare `@db.Decimal(12, 2)`, never Prisma's `Decimal(65,30)` default — the same declaration `Service.price` carries, deliberately wider than the application maximum so a numeric overflow is unreachable by construction.
- All four foreign keys — `Booking` to client, barber and service, and `Client` to owner — SHALL declare `onDelete: Restrict`. A booking carries data of its own, including money and a cancellation token that has travelled by email, and must not vanish silently with a parent.
- `cancellationToken` SHALL be unique, and the table SHALL carry an index on `(barberId, startTime)`.

The table is created here and written by none of this change. Creating it in one migration rather than assembling it across stories follows the precedent `PaymentConfig` set: an entity assembled across several migrations is several chances for those stories to disagree about its shape.

#### Scenario: Migration creates the table with zone-aware instants
- **WHEN** the migration is applied
- **THEN** all four instant columns are zone-aware, not the zone-less default

#### Scenario: Monetary columns declare their precision
- **WHEN** the schema is reviewed
- **THEN** both monetary columns declare an explicit precision and scale rather than inheriting Prisma's default

#### Scenario: Migration is additive
- **WHEN** the migration runs against the shared database
- **THEN** two tables and two enums are created, no existing column is altered, no backfill occurs, and no existing row is modified

#### Scenario: Foreign keys restrict rather than cascade
- **WHEN** the schema is reviewed
- **THEN** every booking foreign key declares restrict, and the reason is recorded alongside it

#### Scenario: No application code writes a booking
- **WHEN** the change is reviewed
- **THEN** no route, action or repository method in it inserts, updates or deletes a booking row

### Requirement: A provisional hold cannot exist without its expiry
The database SHALL refuse a `Booking` row whose status is `PENDING_PAYMENT` and whose `holdExpiresAt` is null.

Availability treats a `PENDING_PAYMENT` booking as blocking when `holdExpiresAt` is null, deliberately: reading an absent deadline as "expired long ago" would release a slot the instant a write set the status without it. That decision is only safe if the combination cannot occur — otherwise it is a **permanent silent lock**, since the sweep job (B7) selects on `holdExpiresAt < now`, which is false for null, and no surface in the product would explain to the owner why the slot never came back.

The guarantee SHALL be a database constraint rather than an application rule. The application that would enforce it does not exist yet — B4 writes the row — so a rule expressed anywhere else is a rule the story that needs it has not read.

The constraint SHALL be expressed in raw SQL in a migration, because Prisma's schema language cannot declare it, and its existence SHALL be recorded in `prisma/schema.prisma` so that a future reader does not assume the schema file is the whole truth.

`PENDING_APPROVAL` is deliberately **not** covered: a receipt has been uploaded and a human owes an answer, so that state blocks regardless of any deadline and needs none.

#### Scenario: A hold without a deadline is refused
- **WHEN** a booking is written with status `PENDING_PAYMENT` and no `holdExpiresAt`
- **THEN** the database rejects it

#### Scenario: A hold with a deadline is accepted
- **WHEN** a booking is written with status `PENDING_PAYMENT` and a `holdExpiresAt`
- **THEN** it is stored

#### Scenario: The other statuses need no deadline
- **WHEN** a booking is written as `CONFIRMED`, `PENDING_APPROVAL`, `CANCELLED` or `EXPIRED` with no `holdExpiresAt`
- **THEN** it is stored

#### Scenario: The constraint is discoverable from the schema file
- **WHEN** `prisma/schema.prisma` is read
- **THEN** the constraint is named there with the reason it cannot be declared in the schema language

### Requirement: An appointment instant survives storage without drifting
Writing an appointment instant and reading it back SHALL return the same instant, confirmed against the real database rather than assumed.

`TimeOff` established this check for the first zone-aware columns in the schema. It is repeated here because a silent three-hour drift on a booking looks exactly like correct data, and because these are the columns an appointment time is compared against.

#### Scenario: Round trip through the database
- **WHEN** a known appointment instant is stored and read back
- **THEN** it equals the instant that was written

### Requirement: Blocking bookings are read by barber and range, indexed and owner-scoped
The repository SHALL expose a read returning the bookings that may block availability for one barber over a half-open instant range, carrying only `startTime`, `endTime`, `status` and `holdExpiresAt`.

The read SHALL take the owner as a required parameter and scope through `barber.location.ownerId`, so an unscoped booking query is inexpressible through the contract — the same property every other repository in this project holds. It SHALL be a single query served by the `(barberId, startTime)` index, and SHALL return a projection rather than persisted rows.

The range predicate SHALL be the half-open overlap `startTime < rangeEnd AND endTime > rangeStart`, matching the interval convention `TimeOff` and `Booking` share.

#### Scenario: One indexed, scoped query
- **WHEN** availability is computed for a barber and a date
- **THEN** the blocking bookings are read in a single query carrying the owner predicate and served by the barber-and-start-time index

#### Scenario: A foreign barber's bookings cannot be read
- **WHEN** the read is attempted for a barber belonging to a different owner
- **THEN** no rows are returned

#### Scenario: The read is a projection
- **WHEN** the read executes
- **THEN** it selects only the four columns availability needs, and carries no client identifier, token, price or deposit

#### Scenario: An appointment straddling the range boundary is returned
- **WHEN** a booking starts before the range and ends inside it
- **THEN** it is returned, because it overlaps the range under the half-open rule

### Requirement: Monetary columns cross the repository boundary as canonical strings
Should any read in this change or later surface `priceAtBooking` or `depositAmount`, the value SHALL cross the repository boundary as a canonical two-decimal string through the shared helper, never as a number and never as a driver decimal.

PC3 measured against the live database that the driver returns a stored `2000.50` as `2000.5`, and integer-cent arithmetic then read the lone `5` as five centavos. M3 had documented the same failure for `Service.price`. The helper exists and is shared; these two columns are the next place the same defect would land.

#### Scenario: The convention is declared with the columns
- **WHEN** the booking repository is reviewed
- **THEN** the monetary conversion rule is stated and no monetary value crosses a layer as a driver type

### Requirement: The booking tables are verified against the live database by a seeded gate
This change SHALL include a verification script following the existing per-story gate pattern, which seeds bookings directly — including a `PENDING_PAYMENT` booking whose hold has expired — exercises the availability read against the live database, and removes what it created.

No user interface can produce a booking until B4, so without a seeded gate the booking subtraction would be the one part of this change that nothing verifies against real data. This project's runtime verification has caught a defect no unit test did on more than one story.

#### Scenario: The gate seeds what no interface can
- **WHEN** the gate runs
- **THEN** it creates bookings in blocking and non-blocking states, including an expired hold, and asserts which of them affect the offered times

#### Scenario: The gate cleans up
- **WHEN** the gate finishes
- **THEN** every row it created has been removed

### Requirement: The booking tables gain their first writer, and it needs no migration

The booking write SHALL use the schema exactly as B3 created it: two enums, two tables, the `(barberId, startTime)` index, and the check constraint requiring a non-null `holdExpiresAt` on a `PENDING_PAYMENT` row. This change SHALL introduce **no migration**.

B3 created the tables ahead of their writer deliberately, so that the story carrying the concurrency-critical transaction would not also be carrying a schema change against a live database. That property SHALL be preserved: if a column turns out to be needed, it is a decision to surface and record, not a convenience to add mid-change.

The per-row lock the transaction depends on SHALL rely only on facilities available on the deployed PostgreSQL without installing an extension, and its availability SHALL be **verified against the live database** rather than assumed from the version string.

#### Scenario: No schema change
- **WHEN** the change is complete
- **THEN** `prisma/schema.prisma` and `prisma/migrations/` are unchanged

#### Scenario: The check constraint is satisfied by construction
- **WHEN** any booking is inserted with status `PENDING_PAYMENT`
- **THEN** it carries a non-null `holdExpiresAt` and the existing constraint is never the thing that rejects it

#### Scenario: The lock facility is proven
- **WHEN** the verification script runs against the live database
- **THEN** the locking mechanism the transaction uses is confirmed available before any concurrency result is trusted

### Requirement: Client identity is normalized before it reaches the unique index

`Client.email` SHALL be trimmed and lowercased before persistence, and `Client.name` SHALL be normalized by the same shared rule the catalogue entities use. The `(ownerId, email)` unique index compares raw bytes, so the values it compares SHALL already be canonical — this is the same reasoning `BusinessProfile.publicSlug`, `Location.name`, `Barber.displayName` and `Service.name` follow.

Deduplication SHALL be a single upsert keyed on `(ownerId, email)`, not a read followed by a write. The check and the write would be separate round trips against a transaction-mode pooler and may not share a connection, so the database constraint SHALL be the guarantee.

A returning client's `name` and `phone` SHALL be updated to the submitted values. A unique-constraint violation from two concurrent first bookings SHALL be retried once and SHALL NOT surface as a field-level validation error.

#### Scenario: Case variants resolve to one row
- **WHEN** the same address is submitted with different capitalization or surrounding whitespace for one owner
- **THEN** exactly one `Client` row exists

#### Scenario: The same address at two owners
- **WHEN** the same address books at two different owners
- **THEN** two `Client` rows exist, one per owner, and neither owner's read can reach the other

#### Scenario: Dedup is not a read-then-write
- **WHEN** the client resolution is reviewed
- **THEN** it is expressed as a single conflict-aware write against the unique key

### Requirement: The no-overlap invariant is enforced by the database session, never by application reads

A booking SHALL be inserted only inside a transaction that has first acquired a lock scoped to the barber, re-read that barber's candidate bookings for the range through the `(barberId, startTime)` index, and applied the shared blocking predicate. An application-level read-then-write SHALL NOT be treated as sufficient under any circumstances.

The range read SHALL be bounded at **both** ends. B3 measured with `EXPLAIN` that an upper bound alone leaves `endTime` in Filter and walks every earlier row for that barber; the lower bound derives from the maximum permitted service duration, and that derivation is valid only while the duration cap is enforced on write.

The transaction SHALL declare explicit wait and execution timeouts. It pins a pooled connection for its duration, and the pool is shared with the owner's dashboard — an unbounded transaction under contention degrades a surface that has nothing to do with this flow.

#### Scenario: Concurrent inserts for one slot
- **WHEN** several transactions attempt the same barber and overlapping range simultaneously
- **THEN** exactly one row is written and the others are refused

#### Scenario: The read uses the index at both ends
- **WHEN** the overlap query is reviewed
- **THEN** it constrains `startTime` from below as well as above

#### Scenario: The transaction cannot hang a pooled connection
- **WHEN** the transaction is configured
- **THEN** explicit wait and execution timeouts are set rather than inherited from defaults

### Requirement: A booking's monetary and temporal snapshots are written in the declared types

`priceAtBooking` and `depositAmount` SHALL cross the repository boundary as canonical decimal strings in both directions, never as a driver-native numeric and never through a floating-point intermediate. B3 recorded the failure this prevents: a stored `2000.50` returns as `2000.5`, and integer-cent arithmetic then reads the trailing digit as five centavos.

`startTime`, `endTime` and `holdExpiresAt` SHALL be written as UTC instants into their zone-aware columns. No scheduling code on the write path SHALL use the runtime's local calendar accessors, which answer UTC on the deployment runtime and are wrong for the last three hours of every business day while returning a plausible number rather than raising.

#### Scenario: A trailing-zero amount survives the round trip
- **WHEN** a booking is written with a price whose cents end in zero and then read back
- **THEN** the value is unchanged and its cents are interpreted correctly

#### Scenario: An appointment instant does not drift
- **WHEN** a booking is written for a business-local time and read back
- **THEN** it denotes the same instant, including for a booking created during the last three hours of a local day

### Requirement: A cancellation token is unguessable and unique by constraint

`cancellationToken` SHALL be generated from a cryptographically secure random source with at least 256 bits of entropy, encoded URL-safely, and SHALL rely on the column's unique constraint so that a collision is a write failure rather than one client gaining access to another's booking.

It SHALL NOT be derived from the booking's identifiers, the client's data, or a timestamp. It is the only credential the client will ever hold for this appointment, and it authorizes both viewing and — from the story that introduces cancellation — destroying it.

#### Scenario: Tokens are unpredictable
- **WHEN** many bookings are created
- **THEN** no token is derivable from the booking's identifiers, the client's contact data, or its creation time

#### Scenario: A collision fails the write
- **WHEN** a generated token collides with a stored one
- **THEN** the insert fails rather than returning a booking whose token is shared

### Requirement: Booking reads for the public flow carry an explicit projection

Any read of a booking that serves an unauthenticated surface SHALL name its columns explicitly and SHALL NOT select the whole row or eagerly include the client. The confirmation page needs the appointment, the deposit and the hold deadline; it does not need the client's email or phone, and a projection that does not carry them cannot render them by accident.

#### Scenario: The confirmation read
- **WHEN** the hold-confirmation page reads its booking
- **THEN** the query selects a named set of columns that excludes the client's email and phone

#### Scenario: No eager whole-row read on a public path
- **WHEN** the public booking reads are reviewed
- **THEN** none selects the whole row or includes the client relation wholesale

### Requirement: Payment model as single source of truth

The `Payment` table SHALL be defined once in the Prisma schema and SHALL carry: its own id; a required relation to `Booking` restricted on delete; a method enum distinguishing the online gateway from a bank transfer; a status enum of `PENDING`, `APPROVED` and `REJECTED` defaulting to `PENDING`; the amount charged; the external payment and preference identifiers; the approval instant; and creation and update timestamps.

The amount SHALL be declared with explicit precision and scale, never the ORM's default decimal, following the convention the service price established and the booking columns follow. Instants SHALL be declared zone-aware, never inheriting the zone-less default.

The transfer receipt entity is **not** created by this change. Only the payment record and its two enums are.

#### Scenario: The schema declares the table once
- **WHEN** the schema is inspected
- **THEN** exactly one `Payment` model exists, with an explicitly declared decimal precision and zone-aware instants

#### Scenario: A booking cannot be deleted out from under a payment
- **WHEN** deletion of a booking that has payments is attempted
- **THEN** the database restricts it

### Requirement: The external payment identifier is the idempotency key, enforced by the database

The external payment identifier SHALL be unique at the database level.

Duplicate notification delivery is normal operation for this gateway, and idempotency SHALL therefore rest on a constraint rather than on a prior read, which two concurrent deliveries can both pass. The unique violation SHALL be translated as already-processed, and that translation SHALL be qualified on the violated constraint — this codebase already carries a defect where an unqualified violation is reported as a duplicate name.

#### Scenario: A second insert of the same external id fails at the database
- **WHEN** two concurrent handlers insert the same external payment identifier
- **THEN** exactly one succeeds and the other receives a unique violation

#### Scenario: The violation is translated on its own constraint
- **WHEN** the unique violation on the external payment identifier is handled
- **THEN** it is discriminated by constraint and not by assuming which constraint failed

### Requirement: At most one live payment exists per booking

A partial unique index over the booking reference, restricted to rows whose status is not `REJECTED`, SHALL guarantee that a booking has at most one payment that is pending or approved.

The ORM cannot declare a partial index, so it SHALL live in the migration and SHALL be recorded in a schema comment. A schema file that omits a constraint the application depends on will be mistaken for the whole truth — the booking table already carries such a comment for its hold constraint, for the same reason.

#### Scenario: A second live payment is refused
- **WHEN** a second non-rejected payment is inserted for a booking that already has one
- **THEN** the database refuses the write

#### Scenario: A rejected payment does not block a retry
- **WHEN** a booking's only payment is `REJECTED` and a new payment is created
- **THEN** the write succeeds

#### Scenario: The constraint is discoverable from the schema
- **WHEN** the schema file is read
- **THEN** a comment records the partial index and names the migration that creates it

### Requirement: Payment amounts cross the repository boundary as canonical strings

The payment amount SHALL cross the repository boundary as a canonical decimal string in both directions, never as a driver decimal object or a floating-point number.

The driver returns a stored `2000.50` as `2000.5`, and integer-cent arithmetic then reads the trailing digit as five centavos. This was measured when the deposit policy was built and already binds the service price and the booking's snapshot columns; the comparison against the gateway's reported amount is the same arithmetic and the same hazard.

#### Scenario: A trailing-zero amount survives the boundary
- **WHEN** an amount of 2000.50 is read back and compared against a reported gateway amount
- **THEN** the comparison is exact and does not treat it as 2000.05

### Requirement: Payment reads are indexed for the two shapes this feature has

The table SHALL carry an index supporting lookup by booking, and the external payment identifier's uniqueness SHALL serve lookup by that identifier. These are the only two query shapes: the confirmation page and the initiation path ask by booking, the notification handler asks by external identifier or by the payment's own id.

#### Scenario: Neither lookup is a sequential scan
- **WHEN** payments are read by booking or by external payment identifier
- **THEN** each is served by an index

### Requirement: The payment table is verified against the live database by a seeded gate

The migration SHALL be verified against the live database rather than assumed from the schema: the table, both enums, the unique constraint and the partial index SHALL each be confirmed to exist, and the partial index SHALL be confirmed to refuse a second live payment.

The prior booking migration carried a check constraint the ORM could not declare, and the same class of omission here would surface as a duplicate charge rather than as a failed deploy.

#### Scenario: The gate confirms the constraints exist
- **WHEN** the gate script runs against the live database
- **THEN** the table, both enums, the unique external identifier and the partial unique index are each confirmed present

#### Scenario: The gate proves the partial index refuses
- **WHEN** the gate attempts a second non-rejected payment for one booking
- **THEN** the database refuses it and the gate reports the refusal as expected


### Requirement: The sweep's two predicates are each served by a partial index

`Booking` SHALL carry a partial index on `holdExpiresAt` restricted to `PENDING_PAYMENT` rows, and a partial index on `startTime` restricted to `PENDING_APPROVAL` rows.

The existing `(barberId, startTime)` index serves the availability read and the no-overlap check, both of which name a barber. The sweep names no barber — it is a maintenance query over every shop — so neither of its predicates can use that index, and without these two it walks the table every five minutes against a pooler shared with the owner's dashboard and the public booking write.

They are **partial**, not full: the eligible statuses are a small and shrinking minority of a table that grows with every appointment ever made, and a full index would carry every confirmed booking in the product's history for a query that can never match one.

The schema file previously recorded that a partial index on the blocking statuses was rejected as premature because it would optimize a predicate this capability might still refine. That predicate is now written and the indexes match it.

Both SHALL be declared in raw SQL in a migration, because the schema language cannot express a partial index, and their existence SHALL be recorded in the schema file so a future reader does not mistake it for the whole truth — the convention the hold constraint and the one-live-payment index already follow.

#### Scenario: The lapsed-hold sweep is indexed
- **WHEN** the sweep selects `PENDING_PAYMENT` candidates by `holdExpiresAt`
- **THEN** the query is served by the partial index rather than by a sequential scan

#### Scenario: The unanswered-receipt sweep is indexed
- **WHEN** the sweep selects `PENDING_APPROVAL` candidates by `startTime`
- **THEN** the query is served by the partial index rather than by a sequential scan

#### Scenario: History is not carried by the indexes
- **WHEN** a booking is confirmed, cancelled or expired
- **THEN** it leaves both partial indexes

#### Scenario: The indexes are discoverable from the schema file
- **WHEN** `prisma/schema.prisma` is read
- **THEN** both indexes are named there with the reason they cannot be declared in the schema language

### Requirement: The migration adds indexes and touches no data

The migration introducing the sweep's indexes SHALL create indexes only. It SHALL NOT alter a column, add a constraint, backfill a value, or modify any existing row.

Every booking that would be eligible on the day this ships has been eligible for as long as it has existed, and availability has already been treating it as such. There is nothing to correct, and a data-modifying migration over a table this central would be a risk taken for no gain — the scheduled job reaches every one of those rows on its own, in bounded batches, under the same guards it uses forever after.

#### Scenario: The migration is index-only
- **WHEN** the migration runs against the shared database
- **THEN** two indexes are created, no column is altered, no constraint is added, and no row is modified

#### Scenario: The backlog is handled by the job, not the migration
- **WHEN** the first scheduled run executes after the migration
- **THEN** the historical backlog is swept in bounded batches across as many runs as it takes
