## ADDED Requirements

### Requirement: Dashboard aggregates are read through their own owner-scoped port

The summary figures of the dashboard home SHALL be read through a repository port of their own, distinct from the booking repository.

The booking repository states about itself that every one of its methods is keyed by something owner-scoped, so that an unscoped query is inexpressible through it. That property is about reading and writing bookings; an aggregate read returns counts and a sum, not the aggregate root, and widening the booking contract to carry reporting reads would stretch a promise it makes about a different thing. The separation follows the precedent set when a maintenance sweep needed a port that named its own exception rather than eroding an existing contract — here the exception is not to ownership but to shape.

Every method of the aggregate port SHALL take the owner as a parameter, so the property that an unscoped query is inexpressible holds here too.

The port SHALL NOT expose a method that returns booking rows for reporting; the recent-bookings listing is a separate, explicitly projected read.

#### Scenario: The aggregate port is separate and owner-keyed
- **WHEN** the domain repository contracts are reviewed
- **THEN** the dashboard aggregate port is distinct from the booking repository and every method on it takes an owner

#### Scenario: The booking contract is unchanged in kind
- **WHEN** the booking repository is reviewed after this change
- **THEN** it has gained no reporting method

---

### Requirement: An owner-scoped aggregate joins through the barber relation and is computed in one statement

Every aggregate in this capability SHALL reach the owner by joining `barber → location → ownerId`. A booking's location is deliberately not duplicated onto the booking row, so this is the only path, and it is the same one the receipt queue already takes.

The six dashboard figures SHALL be produced by **one statement**, not by six queries. This is required for two independent reasons: a round trip to the pooler has been measured at roughly a third of a second from this deployment, and six separate queries would answer from six different instants, so a booking confirmed mid-render could be counted by one figure and not by another.

The statement SHALL narrow by status, by owner and by an instant range, and SHALL NOT re-express any rule that reads a hold deadline — the shared blocking predicate remains the only definition of whether a booking is still holding its slot, for the reason the booking write and the sweep both record.

There is no row-level security on these tables. Cross-owner isolation SHALL therefore be proven by test against a fixture containing **two owners** with rows in every counted category, because a leaked aggregate produces no row that can look wrong, only a plausible integer.

#### Scenario: The aggregate is one statement
- **WHEN** the aggregate repository is reviewed
- **THEN** the six figures are produced by a single statement scoped through the barber relation

#### Scenario: Another owner's rows are excluded from every figure
- **WHEN** the aggregate is taken against a two-owner fixture
- **THEN** no figure includes the other owner's bookings, payments or receipts

#### Scenario: The blocking rule is not re-expressed in SQL
- **WHEN** the aggregate statement is reviewed
- **THEN** it narrows by status and by instant only, and defers the hold-deadline decision to the shared predicate

---

### Requirement: A monetary aggregate crosses the repository boundary as a canonical string

A sum over a monetary column SHALL be converted at the repository boundary to a canonical decimal string, exactly as every individual monetary column in this project already is. It SHALL NOT cross a layer as a driver type and SHALL NOT be converted to a floating-point number.

The driver returns a stored `2000.50` as `2000.5`, and integer-cent arithmetic then reads the lone `5` as five centavos. This was measured on a stored price and is documented on the service price, the booking's snapshots and the payment's amount. An aggregate is the same shape of value and carries the same defect, and every test that mocks the repository will pass while it is present.

An empty aggregate — no matching rows — SHALL be normalized to a canonical zero rather than surfaced as a null, so that no caller has to decide what a missing sum means.

#### Scenario: A trailing zero survives the sum
- **WHEN** the only matching payment is 2000.50
- **THEN** the value crossing the repository boundary is the canonical string for two thousand pesos and fifty centavos

#### Scenario: An empty sum is a zero
- **WHEN** no payment matches the predicate
- **THEN** the repository returns a canonical zero rather than a null

---

### Requirement: The dashboard aggregate predicates are indexed by measurement, not by assumption

Whether the dashboard aggregate needs new indexes SHALL be decided by measuring the statement against the live database, not by adding indexes in anticipation.

The existing booking index leads with the barber column and serves none of these predicates, which is the same reason the sweep needed indexes of its own. The candidates are an index on booking status with start time, and one on payment status with approval time.

Any index that ships SHALL be declared in a raw-SQL migration and SHALL carry a comment in the schema file pointing at that migration, because a schema-only reading of the project will not see it — the convention every such index here already follows. A migration in this change SHALL add indexes only and SHALL touch no data.

#### Scenario: An index is justified before it is added
- **WHEN** an index is added by this change
- **THEN** the measurement that justified it is recorded

#### Scenario: An added index is visible to a schema reader
- **WHEN** an index is added that Prisma cannot declare
- **THEN** the schema file carries a comment naming the migration that holds it

#### Scenario: The migration touches no data
- **WHEN** the migration is reviewed
- **THEN** it contains no statement that inserts, updates or deletes a row

---

### Requirement: The dashboard aggregates are verified against the live database by a seeded gate

This capability's figures SHALL be verified by an executable gate run against the real database, following the pattern the booking, payment and sweep tables already use.

The gate SHALL seed **two owners** and, for the owner under test, bookings in all five statuses, an `APPROVED` payment whose booking is `EXPIRED`, a `PENDING` receipt whose booking was swept, and a deposit of exactly `2000.50`. It SHALL assert every figure, assert that none of the other owner's rows contributed, assert that the sum keeps its trailing zero, and report the wall-clock cost of the page's reads.

A mock cannot certify this. The project has already recorded that a mocked query can certify a statement the real driver cannot execute, and both the trailing-zero defect and a client that could not be constructed in a non-request context were each found by a live gate and by nothing else.

#### Scenario: The gate proves isolation on real rows
- **WHEN** the gate runs against a two-owner fixture
- **THEN** every figure for the owner under test excludes the other owner's rows

#### Scenario: The gate proves the money path end to end
- **WHEN** the seeded deposit is 2000.50
- **THEN** the gate asserts the rendered figure is two thousand pesos and fifty centavos

#### Scenario: The gate reports the cost
- **WHEN** the gate completes
- **THEN** it prints the wall-clock duration of the page's reads
