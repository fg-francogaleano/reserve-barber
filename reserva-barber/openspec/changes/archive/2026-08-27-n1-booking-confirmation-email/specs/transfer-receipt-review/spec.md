## MODIFIED Requirements

### Requirement: Approval confirms the booking in one transaction under the per-barber lock

Approving SHALL, in one transaction holding the same per-barber advisory lock the booking write takes: set the receipt to `APPROVED` with a `reviewedAt`, set the parent `Payment` to `APPROVED`, and set the `Booking` to `CONFIRMED`.

The booking update SHALL be **conditional** on the booking still being `PENDING_APPROVAL`, so a concurrent transition matches zero rows rather than being reasserted.

The lock SHALL be acquired with a statement executed for its effect, not with a query that reads a column back.

Because a `PENDING_APPROVAL` booking has been blocking its slot the whole time, the slot cannot have been sold underneath it; the lock is taken so this caller cannot collide with a write that is in the middle of taking an adjacent slot.

**An applied approval SHALL request the confirmation email** specified in the `booking-confirmation-email` capability, after the transaction has committed and never from inside it. This is the trigger that matters most in the product: the Mercado Pago client is at least looking at a page when their booking confirms, while a transfer client is told a human will decide and then learns the answer only if something reaches them. Without the email, **this path confirms appointments that the client never finds out about.**

The email SHALL be requested only when the approval was applied. An approval that matched zero rows — a second submission, or a booking that moved underneath it — SHALL send nothing.

**The approval SHALL NOT be reported as failed, retried, or rolled back because the email failed**, and the owner's success message SHALL NOT state that the client was notified unless the send was recorded. Telling an owner that a client has been informed, when they have not, is worse than saying nothing: it removes the owner's reason to make contact by hand, which is the only recovery this product offers.

#### Scenario: An approval confirms
- **WHEN** the owner approves a pending receipt
- **THEN** the receipt is `APPROVED` with a `reviewedAt`, the payment is `APPROVED`, and the booking is `CONFIRMED`

#### Scenario: An applied approval notifies the client
- **WHEN** an approval is applied
- **THEN** one confirmation email is requested for that booking, after the transaction has committed

#### Scenario: A second approval changes nothing
- **WHEN** the owner submits an approval twice for the same receipt
- **THEN** the second matches zero rows, no state changes, no second email is requested, and no error is presented

#### Scenario: Approving a booking that was cancelled in the meantime
- **WHEN** the owner approves a receipt whose booking has since been cancelled
- **THEN** the booking is not confirmed, no email is requested, and the owner is told plainly that the booking is no longer pending

#### Scenario: A failed email does not fail the approval
- **WHEN** the email provider is unavailable at the moment an approval is applied
- **THEN** the receipt, payment and booking remain approved and confirmed, and the owner's action succeeds

#### Scenario: The owner is not told the client was notified when they were not
- **WHEN** an approval is applied and the send fails
- **THEN** the owner's success message confirms the approval without claiming that the client was informed
