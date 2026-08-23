## MODIFIED Requirements

### Requirement: A booking blocks only while its hold is live

A booking SHALL block a slot when its status is `PENDING_APPROVAL` or `CONFIRMED`, or when its status is `PENDING_PAYMENT` **and** its `holdExpiresAt` has not passed. A `PENDING_PAYMENT` booking whose `holdExpiresAt` is in the past SHALL NOT block. `CANCELLED` and `EXPIRED` bookings SHALL NOT block.

B7 — the scheduled job that expires abandoned holds — ships three stories later. A status-only filter would let every abandoned checkout remove a slot from sale permanently, with no surface anywhere in the product that would show the owner why.

`PENDING_APPROVAL` is never treated as expired **while its appointment is still in the future**: a receipt has been uploaded and a human owes an answer, and releasing the slot underneath a transfer the owner is about to approve would sell it twice.

**A `PENDING_APPROVAL` booking whose `startTime` has passed SHALL be eligible for expiry.** Its time cannot be sold to anyone any more, so releasing it sells nothing twice — and without this the state has no exit that does not depend on the owner being attentive. An owner on holiday blocks the calendar exactly as an absent reviewer would, so the review surface makes this case rarer rather than impossible. Expiry SHALL NOT be triggered by `holdExpiresAt` for this status, which is the deadline for uploading a receipt and not a deadline for answering one.

This predicate SHALL be defined in one place, and **the booking write SHALL apply that same definition**. It is no longer documented as a rule a future story must share — the second caller now exists, and a disagreement between the two would offer a client a slot and then reject them while they pay.

#### Scenario: An abandoned checkout releases its slot
- **WHEN** a booking at 15:00 is `PENDING_PAYMENT` with a `holdExpiresAt` one hour in the past and no job has expired it
- **THEN** 15:00 is offered

#### Scenario: A live hold blocks
- **WHEN** a booking at 15:00 is `PENDING_PAYMENT` with a `holdExpiresAt` ten minutes in the future
- **THEN** 15:00 is not offered

#### Scenario: An uploaded receipt blocks regardless of the upload deadline
- **WHEN** a booking at 15:00 tomorrow is `PENDING_APPROVAL` and its `holdExpiresAt` is in the past
- **THEN** the slot is not offered

#### Scenario: An unanswered receipt stops blocking once the appointment has passed
- **WHEN** a booking is `PENDING_APPROVAL` and its `startTime` is in the past
- **THEN** it is eligible for expiry and no longer blocks

#### Scenario: A cancelled booking frees its slot
- **WHEN** a booking at 15:00 is `CANCELLED`
- **THEN** 15:00 is offered

#### Scenario: The predicate has one home
- **WHEN** the availability code and the booking write are reviewed
- **THEN** the blocking rule is expressed once and both the read and the write call it

#### Scenario: The read and the write agree
- **WHEN** a slot is offered by the availability read and submitted immediately
- **THEN** the write does not refuse it on blocking grounds

### Requirement: A payment confirmation is a third caller of the blocking rule and of the per-barber lock

A payment confirmation that would place a booking into the calendar after its hold has lapsed SHALL determine whether the slot is still free by calling the shared blocking predicate, and SHALL do so inside a transaction holding **the same per-barber advisory lock the booking write takes**.

**Two further callers now exist and SHALL take the same lock: the transfer receipt write, which moves a booking from `PENDING_PAYMENT` to `PENDING_APPROVAL`, and the owner's approval, which moves it to `CONFIRMED`.** The sweeper remains named as a future caller.

The lock binds only code that takes it. The booking write established it; the lapsed-hold confirmation was the first that *confirms* an existing booking rather than creating one, and the approval is the second. A caller that skipped the lock could place a booking into a slot a concurrent write is in the middle of taking, which is the same double-booking the write's transaction exists to prevent, arriving from the side nobody watches.

The lock SHALL be acquired with a statement executed for its effect rather than a query that reads a column back: the advisory lock function returns `void`, which the driver adapter cannot deserialize, and a test that mocks the query call cannot detect the difference.

The predicate SHALL NOT be re-expressed for any of these callers. If a confirming side and the reading side disagreed about which bookings block, the product would confirm an appointment its own availability considers free, or refuse one it considers taken.

#### Scenario: The confirming path takes the lock
- **WHEN** a lapsed-hold payment confirmation re-checks availability
- **THEN** the transaction holds the same per-barber advisory lock the booking write takes, acquired before the read

#### Scenario: The receipt write takes the lock
- **WHEN** a transfer receipt is accepted and the booking moves to `PENDING_APPROVAL`
- **THEN** the transaction holds the same per-barber advisory lock, acquired before the blocking re-check

#### Scenario: The approval takes the lock
- **WHEN** the owner approves a receipt and the booking moves to `CONFIRMED`
- **THEN** the transaction holds the same per-barber advisory lock

#### Scenario: The confirming path reuses the predicate
- **WHEN** the confirmation determines whether the slot is free
- **THEN** it calls the shared blocking function rather than expressing the blocking statuses again

#### Scenario: The lock is taken by a statement, not a query
- **WHEN** any caller acquires the per-barber advisory lock
- **THEN** it executes the statement for its effect and reads no column back

#### Scenario: A concurrent write and a confirmation cannot both win
- **WHEN** a booking write and a lapsed-hold confirmation contend for the same barber and start time
- **THEN** exactly one of them results in a booking occupying that slot
