## MODIFIED Requirements

### Requirement: The recent-bookings list shows every status, bounded and narrowly projected

The page SHALL render the most recent bookings ordered by creation time, newest first, bounded by a named constant.

The list SHALL include bookings in **every** status, each rendered with a distinguishable badge. `CANCELLED` and `EXPIRED` SHALL be visually distinct from one another: that distinction is the entire reason the product has two statuses, and this list is the first surface in the product where an owner can see that a checkout was abandoned at all.

Each row SHALL show the appointment date and time, the client's name, the service, the barber, the status and the deposit amount. The projection SHALL NOT carry the client's email or telephone number: a field that is not selected cannot reach a log line or a serialized prop, and contact details belong to the story that owns them.

**A cancelled row SHALL name who cancelled it.** Once a client can cancel their own booking, the cancellations counter sums two different events and the status alone cannot separate them — an owner reading "Cancelaciones de hoy: 3" cannot tell how many were their own doing. **This is the other half of the decision not to notify the owner of a client cancellation**: no message is sent, so the surface that replaces the message has to carry the fact. A row whose canceller is null SHALL name nobody, because every such row predates the column being written and inventing an actor would be inventing a fact.

**The projection SHALL widen by exactly one field to support this, and by no more.** The earlier rule that this list's projection must not grow was written when the only thing being added was a control the row's existing fields already supported; it does not extend to a fact the row does not carry. The addition SHALL be the canceller and nothing else — no cancellation instant, no reason, no actor identity beyond which side acted.

**Each row SHALL offer a cancel control where, and only where, the booking is still cancellable.** A terminal booking SHALL render no control rather than a disabled one. The decision SHALL come from the shared eligibility predicate rather than from a status list written into the row, so the control cannot appear where the write would refuse.

Offering that control SHALL NOT require any further widening: it needs the booking's id and its status, both of which the row already carries.

The read SHALL be bounded by a limit. An unbounded list read on the most-visited authenticated page in the product is not acceptable.

#### Scenario: Abandoned and cancelled bookings are both visible and distinguishable

- **WHEN** the owner's recent bookings include one `CANCELLED` and one `EXPIRED`
- **THEN** both are listed, with badges that differ from each other

#### Scenario: A client's cancellation is distinguishable from the owner's own

- **WHEN** the list contains one booking cancelled by the client and one cancelled by the owner
- **THEN** each row names its canceller, and the two are not rendered identically

#### Scenario: A cancellation with no recorded canceller names nobody

- **WHEN** a row renders a `CANCELLED` booking whose canceller is null
- **THEN** the row shows the status and attributes the decision to no one

#### Scenario: The list is bounded

- **WHEN** the owner has several hundred bookings
- **THEN** the read requests at most the configured limit

#### Scenario: Contact details are not projected

- **WHEN** the recent-bookings projection is reviewed
- **THEN** it contains no client email and no client telephone field

#### Scenario: A cancellable row offers the control

- **WHEN** a row renders a `CONFIRMED`, `PENDING_PAYMENT` or `PENDING_APPROVAL` booking
- **THEN** a cancel control is present

#### Scenario: A terminal row offers nothing

- **WHEN** a row renders a `CANCELLED` or `EXPIRED` booking
- **THEN** no cancel control is present, disabled or otherwise

#### Scenario: The control adds no columns to the read

- **WHEN** the projection is compared before and after the cancel control was added
- **THEN** it is unchanged, because the control needs only the id and the status the row already carries

#### Scenario: The projection grows by one field and no more

- **WHEN** the projection is compared before and after this change
- **THEN** the only added field is the canceller
