## ADDED Requirements

### Requirement: The cancellation columns gain their first writers, with no migration

`Booking.cancelledAt` and `Booking.cancelledBy` have existed since the booking tables were created and have never been written. This capability is their first writer, and it SHALL add **no migration**: the columns and the `CancelledBy` enum are already in place, declared whole rather than assembled across stories.

Every path that writes `CANCELLED` SHALL write both columns. A cancelled booking with no recorded canceller cannot be attributed once more than one party can cancel, and no later read can recover the answer.

`cancelledBy` SHALL be `OWNER` for both owner-initiated cancellation and receipt rejection — the owner is the actor in both — leaving `CLIENT` for the story that gives clients a cancellation of their own.

Rows cancelled before this capability SHALL keep their nulls. **No backfill:** inventing a canceller for historical rows would be a guess presented as data, where a null honestly records that nobody was tracking it.

#### Scenario: No migration is added
- **WHEN** the change is reviewed
- **THEN** it contains no migration directory and the schema file is unchanged

#### Scenario: Both columns are written together
- **WHEN** any path writes `CANCELLED`
- **THEN** it writes `cancelledAt` and `cancelledBy` in the same statement

#### Scenario: Historical rows are left alone
- **WHEN** a booking cancelled before this capability is read
- **THEN** its canceller and instant are null

---

### Requirement: The cancellation write touches one booking and nothing that describes another

The cancellation SHALL be keyed by booking id, scoped to the caller's owner through the barber's location, and guarded on the status it expects.

It SHALL NOT touch any monetary or temporal snapshot, the cancellation token, or either of the booking's foreign keys. It SHALL clear `holdExpiresAt`, because a finished booking has no hold left to describe — deliberately unlike an expired row, which preserves it as the evidence of why the row ended.

The payment and receipt writes in the same transaction SHALL each be **conditional on the status they expect**, so a payment already `APPROVED` and a receipt already reviewed match zero rows rather than being rewritten.

**Verification of what a write touched SHALL compare the stored row before and after**, not the arguments passed to the update. A test asserting the argument shape cannot see a column the ORM adds — which is how a related claim in a previous story was found to be false.

#### Scenario: Snapshots and identity are untouched
- **WHEN** a booking is cancelled
- **THEN** its price, deposit, appointment instants, token and foreign keys are unchanged

#### Scenario: The hold deadline is cleared, unlike an expiry
- **WHEN** a `PENDING_PAYMENT` booking is cancelled
- **THEN** its `holdExpiresAt` is null

#### Scenario: An approved payment matches zero rows
- **WHEN** the transaction attempts the payment write against an `APPROVED` payment
- **THEN** zero rows match and the payment is unchanged

#### Scenario: The comparison is against the database
- **WHEN** the write is verified
- **THEN** the stored row is read before and after and compared

---

### Requirement: The public booking projection carries the canceller

The projection feeding the client's confirmation page SHALL carry `cancelledBy`, so the page can name who cancelled rather than inferring it from the status.

It SHALL remain within its existing bounds: no client email, no telephone, no payment-configuration column. Adding the canceller widens the projection by one enum and nothing else.

#### Scenario: The canceller reaches the page
- **WHEN** the confirmation page reads a cancelled booking
- **THEN** the projection carries who cancelled it

#### Scenario: The projection is not otherwise widened
- **WHEN** the projection is compared before and after this change
- **THEN** the only added field is the canceller
