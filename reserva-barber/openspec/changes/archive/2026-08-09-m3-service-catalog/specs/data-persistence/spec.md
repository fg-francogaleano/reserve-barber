## ADDED Requirements

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

This requirement is the `Service` counterpart of the identically-shaped barber rule already in this capability. They are kept as two requirements rather than one merged rule because each names its own table and its own domain error, and M4 invalidates both independently. This blanket translation is correct **only while `Service` participates in exactly one business unique constraint**. The limitation SHALL be recorded with the trigger that invalidates it, because story M4 introduces `BarberService(barberId, serviceId)`, after which an unrelated violation would render a message about a name the owner never touched.

No foreign-key violation translation is required: `Service`'s only foreign key is its owner, and the session owner cannot cease to exist mid-request without the request having already failed at authentication.

#### Scenario: Constraint violation translated
- **WHEN** the database rejects a service write with a unique-constraint violation
- **THEN** the caller receives the duplicate-name domain error and the response carries no constraint name, column name, or SQL fragment

#### Scenario: The limitation is documented
- **WHEN** `docs/tech-debt.md` is reviewed after this change
- **THEN** it records that the translation is unqualified and names M4 as the trigger to qualify it

### Requirement: Constraint-violation diagnostics exclude submitted business data
When a database error is recognized as a constraint violation, the log entry SHALL record the driver's error code and the operation, and MUST NOT record the driver's error message. A PostgreSQL unique-violation message embeds the offending column values, so logging it verbatim writes business data into the log stream and allows a submitted name containing quotes or newlines to forge fields in structured log output.

Errors that are **not** recognized SHALL continue to log their message: an unknown failure stripped of its detail cannot be diagnosed by anyone.

This requirement applies to the service write paths introduced by this change. The equivalent exposure in the already-shipped location and barber write paths SHALL be recorded as technical debt rather than corrected here, because altering the observable behaviour of a closed change without updating its artifacts is forbidden by the spec-first change policy.

#### Scenario: A recognized violation logs only the code
- **WHEN** a unique-constraint violation is caught during a service write
- **THEN** the log entry contains the driver error code and the operation name
- **THEN** it contains no service name, no key value, and no SQL fragment

#### Scenario: An unrecognized failure keeps its detail
- **WHEN** an unexpected database error that is not a recognized constraint violation is caught
- **THEN** the log entry still records its message so the failure can be diagnosed

#### Scenario: The shipped exposure is recorded, not silently changed
- **WHEN** `docs/tech-debt.md` is reviewed after this change
- **THEN** it records that the location and barber write paths log raw driver messages, and the trigger for correcting them
