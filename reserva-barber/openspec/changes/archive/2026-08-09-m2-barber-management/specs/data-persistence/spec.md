## ADDED Requirements

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
