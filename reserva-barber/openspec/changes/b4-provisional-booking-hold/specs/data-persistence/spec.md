## ADDED Requirements

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
