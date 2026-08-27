## MODIFIED Requirements

### Requirement: Rejection releases the slot and says what happened to the money

Rejecting SHALL, in one transaction: set the receipt to `REJECTED` with a `reviewedAt`, set the parent `Payment` to `REJECTED`, and set the `Booking` to `CANCELLED`, releasing the slot.

**The booking update SHALL also record `cancelledAt` and `cancelledBy` as `OWNER`.** It never has. Since B6 this path has written the status alone, which has three consequences that only became visible when a second canceller was designed:

- **The dashboard's cancellations counter reads zero.** It bounds on `cancelledAt`, so a cancellation with no instant is invisible to it — and this was the only writer of `CANCELLED` in the product.
- **The client-facing cancelled state cannot attribute the decision**, because attribution keys on `cancelledBy`. A booking rejected here would fall through to the generic form.
- **Once a client can cancel their own booking, the two are indistinguishable.** A `CANCELLED` row with no canceller could be either, and no later read can recover which.

Rejection SHALL require an explicit confirmation, because it is destructive and irreversible from the owner's side.

The confirmation SHALL state that the client's slot will be released and that any money actually transferred is not returned by this system.

**Rejection is no longer the only writer of `CANCELLED`.** The rules it holds — the conditional booking update, no advisory lock because a release cannot double-book, and an `APPROVED` payment left untouched — are now shared with owner cancellation rather than particular to this path.

#### Scenario: A rejection frees the time
- **WHEN** the owner rejects a pending receipt for a 15:00 appointment
- **THEN** the receipt and payment are `REJECTED`, the booking is `CANCELLED`, and a fresh availability read offers 15:00

#### Scenario: Rejection is confirmed before it happens
- **WHEN** the owner activates the reject control
- **THEN** an explicit confirmation is required before any row changes

#### Scenario: The rejection records who cancelled and when
- **WHEN** a rejection cancels a booking
- **THEN** that booking carries a `cancelledAt` and a `cancelledBy` of `OWNER`

#### Scenario: A rejection becomes visible to the cancellations counter
- **WHEN** a receipt is rejected today
- **THEN** the dashboard's cancellations counter includes it

#### Scenario: Bookings cancelled before this change keep their nulls
- **WHEN** a booking cancelled by an earlier version of this path is read
- **THEN** its canceller is null and no value is invented for it
