# payment-mercado-pago Specification

## Purpose
TBD - created by archiving change b5-mercado-pago-payment. Update Purpose after archive.
## Requirements
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

### Requirement: The preference is built entirely by the server from stored values

The preference SHALL be created server-side from the booking row alone. No field of it SHALL be read from the request body, the query string, a cookie, or any other client-supplied source.

The charged amount SHALL be `booking.depositAmount` — the value snapshotted at creation — read from the column and **never recomputed** from the live deposit policy. `DepositPolicy` SHALL NOT be called anywhere in this capability. An owner who edits their policy while a client is at the checkout must not cause that client's correct payment to be rejected.

The currency SHALL be `ARS`. The `external_reference` SHALL be `booking.id`.

#### Scenario: The amount comes from the snapshot
- **WHEN** a preference is created for a booking whose `depositAmount` is 5000.00 and whose owner has since changed the deposit policy
- **THEN** the preference's unit price is 5000.00

#### Scenario: The client cannot influence the charge
- **WHEN** the payment request body carries an `amount`, `currency`, or `external_reference` field
- **THEN** every one of them is ignored and the preference is built from the booking row

### Requirement: The cancellation token travels in the request body, never in a path or query string

The payment endpoint SHALL be a fixed path, and the booking SHALL be identified by a `cancellationToken` read from the POST body.

The token is the client's cancellation credential. A path or query parameter carrying it lands in access logs, proxy caches, browser history and the next request's `Referer` — the same reasoning that made B4 route contact details through a cookie rather than a redirect URL.

For the same reason, `external_reference` SHALL be `booking.id` and never the cancellation token: the reference is stored by Mercado Pago, shown in their dashboard and echoed in their notifications, and the token is `@unique` and cannot be rotated without invalidating the client's own link.

#### Scenario: The endpoint path carries no token
- **WHEN** a payment is initiated
- **THEN** the request path is a fixed URL containing no booking identifier

#### Scenario: The token does not reach Mercado Pago
- **WHEN** a preference is created
- **THEN** the cancellation token appears in no field of the preference payload, including `external_reference`, `back_urls` and `metadata`

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

### Requirement: The client's return from Mercado Pago decides nothing

The `back_urls` return SHALL bring the client to a **landing route that names no credential**, which then sends them on to their confirmation page carrying only an outcome code. The page SHALL determine what to display by reading live booking and payment state, and SHALL NOT treat the outcome code as evidence of anything.

A return URL is a browser navigation that anyone can type. Only the webhook, authenticated per the requirement below, changes a booking's status.

**The confirmation page's address SHALL NOT be given to the gateway.** That page is addressed by the cancellation token, so naming it in `back_urls` would store a live credential in the gateway's preference, visible in their dashboard — the same exposure that keeps the token out of `external_reference`, and that the confirmation route's `no-referrer` header prevents through the other channel. The token SHALL instead travel in an httpOnly, `SameSite=Lax`, `/b`-scoped cookie set when the payment is initiated, which the landing route reads back.

Two alternatives are **rejected** and SHALL NOT be adopted: putting the payment id in `back_urls` and resolving the booking from it would make the notification reference authorize something, when its entire safety argument is that it authorizes nothing; and minting a return-only secret would be two secrets for one holder, which the confirmation page's addressing scheme already refused.

When the cookie is absent — a different browser, a cleared jar, an expired lifetime — the landing route SHALL send the client to the shop's public page with a message directing them to their own link, and SHALL NOT resolve the booking by any identifier present in the return URL.

#### Scenario: The gateway is never told the confirmation address
- **WHEN** a preference is created
- **THEN** no field of it contains the cancellation token, `back_urls` included

#### Scenario: The landing route completes the round trip
- **WHEN** the client returns from the gateway with the initiation cookie present
- **THEN** they are redirected to their confirmation page with an outcome code

#### Scenario: A return without the cookie resolves nothing
- **WHEN** the client returns from the gateway with no initiation cookie, and the return URL carries the gateway's own reference parameters
- **THEN** no booking is looked up from those parameters and the client is sent to the shop's public page with a message about using their own link

#### Scenario: A forged success return
- **WHEN** a client opens the confirmation page with the success outcome code and no payment has been confirmed
- **THEN** the booking remains `PENDING_PAYMENT` and the page does not state that the appointment is confirmed

#### Scenario: The webhook arrived before the client returned
- **WHEN** the client returns after the booking has already been confirmed
- **THEN** the page shows the confirmed state rather than a pending one

### Requirement: A notification is authenticated by re-fetching the payment, not by trusting its body

The webhook handler SHALL treat the notification body as a hint carrying an identifier, and SHALL NOT derive any state change from its contents.

The handler SHALL resolve the owner through a `ref` query parameter on the `notification_url`, which carries the id of the `Payment` row written at preference creation. Nothing else in the request can answer which Mercado Pago account the notification concerns.

The handler SHALL then fetch the payment from Mercado Pago's payments API using **that owner's own access token**, and that response SHALL be the sole authority for the payment's status. An attacker cannot forge a payment that the owner's own account will confirm.

Signature validation is **deliberately not implemented** in this change. A `validateSignature()` that passes when no secret is configured reads as protection while protecting nothing, and this product has no per-owner webhook secret stored. This is recorded as tech debt with its trigger, not left as an omission.

#### Scenario: A fabricated notification confirms nothing
- **WHEN** a notification arrives naming a payment id that Mercado Pago's API does not return as approved for that owner
- **THEN** no booking or payment row changes

#### Scenario: The resolution is cheap before it is expensive
- **WHEN** a notification arrives whose `ref` matches no `Payment` row
- **THEN** no outbound Mercado Pago call is made

### Requirement: Three properties of the fetched payment are verified before anything is confirmed

Before any transition, the handler SHALL verify against the stored row that the fetched payment's `external_reference` equals the booking's id, its `transaction_amount` equals the payment's recorded `amount`, and its `currency_id` is `ARS`.

A mismatch SHALL refuse the transition and log it. Without the amount check, any small payment on the owner's account — or a replayed notification for an unrelated one — would confirm a booking it never paid for.

#### Scenario: An amount that does not match the deposit
- **WHEN** Mercado Pago reports `transaction_amount` 1.00 for a payment whose recorded amount is 5000.00
- **THEN** the booking remains `PENDING_PAYMENT`, the payment is not marked `APPROVED`, and an amount mismatch is logged with the booking id and both amounts

#### Scenario: A reference belonging to another booking
- **WHEN** the fetched payment's `external_reference` names a different booking
- **THEN** no row changes and the mismatch is logged

### Requirement: Confirmation is idempotent, and duplicate delivery is indistinguishable from first delivery

`mpPaymentId` SHALL be unique in the database, and that constraint SHALL be the idempotency guarantee rather than a prior read.

The transition SHALL run inside one transaction and SHALL be conditioned on the booking still being `PENDING_PAYMENT`, so that a second delivery updates no rows. A unique-violation on `mpPaymentId` SHALL be translated as already-processed, and that translation SHALL be qualified on the violated constraint rather than treating any violation as such.

#### Scenario: The same notification three times
- **WHEN** the same approved notification is delivered three times
- **THEN** exactly one `Payment` row carries that `mpPaymentId` with status `APPROVED`, the booking is `CONFIRMED` once with a single `approvedAt`, and all three deliveries are answered `200`

#### Scenario: An out-of-order pending after an approved
- **WHEN** a `pending` notification arrives for a payment already recorded `APPROVED`
- **THEN** the payment remains `APPROVED` and the booking remains `CONFIRMED`

### Requirement: Only a transient failure asks Mercado Pago to retry

Every notification that is handled, ignored, malformed in a recognized way, or refused by a verification check SHALL be answered `200`.

Only a genuinely transient failure — the database unreachable, or Mercado Pago unreachable during the re-fetch — SHALL be answered `503`, because that is the only case a retry can resolve.

Responses SHALL be indistinguishable across "ref not found", "already processed" and "verification refused", so the endpoint cannot be used to discover which bookings or payments exist.

#### Scenario: An ignored notification is not retried
- **WHEN** a notification for an unrelated topic arrives
- **THEN** the response is `200` and Mercado Pago does not retry it

#### Scenario: A database outage is retried
- **WHEN** the database is unreachable while handling a notification
- **THEN** the response is `503`

#### Scenario: The endpoint is not an oracle
- **WHEN** notifications arrive for an unknown `ref` and for an already-processed payment
- **THEN** both responses are identical in status and body

### Requirement: A payment that arrives after the hold lapsed is defended in three layers

**Prevention.** Every preference SHALL carry an expiry set to the booking's `holdExpiresAt`, so Mercado Pago refuses an attempt begun after the hold lapsed.

**Detection.** A notification approving a booking whose hold has lapsed SHALL re-check availability inside a transaction that takes **the same per-barber advisory lock the booking write takes**, applying `blocksAvailability` — the same function, never a reimplementation. This capability is a third caller of that lock, after the booking write and alongside the transfer approval. **The sweeper, previously named here as a further caller, takes no lock**: it only releases slots, and a release cannot double-book.

**Preservation.** The detection layer is guarded on the booking still being `PENDING_PAYMENT`, so it works only for as long as that status survives. The scheduled sweep SHALL therefore leave a lapsed hold alone for a grace window before expiring it. **Without that window this requirement would be quietly narrowed by the sweep rather than by a decision**: preference expiry stops an attempt *begun* after the hold lapsed, but not one begun moments before it and approved moments after, and every such payment would arrive to find a booking that no longer exists. The guarantee below is unconditional only while a lapsed hold is still `PENDING_PAYMENT`; the grace window is what keeps it meaningful.

**Outcome.** If the slot is still free, the booking SHALL be confirmed despite the lapsed hold: a client who paid and whose slot nobody took must not lose it to a clock. If the slot has been taken, the booking SHALL NOT be confirmed, the payment SHALL still be recorded `APPROVED` because it is a real charge, and the outcome SHALL be surfaced to the client on their page and to the owner. A refund the owner never learns about is a defect, not a deferred feature.

#### Scenario: Late payment, slot still free
- **WHEN** an approved notification arrives after `holdExpiresAt` and no other booking occupies that barber and start time
- **THEN** the booking is transitioned to `CONFIRMED`

#### Scenario: Late payment inside the grace window is still recoverable
- **WHEN** an approved notification arrives minutes after `holdExpiresAt`, before the sweep is permitted to expire the booking, and the slot is free
- **THEN** the booking is transitioned to `CONFIRMED` rather than reported as a booking that no longer exists

#### Scenario: Late payment, slot resold
- **WHEN** an approved notification arrives after `holdExpiresAt` and another booking now blocks that barber and start time
- **THEN** the original booking is not confirmed, the newer booking is untouched, the payment is recorded `APPROVED` with a slot-lost outcome logged, and Mercado Pago receives `200`

#### Scenario: The re-check uses the shared predicate under the shared lock
- **WHEN** the late-payment re-check runs
- **THEN** it holds the same per-barber advisory lock the booking write takes and calls `blocksAvailability` rather than expressing the blocking rule again

### Requirement: An approved payment for a booking that no longer exists is reported as loudly as a lost slot

When a notification approves a payment whose booking is no longer bookable — cancelled, or expired — the booking SHALL NOT be confirmed, the payment SHALL still be recorded as approved because the charge is real, and the outcome SHALL be logged at error level carrying the booking's actual status.

**It SHALL NOT be reported as a duplicate delivery.** Both reach the confirming transaction as a guarded update that matched nothing, and from inside that transaction they are indistinguishable — which is exactly why the status it found must travel back with the refusal. A booking already confirmed is the idempotency mechanism working and owes nobody anything; a booking that went away is money taken for an appointment that does not exist, and owes a refund as surely as the slot-lost case does.

#### Scenario: A cancelled booking receives an approved payment
- **WHEN** a notification approves a payment whose booking has been cancelled
- **THEN** the booking is not confirmed, the payment is recorded as approved, and the outcome is logged at error with the booking's status

#### Scenario: A duplicate delivery is still routine
- **WHEN** the same notification arrives again over a booking that is already confirmed
- **THEN** it is reported as already processed and logged at information level

### Requirement: A second gateway payment id never rewrites the first

On the path that records the payment before checking the booking, the write SHALL be conditioned on the payment having no gateway id yet.

The gateway permits several payment attempts against one checkout. Without the condition, a later approved attempt would overwrite the identifier and the instant of a payment already approved — and the unique constraint would not refuse it, because the new identifier is new. The first approval is the one that happened.

#### Scenario: A second approved attempt on one checkout
- **WHEN** a notification approves a second gateway payment for a payment record that already carries one
- **THEN** the stored identifier and approval instant are unchanged and the notification is reported as already processed

### Requirement: Money returned after confirmation changes no row and is reported

A notification reporting a payment as `refunded`, `charged_back` or `cancelled` for a booking already `CONFIRMED` SHALL change no row, SHALL be answered `200`, and SHALL produce one warning-level log line carrying the booking id, the payment id and the reported status.

Cancelling a confirmed appointment because a dispute was filed — one the owner may win — would silently empty an agenda and leave a client arriving to no booking. The decision belongs to a human, who has a dashboard control for it. This is stated as a rule so that a handler which simply lacks the branch is distinguishable from one that decided.

#### Scenario: A chargeback on a confirmed booking
- **WHEN** a notification reports a confirmed booking's payment as charged back
- **THEN** the booking remains `CONFIRMED`, the payment remains `APPROVED`, one warning is logged with the three identifiers, and the response is `200`

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

### Requirement: Mercado Pago is called over the platform fetch with bounded time

Both Mercado Pago calls SHALL be made through an injected `fetch`-shaped transport so that tests never reach the network, and SHALL carry the token in a header, never in a URL.

Every call SHALL be bounded by an abort timeout. An unbounded call leaves a request pending until the platform kills it, after which the client submits again and two writes race.

No Mercado Pago call SHALL be made inside a database transaction.

The vendor SDK SHALL NOT be added as a dependency. Two endpoints do not justify it against a Worker bundle already near its size ceiling.

#### Scenario: A slow Mercado Pago does not hang a request
- **WHEN** Mercado Pago does not respond within the configured timeout during preference creation
- **THEN** the request aborts, the client returns to the confirmation page with their hold intact and an outcome inviting a retry, and no `Payment` row is left blocking a later attempt

#### Scenario: No network in unit tests
- **WHEN** the payment unit tests run
- **THEN** the transport is a test double and no request reaches Mercado Pago

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

### Requirement: Payment logs identify the decision and never the person

Every payment and notification outcome SHALL be logged with the booking id, the payment id, the Mercado Pago payment id where known, and the decided outcome — distinguishing at minimum: reference unresolved · payment not found at Mercado Pago · amount or reference mismatch · hold lapsed with slot free · hold lapsed with slot lost · already processed · post-confirmation reversal.

No log line SHALL carry the client's name, email or phone, the cancellation token, or any credential material.

#### Scenario: Outcomes are distinguishable in logs
- **WHEN** a notification is refused for an amount mismatch
- **THEN** the log identifies that specific cause rather than a generic failure

#### Scenario: No personal data in payment logs
- **WHEN** any payment or notification path logs
- **THEN** no client contact detail, cancellation token or credential appears in the output

### Requirement: The minimum chargeable deposit is confirmed against Mercado Pago rather than assumed

The minimum deposit constant SHALL be set to Mercado Pago's real minimum chargeable amount in ARS, confirmed from their documentation during this change, and the wording marking it provisional SHALL be removed from the code, the data model document and the tech-debt register in the same change.

This is the first story able to answer the question. A floor set above the real minimum silently raises small deposits the gateway would have accepted; set below it, it fails to protect and the rejection lands inside a client's checkout.

#### Scenario: The constant is no longer provisional
- **WHEN** the change is complete
- **THEN** the minimum deposit constant reflects a confirmed Mercado Pago limit and no artifact describes it as provisional

### Requirement: Every user-facing string this capability introduces is Spanish and lives with the flow's copy

All new strings — the payment control, every state of the confirmation page, the outcome messages and the failure notices — SHALL be Spanish (es-AR) and SHALL live in the shared copy module under the booking flow's key, never inline beside logic. Amounts SHALL be formatted in ARS through the existing formatters. Identifiers, comments, log messages and test names remain English.

#### Scenario: Copy location review
- **WHEN** the change is complete
- **THEN** no user-facing Spanish string introduced by this capability is written inline

### Requirement: The payment path is proven against the deployed runtime before the story closes

A gate script SHALL exercise, against a deployed preview and a live database: a preference created for a real booking, a notification round-tripped to a confirmed booking, the same notification replayed without a second effect, an amount mismatch refused, and both late-payment branches — slot free and slot resold.

Unit tests alone cannot establish this. The prior story found two defects in the first minutes of runtime checking that a fully green suite had certified, one of them a repository mock asserting a call that could not work against the real driver. Test doubles in this capability SHALL expose only methods that exist on the real collaborator.

#### Scenario: The gate passes on the deployment runtime
- **WHEN** the gate script runs against the deployed preview
- **THEN** every listed path is exercised and reported as passing

#### Scenario: A double cannot certify an impossible call
- **WHEN** a test double stands in for the payment gateway or the transaction client
- **THEN** it exposes only the methods the real collaborator provides, so calling a wrong one fails the test

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

