## ADDED Requirements

### Requirement: A booking records when its client was told it was confirmed

`Booking` SHALL gain a nullable, zone-aware column recording the instant the email provider accepted the confirmation message, declared `@db.Timestamptz(3)` like every other instant on this table and for the reason `docs/data-model.md` gives: Prisma's zone-less default is the failure mode that convention exists to prevent.

The column SHALL be added by its own migration. The migration SHALL be purely additive — one nullable column, no backfill, no altered column, no modified row — so that every booking that existed before this change reads as "never told", which is exactly what is true of them.

**No index SHALL be added.** Nothing queries the column yet; the story that gives "confirmed but never told" a surface is the story that should measure and index it, in the way the dashboard aggregates were indexed by measurement rather than by assumption.

The column SHALL NOT be used as an idempotency key. At-most-once delivery is a property of the guarded status transition, and a second mechanism claiming the same guarantee is a second thing to get wrong.

`docs/data-model.md` §11 SHALL be updated in the same change, per the spec-first policy.

#### Scenario: The migration is additive
- **WHEN** the migration runs against the shared database
- **THEN** one nullable column is added, no existing column is altered, no backfill occurs, and no existing row is modified

#### Scenario: The instant is zone-aware
- **WHEN** the schema is reviewed
- **THEN** the column is `Timestamptz` rather than the zone-less default

#### Scenario: Pre-existing bookings read as never told
- **WHEN** a booking confirmed before this change is read
- **THEN** its send instant is null

#### Scenario: It is not an idempotency key
- **WHEN** the send path is reviewed
- **THEN** no code reads the column to decide whether to send

---

### Requirement: The confirmation message is composed from one named projection that deliberately carries the client's address

The read that composes the confirmation email SHALL be a single explicit projection naming its columns, and SHALL be the only read in the notification and review paths that selects the client's email address.

It SHALL carry exactly what the message needs: the client's name and email, the shop's public name and slug, the branch name and address, the barber's display name, the service name, the appointment's start instant, the price and deposit as canonical decimal strings, and the cancellation token.

It SHALL NOT select the phone, SHALL NOT select the whole row, SHALL NOT include the client relation wholesale, and SHALL NOT carry any payment-configuration column — encrypted or otherwise.

**This is a deliberate, named exception to the projection rule the public-flow reads follow.** That rule exists because the confirmation *page* can be opened on a shared device, so a projection that cannot carry contact detail cannot render it by accident. An email is addressed to that contact detail; the column is the destination rather than a leak. The exception SHALL be documented in the contract that declares it, so that a later reader finds a decision rather than an inconsistency.

Monetary values SHALL cross the repository boundary as canonical decimal strings, like every other money column, because the driver returns a stored `2000.50` as `2000.5` and a message rendering the lone `5` as five centavos would be wrong in a place nobody can correct after sending.

#### Scenario: The projection names its columns
- **WHEN** the confirmation-message read runs
- **THEN** it selects a named set of columns rather than the whole row or a wholesale client include

#### Scenario: The phone is not selected
- **WHEN** the projection is reviewed
- **THEN** it carries no phone column

#### Scenario: No credential can ride along
- **WHEN** the projection's type is reviewed
- **THEN** it has no field capable of holding an access token or any payment-configuration value

#### Scenario: Money crosses as a canonical string
- **WHEN** a booking with a stored deposit of `2000.50` is read for the message
- **THEN** the value crosses the boundary as a canonical decimal string rather than as a driver number

#### Scenario: The exception is documented where it is declared
- **WHEN** the repository contract is read
- **THEN** it states that this projection selects the client's email, and why that is correct for a message and not for a page

---

### Requirement: Recording the send is a guarded write that cannot alter a booking's state

The write that records the send instant SHALL set that column and SHALL disturb nothing that describes what the booking is. It SHALL NOT touch `status`, `holdExpiresAt`, `cancelledAt`, `cancelledBy`, the cancellation token, either foreign key, or any monetary or temporal snapshot.

**The ORM's own `updatedAt` moves with it, and the requirement is written to admit that rather than to forbid it.** An earlier form of this requirement said "that column and no other"; the live-database gate compared the whole row before and after and found Prisma bumping `updatedAt`, as it does on every write through the client. Expressing the write as raw SQL to make the stricter claim true would make it the only write in the product to bypass the client, for a property nothing depends on. The one reader of `updatedAt` — the page's proxy for the confirmation instant — consults it only when the send instant is null, which is exactly when this write did not run.

It SHALL be keyed by booking id and SHALL run outside the confirming transaction.

A failure of this write SHALL NOT roll anything back and SHALL NOT be surfaced as a failure to its caller; it SHALL be logged.

#### Scenario: Nothing describing the booking moves
- **WHEN** the send instant is recorded
- **THEN** the whole row is unchanged except for that column and the ORM's `updatedAt`

#### Scenario: The row is compared against the database, not against the query
- **WHEN** the write is verified
- **THEN** the comparison is of the stored row before and after, because a test asserting the update's arguments cannot see a column the ORM adds

#### Scenario: A failed record does not undo a confirmation
- **WHEN** the recording write fails
- **THEN** the booking remains `CONFIRMED` and the caller's outcome is unchanged
