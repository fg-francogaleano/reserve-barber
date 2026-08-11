## ADDED Requirements

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

## MODIFIED Requirements

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
