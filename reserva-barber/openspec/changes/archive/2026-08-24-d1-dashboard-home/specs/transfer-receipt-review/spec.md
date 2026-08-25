## MODIFIED Requirements

### Requirement: The owner has a queue of receipts awaiting an answer

The dashboard SHALL provide an owner-only page listing every `TransferReceipt` in status `PENDING` **whose booking is still `PENDING_APPROVAL`**, scoped to that owner and ordered oldest first, since the oldest is the one whose appointment is nearest to being unanswerable.

**The booking-status condition is new, and it repairs a defect rather than adding a preference.** The scheduled sweep expires a `PENDING_APPROVAL` booking once its own appointment has passed, and it writes `Booking.status` and nothing else — deliberately, so a late notification can still complete a payment's own history. The receipt therefore stays `PENDING` forever. Filtering on receipt status alone leaves that row in the queue with an approve control whose only reachable answer is that the booking is no longer pending, because the approval is guarded on `PENDING_APPROVAL`. The queue is a list of decisions the owner can still make; a row that cannot be decided does not belong in it.

**The predicate SHALL be expressed once and shared by the listing and by any count of it.** A dashboard counter and this queue disagreeing about how many receipts are waiting is worse than having no counter, and two copies of a predicate that reads a status is exactly how they come to disagree.

The capability SHALL therefore expose a **count** over that same shared predicate, scoped to the owner, for surfaces that need the number without the rows.

Each entry SHALL show the appointment date and time, the barber, the location, the service, the client's name, and **the expected deposit amount taken from the booking's snapshot**.

The page SHALL be uncached and SHALL NOT be indexed.

An empty queue SHALL have a designed state stating that there is nothing to review, never a blank region.

#### Scenario: Pending receipts are listed
- **WHEN** the owner opens the review page with two pending receipts on bookings awaiting approval
- **THEN** both appear, oldest first, each showing its appointment, its client and its expected amount

#### Scenario: A receipt whose booking was swept leaves the queue
- **WHEN** a receipt is `PENDING` and its booking was expired by the sweep after the appointment passed
- **THEN** it does not appear in the queue

#### Scenario: The queue never offers a decision that cannot be made
- **WHEN** the queue is rendered
- **THEN** every row it contains would be accepted by the approval path

#### Scenario: The count and the listing agree
- **WHEN** the count and the listing are evaluated against the same data
- **THEN** the count equals the number of rows the listing returns

#### Scenario: The predicate has one home
- **WHEN** the receipt repository is reviewed
- **THEN** the listing and the count are built from a single shared definition of the pending predicate

#### Scenario: Another owner's receipts are invisible
- **WHEN** the owner opens the review page and another owner has pending receipts
- **THEN** none of them appear

#### Scenario: Another owner's receipts are not counted
- **WHEN** the count is taken and another owner has pending receipts
- **THEN** they are not included

#### Scenario: An empty queue is a designed state
- **WHEN** the owner opens the review page with no pending receipts
- **THEN** the page states that there is nothing to review
