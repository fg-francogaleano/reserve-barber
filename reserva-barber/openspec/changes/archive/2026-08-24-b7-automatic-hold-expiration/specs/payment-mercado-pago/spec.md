## MODIFIED Requirements

### Requirement: A payment that arrives after the hold lapsed is defended in three layers

**Prevention.** Every preference SHALL carry an expiry set to the booking's `holdExpiresAt`, so Mercado Pago refuses an attempt begun after the hold lapsed.

**Detection.** A notification approving a booking whose hold has lapsed SHALL re-check availability inside a transaction that takes **the same per-barber advisory lock the booking write takes**, applying `blocksAvailability` — the same function, never a reimplementation. This capability is a third caller of that lock, after the booking write and alongside the transfer approval. **The sweeper, previously named here as a further caller, takes no lock**: it only releases slots, and a release cannot double-book.

**Preservation.** The detection layer is guarded on the booking still being `PENDING_PAYMENT`, so it works only for as long as that status survives. The scheduled sweep SHALL therefore leave a lapsed hold alone for a grace window before expiring it. **Without that window this requirement would be quietly narrowed by the sweep rather than by a decision**: preference expiry stops an attempt *begun* after the hold lapsed, but not one begun moments before it and approved moments after, and every such payment would arrive to find a booking that no longer exists. The guarantee below is unconditional only while a lapsed hold is still `PENDING_PAYMENT`; the grace window is what keeps it meaningful.

**Outcome.** If the slot is still free, the booking SHALL be confirmed despite the lapsed hold: a client who paid and whose slot nobody took must not lose it to a clock. If the slot has been taken, the booking SHALL NOT be confirmed, the payment SHALL still be recorded `APPROVED` because it is a real charge, and the outcome SHALL be surfaced to the client on their page and to the owner. A refund the owner never learns about is a defect, not a deferred feature.

#### Scenario: Late payment, slot still free
- **WHEN** an approved notification arrives after `holdExpiresAt` and no other booking occupies that barber and start time
- **THEN** the booking is transitioned to `CONFIRMED`

#### Scenario: Late payment inside the grace window is still recoverable
- **WHEN** an approved notification arrives minutes after `holdExpiresAt`, before the sweep is permitted to expire the booking, and the slot is free
- **THEN** the booking is transitioned to `CONFIRMED` rather than reported as a booking that no longer exists

#### Scenario: Late payment, slot resold
- **WHEN** an approved notification arrives after `holdExpiresAt` and another booking now blocks that barber and start time
- **THEN** the original booking is not confirmed, the newer booking is untouched, the payment is recorded `APPROVED` with a slot-lost outcome logged, and Mercado Pago receives `200`

#### Scenario: The re-check uses the shared predicate under the shared lock
- **WHEN** the late-payment re-check runs
- **THEN** it holds the same per-barber advisory lock the booking write takes and calls `blocksAvailability` rather than expressing the blocking rule again
