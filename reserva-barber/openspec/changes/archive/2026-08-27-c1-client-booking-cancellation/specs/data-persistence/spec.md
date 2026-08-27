## ADDED Requirements

### Requirement: The cancellation columns gain their second writer, resolved by token instead of by owner

The repository SHALL expose a **token-scoped cancellation write**, separate from the owner-scoped one, and neither SHALL be reachable through the other.

**They are two methods rather than one because they resolve the booking through different credentials** — a session joined through the barber's location's owner, versus a unique token. A single method accepting "one or the other" is one edit away from accepting neither, on the write that destroys a confirmed appointment.

The write SHALL run in **one transaction** that:

- sets `status` to `CANCELLED`, `cancelledAt` to the deciding instant, `cancelledBy` to `CLIENT`, and `holdExpiresAt` to null;
- is **conditional on the status it read**, so a booking that moved underneath matches zero rows and is reported as what it became;
- takes **no advisory lock**, because it only releases a slot and a release cannot double-book;
- leaves an `APPROVED` payment untouched, guarded by the write's own condition rather than by a branch;
- sets a `PENDING` payment to `REJECTED`;
- writes **nothing** to any `TransferReceipt`.

The transaction SHALL guard on **status alone**. The eligibility rule reads a deadline, and a SQL copy of it would drift from the availability read the first time either is refined — the same drift the provisional-hold write forbids by name. Status is also the only input that races: the sweep and the notification both write it, while `startTime` never moves and `holdExpiresAt` only ever moves later.

**No migration SHALL be required.** `cancelledAt`, `cancelledBy` and the `CancelledBy` enum already exist, and `CLIENT` is already a member of that enum; this write is simply the first to store it.

The write SHALL return the shop's public slug alongside its outcome, so the caller can return the client to their own page without trusting a value the client submitted.

#### Scenario: The client's attribution reaches the database

- **WHEN** a booking is cancelled through the token-scoped write
- **THEN** the stored row carries `cancelledBy` of `CLIENT`, a non-null `cancelledAt`, and a null `holdExpiresAt`

#### Scenario: The status guard refuses a booking that moved

- **WHEN** the booking's status changes between the read and the write
- **THEN** the update matches zero rows and no column is written

#### Scenario: An approved payment is untouched

- **WHEN** the cancelled booking carries an `APPROVED` payment
- **THEN** the payment row is unchanged, including its approval instant, verified by comparing the whole row before and after

#### Scenario: A receipt is not written

- **WHEN** the cancelled booking carries a receipt in any state
- **THEN** the receipt row is unchanged

#### Scenario: No lock is taken

- **WHEN** the transaction is reviewed
- **THEN** it acquires no advisory lock, and the type it is written against offers no way to acquire one

#### Scenario: The schema is untouched

- **WHEN** the change is applied
- **THEN** no migration is added and the Prisma schema's cancellation columns are unchanged

---

### Requirement: A cancellation-rejected payment may still be approved by a later notification, and that is intended

The payment confirmation write guards its approval on the **absence of a gateway payment identifier**, not on the payment's status. A payment set to `REJECTED` by a client cancellation therefore remains eligible for approval by a notification that arrives afterwards, and the resulting row SHALL be left as `APPROVED` with its approval instant.

**This SHALL be treated as correct rather than as a race to be closed.** The money really did move. Forcing the row to stay `REJECTED` would make the client's own page silent about cash that left their account, because the sentence telling them a refund has to be arranged with the shop is conditioned on the payment being approved.

The booking SHALL remain `CANCELLED` — its own guard refuses the confirmation — and the outcome SHALL be reported as an approved payment for a booking that no longer exists, at the level that case already carries.

The ordering SHALL be exercised by test in **both directions**, because the behaviour currently depends on which column a guard happens to name.

#### Scenario: The notification arrives after the cancellation

- **WHEN** a client cancels a booking with a `PENDING` payment and an approved notification arrives afterwards
- **THEN** the payment is `APPROVED`, the booking is still `CANCELLED`, and the outcome is reported as a payment for a booking that no longer exists

#### Scenario: The cancellation arrives after the confirmation

- **WHEN** the notification confirms the booking first
- **THEN** the client's cancellation is applied to a `CONFIRMED` booking and the approved payment is left untouched

#### Scenario: The client's page states the money

- **WHEN** the page renders a cancelled booking whose payment ended `APPROVED`
- **THEN** it states that the deposit is not returned by this system
