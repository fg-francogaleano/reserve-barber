# booking-confirmation-email Specification

## Purpose
TBD - created by archiving change n1-booking-confirmation-email. Update Purpose after archive.
## Requirements
### Requirement: A confirmation email is sent on the transition into CONFIRMED, from exactly two triggers

The system SHALL send one confirmation email to the client when a booking transitions **into** `CONFIRMED`, and SHALL have exactly two triggers: the Mercado Pago notification path reporting the `confirmed` outcome, and the owner's approval of a transfer receipt reporting that the approval was applied.

The trigger SHALL be the **outcome of the guarded write**, never the observed status of the booking. Both writes are conditional updates guarded on the status they expect, so exactly one caller per booking ever sees the confirming outcome; a duplicate delivery, a re-run, or a concurrent second approval matches zero rows and reports something else.

**Keying the send on "the booking is `CONFIRMED`" is forbidden.** The Mercado Pago notification endpoint is public and replayable by design, and every redelivery reaches that state. A send keyed on the status would make an unauthenticated endpoint into an unbounded mail sender aimed at one real person's inbox.

No email SHALL be sent for any other outcome. In particular, a payment approved after the slot was lost, a payment approved for a booking that no longer exists, a rejected receipt, and a swept hold each send nothing.

#### Scenario: The Mercado Pago path confirms
- **WHEN** a notification is verified and the booking transitions from `PENDING_PAYMENT` to `CONFIRMED`
- **THEN** one confirmation email is requested for that booking

#### Scenario: The transfer path confirms
- **WHEN** the owner approves a pending receipt and the booking transitions from `PENDING_APPROVAL` to `CONFIRMED`
- **THEN** one confirmation email is requested for that booking

#### Scenario: A redelivered notification sends nothing
- **WHEN** Mercado Pago redelivers a notification for a booking already `CONFIRMED`
- **THEN** the outcome is reported as already processed and no request is made to the email provider

#### Scenario: A concurrent second approval sends nothing
- **WHEN** the owner submits the same receipt approval twice concurrently
- **THEN** exactly one submission matches a row and exactly one email is requested

#### Scenario: A lost slot sends nothing
- **WHEN** a payment is approved for a booking whose slot was resold
- **THEN** no confirmation email is requested

---

### Requirement: A failed send never changes the outcome of the transition that triggered it

Sending SHALL be non-fatal at every call site. A provider error, a rejection, a timeout, or an absent configuration SHALL leave the booking `CONFIRMED`, SHALL leave the Mercado Pago notification answering `200`, and SHALL leave the owner's approval reported as successful.

The email SHALL NOT be sent inside a database transaction, and no send SHALL begin before the confirming transaction has committed. A third party's latency must never hold a pooled connection, and a rolled-back transaction must never be announced to a client.

A send failure SHALL NOT be converted into a request for redelivery. Asking Mercado Pago to retry cannot recover it: the retry finds the booking already confirmed, reports it as already processed, and by this capability's own trigger rule sends nothing. **A `503` here would conceal the failure rather than resolve it.**

The port SHALL report failure as a value rather than by throwing into its caller, so that "the mail provider is down" cannot become an unhandled exception on a payment path.

#### Scenario: The provider is unavailable
- **WHEN** the email provider responds `500` after a booking is confirmed by notification
- **THEN** the booking remains `CONFIRMED`, the endpoint answers `200`, and an error is logged

#### Scenario: The provider times out
- **WHEN** the email provider does not respond within the configured timeout
- **THEN** the request is aborted, the caller's outcome is unchanged, and an error is logged

#### Scenario: The owner's approval still succeeds
- **WHEN** the email provider rejects the message after an approval is applied
- **THEN** the receipt, payment and booking remain approved and confirmed, and the owner is not shown a failure

#### Scenario: The send is outside the transaction
- **WHEN** the confirming code paths are reviewed
- **THEN** no send is initiated from inside a database transaction

---

### Requirement: The email carries the appointment, the money and the client's own link

The message SHALL carry: the shop's public name, the branch name and address, the barber's display name, the service name, the appointment's date and start time, the deposit already paid, the balance payable at the shop, and a link to the client's booking page.

The appointment SHALL be formatted in the **business** timezone through the shared business-time module, never in the runtime's timezone and never in the recipient's. The rule the booking domain already states applies here: a second expression of a rule that reads a clock drifts from the first.

Monetary values SHALL be rendered from the canonical decimal strings the repository boundary produces, through the same formatter the pages use.

The link SHALL address the existing confirmation page by the booking's `cancellationToken`. **A URL for a route that does not yet exist SHALL NOT be emailed**, because an email cannot be redeployed and a 404 in an inbox is permanent.

**The link's described purpose SHALL name cancelling, now that the page can do it.** The message offered the page as somewhere to *see* the appointment because that was all it could do; the same sentence in the same inbox now understates a control that is one click away, and a client who cannot come would go on writing to the shop rather than using the link they were sent. The wording SHALL NOT imply that following the link cancels anything — the page renders, and cancelling takes a further deliberate step.

**The message SHALL NOT carry a direct link to the cancellation itself.** The cancellation is a `POST` behind a confirmation for the reason recorded against the unverified-recipient debt, and a URL in an email that performs the action would defeat exactly that.

The fallback used when no public origin is configured, which tells a client to contact the shop in order to change or cancel, SHALL remain unchanged: with no link there is still nothing else they can do.

The link SHALL appear as a visible, complete URL in addition to any styled control, so that a plain-text rendering, a forward, or a client that strips markup still carries it.

The message SHALL be sent with a plain-text alternative alongside any markup rendering, and SHALL reference no remote images.

#### Scenario: The appointment is in the shop's timezone
- **WHEN** the email is built for an appointment stored as an instant
- **THEN** the rendered date and time are the business-local ones, produced by the shared business-time module

#### Scenario: The balance is stated
- **WHEN** the email is built for a booking whose price exceeds its deposit
- **THEN** it states the deposit already paid and the amount payable at the shop

#### Scenario: The link says the page can cancel
- **WHEN** the message is composed with a public origin configured
- **THEN** its description of the link names cancelling as something the client can do there

#### Scenario: No URL in the message performs a cancellation
- **WHEN** every URL in the message is fetched
- **THEN** no booking changes status

#### Scenario: The no-link fallback is unchanged
- **WHEN** no public origin is configured
- **THEN** the message tells the client to contact the shop to change or cancel, and carries no URL

#### Scenario: The link survives plain text
- **WHEN** the plain-text alternative is rendered
- **THEN** the complete booking URL appears as readable text

#### Scenario: No remote assets
- **WHEN** the message is reviewed
- **THEN** it requests no image or asset from a remote host

### Requirement: An unusable public origin degrades the email rather than corrupting it

The link SHALL be composed from the deployment's configured public origin, resolved through the shared origin module that already refuses loopback and private addresses.

When no usable origin resolves, the email SHALL still be sent — a client who paid is owed the confirmation regardless — and SHALL omit the link entirely. It SHALL NOT contain a relative URL, a loopback address, or a host derived from a request header.

That condition SHALL be logged at error level with a distinguishable reason. This is a configuration fault whose only other symptom is an email nobody can act on.

#### Scenario: No origin configured
- **WHEN** a booking is confirmed on a deployment with no usable public origin
- **THEN** the email is sent without a link, and an error naming the missing origin is logged

#### Scenario: A private origin is refused
- **WHEN** the configured origin is a loopback or private address
- **THEN** no such URL appears in the message

#### Scenario: A request header cannot supply the origin
- **WHEN** the email is composed
- **THEN** the origin comes from configuration alone and no host header contributes to it

---

### Requirement: Whether the client was told is recorded on the booking, not only in a log

The `Booking` row SHALL carry the instant at which the provider accepted the confirmation message, written after acceptance and outside the confirming transaction.

Its absence on a `CONFIRMED` booking SHALL mean "this client was never told", and SHALL be expressible as a query rather than recoverable only by reading logs.

Failing to record it SHALL NOT undo anything and SHALL NOT be presented as a failure to the caller; it SHALL be logged.

**This column does not provide idempotency and SHALL NOT be relied on for it.** At-most-once delivery comes from the guarded transition. The column exists so that the product can answer a question it currently cannot: which confirmed bookings have a client who does not know.

#### Scenario: A successful send is recorded
- **WHEN** the provider accepts the message
- **THEN** the booking carries the acceptance instant

#### Scenario: A failed send leaves the column null
- **WHEN** the provider rejects or times out
- **THEN** the booking's send instant remains null and the booking stays `CONFIRMED`

#### Scenario: Confirmed-but-untold is queryable
- **WHEN** bookings are queried for a confirmed status and a null send instant
- **THEN** the result is exactly the set of clients who were never told

---

### Requirement: The provider is called over the platform fetch with bounded time and no SDK

The provider SHALL be called through an injected `fetch`-shaped transport so that tests never reach the network, with the API key in a request header and never in a URL or a query string.

Every call SHALL be bounded by an abort timeout.

**The vendor SDK SHALL NOT be added as a dependency.** One endpoint does not justify it against a Worker bundle already near its size ceiling, and the same decision was taken for the payment gateway for the same reason.

No provider response body SHALL be logged or attached to an error, and no log line SHALL carry the API key or the `Authorization` header.

The adapter SHALL translate the provider's responses into a small closed set of outcomes distinguishing at minimum: accepted · refused for a reason a retry cannot change · rate-limited or quota-exhausted · transient.

#### Scenario: No network in unit tests
- **WHEN** the email unit tests run
- **THEN** the transport is a test double and no request reaches the provider

#### Scenario: The dependency list is unchanged
- **WHEN** the change's dependency manifest is reviewed
- **THEN** no email vendor package has been added

#### Scenario: A rejection leaks nothing
- **WHEN** the provider rejects the request with a body echoing the submitted fields
- **THEN** no part of that body and no credential appears in any log line

#### Scenario: Quota exhaustion is distinguishable
- **WHEN** the provider answers with a rate-limit or quota status
- **THEN** the logged outcome distinguishes it from an ordinary failure

---

### Requirement: Guest-supplied values are escaped in the body and never reach a header

Every value originating from a guest — the client's name above all — SHALL be escaped for the rendering it appears in.

No guest-supplied value SHALL be interpolated into any message header, including sender, reply-to and subject. A newline sequence in a header is a second message with an attacker-chosen recipient.

The recipient address SHALL be the only guest-supplied value that reaches the provider as an address field, and it SHALL be sent as a single address, never as a list assembled by parsing.

#### Scenario: A name containing markup
- **WHEN** a client's stored name contains markup
- **THEN** it appears escaped in the message body and executes nothing

#### Scenario: A name containing a newline sequence
- **WHEN** a client's stored name contains carriage-return or line-feed characters
- **THEN** no part of it reaches any header and no additional recipient is produced

#### Scenario: The subject is composed from server-held values
- **WHEN** the subject is built
- **THEN** it is composed from the shop's name and the appointment instant, not from guest-supplied text

---

### Requirement: Email logs identify the decision and never the person or the credential

Every send attempt SHALL be logged with the booking id and the decided outcome, under an operation name that identifies this capability.

No log line SHALL carry the recipient address, the client's name or phone, the cancellation token, the composed link, the message body, or the provider API key.

An outcome that a retry cannot change and an outcome that is merely transient SHALL be distinguishable in the log, because they lead to different action by the operator.

#### Scenario: Outcomes are distinguishable
- **WHEN** a send fails because the quota is exhausted
- **THEN** the log identifies that cause rather than a generic failure

#### Scenario: No personal data in email logs
- **WHEN** any send path logs
- **THEN** no recipient address, client contact detail, cancellation token or credential appears in the output

---

### Requirement: The confirmation page states the true email status and never claims a message that failed

The confirmed state of the booking page SHALL render one of three variants, chosen from the recorded send instant: the message was sent, it has not been recorded yet, or it could not be sent.

It SHALL NOT state that a confirmation was emailed unless the send instant is recorded.

In the could-not-send variant the page SHALL say so plainly and SHALL keep the instruction to save the link, which in that case is the client's only copy.

Every string this introduces SHALL be Spanish (es-AR) and SHALL live with the flow's copy module rather than inline in a component.

#### Scenario: The email was sent
- **WHEN** the page renders a confirmed booking whose send instant is recorded
- **THEN** it states that the confirmation was sent to the client's email

#### Scenario: The email failed
- **WHEN** the page renders a confirmed booking whose send instant is null and whose confirmation is not recent
- **THEN** it does not claim an email was sent, and it tells the client to keep the link

#### Scenario: Copy lives with the flow
- **WHEN** the components are reviewed
- **THEN** no Spanish user-facing string introduced by this capability is written inline

---

### Requirement: Configuration for sending is validated at this feature's own composition root

The provider API key SHALL be a deployment secret, supplied by `wrangler secret put` and by the git-ignored local variables file, uploaded as exact bytes.

The sender address SHALL be a non-secret deployment variable belonging in the committed Wrangler configuration, so that a deploy from a fresh clone does not silently lack it.

**Neither value SHALL have a default, and the sender address especially SHALL NOT fall back to a provider's shared onboarding sender.** Such a sender delivers only to the provider account owner's own address — so it would pass a verification performed from that inbox and silently drop every real client, which is the one failure this capability has no way to detect. Until a verified sender exists the variable SHALL be **absent**, which is a handled state, rather than populated with a value that partly works.

The key SHALL be validated at the composition root of this capability and **never** in the application's global startup validation. A missing value SHALL disable confirmation emails alone; it SHALL NOT break the notification endpoint, the review queue, or any page.

**Reading those values from the process environment is a convenience of the request-served composition roots, not the contract.** The shared sender factory SHALL accept the key and the sender address as explicit arguments, and the process-environment read SHALL be a thin wrapper over that entry point. A caller with no request context — a scheduled invocation, where the process environment is not populated from deployment bindings — SHALL be able to construct a fully configured sender without depending on runtime behaviour this project has not measured.

The factory SHALL continue to return a sender that cannot send, rather than throwing, when either value is absent by either route.

#### Scenario: The key is missing
- **WHEN** the application is deployed without the provider key
- **THEN** confirmations are still processed, the failure is logged by name, and no other feature is affected

#### Scenario: The sender address is missing
- **WHEN** the application is deployed without a sender address
- **THEN** it is reported by name alongside any other missing value, and no default sender is substituted

#### Scenario: The committed configuration carries no placeholder
- **WHEN** the deployment configuration is reviewed before a domain has been verified
- **THEN** the sender variable is absent, and its intended value is documented rather than guessed

#### Scenario: A caller with no request context configures the sender explicitly
- **WHEN** the sender factory is called with a key and a sender address supplied directly
- **THEN** it returns a sending adapter without reading any process environment

#### Scenario: The request-served roots are unchanged
- **WHEN** a confirmation is sent from the notification endpoint or the receipt review
- **THEN** the configuration still comes from the process environment and every existing behaviour is unchanged

### Requirement: The missing-configuration failure is reported once per message, never once per request

A deployment with incomplete email configuration SHALL report that fact **when a message would actually have been sent**, and SHALL NOT report it when the sender is merely constructed.

This capability's composition roots are per-request functions. Logging at construction puts one entry on every request to the **public, unauthenticated** notification endpoint — including on the cheap-rejection path where a reference resolved nothing and no message was ever going to be composed — and one on every render of the owner's review queue. That is log volume an anonymous caller can drive, on an endpoint already documented as unmetered.

Reporting at send time bounds the volume to one entry per confirmed booking, and places it out of reach of an anonymous caller: a forged notification never reaches a confirming outcome, so it never reaches a send.

The entry SHALL name the missing variables and SHALL carry no credential value, no recipient address and no message content.

#### Scenario: Constructing the sender reports nothing
- **WHEN** the composition root is built repeatedly with no configuration
- **THEN** no log entry is produced

#### Scenario: An attempted send reports once
- **WHEN** several senders are constructed and one message is attempted
- **THEN** exactly one entry is produced, naming the missing variables

#### Scenario: A notification that resolves nothing costs no entry
- **WHEN** an unauthenticated caller posts a notification whose reference matches no payment
- **THEN** no email-configuration entry is produced

---

### Requirement: Delivery is proven against a real inbox before the story closes

This capability SHALL NOT be considered verified by a passing test suite or by a successful provider response. A provider acceptance means accepted for delivery, and a domain whose sender authentication records are absent or wrong delivers to spam, which is indistinguishable from not sending.

Verification SHALL consist of a message arriving in a real mailbox, composed from a real database read and sent by the real provider adapter through a real trigger.

**Achieved once, and the remainder is recorded rather than waived (T76).** One trigger — the receipt approval — delivered a message whose link opened its booking. Three gaps stand: no sending domain is verified, so the provider's shared sender reaches the account owner and nobody else; the provider call has never been made from the Worker runtime, only from Node; and the notification trigger cannot be exercised, because the gateway no longer holds the payments that would reach its confirming branch.

**While the first gap stands, the provider key SHALL NOT be set in production.** A deployment that appears to send, and reaches one person, is the partial success this capability already refuses in its configuration rule — and it would replace an honest could-not-send state with a false claim.

A verified sending domain, with its sender-authentication DNS records published, SHALL be treated as a prerequisite of that verification rather than as follow-up work. Until one exists, the provider's shared onboarding sender delivers only to the account owner's own address, and an end-to-end check with a client address is impossible.

#### Scenario: The Mercado Pago path is proven end to end
- **WHEN** a real payment is confirmed on the deployed runtime
- **THEN** the confirmation message arrives in the client mailbox and its link opens that booking's page

#### Scenario: The transfer path is proven end to end
- **WHEN** the owner approves a receipt on the deployed runtime
- **THEN** the confirmation message arrives in the client mailbox

#### Scenario: The prerequisite is recorded rather than assumed
- **WHEN** the sending domain has not been verified
- **THEN** the story records that runtime verification is blocked on DNS rather than reporting the capability as done

