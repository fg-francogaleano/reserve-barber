## MODIFIED Requirements

### Requirement: Every payment state of the confirmation page is designed and truthful

The page SHALL have a distinct rendering for each of: hold live and unpaid · a payment already in flight · returned and awaiting confirmation · confirmed · rejected with hold time remaining · hold lapsed and unpaid · paid but the slot was lost · payments impossible · transfer committed and awaiting a receipt · a receipt uploaded and under review · a receipt rejected · a method already in progress · **cancelled by the shop** · **cancelled by the client**.

**The cancelled state closes a gap this requirement has carried since it was written.** It claimed to enumerate every state the page has, and `CANCELLED` was never among them — a cancelled booking fell through every branch to the lapsed-hold state and told its client *"la reserva venció"*. That stayed invisible because the single writer of `CANCELLED` also set the receipt to `REJECTED`, and that branch fires first; the fall-through became reachable the moment a second canceller existed.

Precedence between these states SHALL be expressed as a table in one pure function rather than as branching in the view, and the page SHALL read live state so that a code carried in the URL only chooses wording within what the database already says is true. A confirmed booking SHALL outrank every code, including a forged one. **A receipt under review SHALL outrank a lapsed hold and any stale code**, because a booking in `PENDING_APPROVAL` has not expired and telling its client otherwise would be false.

**The cancelled states SHALL outrank the lapsed-hold and paid-slot-lost states**, which would otherwise tell somebody the shop cancelled on them that they ran out of time or lost a race. They SHALL sit **below** the receipt states, which are currently unreachable from this page's projection (T73) — so a receipt rejection lands here too, and the shop-cancelled wording must be true of a rejection as well as of a cancellation. **The choice among the cancelled states SHALL be driven by the recorded canceller rather than by the status**: the shop's, the client's own, and an unattributed form for a null canceller. The status cannot tell the three apart, and they are opposite messages — one is an apology, one is a receipt, and one is a fact with no author.

**The page SHALL offer a client cancellation control, and a confirmation step ahead of it**, in the states where the booking is cancellable by its client. The control SHALL be **absent, never disabled**, everywhere else. The confirmation step SHALL be reached by a safe request that writes nothing, and the cancellation itself SHALL be a `POST`.

The awaiting-confirmation state SHALL refresh itself a bounded number of times rather than instruct the client to refresh by hand, and a progress indicator SHALL accompany the refreshing form and never the terminal one.

**No refresh SHALL be emitted while the cancellation confirmation is on screen.** The client is reading a warning about an irreversible action, and a timed navigation must not move the page underneath them. When they leave the confirmation by its own way back, the refresh resumes.

**The refresh URL SHALL be rebuilt from an allowlist of the parameters this page owns, not from every parameter it was routed with.** Copying anything present is how a parameter belonging to another feature rides along on a timed navigation — which for the cancellation confirmation means a page that can re-enter the confirmation indefinitely, on its own.

The refresh SHALL work with **no JavaScript**, and its attempt counter SHALL be carried in the URL, parsed server-side and **clamped**. A counter that is absent, malformed, negative or beyond the bound SHALL render the terminal form.

The rejected state SHALL state how much of the hold remains, because that is what determines whether retrying is worth attempting.

**The confirmed state SHALL state the true status of the confirmation email** and SHALL NOT claim a message that was not sent.

A failure caused by the owner's configuration — credentials that cannot be decrypted, Mercado Pago unreachable, or no usable payment method at all — SHALL be phrased as the shop being unable to process payments, never as the client's payment having failed.

The page SHALL remain uncached and unindexed, and SHALL continue to render no client email or phone.

#### Scenario: A cancelled booking is not reported as expired
- **WHEN** the page renders a booking the shop cancelled
- **THEN** it states the shop cancelled it and does not state that the booking expired

#### Scenario: A client's own cancellation is not reported as the shop's
- **WHEN** the page renders a booking whose recorded canceller is the client
- **THEN** it renders the client's own cancelled state and does not state that the shop cancelled it

#### Scenario: A receipt rejection is no longer reported as an expiry
- **WHEN** the page renders a booking cancelled by a receipt rejection
- **THEN** it states the shop cancelled the appointment, rather than that it expired

#### Scenario: A cancellation with no recorded canceller is not attributed
- **WHEN** the page renders a `CANCELLED` booking whose canceller is null
- **THEN** a generic cancelled state is rendered and no party is blamed

#### Scenario: The cancellation control is absent where it cannot succeed
- **WHEN** the page renders a booking outside the client's cancellation eligibility
- **THEN** no cancellation control is present, disabled or otherwise

#### Scenario: The confirmation does not get pulled away by the refresh
- **WHEN** the cancellation confirmation is rendered on a booking whose state would otherwise refresh itself
- **THEN** no timed refresh is emitted while the confirmation is on screen

#### Scenario: The refresh carries only the parameters this page owns
- **WHEN** the page is opened with a parameter belonging to another feature and its state refreshes itself
- **THEN** the refresh URL carries only the allowlisted parameters

#### Scenario: Awaiting confirmation after returning
- **WHEN** the client returns from Mercado Pago before the notification has been processed
- **THEN** the page states that the payment is being confirmed and does not state that no payment was made

#### Scenario: The awaiting state refreshes itself
- **WHEN** the awaiting-confirmation state is rendered on the first attempt
- **THEN** the response carries a server-rendered timed refresh to the same page with the attempt counter advanced, and no client-side script is required

#### Scenario: The refresh is bounded
- **WHEN** the attempt counter has reached its bound
- **THEN** no refresh is emitted, no progress indicator is shown, and the manual instruction is rendered

#### Scenario: A forged attempt counter cannot loop the page
- **WHEN** the page is opened with an attempt counter that is malformed, negative or far beyond the bound
- **THEN** the terminal form is rendered and no refresh is emitted

#### Scenario: An owner-side failure does not blame the client
- **WHEN** the stored credential cannot be decrypted and the client submits the payment control
- **THEN** no Mercado Pago call is attempted, the booking keeps its hold, and the message states that payments cannot be processed right now

#### Scenario: The slot-lost state is stated plainly
- **WHEN** a payment was approved but the slot had been resold
- **THEN** the page states that the payment went through, that the slot was not held, and that the shop will make contact

#### Scenario: A receipt under review outranks the clock
- **WHEN** the page renders for a booking in `PENDING_APPROVAL` whose `holdExpiresAt` has passed
- **THEN** the page states that the receipt is under review and does not state that the turn expired

#### Scenario: A stale code cannot contradict the database
- **WHEN** the page is opened with a payment outcome code in the URL for a booking already in `PENDING_APPROVAL`
- **THEN** the review state is rendered and the code changes nothing

#### Scenario: A forged code cannot invent a lost slot
- **WHEN** the page is opened with the slot-lost transfer code in the URL for a booking whose hold is still live
- **THEN** the code is ignored, the page renders the live hold, and the payment controls remain
- **AND** the same code on a booking whose hold has genuinely lapsed does render the slot-lost state

## ADDED Requirements

### Requirement: Cancelling a booking does not close its checkout, and the client is told so

A cancellation SHALL NOT attempt to close, expire or invalidate an open Mercado Pago checkout.

**Closing it would require an authenticated call with the owner's access token**, which would make the public cancellation path a third composition root permitted to decrypt that credential — against the rule fixing that count at exactly two — on a path whose failure must not undo a cancellation that has already committed.

The consequence SHALL be stated rather than left implicit: a client who cancels can still complete a checkout they left open, capturing money for an appointment that no longer exists. That case is already reported as an approved payment for a booking that no longer exists, and **that report is the only record it has**.

The cancellation confirmation SHALL therefore tell the client not to complete a payment they have already started, and the residual SHALL be recorded as debt rather than presented as handled.

#### Scenario: The checkout is not called

- **WHEN** a client cancellation is applied for a booking with an open checkout
- **THEN** no call is made to Mercado Pago, and no composition root on this path decrypts an access token

#### Scenario: The client is warned before committing

- **WHEN** the confirmation is rendered for a booking with a live payment attempt
- **THEN** it tells the client not to complete a payment already started

#### Scenario: A payment completed afterwards is still reported

- **WHEN** the client completes that checkout after cancelling
- **THEN** the outcome is reported as an approved payment for a booking that no longer exists
