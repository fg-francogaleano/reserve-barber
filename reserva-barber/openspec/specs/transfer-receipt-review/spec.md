# transfer-receipt-review Specification

## Purpose
TBD - created by archiving change b6-transfer-deposit-and-review. Update Purpose after archive.
## Requirements
### Requirement: The owner has a queue of receipts awaiting an answer

The dashboard SHALL provide an owner-only page listing every `TransferReceipt` in status `PENDING`, scoped to that owner and ordered oldest first, since the oldest is the one whose appointment is nearest to being unanswerable.

Each entry SHALL show the appointment date and time, the barber, the location, the service, the client's name, and **the expected deposit amount taken from the booking's snapshot**.

The page SHALL be uncached and SHALL NOT be indexed.

An empty queue SHALL have a designed state stating that there is nothing to review, never a blank region.

#### Scenario: Pending receipts are listed
- **WHEN** the owner opens the review page with two pending receipts
- **THEN** both appear, oldest first, each showing its appointment, its client and its expected amount

#### Scenario: Another owner's receipts are invisible
- **WHEN** the owner opens the review page and another owner has pending receipts
- **THEN** none of them appear

#### Scenario: An empty queue is a designed state
- **WHEN** the owner opens the review page with no pending receipts
- **THEN** the page states that there is nothing to review

### Requirement: The receipt file is served through a short-lived signature, as an attachment

The stored object SHALL be reached through a signed URL created at render time with the owner's own session, never through a persisted URL and never through a privileged credential.

The signature SHALL be short-lived.

The response SHALL be forced to download rather than render inline, so a PDF carrying active content is never executed against the storage origin in the owner's browser.

#### Scenario: The link is signed at render time
- **WHEN** the review page renders
- **THEN** the file link carries a signature generated for that render and no unsigned URL appears in the response

#### Scenario: The file downloads rather than renders
- **WHEN** the owner opens a receipt that is a PDF
- **THEN** the response instructs the browser to download it

#### Scenario: A stale link stops working
- **WHEN** a signed link is used after its lifetime has elapsed
- **THEN** the request is refused

### Requirement: Approval confirms the booking in one transaction under the per-barber lock

Approving SHALL, in one transaction holding the same per-barber advisory lock the booking write takes: set the receipt to `APPROVED` with a `reviewedAt`, set the parent `Payment` to `APPROVED`, and set the `Booking` to `CONFIRMED`.

The booking update SHALL be **conditional** on the booking still being `PENDING_APPROVAL`, so a concurrent transition matches zero rows rather than being reasserted.

The lock SHALL be acquired with a statement executed for its effect, not with a query that reads a column back.

Because a `PENDING_APPROVAL` booking has been blocking its slot the whole time, the slot cannot have been sold underneath it; the lock is taken so this caller cannot collide with a write that is in the middle of taking an adjacent slot.

#### Scenario: An approval confirms
- **WHEN** the owner approves a pending receipt
- **THEN** the receipt is `APPROVED` with a `reviewedAt`, the payment is `APPROVED`, and the booking is `CONFIRMED`

#### Scenario: A second approval changes nothing
- **WHEN** the owner submits an approval twice for the same receipt
- **THEN** the second matches zero rows, no state changes, and no error is presented

#### Scenario: Approving a booking that was cancelled in the meantime
- **WHEN** the owner approves a receipt whose booking has since been cancelled
- **THEN** the booking is not confirmed, and the owner is told plainly that the booking is no longer pending

### Requirement: Rejection releases the slot and says what happened to the money

Rejecting SHALL, in one transaction: set the receipt to `REJECTED` with a `reviewedAt`, set the parent `Payment` to `REJECTED`, and set the `Booking` to `CANCELLED`, releasing the slot.

Rejection SHALL require an explicit confirmation, because it is destructive and irreversible from the owner's side.

The confirmation SHALL state that the client's slot will be released and that any money actually transferred is not returned by this system.

#### Scenario: A rejection frees the time
- **WHEN** the owner rejects a pending receipt for a 15:00 appointment
- **THEN** the receipt and payment are `REJECTED`, the booking is `CANCELLED`, and a fresh availability read offers 15:00

#### Scenario: Rejection is confirmed before it happens
- **WHEN** the owner activates the reject control
- **THEN** an explicit confirmation is required before any row changes

### Requirement: The review surface is owner-only and its writes are authenticated

The page and both actions SHALL be reachable only with an owner session, and every read and write SHALL be scoped by owner id.

A receipt id supplied in a request SHALL be resolved within the caller's own scope. A receipt belonging to another owner and a receipt that does not exist SHALL be answered identically.

#### Scenario: An anonymous request is turned away
- **WHEN** an anonymous client requests the review page
- **THEN** it is not served

#### Scenario: A foreign receipt id is indistinguishable from an unknown one
- **WHEN** the owner submits an approval for a receipt belonging to another owner, and separately for an id that does not exist
- **THEN** both responses are identical

### Requirement: Nothing in this capability claims the payment was verified

The review surface SHALL present the receipt as evidence the owner must judge, not as a verified payment. It SHALL render the expected amount beside the file so the comparison is possible, and SHALL NOT state or imply that the transfer has been checked by the system.

#### Scenario: The expected amount is present for comparison
- **WHEN** a receipt is displayed
- **THEN** the booking's snapshotted deposit amount is shown beside it

#### Scenario: No verification is claimed
- **WHEN** the review page renders
- **THEN** no text states that the transfer has been confirmed, matched or validated by the system

### Requirement: Every user-facing string this capability introduces is Spanish and lives in the copy module

All owner-facing text — the queue, the empty state, the confirmation, the outcome messages — SHALL be Spanish (es-AR) and SHALL live in the copy module rather than inline in components.

#### Scenario: No inline user-facing text
- **WHEN** the review page and its actions are reviewed
- **THEN** no Spanish string literal appears outside the copy module

### Requirement: Review actions are logged without exposing the client or the destination

Each approval and rejection SHALL be logged with the receipt id, the booking id and the outcome, and SHALL NOT record the client's contact details, the uploaded filename, or the transfer destination.

#### Scenario: A rejection is auditable without exposing anyone
- **WHEN** a receipt is rejected
- **THEN** the log records the operation, the ids and the outcome, and contains no contact detail, no filename and no destination
