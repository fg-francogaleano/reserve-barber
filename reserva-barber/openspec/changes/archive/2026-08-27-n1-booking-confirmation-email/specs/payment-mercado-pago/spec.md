## MODIFIED Requirements

### Requirement: Exactly one composition root in the public flow may decrypt the access token

The plaintext Mercado Pago access token SHALL be reachable from exactly one composition root, which exists only to serve this capability, and SHALL NOT be added to the booking write's composition root.

The decrypted value SHALL exist only inside the infrastructure adapter that calls Mercado Pago. No application-layer type, log context, component prop, serialized payload or error object SHALL have a field capable of holding it. `PublicPaymentReadiness` SHALL gain no field.

No response body from either Mercado Pago endpoint SHALL be logged, because rejection payloads routinely echo the credential they rejected.

**That root now also reads a booking, and the property it used to state about itself is revised rather than left standing.** It was documented as wiring no booking repository, on the grounds that the notification never reads a booking except through the payment's own projection — one that carries no client contact detail and no cancellation token. Confirmation now sends an email, and composing it requires the client's name and address, the appointment, the branch and the token. The narrowed guarantee that replaces it: **the notification path reads the booking through one named projection built for the confirmation message, and through no other read.** It SHALL NOT select the whole row, SHALL NOT include the client relation wholesale, and SHALL NOT gain any payment-configuration field. The credential rule above is unaffected — the projection and the access token remain reachable only through separate reads, and neither type can hold the other's value.

The composition root's own documentation SHALL be updated to state the new shape and the reason, rather than leaving a comment that asserts a property the code no longer has.

#### Scenario: The booking write still cannot decrypt
- **WHEN** the booking creation composition root is constructed
- **THEN** it builds no credential cipher and a token read through it would fail rather than return plaintext

#### Scenario: A failed Mercado Pago call logs nothing from the request
- **WHEN** a call to Mercado Pago fails or times out
- **THEN** no log line contains the access token, the `Authorization` header, or the response body

#### Scenario: The notification path reads a booking through one named projection
- **WHEN** the notification composition root is constructed
- **THEN** its booking read names its columns explicitly and is used only to compose the confirmation message

#### Scenario: The two reads cannot be confused
- **WHEN** the confirmation-message projection is reviewed
- **THEN** it carries no payment-configuration field and no type in the send path can hold an access token

#### Scenario: The stated guarantee matches the code
- **WHEN** the notification composition root is read
- **THEN** its documentation describes the booking read it now performs and why, rather than denying that one exists

---

### Requirement: Every payment state of the confirmation page is designed and truthful

The page SHALL have a distinct rendering for each of: hold live and unpaid · a payment already in flight · returned and awaiting confirmation · confirmed · rejected with hold time remaining · hold lapsed and unpaid · paid but the slot was lost · payments impossible · transfer committed and awaiting a receipt · a receipt uploaded and under review · a receipt rejected · a method already in progress · **cancelled by the shop**.

**The cancelled state closes a gap this requirement has carried since it was written.** It claimed to enumerate every state the page has, and `CANCELLED` was never among them — a cancelled booking fell through every branch to the lapsed-hold state and told its client *"la reserva venció"*. That stayed invisible because the single writer of `CANCELLED` also set the receipt to `REJECTED`, and that branch fires first; the fall-through became reachable the moment a second canceller existed.

Precedence between these states SHALL be expressed as a table in one pure function rather than as branching in the view, and the page SHALL read live state so that a code carried in the URL only chooses wording within what the database already says is true. A confirmed booking SHALL outrank every code, including a forged one. **A receipt under review SHALL outrank a lapsed hold and any stale code**, because a booking in `PENDING_APPROVAL` has not expired and telling its client otherwise would be false.

**The cancelled state SHALL outrank the lapsed-hold and paid-slot-lost states**, which would otherwise tell somebody the shop cancelled on them that they ran out of time or lost a race. It SHALL sit **below** the receipt states, which are currently unreachable from this page's projection (T73) — so a receipt rejection lands here too, and this state's wording must be true of a rejection as well as of a cancellation. It SHALL be driven by the recorded canceller rather than by the status, because once a client can cancel their own booking the status cannot tell the two apart.

The awaiting-confirmation state SHALL refresh itself a bounded number of times rather than instruct the client to refresh by hand, and a progress indicator SHALL accompany the refreshing form and never the terminal one.

The refresh SHALL work with **no JavaScript**, and its attempt counter SHALL be carried in the URL, parsed server-side and **clamped**. A counter that is absent, malformed, negative or beyond the bound SHALL render the terminal form.

The rejected state SHALL state how much of the hold remains, because that is what determines whether retrying is worth attempting.

**The confirmed state SHALL state the true status of the confirmation email** and SHALL NOT claim a message that was not sent.

A failure caused by the owner's configuration — credentials that cannot be decrypted, Mercado Pago unreachable, or no usable payment method at all — SHALL be phrased as the shop being unable to process payments, never as the client's payment having failed.

The page SHALL remain uncached and unindexed, and SHALL continue to render no client email or phone.

#### Scenario: A cancelled booking is not reported as expired
- **WHEN** the page renders a booking the shop cancelled
- **THEN** it states the shop cancelled it and does not state that the booking expired

#### Scenario: A receipt rejection is no longer reported as an expiry
- **WHEN** the page renders a booking cancelled by a receipt rejection
- **THEN** it states the shop cancelled the appointment, rather than that it expired

#### Scenario: A cancellation with no recorded canceller is not attributed
- **WHEN** the page renders a `CANCELLED` booking whose canceller is null
- **THEN** a generic cancelled state is rendered and no party is blamed

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

### Requirement: A confirmed notification hands off to the confirmation email and waits on nothing else

When the notification path reports the `confirmed` outcome, it SHALL request the confirmation email specified in the `booking-confirmation-email` capability, after the confirming transaction has committed.

The request SHALL be made for that outcome alone. The `alreadyProcessed`, `slotLost`, `bookingUnavailable`, `mismatch`, `notApproved`, `notAtGateway`, `unresolved`, `reversedAfterConfirmation` and `retry` outcomes SHALL each send nothing.

The response policy of this endpoint SHALL be unchanged by the addition. A send failure SHALL NOT produce a `503`, SHALL NOT alter the acknowledged body, and SHALL NOT make any outcome distinguishable to the caller. The endpoint's uniform body for every non-retry outcome exists so that a public endpoint is not an oracle for which bookings exist, and an email that failed must not become a new way to ask.

#### Scenario: Only the confirming outcome sends
- **WHEN** each notification outcome is exercised
- **THEN** only `confirmed` requests an email

#### Scenario: A send failure does not become a retry request
- **WHEN** the email provider fails after a confirmation
- **THEN** the endpoint answers `200` with the same acknowledged body it answers for every other handled outcome

#### Scenario: The email outcome is not observable from outside
- **WHEN** two notifications are compared, one whose email succeeded and one whose email failed
- **THEN** the two responses are identical in status and body
