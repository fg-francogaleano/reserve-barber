# booking-reminder-email Specification

## Purpose
The scheduled message that tells a client their appointment is coming, and **the only mechanism in
this product for recovering a slot from a client who has changed their mind**. Its value is the
cancellation link it carries: between booking and appointment the product has no other voice, so a
client who can no longer come has nothing prompting them to release a slot the shop could still sell.

It is the first message here whose trigger is **time passing** rather than something a client did,
and every design decision follows from that one fact. The confirmation inherits at-most-once delivery
from a guarded status transition; this has no transition to key on, so the guarantee is constructed —
a single conditional update that both selects and marks, run **before** the send. `reminderEmailSentAt`
is therefore an idempotency key, which is the exact inverse of the column beside it on the same table.

Created by archiving change n2-appointment-reminder-email.

## Requirements

### Requirement: A reminder is claimed before it is sent, and the claim is the only thing that makes delivery at-most-once

The system SHALL send at most one reminder message per booking, and SHALL guarantee that by a **conditional update that both selects and marks**: a single statement setting `reminderEmailSentAt` where it is currently null and the status is `CONFIRMED`, returning the rows it matched. Only rows returned by that statement SHALL be sent to.

**The claim SHALL be written before the send, never after it.** This deliberately inverts the ordering the confirmation message uses, and the reason is that the two capabilities derive at-most-once from different places. The confirmation is triggered by a guarded status transition, so exactly one caller per booking ever observes the confirming outcome and its recorded instant is bookkeeping. **A reminder has no transition to key on** — its trigger is time passing — so the recorded instant *is* the guarantee. Recording after the send leaves a window in which a dead Worker, an accepted-then-timed-out provider call, or a redeploy leaves the row unclaimed, and the next invocation sends again, once per invocation, for as long as the booking remains due.

**Nothing SHALL un-claim a row after a failed send.** A claimed row that could not be delivered may already have been delivered; un-claiming it is how a bounded loss becomes an unbounded duplicate.

A booking whose status changed between selection and claim SHALL match zero rows and SHALL NOT be sent to.

#### Scenario: A second run reminds nobody
- **WHEN** the reminder job runs twice over the same due bookings
- **THEN** the second run claims zero rows and requests no message

#### Scenario: Overlapping invocations cannot double-send
- **WHEN** two invocations overlap over the same candidate rows
- **THEN** each row is claimed by exactly one of them and exactly one message is requested per booking

#### Scenario: A provider outage costs one reminder and never repeats it
- **WHEN** the provider responds with an error for a claimed booking, and the job runs again an hour later
- **THEN** exactly one message was requested in total, the booking's `reminderEmailSentAt` holds the claim instant, and the failure is logged

#### Scenario: A booking cancelled between selection and claim is never reminded
- **WHEN** a selected candidate is cancelled before the claim statement executes
- **THEN** the claim matches zero rows, no message is requested, and `reminderEmailSentAt` remains null

#### Scenario: A failed send is not un-claimed
- **WHEN** the provider rejects a message for a claimed booking
- **THEN** `reminderEmailSentAt` still holds the claim instant and no later run resends

---

### Requirement: The candidate rule never selects a past appointment, and never a booking made inside its own lead window

A booking SHALL be a reminder candidate only when **all** of the following hold: its status is `CONFIRMED`, its `reminderEmailSentAt` is null, its `startTime` is **after** the run's instant, its `startTime` is before the run's instant plus the lead, and the interval between its `createdAt` and its `startTime` is at least the minimum gap.

**`startTime` being in the future is a safety bound and SHALL be expressed as a requirement rather than left implicit in a query.** Without it, the first run in any environment selects every confirmed booking the database has ever held — every fixture, every gate-script row, every real past appointment — and mails all of them. That failure is unbounded, aimed at real inboxes, and unrecoverable once sent.

The window SHALL end at the appointment rather than being centred on a target instant. This makes the rule **self-healing**: anything a failed run, an outage or a deploy skipped is still a candidate on the next invocation. Correctness SHALL NOT depend on the scheduled cadence, and changing the cadence SHALL require no change to this rule.

The minimum gap SHALL suppress a booking created inside its own lead window, which would otherwise receive a "reminder" for an appointment it was told about minutes earlier by the confirmation message, carrying the same appointment and the same link.

The gap SHALL be measured from `createdAt`. It SHALL NOT be measured from `updatedAt`, which the confirmation-send record bumps on every confirmed booking and which is therefore not the booking's age.

#### Scenario: A past confirmed appointment is never a candidate
- **WHEN** the job runs against a database holding confirmed bookings whose `startTime` has passed and whose `reminderEmailSentAt` is null
- **THEN** none of them is claimed, none is sent to, and the summary reports them as not examined

#### Scenario: An appointment beyond the lead is left for a later run
- **WHEN** a confirmed booking starts later than the run's instant plus the lead
- **THEN** it is not claimed, and it is claimed by a run that happens inside its window

#### Scenario: A booking made inside the lead window is not reminded of itself
- **WHEN** a client books and confirms an appointment starting less than the minimum gap later
- **THEN** no reminder is claimed or sent for it, and the confirmation message remains the only one

#### Scenario: A skipped run is caught up rather than lost
- **WHEN** an invocation fails entirely and the next one runs an hour later
- **THEN** every booking the failed run would have claimed is still a candidate

#### Scenario: A cancelled or expired booking is never a candidate
- **WHEN** the job runs and a booking due inside the window is `CANCELLED` or `EXPIRED`
- **THEN** it is excluded by the candidate query's status filter rather than by a later check

---

### Requirement: The lead and the minimum gap are declared constants, disclosed as judgements

The reminder lead and the minimum gap SHALL be declared alongside the other booking-horizon constants, and each SHALL state in the source that it is a judgement no real shop has measured.

The lead SHALL be expressed as an absolute duration, never as "the same local time on the previous day". An absolute lead is unaffected by any future daylight-saving change in the business timezone, and it places the message at approximately the appointment's own hour, which removes the quiet-hours question rather than requiring a separate rule for it.

Neither value SHALL be configurable per shop in this capability. No owner in this product has ever expressed a scheduling policy on any surface, and inventing one here would give every shop a rule none of them asked for.

#### Scenario: The constants declare themselves as guesses
- **WHEN** the reminder constants are read
- **THEN** each is declared beside the other booking-horizon constants and states that it is a judgement rather than a measurement

#### Scenario: The lead is an absolute duration
- **WHEN** the due window is computed
- **THEN** it is computed by adding a fixed duration to the run's instant, not by constructing a local calendar time

---

### Requirement: The message carries the appointment and the link, and the link's stated purpose is cancelling

The message SHALL carry: the shop's public name, the branch name and address, the barber's display name, the service name, the appointment's date and start time, the deposit already paid, the balance payable at the shop, and a link to the client's own booking page.

The link SHALL address the existing booking page by the booking's `cancellationToken`, and its description SHALL name **cancelling** as what the client can do there. That is this message's reason to exist: a client who can no longer come is the only one who can release the slot while it is still resellable, and this is the only moment the product puts that control in front of them.

The wording SHALL NOT imply that following the link cancels anything, and **the message SHALL NOT carry a URL that performs a cancellation.** The cancellation is a `POST` behind a confirmation step, and a URL in an inbox that performed it would defeat exactly that.

The appointment SHALL be formatted in the **business** timezone through the shared business-time module, never in the runtime's timezone and never in the recipient's.

Monetary values SHALL be rendered from the canonical decimal strings the repository boundary produces, through the same formatter and the same integer-cent arithmetic the confirmation message uses.

The reminder SHALL be composed by its **own** builder function. It SHALL NOT be produced by a parameter or flag on the confirmation's builder: the two messages share fields and have different jobs, and a switch between them is a function whose every reader must hold both messages in mind.

The message SHALL be sent with a plain-text alternative alongside any markup rendering, SHALL render the complete URL as readable text in addition to any styled control, and SHALL reference no remote images or assets.

Every user-facing string this capability introduces SHALL be Spanish (es-AR) and SHALL live in the shared copy module rather than inline in the builder.

#### Scenario: The appointment is in the shop's timezone
- **WHEN** the reminder is built for an appointment stored as an instant
- **THEN** the rendered date and time are the business-local ones, produced by the shared business-time module

#### Scenario: The link is described as a way to cancel
- **WHEN** the message is composed with a usable public origin
- **THEN** its description of the link names cancelling as something the client can do on that page

#### Scenario: No URL in the message performs a cancellation
- **WHEN** every URL in the message is fetched
- **THEN** no booking changes status

#### Scenario: The link survives plain text
- **WHEN** the plain-text alternative is rendered
- **THEN** the complete booking URL appears as readable text

#### Scenario: The builder is its own function
- **WHEN** the message builders are reviewed
- **THEN** the reminder is produced by a function of its own and the confirmation's builder takes no message-kind parameter

#### Scenario: No remote assets
- **WHEN** the message is reviewed
- **THEN** it requests no image or asset from a remote host

---

### Requirement: An unusable public origin degrades the reminder further than it degrades a confirmation, and that is stated

The link SHALL be composed from the deployment's configured public origin, resolved through the shared origin module that already refuses loopback and private addresses. No request header SHALL contribute to it, and no relative URL or loopback address SHALL appear in the message.

When no usable origin resolves, the reminder SHALL still be sent and SHALL omit the link entirely.

That condition SHALL be logged at error level with a distinguishable reason, and the capability SHALL record that **the loss here is larger than on the confirmation path**: a confirmation without a link is still a receipt for money that moved, while a reminder without a link has had its entire actionable value removed and leaves the client exactly where they were before the message arrived.

#### Scenario: No origin configured
- **WHEN** a reminder is sent on a deployment with no usable public origin
- **THEN** the message is sent without a link and an error naming the missing origin is logged

#### Scenario: A private origin is refused
- **WHEN** the configured origin is a loopback or private address
- **THEN** no such URL appears in the message and the message is sent without a link

#### Scenario: A request header cannot supply the origin
- **WHEN** the message is composed
- **THEN** the origin comes from configuration alone

---

### Requirement: The reminder reads and writes across owners through a port of its own

The job SHALL be expressed through a repository port distinct from the booking repository, whose contract states that it is deliberately **not owner-scoped** and why.

This is the product's second cross-owner write. Every other repository asserts that an unscoped query is inexpressible through it; a scheduled job over every shop at once cannot honour that, and widening the booking repository to admit it would void a property that contract states about itself.

The port's reads SHALL be bounded by an explicit projection carrying only what the message needs, so that no field this capability does not render can reach a log line.

Cross-owner isolation SHALL be proven by a test whose fixture contains two owners.

#### Scenario: The contract names the exception
- **WHEN** the reminder port is read
- **THEN** it states that it is not owner-scoped and why a scheduled job cannot be

#### Scenario: One shop's reminders do not disturb another's bookings
- **WHEN** owner A has a due booking and owner B has a due booking and an already-reminded booking
- **THEN** both due bookings are claimed exactly once and owner B's already-reminded booking is untouched

#### Scenario: The projection carries nothing extra
- **WHEN** the reminder port's projection is reviewed
- **THEN** it selects only the fields the message renders

---

### Requirement: A booking that cannot be composed costs one message and never a batch

A booking whose shop has no public profile SHALL NOT be sent a message. The link is built on the shop's public slug, which lives on that profile, and a URL composed on an absent slug is a permanent dead link in an inbox that cannot be corrected.

**Such a booking is claimed and then dropped, and the capability SHALL record that rather than imply otherwise.** The claim is a conditional update over ids the eligibility rule approved; only the message projection can discover the missing slug, and it runs after. The row is therefore consumed without a message. This is unreachable today — the public slug *is* the profile, so a booking cannot exist without one — and it is stated because it would become reachable the moment that stopped being true.

A booking the message builder cannot render SHALL be reported and skipped, and SHALL NOT abort the batch it belongs to. The builder is pure but not total, and every row in a batch is already claimed by the time any of them is composed — so an unhandled failure on one would consume the reminders of every booking behind it.

#### Scenario: A shop with no public profile is not written to
- **WHEN** a due booking's shop has no public profile
- **THEN** no message is requested for it and no URL is composed

#### Scenario: An unrenderable booking does not consume its batch
- **WHEN** one claimed booking cannot be composed and another in the same batch can
- **THEN** the second is sent to, the first is logged as a failure, and the run completes

---

### Requirement: The run is bounded, decides against one instant, and takes no advisory lock

The run SHALL be bounded: at most a fixed number of rows per statement and a fixed number of batches per invocation, stopping early when a batch selects nothing. The remainder SHALL be left for the next invocation, which the self-healing candidate rule makes safe.

A single instant SHALL be taken at the start of the invocation and used for the window bound, the minimum-gap comparison and the claim's recorded value alike. The runtime's clock and the database's clock SHALL NOT both decide within one run.

Each batch SHALL be claimed and then sent before the next batch is claimed, so that the interval between claiming a booking and sending its message is bounded by one batch rather than by the whole invocation.

The job SHALL NOT take the per-barber advisory lock. Every caller of that lock **places** a booking into a slot and the lock exists so two of them cannot choose the same one; this job places nothing and cannot double-book. Safety comes from the conditional update.

#### Scenario: A backlog is processed in bounded batches
- **WHEN** more due bookings exist than one invocation's cap allows
- **THEN** the run processes up to its cap and leaves the remainder, which the next invocation claims

#### Scenario: One clock decides the whole run
- **WHEN** the candidate query, the gap comparison and the claim are examined for one invocation
- **THEN** each used the same instant, taken once at the start

#### Scenario: No advisory lock is taken
- **WHEN** the job's data access is reviewed
- **THEN** no advisory lock is acquired and every write is a conditional update

---

### Requirement: A run that reminded nobody is distinguishable from a run with nothing to do

Every invocation SHALL emit one structured summary, **including invocations that sent nothing**, carrying the number of candidates examined, the number claimed, the number sent, the number of failures by outcome, the number of batches and the run's duration.

**Silence is this capability's failure mode, so silence SHALL NOT also be its success mode.** If the job never fires, cannot reach the database, or has no usable sender, nothing else in the product looks wrong: every booking still confirms, every page still renders, and no client or owner experiences a symptom they can attribute to it.

A rate-limited or quota-exhausted outcome SHALL be distinguishable in the log from an ordinary rejection, because the two lead to different action and because reminders arrive as a burst — the most likely production shape being reminders exhausting the provider quota and every subsequent **confirmation** being throttled behind them.

A missing or unusable database binding SHALL be reported as an error naming the variable, and SHALL NOT be swallowed as an empty run.

#### Scenario: A run with nothing to do still reports
- **WHEN** the job runs and no booking is due
- **THEN** one summary is emitted recording zero candidates, zero claims and zero sends

#### Scenario: Quota exhaustion is distinguishable
- **WHEN** the provider answers with a rate-limit or quota status
- **THEN** the logged outcome identifies that cause rather than a generic failure

#### Scenario: A missing binding is not silence
- **WHEN** the scheduled invocation runs without a usable database connection string
- **THEN** an error naming the variable is emitted rather than a summary reporting zero work

---

### Requirement: The reminder's configuration comes from the invocation's environment, never from a request-scoped source

The provider key, the sender address and the public origin SHALL be obtained from the scheduled invocation's environment argument and passed explicitly into the sender factory.

**The shared sender factory SHALL therefore admit configuration as an argument.** Its existing process-environment read SHALL remain available to the request-served composition roots as a convenience, and SHALL NOT be the only way to construct a sender.

This capability SHALL NOT depend on the runtime populating a process environment from Worker bindings, whether or not a given compatibility date does so.

**The failure this prevents SHALL be recorded, because it is silent on every surface.** With the claim written before the send, an unconfigured sender marks every due booking as reminded while delivering nothing — permanently, on the first run, with every page, test and status check still reporting correctly.

A composition-root test SHALL assert that the scheduled path constructs a configured sender when the environment supplies the values.

**When the configuration is incomplete the job SHALL refuse to run at all, and SHALL make that decision before it issues any query.** It SHALL log the missing variables by name, emit a summary recording zero work so that a refusal is not silence, and return without claiming anything.

This is a requirement rather than an optimisation, and it is the direct consequence of claiming before sending. Without it an unconfigured deployment claims every due booking, receives `rejected` for each, and leaves all of them permanently marked as reminded having received nothing. That is not a hypothetical configuration: the confirmation capability's own deliverability rule **requires** the provider key to be absent in production until a sending domain is verified, so the first scheduled run on the intended deployment would consume every reminder the shop had.

The refusal SHALL NOT mark the invocation failed. It is the state the deployment was told to be in, and an hourly failure would train an operator to ignore the only signal this job has.

#### Scenario: An unconfigured deployment queries nothing
- **WHEN** a scheduled invocation runs with no provider key
- **THEN** no candidate query and no claim is issued, and no booking's claim instant changes

#### Scenario: A refusal is still reported
- **WHEN** the job refuses to run for missing configuration
- **THEN** an error names the missing variables and one summary recording zero work is emitted

#### Scenario: A refusal is not an invocation failure
- **WHEN** the job refuses to run for missing configuration
- **THEN** the invocation completes successfully rather than being marked failed

#### Scenario: The scheduled path builds its sender from the environment
- **WHEN** the scheduled handler constructs the reminder job
- **THEN** the provider key, sender address and origin come from the invocation's environment argument

#### Scenario: The factory accepts explicit configuration
- **WHEN** the sender factory is called from a context with no request
- **THEN** it accepts the values directly and does not read a process environment

#### Scenario: Missing configuration is reported per message, not per construction
- **WHEN** several senders are constructed with no configuration and one message is attempted
- **THEN** exactly one entry is produced, naming the missing variables under this capability's operation name

---

### Requirement: Guest-supplied values are escaped in the body and never reach a header

Every value originating from a guest — the client's name above all — SHALL be escaped for the rendering it appears in, by the shared escaping helpers rather than by anything written for this message.

No guest-supplied value SHALL be interpolated into any message header, including sender, reply-to and subject. A newline sequence in a header is a second message with an attacker-chosen recipient.

The recipient address SHALL be the only guest-supplied value that reaches the provider as an address field, and it SHALL be sent as a single address, never as a list assembled by parsing.

The subject SHALL be composed from server-held values — the shop's name and the appointment instant — and never from guest-supplied text.

#### Scenario: A name containing markup
- **WHEN** a client's stored name contains markup
- **THEN** it appears escaped in the message body and executes nothing

#### Scenario: A name containing a newline sequence
- **WHEN** a client's stored name contains carriage-return or line-feed characters
- **THEN** no part of it reaches any header and no additional recipient is produced

---

### Requirement: Reminder logs identify the decision and never the person or the credential

Every send attempt SHALL be logged with the booking id and the decided outcome, under an operation name that identifies **this** capability and no other.

The capability's log identity SHALL be supplied as a value with no default, so that a shared sender or factory cannot file this message under another capability's name — the defect the confirmation capability records against itself when a second message type reused its factory.

No log line SHALL carry the recipient address, the client's name or phone, the cancellation token, the composed link, the message body, or the provider API key.

#### Scenario: The reminder files under its own operation name
- **WHEN** a reminder send fails
- **THEN** the log entry carries this capability's operation name and not the confirmation's

#### Scenario: No personal data in reminder logs
- **WHEN** any reminder path logs
- **THEN** no recipient address, client contact detail, cancellation token, link or credential appears in the output

---

### Requirement: The capability changes nothing a client or an owner can see

No page, component, copy string outside the message itself, or user-facing state SHALL change.

**The confirmation message SHALL NOT promise a reminder.** A deployment without a usable sender delivers none, and a promise made in an email cannot be corrected after it is sent.

Nothing SHALL notify the owner about reminders, sent or unsent. That gap is real and is recorded rather than closed here.

#### Scenario: The change touches no view
- **WHEN** the change's diff is reviewed
- **THEN** no file under the application's route or component directories is modified

#### Scenario: The confirmation makes no promise about a reminder
- **WHEN** the confirmation message is reviewed after this change
- **THEN** it says nothing about a future reminder

---

### Requirement: Production delivery cannot be proven, and the story records that rather than reporting success

This capability SHALL NOT be considered verified by a passing test suite or by a successful provider response.

Its guarantees — timing, idempotence, isolation and boundedness against real rows — SHALL be verified by a gate script executed against the live database, proving: that a past confirmed booking is never selected, that a due booking is claimed exactly once, that a re-run claims nothing, that a concurrent cancellation makes the claim match zero rows, that a short-notice booking is suppressed, and that a second owner's rows are untouched. Everything the gate creates SHALL be removed at the end, in foreign-key order.

The scheduled invocation SHALL additionally be fired by hand against the local runtime before deploy, because no unit test executes the entrypoint.

**While no sending domain is verified, the provider key SHALL NOT be set on the scheduled Worker in production**, on the same terms the confirmation capability already states.

The capability SHALL record that it is **worse placed than the confirmation** for detecting its own failure: a confirmation that could not be sent is disclosed on the booking page, whereas a reminder that was never delivered and one that was delivered are indistinguishable to a client, so no surface in the product reveals the difference.

#### Scenario: The gate passes against real rows
- **WHEN** the gate script runs against the live database
- **THEN** every probe passes and every row it created is removed

#### Scenario: The entrypoint is exercised before deploy
- **WHEN** the local runtime's scheduled trigger is fired by hand for this schedule
- **THEN** the job executes and emits its summary

#### Scenario: The prerequisite is recorded rather than assumed
- **WHEN** the sending domain has not been verified
- **THEN** the story records that delivery verification is blocked on DNS, the provider key stays unset in production, and the capability is not reported as done
