## ADDED Requirements

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
