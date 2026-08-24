# booking-hold-expiration Specification

## Purpose
The scheduled job that writes `EXPIRED`, and the only thing in this product that does. It does **not** free slots — availability has ignored a lapsed hold since B3, by evaluating `holdExpiresAt` at read time — so what this capability adds is the terminal record: the status that describes what happened, so a reader who filters on status alone is correct rather than accidentally correct. It sweeps two kinds of booking, a `PENDING_PAYMENT` hold ten minutes past its deadline and a `PENDING_APPROVAL` receipt whose appointment has passed, and it is the first cross-owner write in the product. Created by archiving change b7-automatic-hold-expiration.
## Requirements

### Requirement: A scheduled sweep is the only writer of `EXPIRED`

The system SHALL run a scheduled job that transitions abandoned provisional bookings to `EXPIRED`. It SHALL be the only code in the product that writes that status.

**The sweep does not free slots.** Availability stops counting a lapsed hold the instant it lapses, by evaluating `holdExpiresAt` at read time, and every read and write path already calls that shared predicate. What the sweep provides is the terminal record: a status that describes what happened, so that a reader who filters on status alone — the shape D1's counters will take — is correct rather than accidentally correct.

The job SHALL be scheduled at a cadence of five minutes. Cadence is a data-freshness choice and SHALL NOT be treated as a correctness one: no client-visible behaviour depends on how soon after eligibility a row is swept.

#### Scenario: An abandoned checkout is swept
- **WHEN** the sweep runs and a `PENDING_PAYMENT` booking's `holdExpiresAt` passed longer ago than the grace window
- **THEN** the booking's status is `EXPIRED`

#### Scenario: Availability is unchanged by the sweep
- **WHEN** the same slot's availability is computed before and after the sweep runs
- **THEN** the answer is identical in both cases

#### Scenario: No other code writes the status
- **WHEN** the codebase is reviewed
- **THEN** no route, action, service or repository outside this capability writes `EXPIRED`



### Requirement: A lapsed hold is not swept until the grace window has passed

A `PENDING_PAYMENT` booking SHALL become eligible for expiry only once its `holdExpiresAt` is earlier than the current instant minus `EXPIRY_GRACE_MINUTES`. The grace SHALL be **10 minutes**, declared beside the other booking-horizon constants and disclosed as a judgement rather than a measurement.

**The grace exists to protect the late-payment guarantee, and without it this capability is a regression.** A Mercado Pago approval that arrives after the hold lapsed still confirms the booking when nobody took the slot — that path is guarded on the booking being `PENDING_PAYMENT`. A sweep with no grace flips the row to `EXPIRED` first, and the same notification then reports an approved payment against a booking that no longer exists: money taken, appointment gone, refund arranged by hand. Preference expiry set at `holdExpiresAt` prevents an attempt *begun* after the hold lapsed; it does not prevent an attempt begun just before it from being approved just after.

The grace SHALL cost nothing in availability terms, because the slot is sellable throughout it.

#### Scenario: A hold that lapsed inside the grace window survives
- **WHEN** the sweep runs and a `PENDING_PAYMENT` booking's `holdExpiresAt` passed three minutes ago
- **THEN** the booking is still `PENDING_PAYMENT`

#### Scenario: A late approval inside the grace still confirms
- **WHEN** an approved notification arrives for that booking and no other booking blocks the slot
- **THEN** the booking is transitioned to `CONFIRMED` rather than reported as no longer existing

#### Scenario: The same hold is swept once the grace has passed
- **WHEN** the sweep runs again and that booking's `holdExpiresAt` passed more than ten minutes ago
- **THEN** the booking's status is `EXPIRED`

#### Scenario: The grace is disclosed as a guess
- **WHEN** the constant is read
- **THEN** it is declared alongside the other booking-horizon constants and states that it is a judgement no real shop has yet measured



### Requirement: An unanswered receipt is released by its appointment, never by its upload deadline

A `PENDING_APPROVAL` booking SHALL become eligible for expiry once its own `startTime` is in the past, and by no other rule.

`holdExpiresAt` SHALL NOT be consulted for this status. That column is the deadline for **uploading** a receipt, not for **answering** one, and releasing a slot underneath a transfer the owner is about to approve would sell it twice.

The grace window SHALL NOT apply to this status. It exists to protect an in-flight gateway confirmation, and there is no gateway on this path — the only thing that could still confirm the booking is a human, whose decision the passing of the appointment has already made worthless.

#### Scenario: A future appointment awaiting review is untouched
- **WHEN** the sweep runs and a `PENDING_APPROVAL` booking starts tomorrow, with a `holdExpiresAt` that passed hours ago
- **THEN** the booking is still `PENDING_APPROVAL` and the owner can still approve or reject its receipt

#### Scenario: A past appointment awaiting review is swept
- **WHEN** the sweep runs and a `PENDING_APPROVAL` booking's `startTime` is in the past
- **THEN** the booking's status is `EXPIRED`

#### Scenario: The upload deadline never decides this status
- **WHEN** a `PENDING_APPROVAL` booking's `holdExpiresAt` is arbitrarily far in the past and its `startTime` is in the future
- **THEN** the sweep does not select it



### Requirement: No status outside the two eligible ones is ever touched

The sweep SHALL leave `CONFIRMED`, `CANCELLED` and `EXPIRED` bookings unmodified. Their exclusion SHALL come from the candidate query naming the statuses it selects, not from a filter that removes them afterwards.

A confirmed appointment in the past is history, not an abandoned hold, and nothing is waiting on it. `CANCELLED` and `EXPIRED` are already terminal.

#### Scenario: A past confirmed appointment is left alone
- **WHEN** the sweep runs and a `CONFIRMED` booking's `startTime` passed a week ago
- **THEN** the booking is still `CONFIRMED`

#### Scenario: A cancelled booking is not re-terminated
- **WHEN** the sweep runs and a `CANCELLED` booking is present in the swept range
- **THEN** its status, `cancelledAt` and `cancelledBy` are unchanged



### Requirement: SQL narrows the candidates; the shared predicate decides

The candidate query SHALL filter only on status, a bound on the relevant instant column, and a row limit. The decision that a candidate is no longer holding anything SHALL be made by calling the shared blocking predicate with the run's instant.

**The rule SHALL NOT be re-expressed in SQL.** The predicate reads a deadline, and a second copy of it drifts from the availability read and the booking write the first time either side is refined — the failure every other caller of this predicate is written to avoid.

Because the predicate answers `false` for `CANCELLED` and `EXPIRED` as well, the candidate query's status filter SHALL be what confines the sweep, and the predicate SHALL be what confirms it.

#### Scenario: The eligibility decision calls the shared function
- **WHEN** a candidate is evaluated
- **THEN** the shared blocking predicate is called, and the blocking statuses are not restated in the query

#### Scenario: The query is bounded
- **WHEN** the candidate query executes
- **THEN** it carries a status filter, an instant bound and a row limit



### Requirement: The sweep is idempotent, bounded, and safe to run concurrently with itself

Each write SHALL be a conditional update guarded on the status the sweep expects to find, so a booking that changed underneath the run matches zero rows rather than having a decision reasserted over it.

The run SHALL be bounded: at most `SWEEP_BATCH_SIZE` rows per statement and at most `MAX_BATCHES_PER_RULE` batches **per rule**, stopping early when a batch selects nothing. The two rules are bounded independently — one draining a backlog must not starve the other — so an invocation's ceiling is `SWEEP_BATCH_SIZE × MAX_BATCHES_PER_RULE × 2`, and the spec says so rather than implying a single per-run figure. An unbounded statement would face, on its first production run, every abandoned hold ever created — including everything left by development and by the gate scripts — inside one transaction on a pooler shared with the owner's dashboard and the public booking write.

The sweep SHALL NOT take the per-barber advisory lock. Releasing a slot cannot double-book anything, which is the same reasoning the receipt rejection path already records. Safety comes from the guarded update, not from a lock.

A single instant SHALL be taken at the start of the invocation and used for the query bound and the predicate alike. The Worker's clock and the database's clock SHALL NOT both decide within one run.

#### Scenario: A second run sweeps nothing
- **WHEN** the sweep runs twice over the same eligible rows
- **THEN** the second run reports zero expiries rather than reasserting the first

#### Scenario: Overlapping invocations cannot double-write
- **WHEN** two invocations overlap over the same candidate rows
- **THEN** each row is expired exactly once

#### Scenario: A booking that changes mid-sweep is not overwritten
- **WHEN** a client attaches a transfer receipt to a selected candidate before the update statement runs
- **THEN** the update matches zero rows and the booking is `PENDING_APPROVAL`

#### Scenario: A backlog is swept in bounded batches
- **WHEN** more eligible rows exist than one batch can hold
- **THEN** the run processes them in batches up to its per-run cap and leaves the remainder for the next invocation

#### Scenario: A row eligible under both rules is swept once
- **WHEN** a booking's `holdExpiresAt` equals its `startTime` — the clamp's boundary — and both are far enough in the past to satisfy either rule
- **THEN** the booking is expired once and counted once



### Requirement: The sweep is the product's first cross-owner write and says so

The sweep SHALL be expressed through a port of its own, distinct from the booking repository, whose contract states that it is deliberately not owner-scoped and why.

Every repository in this project asserts that an unscoped query is inexpressible through it. A sweep cannot honour that: it is a maintenance job over every shop at once. Widening the booking repository to admit it would void a property that contract states about itself, and the next reader would have no way to tell an exception from an erosion. `findByPublicSlug` is the precedent — a named exception with its reason, bounded by a projection.

Cross-owner isolation SHALL be proven by a test whose fixture contains two owners.

#### Scenario: The contract names the exception
- **WHEN** the sweep's port is read
- **THEN** it states that it is not owner-scoped, and why a sweep cannot be

#### Scenario: One shop's sweep does not touch another's bookings
- **WHEN** owner A has an eligible booking and owner B has a live hold and a confirmed booking
- **THEN** only owner A's booking is expired and both of owner B's bookings are unchanged



### Requirement: The sweep writes a status and nothing else

The sweep SHALL NOT modify `Payment` rows. Its concern is the slot; the money has its own record, and a late notification must still be able to complete the payment's own history.

The sweep SHALL NOT set `cancelledAt` or `cancelledBy`. The `CancelledBy` enum admits only `OWNER` and `CLIENT`, and `EXPIRED` against `CANCELLED` is precisely how this product distinguishes a deadline from a decision.

The sweep SHALL preserve `holdExpiresAt` on the row it expires. It is the evidence of why the row expired. This is deliberately unlike the confirmation and cancellation writes, which clear it because a booking they finish has no hold left to describe.

#### Scenario: A pending payment survives its booking's expiry
- **WHEN** a booking with a `PENDING` payment is expired
- **THEN** the payment's status, amount and identifiers are unchanged

#### Scenario: An expired booking is not a cancelled one
- **WHEN** a booking is expired
- **THEN** `cancelledAt` and `cancelledBy` are null and the status is `EXPIRED` rather than `CANCELLED`

#### Scenario: The deadline survives as evidence
- **WHEN** a booking is expired
- **THEN** its `holdExpiresAt` still holds the instant the hold lapsed



### Requirement: A sweep that does nothing is distinguishable from a sweep with nothing to do

Every invocation SHALL emit one structured summary, **including invocations that expired nothing**, carrying the number of candidates examined, the number expired under each of the two rules, the number of batches, and the run's duration.

**This is the requirement the capability's honesty rests on.** If the job never fires, or cannot reach the database, nothing else in the product looks wrong: availability keeps releasing slots, every page renders correctly, and no client or owner experiences a symptom. Silence is this capability's failure mode, so silence must not also be its success mode.

A booking expired while carrying an `APPROVED` payment SHALL be logged at error level with the booking, the payment and the amount. It is the last surface in the product that can say a refund is owed, and the row stops looking anomalous the moment it is swept.

A missing or unusable database binding SHALL be reported as an error naming the variable, and SHALL NOT be swallowed as an empty run.

#### Scenario: A run with nothing to do still reports
- **WHEN** the sweep runs and no booking is eligible
- **THEN** one summary is emitted recording zero expiries and the candidates examined

#### Scenario: An expired booking that was already paid is reported loudly
- **WHEN** a booking carrying an `APPROVED` payment is expired
- **THEN** an error-level entry names the booking, the payment and the amount

#### Scenario: A missing binding is not silence
- **WHEN** the scheduled invocation runs without a usable database connection string
- **THEN** an error naming the variable is emitted rather than a summary reporting zero work



### Requirement: The capability changes nothing a client or owner can see

No page, component, copy string or user-facing state SHALL change. The confirmation page already resolves a lapsed hold from the shared predicate and already tells the client the slot is free again, in both directions, whether or not a row has been swept.

Nothing SHALL notify the owner that a hold expired. That gap is real and is recorded rather than closed here: an expiration has no surface until the dashboard home exists.

#### Scenario: The confirmation page is unchanged by the sweep
- **WHEN** a client opens their confirmation page before and after their lapsed booking is swept
- **THEN** the same state and the same copy are rendered

#### Scenario: The change touches no view
- **WHEN** the change's diff is reviewed
- **THEN** no file under the application's route or component directories is modified



### Requirement: The sweep is proven against the live database

Because the job's guarantees are timing, isolation and idempotence against real rows, they SHALL be verified by a gate script executed against the live database rather than by mocks alone. A mock can certify a sweeper that cannot run.

The gate SHALL prove both directions of both eligibility rules, that a confirmed booking is untouched, that a second owner's rows are untouched, that a re-run expires nothing, and that a concurrent status change makes the update match zero rows. Everything it creates SHALL be removed at the end, in foreign-key order.

The scheduled invocation SHALL additionally be exercised locally through the runtime's own scheduled-trigger facility before deploy, because no unit test executes the entrypoint.

#### Scenario: The gate passes against real rows
- **WHEN** the gate script runs against the live database
- **THEN** every probe passes and every row it created is removed

#### Scenario: The entrypoint is exercised before deploy
- **WHEN** the local runtime's scheduled trigger is fired by hand
- **THEN** the sweep executes and emits its summary
