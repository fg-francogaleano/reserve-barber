## ADDED Requirements

### Requirement: A payment confirmation is a third caller of the blocking rule and of the per-barber lock

A payment confirmation that would place a booking into the calendar after its hold has lapsed SHALL determine whether the slot is still free by calling the shared blocking predicate, and SHALL do so inside a transaction holding **the same per-barber advisory lock the booking write takes**.

The lock binds only code that takes it. The booking write established it; the sweeper and the transfer approval are named as future callers; this is a third, and it is the first that *confirms* an existing booking rather than creating one. A confirmation that skipped the lock could place a booking into a slot a concurrent write is in the middle of taking, which is the same double-booking the write's transaction exists to prevent, arriving from the side nobody watches.

The predicate SHALL NOT be re-expressed for this caller. If the confirming side and the reading side disagreed about which bookings block, the product would confirm an appointment its own availability considers free, or refuse one it considers taken.

#### Scenario: The confirming path takes the lock
- **WHEN** a lapsed-hold payment confirmation re-checks availability
- **THEN** the transaction holds the same per-barber advisory lock the booking write takes, acquired before the read

#### Scenario: The confirming path reuses the predicate
- **WHEN** the confirmation determines whether the slot is free
- **THEN** it calls the shared blocking function rather than expressing the blocking statuses again

#### Scenario: A concurrent write and a confirmation cannot both win
- **WHEN** a booking write and a lapsed-hold confirmation contend for the same barber and start time
- **THEN** exactly one of them results in a booking occupying that slot
