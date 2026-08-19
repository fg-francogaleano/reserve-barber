## MODIFIED Requirements

### Requirement: Choosing a time reserves nothing

The flow SHALL present the slot list as a snapshot. No copy on the date step or the time step SHALL state or imply that the chosen time is held, reserved, or guaranteed. Selecting a time SHALL write nothing: the selection lives in the query string, and a query string is not a claim.

Two clients can be looking at the same start. The truth is the booking transaction, which re-validates availability rather than trusting the selection carried in the URL — and which may legitimately refuse a time this list offered a moment earlier.

**A time becomes held only when the client submits their details and the transaction accepts the write.** The prohibition on writing a `Booking` or `Client` row from any route or action applied to B3, whose scope was the read side; it does not extend to the booking write, which is the one writer this capability's blocking rule was designed around. Nothing on the date or time step, however, SHALL create or reserve anything.

#### Scenario: The copy makes no promise
- **WHEN** a time is selected
- **THEN** no Spanish string on the date or time step states that the time is reserved or held

#### Scenario: Selecting writes nothing
- **WHEN** a client moves through the date and time steps, including selecting a time
- **THEN** no `Booking` and no `Client` row is created

#### Scenario: The offered list is not a guarantee
- **WHEN** a client submits a time that this list offered and another booking took it in between
- **THEN** the write is refused, confirming that the list was a snapshot rather than a hold

### Requirement: A booking blocks only while its hold is live

A booking SHALL block a slot when its status is `PENDING_APPROVAL` or `CONFIRMED`, or when its status is `PENDING_PAYMENT` **and** its `holdExpiresAt` has not passed. A `PENDING_PAYMENT` booking whose `holdExpiresAt` is in the past SHALL NOT block. `CANCELLED` and `EXPIRED` bookings SHALL NOT block.

B7 — the scheduled job that expires abandoned holds — ships three stories later. A status-only filter would let every abandoned checkout remove a slot from sale permanently, with no surface anywhere in the product that would show the owner why.

`PENDING_APPROVAL` is never treated as expired: a receipt has been uploaded and a human owes an answer.

This predicate SHALL be defined in one place, and **the booking write SHALL apply that same definition**. It is no longer documented as a rule a future story must share — the second caller now exists, and a disagreement between the two would offer a client a slot and then reject them while they pay.

#### Scenario: An abandoned checkout releases its slot
- **WHEN** a booking at 15:00 is `PENDING_PAYMENT` with a `holdExpiresAt` one hour in the past and no job has expired it
- **THEN** 15:00 is offered

#### Scenario: A live hold blocks
- **WHEN** a booking at 15:00 is `PENDING_PAYMENT` with a `holdExpiresAt` ten minutes in the future
- **THEN** 15:00 is not offered

#### Scenario: An uploaded receipt blocks regardless of age
- **WHEN** a booking at 15:00 is `PENDING_APPROVAL` and its `holdExpiresAt` is in the past
- **THEN** 15:00 is not offered

#### Scenario: A cancelled booking frees its slot
- **WHEN** a booking at 15:00 is `CANCELLED`
- **THEN** 15:00 is offered

#### Scenario: The predicate has one home
- **WHEN** the availability code and the booking write are reviewed
- **THEN** the blocking rule is expressed once and both the read and the write call it

#### Scenario: The read and the write agree
- **WHEN** a slot is offered by the availability read and submitted immediately
- **THEN** the write does not refuse it on blocking grounds
