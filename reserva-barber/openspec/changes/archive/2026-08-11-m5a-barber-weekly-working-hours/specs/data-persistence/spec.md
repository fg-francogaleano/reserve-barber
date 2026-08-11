## ADDED Requirements

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
