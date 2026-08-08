## ADDED Requirements

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

## MODIFIED Requirements

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
