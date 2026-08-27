## ADDED Requirements

### Requirement: The client may cancel a booking they are still holding, and only that

The system SHALL let the holder of a booking's `cancellationToken` cancel it when **all three** of the following are true:

1. its status is not `PENDING_APPROVAL`;
2. it still blocks availability, as decided by the shared `blocksAvailability` predicate;
3. its appointment has not started — `startTime` is strictly after the deciding instant.

**Eligibility SHALL be built on `blocksAvailability` rather than on a status list**, because that predicate already answers this capability's question: *is this booking still holding its time?* A client cancels in order to give time back, so a booking holding none has nothing to release. A booking whose deposit was approved after its hold lapsed — the paid-slot-lost case — therefore offers no control, and cancelling it would only convert the client's bad luck into their own recorded decision.

**The `startTime` bound is a deliberate asymmetry with the owner's rule, which takes no instant.** A no-show is precisely the past appointment an owner wants off the books; for a client the reverse holds. A past slot cannot be released, so cancelling one would only record an appointment that happened as cancelled — which the dashboard's cancellations counter counts and the statistics story will report as churn.

**A booking whose transfer receipt is under review SHALL NOT be cancellable by its client.** In that state the client has already transferred real money and uploaded proof of it, and a human owes them an answer. The owner's review queue filters on the **booking's status**, so a client cancellation would remove that receipt from the only surface anyone would ever look at it on, leaving money in the shop's account with no row in this product asserting that it arrived. The page SHALL instead tell the client to contact the shop, so the exclusion reads as a decision rather than as a missing control.

**No minimum-notice period SHALL be introduced.** Whether a client may cancel ten minutes before their turn is a shop policy, and no owner can express one in this product; choosing a number here would make a guess into a rule every shop inherits.

Eligibility SHALL be expressed as **a single domain predicate consulted by every caller that needs the answer**: the page deciding whether to render the control, the service deciding whether to attempt the write, and the write's own cheap rejection. Three copies of a status list are three chances for a control to appear where the write refuses.

#### Scenario: A confirmed future appointment is cancellable

- **WHEN** the client opens the link for a `CONFIRMED` booking whose appointment is tomorrow
- **THEN** a cancellation control is offered

#### Scenario: A past appointment is not

- **WHEN** the client opens the link for a `CONFIRMED` booking whose appointment was yesterday
- **THEN** no cancellation control is offered, and a forged submission for it changes nothing

#### Scenario: A receipt under review is not the client's to cancel

- **WHEN** the client opens the link for a `PENDING_APPROVAL` booking whose receipt is `PENDING`
- **THEN** no cancellation control is offered
- **AND** the page tells them to contact the shop
- **AND** a submission forged for that booking matches zero rows and changes nothing

#### Scenario: A booking that is no longer holding its time offers nothing

- **WHEN** the client opens the link for a `PENDING_PAYMENT` booking whose hold has lapsed
- **THEN** no cancellation control is offered

#### Scenario: One predicate answers for every caller

- **WHEN** the client-eligibility rule is reviewed
- **THEN** the control, the service and the write's rejection all consult the same function

---

### Requirement: The cancellation is a POST behind a safe confirmation step

The cancellation SHALL be performed by a **`POST`**, and SHALL NOT be performed by any `GET`.

**This is a security requirement, not an ergonomic one.** The token addressing the booking travels in an email to an address this product has never verified. A cancel-by-URL would be fired by a mail scanner, a link-preview bot, a corporate security gateway that fetches every link in an inbound message, a mistaken recipient, or the application framework's own link prefetching — none of them intending to cancel anything, all of them producing an appointment that vanishes.

The `POST` SHALL be reached through a **confirmation step that is itself a safe request**: a `GET` carrying a single query parameter, which renders a confirmation and **writes nothing**. Any agent that fetches every URL on the page therefore produces renders and no state change.

The confirmation parameter SHALL be **parsed strictly**: a single expected string value, never an array, never any truthy value. Anything else SHALL render the ordinary page.

The confirmation step SHALL be rendered **only when the booking is cancellable by its client**. A control that cannot succeed invites an action that cannot succeed.

Both steps SHALL work with **no JavaScript**. A scripted confirmation dialog SHALL NOT be used: the public flow ships none, and a dialog that never runs would silently reduce this to a single click.

The endpoint SHALL be a **Route Handler at a fixed path with no identifier in it**, and the token SHALL travel in the **request body**. The path is fixed so the deny-by-default guard can admit it by string equality rather than by pattern; the body keeps a live credential out of access logs and `Referer` headers.

**No CSRF token SHALL be required.** A cross-site submission must carry the cancellation token, and anyone holding that token can cancel by design — a CSRF token would protect a session-derived authority this endpoint does not have. The actor worth defending against is the credential-free one, and it is defeated by the request being a `POST` at all.

#### Scenario: A scanner that fetches every link cancels nothing

- **WHEN** an automated agent fetches the emailed link and every URL on the resulting page
- **THEN** no booking changes status and no row is written

#### Scenario: The confirmation parameter is not a truthy test

- **WHEN** the page is opened with the confirmation parameter repeated, empty, or carrying any value other than the expected one
- **THEN** the ordinary page is rendered and no confirmation is offered

#### Scenario: The confirmation is not offered for a booking that cannot be cancelled

- **WHEN** the confirmation parameter is supplied for a booking outside the client's eligibility
- **THEN** the ordinary page is rendered

#### Scenario: The flow completes with scripting disabled

- **WHEN** the client completes both steps with JavaScript unavailable
- **THEN** the booking is cancelled

#### Scenario: The token is never in the URL of the write

- **WHEN** the cancellation endpoint is reviewed
- **THEN** its path carries no identifier and the token is read from the request body

---

### Requirement: The confirmation states what cannot be undone before the client commits

The confirmation step SHALL state, before the irreversible submission:

1. which appointment is being cancelled — its date, time, service, barber and branch;
2. that the slot is released immediately and may be taken by somebody else;
3. that the action cannot be undone;
4. **where a deposit has been approved** — that the money is not returned by this system and must be arranged with the shop;
5. **where the booking has committed to bank transfer** — that a payment already started must not be completed, and that money already transferred has to be raised with the shop, because nothing here records that it arrived.

**Points 4 and 5 are the reason this step exists rather than a single-click control.** This is the only surface shown while the decision is still the client's to reverse. The owner's equivalent confirmation already carries the same warning before their own write.

The confirmation SHALL offer a way back that is a plain navigation and changes nothing.

**No pending or disabled state SHALL be relied upon.** The flow has no client-side scripting, so the design SHALL tolerate a repeated submission rather than attempt to prevent one.

#### Scenario: The money is named before the click, not after

- **WHEN** the confirmation is shown for a booking whose deposit is approved
- **THEN** it states that the slot is released, that the action is final, and that the deposit is not returned by this system

#### Scenario: A booking with nothing charged raises no refund

- **WHEN** the confirmation is shown for a booking with no approved payment
- **THEN** it makes no statement about money being returned

#### Scenario: An open checkout is warned about

- **WHEN** the confirmation is shown for a booking with a live payment attempt
- **THEN** it tells the client not to complete a payment they have already started

#### Scenario: Backing out changes nothing

- **WHEN** the client uses the confirmation's own way back
- **THEN** no row changes and the ordinary page is rendered

---

### Requirement: The client's cancellation is one guarded transaction that takes no lock

Cancelling by token SHALL run in one transaction that sets `status` to `CANCELLED`, records `cancelledAt`, records `cancelledBy` as `CLIENT`, and clears `holdExpiresAt`.

The booking update SHALL be **conditional on the status it read**, so a booking that moved underneath — confirmed by a notification, swept by the expiry job, cancelled by the owner — matches zero rows and is reported as what it became rather than having `CANCELLED` stamped over it.

**No advisory lock SHALL be taken.** The per-barber lock exists so two writers cannot *place* a booking into one slot; this only releases one, and a release cannot double-book.

**The eligibility predicate SHALL be evaluated in the application and the transaction SHALL guard on status alone.** Re-expressing "the hold is still live" in SQL is the drift the booking write's contract forbids by name. Status is also the only input that races: the sweep writes `EXPIRED` and a notification writes `CONFIRMED`, while `startTime` never moves and `holdExpiresAt` only ever moves later — a commitment to transfer extends it, which can make a hold more live but never less.

An `APPROVED` payment SHALL be left untouched, protected by the write's own condition rather than by a branch. A `PENDING` payment SHALL be set to `REJECTED`. **No receipt SHALL be written in any state.**

The write SHALL return the shop's public slug, so the client is returned to their own page using a value the projection produced rather than one the submission supplied.

**Nothing SHALL be refunded and nothing SHALL record that a refund is owed.** This product has no refund path, and a cancelled booking with an approved deposit is money the owner owes and must arrange outside this system.

#### Scenario: The slot is released

- **WHEN** a `CONFIRMED` booking for 15:00 is cancelled by its client
- **THEN** a fresh availability read offers 15:00

#### Scenario: The canceller is recorded as the client

- **WHEN** a client cancellation is applied
- **THEN** the booking carries a `cancelledAt` and a `cancelledBy` of `CLIENT`

#### Scenario: A hold deadline is cleared

- **WHEN** a `PENDING_PAYMENT` booking is cancelled by its client
- **THEN** its `holdExpiresAt` is null

#### Scenario: An approved deposit survives

- **WHEN** a booking with an `APPROVED` payment is cancelled by its client
- **THEN** the payment is still `APPROVED` with its original approval instant

#### Scenario: A booking confirmed in the meantime is reported, not overwritten

- **WHEN** a client cancellation is submitted for a booking a notification confirmed a moment earlier
- **THEN** the write matches zero rows and the booking is still `CONFIRMED`

#### Scenario: Nothing claims to refund anything

- **WHEN** the client cancellation path is reviewed
- **THEN** no code and no message states that money has been returned

---

### Requirement: A refusal names its reason, and never contradicts the page it lands on

A cancellation that does not apply SHALL return the client to their own booking page, and the page SHALL distinguish at least these two facts:

- **the appointment had already started** — nothing is left to release, and the client's next move is to contact the shop;
- **the booking moved underneath the attempt** — it was confirmed, swept, or cancelled by someone else.

They are separate messages because the client acts on them differently, and a single generic refusal would leave them re-submitting a control that will never succeed.

**A refusal notice SHALL NOT be rendered when the page's resolved state is a cancelled one**, whatever the returned code says. A repeated submission, a lost response after a successful commit, and a browser retry all produce a second write that matches zero rows; the client wanted the booking cancelled and it is, so telling them *"no pudimos cancelar"* under a heading that says the booking is cancelled is the product contradicting itself in two adjacent sentences.

The same rule covers losing the race to the owner: the shop-cancelled state renders, and the client's own attempt is not reported as a failure at something that already happened.

The success path SHALL carry **no outcome code at all**. The page reads live state and renders the cancelled state on its own; a success code could only agree with the database or be ignored.

#### Scenario: A second submission is not reported as a failure

- **WHEN** the client submits the cancellation twice and the second matches zero rows
- **THEN** the page renders the cancelled state and no message says the cancellation failed

#### Scenario: A commit whose response was lost

- **WHEN** the client retries after a cancellation that had already committed
- **THEN** they are shown their cancelled booking rather than an error

#### Scenario: The appointment started between the confirmation and the submission

- **WHEN** the confirmation was opened before the appointment began and submitted after
- **THEN** the booking is unchanged and the client is told the appointment has already started

#### Scenario: The owner cancelled it a moment earlier

- **WHEN** the client's submission loses the race to the owner's cancellation
- **THEN** the page states that the shop cancelled the appointment and does not report the client's attempt as a failure

#### Scenario: Success needs no code

- **WHEN** a cancellation applies
- **THEN** the client is returned to their page with no outcome code, and the cancelled state is resolved from the database

---

### Requirement: The write discloses nothing, and its log volume is not something a stranger can drive

A token that matches no booking SHALL be answered **identically** to one whose booking no longer exists, with no redirect and nothing that discloses whether the token was ever valid.

A token that resolves nothing SHALL NOT be logged as an error. From outside, a forged token and a deleted booking are the same fact and neither is a fault.

**The number of log entries an anonymous caller can produce SHALL be bounded and SHALL be measured, not assumed.** This endpoint is public, unauthenticated and unmetered, so a per-request log line is log volume any stranger can generate at will — the defect found on the confirmation-email path one story earlier, beside a comment asserting the opposite.

No log line on this path SHALL carry the cancellation token, the client's name, email or telephone, or the composed link. The service SHALL be handed identifiers only, so there is nothing available for a later change to log by accident.

The endpoint SHALL be rate limited per origin, and the limitation of that limit SHALL be stated rather than implied: it is per-isolate and best-effort, it defeats one script in a loop rather than a distributed attempt, and **unlike the booking write it has no second database-checked bound behind it**. What bounds this endpoint is the credential — an unguessable, generated, never-derived token — and that SHALL be recorded as the actual protection.

#### Scenario: A forged token discloses nothing

- **WHEN** a cancellation is submitted with a token matching no booking
- **THEN** the response is identical to one for a booking that no longer exists, and no redirect reveals a shop

#### Scenario: A stranger cannot inflate the logs

- **WHEN** a large number of submissions carrying invalid tokens are made
- **THEN** the number of log entries produced is the number this capability names, and it does not grow with the number of requests

#### Scenario: No personal data on this path

- **WHEN** the client cancellation path logs
- **THEN** no token, recipient address, client name or telephone appears

#### Scenario: A resolution miss is not an error

- **WHEN** a submitted token resolves nothing
- **THEN** it is recorded at information level, not as a failure

---

### Requirement: The client cancellation is proven against the live database before the story closes

A gate script SHALL exercise this capability against the live database and SHALL prove at minimum:

- a forged token resolving nothing and disclosing nothing;
- the guarded update matching **zero rows** when the status moved between the read and the write;
- an `APPROVED` payment surviving untouched, verified by a **whole-row comparison before and after**, not by reading back the one column the test expects to change;
- `cancelledAt` and `cancelledBy` landing as `CLIENT` in the database, reached through a **real cancellation path** rather than a seeded row;
- the released slot **reappearing in a real availability read**;
- a booking whose appointment has already started being refused;
- a `PENDING_APPROVAL` booking being refused;
- a repeated submission matching zero rows and reporting the true state;
- the log cardinality an anonymous caller can drive.

The behaviour SHALL additionally be exercised over HTTP on **both** the Node and the `workerd` runtimes, because the two have disagreed before about instants and formatting.

#### Scenario: The gate proves the guard

- **WHEN** a booking's status changes between the read and the write
- **THEN** the gate observes zero rows matched rather than a cancelled booking

#### Scenario: The gate proves the slot came back

- **WHEN** a confirmed booking is cancelled by its client
- **THEN** a real availability read for that barber and day offers the released time

#### Scenario: The gate proves the attribution reached the database

- **WHEN** the cancellation is applied through the real path
- **THEN** the stored row carries `cancelledBy` of `CLIENT` and a non-null `cancelledAt`

#### Scenario: Both runtimes agree

- **WHEN** the flow is driven over HTTP on Node and on `workerd`
- **THEN** the confirmation step and the cancelled state render identically

## MODIFIED Requirements

### Requirement: The client's page names the shop as the canceller

The confirmation page SHALL render a distinct state for a booking cancelled by the shop, stating that the shop cancelled the appointment and that the time was released.

**Its precedence SHALL place it above the lapsed-hold and paid-slot-lost states**, both of which would otherwise describe something that did not happen: a race the client lost, or a deadline they missed. It SHALL sit **below** the receipt states. Those remain in the table and are currently unreachable from the page's projection (T73), so in practice a receipt rejection and a cancellation both arrive here — which is why this state's wording must be true of either.

The state SHALL be driven by **who cancelled**, not by the status alone. A booking cancelled by its own client must not be shown a message about the shop cancelling it, and the status cannot distinguish them. The projection feeding the page SHALL therefore carry the canceller.

**A `CLIENT` canceller SHALL render the client's own state rather than this one.** Until a client could cancel, `CLIENT` was routed to the unattributed state as the safe direction — the alternative being to tell a client the shop had cancelled a booking they cancelled themselves. That fall-through is now replaced by a state of its own, and the unattributed form is reserved for a null canceller.

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

#### Scenario: A client's own cancellation is not blamed on the shop
- **WHEN** the client opens the link for a booking whose recorded canceller is `CLIENT`
- **THEN** the client's own cancelled state is rendered, and no message says the shop cancelled it

#### Scenario: An unattributed cancellation is not blamed on anyone
- **WHEN** the client opens the link for a `CANCELLED` booking with a null canceller
- **THEN** a generic cancelled state is rendered

#### Scenario: A paid cancellation says what the system cannot do
- **WHEN** the cancelled booking's deposit was approved
- **THEN** the page states the deposit is not returned by this system

#### Scenario: No payment control survives
- **WHEN** the cancelled state renders
- **THEN** no payment or receipt control is present
