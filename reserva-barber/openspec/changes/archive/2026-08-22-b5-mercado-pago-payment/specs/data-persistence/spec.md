## ADDED Requirements

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
