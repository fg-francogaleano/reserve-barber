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

#### Scenario: The barbers list issues one aggregate
- **WHEN** the barbers list renders with many barbers
- **THEN** the assigned-service counts are obtained by a single aggregate query, not one per barber

#### Scenario: The services list issues one aggregate
- **WHEN** the services list renders with many services
- **THEN** the active-barber counts are obtained by a single aggregate query, not one per service

