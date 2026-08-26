## ADDED Requirements

### Requirement: The owner may cancel a booking that has not already ended

The system SHALL let the authenticated owner cancel a booking whose status is `CONFIRMED`, `PENDING_PAYMENT` or `PENDING_APPROVAL`.

`CANCELLED` and `EXPIRED` are terminal and SHALL offer **no control at all** rather than a disabled one — a control that cannot succeed invites an action that cannot succeed.

Eligibility SHALL be expressed as a single domain predicate consulted by every caller that needs the answer: the row deciding whether to render a control, the service deciding whether to attempt the write, and the write's own guard. Three copies of a status list are three chances for a control to appear where the write refuses.

**A past appointment SHALL remain cancellable.** A no-show is precisely a past appointment the owner wants off the books, and the list this is offered from is ordered by recency rather than by future-ness.

#### Scenario: A confirmed booking can be cancelled
- **WHEN** the owner cancels a `CONFIRMED` booking
- **THEN** it becomes `CANCELLED`

#### Scenario: A terminal booking offers nothing
- **WHEN** the list renders a `CANCELLED` or an `EXPIRED` booking
- **THEN** no cancel control is present for that row, disabled or otherwise

#### Scenario: A past appointment is still cancellable
- **WHEN** the owner cancels a `CONFIRMED` booking whose appointment was yesterday
- **THEN** it becomes `CANCELLED`

#### Scenario: One predicate answers for every caller
- **WHEN** the eligibility rule is reviewed
- **THEN** the control, the service and the write's guard all consult the same function

---

### Requirement: Cancellation is one guarded transaction that takes no lock

Cancelling SHALL run in one transaction that sets `status` to `CANCELLED`, records `cancelledAt`, records `cancelledBy` as `OWNER`, and clears `holdExpiresAt`.

The booking update SHALL be **conditional on the status being one this capability admits**, so a booking that moved underneath — confirmed by a notification, swept by the expiry job — matches zero rows and is reported as it actually is, rather than having `CANCELLED` stamped over it.

**No advisory lock SHALL be taken.** The per-barber lock exists so two writers cannot *place* a booking into one slot; this only releases one, and a release cannot double-book. Safety comes from the conditional update.

A second submission SHALL match zero rows, change nothing, and SHALL NOT be presented to the owner as an error.

#### Scenario: The slot is released
- **WHEN** a `CONFIRMED` booking for 15:00 is cancelled
- **THEN** a fresh availability read offers 15:00

#### Scenario: The canceller is recorded
- **WHEN** any cancellation is applied
- **THEN** the booking carries a `cancelledAt` and a `cancelledBy` of `OWNER`

#### Scenario: A hold deadline is cleared
- **WHEN** a `PENDING_PAYMENT` booking is cancelled
- **THEN** its `holdExpiresAt` is null, because a finished booking has no hold to describe

#### Scenario: A second cancellation changes nothing
- **WHEN** the owner submits the same cancellation twice concurrently
- **THEN** exactly one matches a row, and the second is not reported as a failure

#### Scenario: A booking confirmed in the meantime is reported, not overwritten
- **WHEN** a cancellation is submitted for a booking a notification confirmed a moment earlier
- **THEN** the write matches zero rows and the owner is told the booking can no longer be cancelled

---

### Requirement: An approved payment is never rewritten, and a pending one is refused

A `Payment` whose status is `APPROVED` SHALL be left untouched. It records a charge that really happened, and rewriting it to make the booking's story tidier would falsify the only record this product has of money moving. That an approved payment can belong to a booking that is not confirmed is already a documented, legitimate pair.

A `Payment` whose status is `PENDING` SHALL be set to `REJECTED` in the same transaction: it is an attempt that can now never complete, and leaving it pending keeps it counted as live.

**No refund SHALL be performed or recorded.** This product has no refund path, and a cancelled booking with an approved deposit is money the owner owes and must arrange outside this system.

#### Scenario: An approved deposit survives the cancellation
- **WHEN** a `CONFIRMED` booking with an `APPROVED` payment is cancelled
- **THEN** the payment is still `APPROVED` with its original approval instant

#### Scenario: A pending payment is refused
- **WHEN** a `PENDING_PAYMENT` booking with a `PENDING` payment is cancelled
- **THEN** the payment is `REJECTED`

#### Scenario: Nothing claims to refund anything
- **WHEN** the cancellation path is reviewed
- **THEN** no code and no message states that money has been returned

---

### Requirement: A receipt awaiting review is left exactly as it was

Cancelling SHALL NOT write to the booking's `TransferReceipt`. A receipt in `PENDING` SHALL remain `PENDING`.

**`PENDING` is the honest record**: it states that nobody answered, which is exactly what happened. `REJECTED` would assert a review that was never performed.

> **The distinguishability argument that originally justified this has been withdrawn.** It held that writing `REJECTED` would make a cancellation identical to a receipt rejection in every stored value, forcing the client's page to give one of them a false message. The stored values do collide — but the page never sees the difference anyway: its projection reads only the booking's *live* payment, and a rejection sets that payment to `REJECTED`, so the receipt status arrives `null` and the rejected-receipt state is **unreachable** (`tech-debt.md` T73, found in this story's runtime check). The decision stands on the record-honesty argument alone.

**Both a cancellation and a receipt rejection therefore render the same generic cancelled state**, and this capability does not change that. It is an improvement on what preceded it — every rejected comprobante used to be reported as an expiry — and it is not the specific message the client deserves. Naming the document again is T73's work, with its own verification.

The owner's queue SHALL NOT show such a receipt, and SHALL achieve that by filtering on the booking's status rather than by a write — which it already does.

The residual cost — a receipt that will never be answered — SHALL be recorded as retention debt rather than resolved by writing a status nobody chose.

#### Scenario: A pending receipt survives the cancellation
- **WHEN** a `PENDING_APPROVAL` booking with a `PENDING` receipt is cancelled
- **THEN** the receipt is still `PENDING` with no `reviewedAt`

#### Scenario: A rejected comprobante is no longer reported as an expiry
- **WHEN** the client opens the link for a booking cancelled by a receipt rejection
- **THEN** the page states the shop cancelled the appointment and does not state that it expired

#### Scenario: The specific rejection message stays out of reach
- **WHEN** that page is compared with one for a plain cancellation
- **THEN** both render the same generic cancelled state, which is recorded as debt rather than claimed as correct

#### Scenario: An already-reviewed receipt is untouched
- **WHEN** a `CONFIRMED` booking whose receipt is `APPROVED` is cancelled
- **THEN** the receipt is still `APPROVED`

#### Scenario: The queue does not show it
- **WHEN** the review queue is read after the cancellation
- **THEN** the receipt is absent, because the queue filters on the booking's status

---

### Requirement: The client's page names the shop as the canceller

The confirmation page SHALL render a distinct state for a booking cancelled by the shop, stating that the shop cancelled the appointment and that the time was released.

**Its precedence SHALL place it above the lapsed-hold and paid-slot-lost states**, both of which would otherwise describe something that did not happen: a race the client lost, or a deadline they missed. It SHALL sit **below** the receipt states. Those remain in the table and are currently unreachable from the page's projection (T73), so in practice a receipt rejection and a cancellation both arrive here — which is why this state's wording must be true of either.

The state SHALL be driven by **who cancelled**, not by the status alone. A booking cancelled by its own client must not be shown a message about the shop cancelling it, and the status cannot distinguish them. The projection feeding the page SHALL therefore carry the canceller.

A `CANCELLED` booking with **no recorded canceller** — every such row predates this capability — SHALL render a generic cancelled state rather than attributing the decision to anyone.

Where the booking's deposit was approved, the state SHALL say that the money is not returned by this system, in the same terms the receipt rejection already uses.

The page SHALL offer no payment control in this state.

#### Scenario: The page stops saying a cancelled booking expired
- **WHEN** the client opens the link for a booking the shop cancelled
- **THEN** the page states the shop cancelled it, and does not state that the booking expired

#### Scenario: A rejected receipt keeps its own message
- **WHEN** the client opens the link for a booking cancelled by a receipt rejection
- **THEN** the page names the comprobante, which is the more specific truth

#### Scenario: A cancellation of a booking awaiting review names the cancellation
- **WHEN** the client opens the link for a booking the shop cancelled while its receipt was still pending
- **THEN** the page names the cancellation, because the receipt was never rejected

#### Scenario: An unattributed cancellation is not blamed on anyone
- **WHEN** the client opens the link for a `CANCELLED` booking with a null canceller
- **THEN** a generic cancelled state is rendered

#### Scenario: A paid cancellation says what the system cannot do
- **WHEN** the cancelled booking's deposit was approved
- **THEN** the page states the deposit is not returned by this system

#### Scenario: No payment control survives
- **WHEN** the cancelled state renders
- **THEN** no payment or receipt control is present

---

### Requirement: The owner confirms explicitly and is never told the client was notified unless they were

Cancelling SHALL require an explicit confirmation before any row changes, because it is destructive and irreversible from the owner's side.

The confirmation SHALL state that the client's slot is released immediately and may be taken by somebody else, that the action cannot be undone, and that any deposit already paid is not returned by this system.

The success message SHALL confirm the cancellation and SHALL NOT claim the client was notified unless a notification was actually sent. Telling an owner a client has been informed when they have not removes the owner's reason to make contact by hand, which is the only recovery this product offers.

The control SHALL carry a pending state while the action is in flight.

#### Scenario: Nothing changes without confirmation
- **WHEN** the owner activates the cancel control and dismisses the confirmation
- **THEN** no row changes

#### Scenario: The confirmation names what the system cannot do
- **WHEN** the confirmation is shown for a booking with an approved deposit
- **THEN** it states that the slot is released, that the action is final, and that the deposit is not returned here

#### Scenario: The success message makes no claim about notification
- **WHEN** a cancellation is applied and the notification fails
- **THEN** the owner is told the booking was cancelled, with no statement that the client was informed

---

### Requirement: The client is told, and telling them can never fail the cancellation

An applied cancellation SHALL send the client a message stating that the shop cancelled their appointment, carrying the appointment that was cancelled and, where a deposit was approved, that it is not returned by this system.

It SHALL reuse the existing email port and its contract: composed by a pure builder, sent through an injected transport, **never throwing**, and reported as an outcome rather than an exception.

The send SHALL happen **after the transaction commits and never inside it**, and SHALL be triggered by the write having applied rather than by the booking's observed status.

**A failure SHALL change nothing** — not the cancellation, not the released slot, not the owner's result. A mail provider must not be able to undo a scheduling decision.

No instant SHALL be recorded for this message and no column SHALL be added for one. A confirmation is a promise the product made and its absence is worth querying; a cancellation notice is a courtesy, and a nullable column with no reader would copy the shape of that decision without its reason.

No log line for this message SHALL carry the recipient address, the client's name, the cancellation token or the message body.

#### Scenario: An applied cancellation notifies
- **WHEN** a cancellation is applied
- **THEN** exactly one message is requested for that booking

#### Scenario: A refused cancellation notifies nobody
- **WHEN** a cancellation matches zero rows
- **THEN** no message is requested

#### Scenario: A provider outage does not undo a cancellation
- **WHEN** the provider is unavailable at the moment a cancellation is applied
- **THEN** the booking is still `CANCELLED`, the slot is still released, and the owner's action succeeded

#### Scenario: The message carries no payment control and no link to pay
- **WHEN** the message is composed
- **THEN** it offers no way to pay and states the appointment is cancelled

#### Scenario: No personal data in the logs
- **WHEN** the notification path logs
- **THEN** no recipient address, client name, token or body appears

---

### Requirement: The write is owner-scoped and discloses nothing about what it refused

The booking id SHALL be resolved within the caller's own scope, reached through the barber's location's owner — the only path, because a booking's location is deliberately not duplicated onto the row.

A booking belonging to another owner and a booking that does not exist SHALL be answered **identically**, and neither SHALL be logged as an error: from outside they are the same answer and neither is a fault.

The page and the action SHALL be reachable only with an owner session.

#### Scenario: Another owner's booking is not cancellable
- **WHEN** a cancellation names a booking outside the caller's scope
- **THEN** nothing changes and the response is identical to one for a booking that does not exist

#### Scenario: An anonymous request is turned away
- **WHEN** an anonymous caller submits a cancellation
- **THEN** it is not performed

#### Scenario: A scope miss is not an error
- **WHEN** a cancellation misses the caller's scope
- **THEN** it is logged at information level, not as a failure

---

### Requirement: Every user-facing string this capability introduces is Spanish and lives with the flow's copy

All owner-facing and client-facing strings SHALL be Spanish (es-AR) and SHALL live in the shared copy module rather than inline in a component.

#### Scenario: No inline strings
- **WHEN** the components are reviewed
- **THEN** no Spanish user-facing string introduced by this capability is written inline

---

### Requirement: The cancellation path is proven against the live database before the story closes

A gate script SHALL exercise this capability against the live database and SHALL prove at minimum: the conditional update matching zero rows when the status moved underneath it; an `APPROVED` payment surviving untouched; a `PENDING` payment and a `PENDING` receipt being refused; `cancelledAt` and `cancelledBy` actually landing; and cross-owner isolation using a **two-owner fixture**.

Cross-owner isolation SHALL NOT be considered proven by inspection or by a unit test alone. Nothing in the type system or the schema constrains it — the join is the tenancy boundary.

#### Scenario: The gate proves the guard
- **WHEN** a booking's status changes between the read and the write
- **THEN** the gate observes zero rows matched rather than a cancelled booking

#### Scenario: The gate proves the money is untouched
- **WHEN** a booking with an approved payment is cancelled
- **THEN** the gate observes the payment unchanged, including its approval instant

#### Scenario: The gate proves cross-owner isolation
- **WHEN** a cancellation is attempted across owners in a two-owner fixture
- **THEN** the other owner's booking is unchanged
