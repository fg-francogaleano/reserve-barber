## MODIFIED Requirements

### Requirement: The held booking offers a payment, and the offer works without JavaScript

The confirmation page SHALL render a control for **each payment method the owner has configured** whenever the booking is `PENDING_PAYMENT` and its hold is live by `blocksAvailability`. The Mercado Pago control SHALL appear when Mercado Pago credentials are stored; the bank transfer control is governed by `payment-bank-transfer`.

Each control SHALL be a submit inside a native `<form method="post">` posting to a fixed URL, so that a client with JavaScript disabled or still loading reaches the payment by a full navigation. The Mercado Pago response SHALL be a `303` redirect to the preference's checkout URL — `303` rather than `302` so that a back-navigation or reload issues a `GET` and never re-posts.

When the hold has lapsed, or the booking is in any other status, the control SHALL be absent from the document rather than rendered disabled. A disabled-looking control invites a tap that cannot succeed.

The page SHALL determine what to offer from a projection of the owner's payment configuration that **cannot carry the access token** — the transfer destination fields and a boolean derived in SQL from the presence of the token. A shop with neither method usable SHALL be rendered as unable to take payments.

#### Scenario: A live hold offers payment
- **WHEN** the confirmation page renders for a `PENDING_PAYMENT` booking whose hold is live and whose shop has Mercado Pago credentials
- **THEN** a submit control posting to the Mercado Pago endpoint is present in the server-rendered HTML

#### Scenario: The payment begins without client-side JavaScript
- **WHEN** the Mercado Pago form is submitted with JavaScript disabled
- **THEN** the response is a `303` to the Mercado Pago checkout URL and the browser follows it

#### Scenario: A lapsed hold offers nothing
- **WHEN** the confirmation page renders for a booking whose `holdExpiresAt` has passed and which has no approved payment
- **THEN** no payment control of any method appears anywhere in the response

#### Scenario: The offer reflects what is configured
- **WHEN** the shop has a usable transfer destination and no Mercado Pago credentials
- **THEN** no Mercado Pago control appears and the transfer control does

#### Scenario: The access token cannot reach the page
- **WHEN** the confirmation page renders for a shop with Mercado Pago configured
- **THEN** the projection feeding it carries no field capable of holding the access token, and the token appears nowhere in the response

### Requirement: Exactly one live payment exists per booking

A second payment initiation for a booking that already has a non-rejected `Payment` SHALL return that existing payment's checkout URL rather than creating a second preference.

The checkout URL SHALL therefore be **stored on the payment**, not reconstructed from the preference id and not re-fetched from the gateway. The payment row is written before the preference exists — the notification address has to carry that row's own id — so the URL is attached afterwards, and a live payment that has none is an unfinished preference creation. That state SHALL be retried rather than treated as a block: a gateway timeout must not leave a client unable to pay for a slot they are still holding.

This SHALL be guaranteed at the database by a partial unique index over `bookingId` where the status is not `REJECTED`, not by handler logic alone, because two concurrent submissions can each observe no existing payment.

**The index bounds methods as well as attempts.** A commitment to one method while a live payment of the other exists SHALL be governed by whether a checkout ever existed: a live Mercado Pago payment **with** a stored checkout URL SHALL block a transfer commitment, and a live Mercado Pago payment **without** one SHALL be set to `REJECTED` in the committing transaction so the transfer may proceed. A payment that never produced a checkout could not have charged anyone, so rejecting it costs nothing; one that did could be paid at any moment, and making room for a second method risks charging the client twice.

B4 established that a repeated submission is not a conflict and must be invisible to the client. A double-tap here SHALL be answered identically to the first tap.

#### Scenario: A double-tap creates one preference
- **WHEN** the payment control is submitted twice within one second for the same booking
- **THEN** exactly one `Payment` row exists, exactly one preference was created at Mercado Pago, and both responses redirect to the same checkout URL

#### Scenario: Returning to an unfinished payment
- **WHEN** a client who abandoned the checkout submits the payment control again while their hold is live
- **THEN** they are redirected to the checkout URL of the existing pending payment

#### Scenario: A preference creation that never finished is retried
- **WHEN** the payment control is submitted for a booking whose live payment has no stored checkout URL, because the previous attempt timed out at the gateway
- **THEN** a preference is created for that same payment row and its URL is attached, rather than the client being told a payment is already in progress

#### Scenario: A live checkout blocks the other method
- **WHEN** a client with a `PENDING` Mercado Pago payment holding a checkout URL commits to bank transfer
- **THEN** no second live payment is created and the client is told a Mercado Pago payment is already in progress

#### Scenario: An unfinished preference does not block the other method
- **WHEN** a client whose Mercado Pago attempt never produced a checkout URL commits to bank transfer
- **THEN** the Mercado Pago payment becomes `REJECTED` and one live `BANK_TRANSFER` payment exists

### Requirement: Every payment state of the confirmation page is designed and truthful

The page SHALL have a distinct rendering for each of: hold live and unpaid · a payment already in flight · returned and awaiting confirmation · confirmed · rejected with hold time remaining · hold lapsed and unpaid · paid but the slot was lost · payments impossible · **transfer committed and awaiting a receipt · a receipt uploaded and under review · a receipt rejected · a method already in progress**.

Precedence between these states SHALL be expressed as a table in one pure function rather than as branching in the view, and the page SHALL read live state so that a code carried in the URL only chooses wording within what the database already says is true. A confirmed booking SHALL outrank every code, including a forged one. **A receipt under review SHALL outrank a lapsed hold and any stale code**, because a booking in `PENDING_APPROVAL` has not expired and telling its client otherwise would be false.

The awaiting-confirmation state SHALL NOT display a progress indicator that implies polling the page does not perform. The rejected state SHALL state how much of the hold remains, because that is what determines whether retrying is worth attempting.

A failure caused by the owner's configuration — credentials that cannot be decrypted, Mercado Pago unreachable, or no usable payment method at all — SHALL be phrased as the shop being unable to process payments, never as the client's payment having failed.

The page SHALL remain uncached and unindexed, and SHALL continue to render no client email or phone.

#### Scenario: Awaiting confirmation after returning
- **WHEN** the client returns from Mercado Pago before the notification has been processed
- **THEN** the page states that the payment is being confirmed and does not state that no payment was made

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
