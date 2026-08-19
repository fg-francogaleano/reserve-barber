# booking-creation Specification

## Purpose
The last step of the public booking flow and the first write a stranger can perform: the client's name, email and phone, and the transaction that turns a chosen time into a held one. A booking is created `PENDING_PAYMENT` with a deadline, its slot removed from sale while the client pays, and the deposit and price snapshotted from the policy in force at that instant. The no-overlap invariant is enforced inside a database transaction under a per-barber lock — never by an application read-then-write — and the rule that decides whether a booking blocks is the same one availability reads, so the flow cannot offer a time it will then refuse. Created by archiving change b4-provisional-booking-hold.

## Requirements

### Requirement: The flow ends by collecting the client's contact details

After a valid start time is selected, the flow SHALL render a **client-details step** collecting exactly three fields — name, email and phone — and SHALL NOT collect anything else. There is no account, no password and no optional field: `data-model.md` §10 defines a guest client as these three values and nothing more.

The step SHALL follow the house form pattern: a native `<form>` with uncontrolled inputs, one Zod schema executed on the server as the single source of validity, and `required` as the only validation attribute. It SHALL NOT carry `min`, `max`, `step` or `pattern` on any control, because each lets the browser block submission with a message in the browser's locale from a string that exists in no copy module — the validation the client meets would not be the validation this specification describes, and the server rule would never run.

The deposit amount SHALL be displayed **before** the fields, not after them. The client is about to hand over contact details; the amount they will owe is what they are consenting to.

#### Scenario: The step renders after a valid time
- **WHEN** a client has selected a branch, service, barber, date and a valid start time
- **THEN** the client-details step renders with name, email and phone, and the deposit amount appears above the fields

#### Scenario: No browser-locale validation is delegated
- **WHEN** the rendered form is reviewed
- **THEN** no control carries `min`, `max`, `step` or `pattern`, and every rejection message originates from the server

#### Scenario: An incomplete selection never reaches the step
- **WHEN** a request arrives with a date but no resolvable time
- **THEN** the time step renders instead and no contact form is offered

### Requirement: The booking write is a Route Handler on an explicitly permitted public path

Creating a booking SHALL be a **Route Handler** at `POST /api/bookings`. It SHALL NOT be a Server Action. `backend-standards.md` states this as a hard rule for the public flow: a Server Action is addressed by an id derived from a build-time key, so a rotated key or a renamed action leaves every open tab calling an id the server no longer knows, and a guest halfway through paying a deposit is exactly the person who must never meet that dead end.

The route guard is deny-by-default and its public set holds `/login` and `/b/**`, so this path SHALL be added to that set **by name**. Without it an anonymous POST is answered `307 → /login` and the flow is broken for every guest with no visible cause. The addition SHALL be an explicit named entry — never a widened prefix test, never a relaxed default, never a change to the middleware matcher — and it SHALL be asserted by test, because no browser session belonging to the owner would ever reveal the fault.

#### Scenario: A guest posts a booking
- **WHEN** a request with no authentication cookie posts a valid booking form to `/api/bookings`
- **THEN** the guard permits it, no redirect to `/login` occurs, and the booking route handles the request

#### Scenario: The dashboard stays protected
- **WHEN** an unauthenticated request opens any `(dashboard)` route or any other `/api` path after this entry is added
- **THEN** it is still redirected to `/login` and no protected data is rendered or fetched

#### Scenario: Composition review
- **WHEN** the change is complete
- **THEN** no Server Action creates a booking, and the permitted path is a named constant covered by a guard test

### Requirement: Every submitted value is re-verified and the time is matched, never parsed

The handler SHALL treat every field of the submission as stranger-supplied. It SHALL re-resolve the shop from the slug, re-verify the location, service and barber against the resolved catalogue exactly as the read side does, and SHALL derive `startTime` **itself** from the submitted calendar date and `HH:mm` through the business-local calendar module.

The submitted time SHALL be **matched against a freshly generated slot list** and SHALL NOT be parsed into an instant taken on trust. `endTime` SHALL be derived from `startTime` plus the service's stored `durationMinutes`, never from the client.

A hidden input is a rendering of state, not a claim about it. Nothing the browser sends SHALL be trusted to name a real row, a real time, or a real price.

#### Scenario: A time that is not on the generated list
- **WHEN** a submission carries a start time that the barber's availability does not offer
- **THEN** no booking is created and the client is returned to the time step

#### Scenario: A crafted instant
- **WHEN** a submission carries an ISO timestamp or a timezone offset in place of `HH:mm`
- **THEN** it is rejected before any write, and no booking is created at an unoffered instant

#### Scenario: A cross-owner id
- **WHEN** a submission names a barber or service belonging to another owner
- **THEN** the response is indistinguishable from one naming an id that does not exist

### Requirement: A business that cannot charge a deposit cannot take a booking

Before any booking is written, the payment-readiness rule SHALL hold: the owner has at least one fully configured payment method **and** a configured deposit policy. The rule SHALL be the one authoritative function already shared with the deposit editor, so the dashboard's report and this enforcement cannot drift into different definitions of ready.

It SHALL be enforced **twice**: the client-details step SHALL NOT render its form for an unready shop, and the handler SHALL refuse the write regardless of what was rendered. A dashboard that refuses to save is not the same control as a booking flow that refuses to book, and only the second one protects a client.

The refusal SHALL tell the client that this shop cannot take bookings right now and SHALL NOT name which half of the configuration is missing. The owner never agreed to publish the state of their payment setup, and the client cannot act on the difference.

#### Scenario: A shop with a catalogue and no deposit policy
- **WHEN** a client reaches the client-details step at a shop whose `depositValue` is null
- **THEN** no contact form is rendered and a Spanish notice says the shop is not taking bookings

#### Scenario: The policy is cleared mid-checkout
- **WHEN** the owner clears the deposit policy after the form rendered and the client then submits
- **THEN** no `Booking` and no `Client` row is created and the same notice is shown

#### Scenario: The refusal discloses nothing
- **WHEN** either refusal renders
- **THEN** no copy names Mercado Pago, the transfer destination, or the deposit policy as the missing part

### Requirement: The readiness read uses a projection that cannot carry the access token

The payment-readiness read SHALL select only the columns the rule consumes — the presence of Mercado Pago credentials, the transfer destination fields and the deposit value — and its type SHALL have no field capable of holding `mpAccessToken`. This composition root SHALL construct **no credential cipher**.

B1, B2 and B3 guaranteed this by handing the public flow no `PaymentConfig` repository at all. This is the story that must finally ask the question, so the guarantee moves from an absent dependency to a type that cannot express the leak — which is stronger than every consumer remembering to strip a field.

#### Scenario: The projection cannot carry the token
- **WHEN** the readiness type and its repository method are reviewed
- **THEN** neither can represent `mpAccessToken`, and the executed query does not select that column

#### Scenario: No cipher on the public path
- **WHEN** the booking write composition root is reviewed
- **THEN** it constructs no credential cipher and no Supabase client, and a missing `PAYMENT_CREDENTIALS_KEY` does not affect this route

### Requirement: A slot is held by a transaction, not by a check

The insert SHALL run inside a single database transaction that, in this order: takes a **lock scoped to the barber** as its first statement; re-reads that barber's working windows, absences and candidate bookings for the range; decides which bookings block; re-asserts that `[startTime, endTime)` falls inside one working window and outside every absence; and only then writes the row.

An application-level read-then-write SHALL NOT be treated as sufficient, and the check and the insert SHALL NOT be separate round trips outside a transaction — `backend-standards.md` states this as the first Booking rule, and a transaction-mode pooler gives no guarantee that two statements share a connection.

The re-assertion against windows and absences is not redundant with the slot list: an owner may narrow a schedule or record an absence between the moment the times were offered and the moment one is submitted.

#### Scenario: Two clients submit the same start time simultaneously
- **WHEN** two requests for the same barber and start time are in flight at once
- **THEN** exactly one `Booking` row exists for that barber and time in a blocking status

#### Scenario: The schedule is narrowed mid-checkout
- **WHEN** the owner replaces the day's window with one that excludes the submitted time, after the times were offered
- **THEN** the booking is refused and no appointment exists outside the barber's working hours

#### Scenario: An absence is recorded mid-checkout
- **WHEN** an absence covering the submitted time is created after the times were offered
- **THEN** the booking is refused

#### Scenario: The transaction is bounded
- **WHEN** the transaction is configured
- **THEN** it declares explicit wait and execution timeouts rather than relying on defaults

### Requirement: The blocking rule has exactly one definition and the write applies it

The decision of whether an existing booking removes its time from sale SHALL be made by the **same function** the availability read calls. It SHALL NOT be re-expressed as a SQL predicate, a second helper, or an inline status list on the write path.

A `PENDING_PAYMENT` booking whose `holdExpiresAt` has passed does not block, and B7 — the job that sweeps such rows — ships after this story. A write side that filtered on status alone would refuse a slot the read side correctly offers, and the client would be told no while paying for a time the product had just shown them as free.

#### Scenario: An expired hold does not block the write
- **WHEN** a `PENDING_PAYMENT` booking for the same time has a `holdExpiresAt` in the past and no job has expired it
- **THEN** the new booking is created

#### Scenario: A live hold blocks the write
- **WHEN** a `PENDING_PAYMENT` booking for the same time has a `holdExpiresAt` in the future
- **THEN** the write is refused

#### Scenario: An uploaded receipt blocks regardless of age
- **WHEN** a `PENDING_APPROVAL` booking overlaps the submitted range and its `holdExpiresAt` has passed
- **THEN** the write is refused

#### Scenario: The rule is not duplicated
- **WHEN** the write path is reviewed
- **THEN** the blocking decision is made by the shared predicate and no equivalent status filter exists in SQL

### Requirement: The hold expires, and never after the appointment has started

A new booking SHALL be created with status `PENDING_PAYMENT` and a non-null `holdExpiresAt` equal to the current instant plus the hold duration, **clamped so that it never exceeds `startTime`**.

The hold duration SHALL be a named constant of **15 minutes**, declared beside the other booking-time bounds and documented as a judgement rather than a measurement — no real shop has used this product, and the value is the first thing a real one will want changed.

The clamp is correctness, not preference: an unclamped hold on a near-term appointment lapses after the appointment has begun, and B7 would then expire a booking whose time has already passed. The minimum booking lead time makes the case rare today and is itself recorded as a guess that will be lowered.

#### Scenario: An ordinary hold
- **WHEN** a booking is created for a start time far beyond the hold duration
- **THEN** `holdExpiresAt` is the creation instant plus 15 minutes

#### Scenario: A near-term appointment
- **WHEN** a booking is created for a start time sooner than the hold duration away
- **THEN** `holdExpiresAt` equals `startTime` and never exceeds it

#### Scenario: The status carries its deadline
- **WHEN** any booking is written with status `PENDING_PAYMENT`
- **THEN** `holdExpiresAt` is non-null, satisfying the database check constraint that already exists

### Requirement: A client is deduplicated by owner and email

A booking SHALL resolve its client by `(ownerId, email)`, creating the row when absent and reusing it when present. The email SHALL be **trimmed and lowercased before persistence**, because the unique index compares raw bytes and two spellings of one address would otherwise become two clients.

When a returning client submits a different name or phone, the stored row SHALL be **updated**: the owner needs the number that will answer today. The accepted consequence SHALL be recorded rather than discovered — `Booking` snapshots the price and the deposit but not the client's name, so a later change re-labels earlier bookings in every dashboard view.

A concurrent first booking from the same address SHALL surface as a unique-constraint violation, which SHALL be retried once and SHALL NOT be reported to the client as an error on the email field.

#### Scenario: A returning client
- **WHEN** a booking is submitted with an email that already exists for this owner
- **THEN** no second `Client` row is created and the existing row is reused

#### Scenario: Case and whitespace variants are one client
- **WHEN** a client books as `Ana@Mail.com ` after having booked as `ana@mail.com`
- **THEN** exactly one `Client` row exists for that owner

#### Scenario: Changed contact details
- **WHEN** a returning client submits a different phone number
- **THEN** the stored client's phone is updated to the submitted value

#### Scenario: Two first bookings race
- **WHEN** two requests carrying the same new email reach the client resolution at once
- **THEN** one `Client` row results, both bookings resolve to it, and neither client sees a validation error

### Requirement: A phone number is normalized to one canonical form or rejected

The submitted phone SHALL be parsed and normalized to a single canonical Argentine form. Input SHALL be accepted with a `+54` prefix, a leading `0`, a `15` mobile prefix, spaces, dashes and parentheses, and SHALL be rejected **only** when the resulting digits cannot form a valid Argentine number.

Normalization SHALL live in one domain module, following the shape the CBU rule already established. A stored value that varies in punctuation is a value the owner has to retype before it is usable, and a rejection at the last step of a checkout costs a booking — so the rule is tolerant on input and strict on storage.

#### Scenario: Equivalent spellings normalize to one value
- **WHEN** the same number is submitted as `+54 9 11 5555-4444`, `011 15 5555 4444` and `1155554444`
- **THEN** each is stored as the same canonical value

#### Scenario: An unusable number is refused
- **WHEN** a submission carries a value whose digit count cannot form a valid Argentine number
- **THEN** it is rejected with a Spanish field error and the other typed values are preserved

### Requirement: The price and the deposit are snapshotted once

`priceAtBooking` SHALL be the service's price at the instant of creation and `depositAmount` SHALL be computed from it by the one authoritative deposit rule. Neither SHALL be recomputed afterwards in any status, and neither SHALL be supplied by the client.

Both SHALL cross the persistence boundary as canonical decimal strings, never as a driver-native numeric type and never as a floating-point intermediate.

A later change to the service price or to the deposit policy SHALL NOT alter an existing booking. Recomputing would reject a client paying a checkout created moments before the owner edited the policy — the payment would be correct and the system would call it wrong.

#### Scenario: The policy changes after creation
- **WHEN** the owner edits the deposit policy after a booking was created
- **THEN** that booking's `depositAmount` is unchanged

#### Scenario: The client cannot name the amount
- **WHEN** a submission carries a price or deposit field
- **THEN** it is ignored and both values are derived on the server

#### Scenario: The deposit rule is not reimplemented
- **WHEN** the write path is reviewed
- **THEN** the deposit is produced by the shared deposit rule and no second calculation exists

### Requirement: A repeated submission returns the same booking rather than a conflict

When the transaction finds a blocking booking that is **this same client's own hold for this same barber and start time**, it SHALL return that booking instead of refusing the write, and SHALL NOT create a second row.

Without this rule a client who double-taps, whose connection retried, or who used the browser's back button after success is told that the slot is no longer available — the only error in this flow delivered exclusively to people who already succeeded.

The success response SHALL be a redirect rather than a rendered body, so that a repeated navigation re-issues a `GET` and not the `POST`.

#### Scenario: A double tap
- **WHEN** a client submits the identical form twice in quick succession
- **THEN** exactly one `Booking` row exists and both responses lead to the same confirmation page

#### Scenario: Back button after success
- **WHEN** a client navigates back and the browser re-submits the form
- **THEN** no second booking is created and no conflict message is shown

#### Scenario: A different client is still refused
- **WHEN** a second client submits the same slot while the first client's hold is live
- **THEN** the write is refused

### Requirement: A lost race returns the client to the time step, not to an error page

When the slot was taken by someone else, the response SHALL return the client to the **time step** with the existing stale-time notice, preserving the branch, service, barber and date already chosen. It SHALL NOT render an error page, SHALL NOT clear the selection, and SHALL NOT return a 404.

This is the same degrade-never-substitute rule the flow already applies to a link that outlived its catalogue. The client's next action is choosing another time, so the response puts them where that happens.

The notice SHALL NOT disclose whether a booking, an absence or a schedule change took the slot. That would hand an anonymous visitor a view of the barber's agenda.

#### Scenario: The slot was taken
- **WHEN** the transaction refuses the write because another booking blocks the range
- **THEN** the time step renders with the stale-time notice and the four upstream selections intact

#### Scenario: No cause is disclosed
- **WHEN** the notice renders
- **THEN** no copy distinguishes a competing booking from an absence or a schedule change

### Requirement: Holds are bounded per client and per origin

The number of simultaneously live holds SHALL be bounded per `(owner, client email)`, and the write endpoint SHALL be throttled per request origin. A request beyond either bound SHALL be refused with a generic Spanish retry message that discloses nothing about the shop's calendar.

This is not hardening for later. A five-minute grid over the booking horizon is thousands of start times per barber; the hold lasts fifteen minutes; and B7, which sweeps abandoned holds, ships three stories after this one. Without a bound, one script can hold a shop's entire calendar and re-take each slot as it lapses, with no surface anywhere in the product that would explain it to the owner.

The throttle SHALL be documented as **best effort**: this runtime offers no shared counter across isolates, so it blunts a naive loop and does not defeat a distributed one. The per-client cap, which is checked against the database, is the bound that actually holds.

#### Scenario: One client exceeds the hold cap
- **WHEN** a single email submits more simultaneous holds than the cap allows for one owner
- **THEN** the requests beyond the cap are refused and no further bookings are created

#### Scenario: A lapsed hold frees the allowance
- **WHEN** one of that client's holds expires
- **THEN** they may create another booking

#### Scenario: The refusal says nothing useful to an attacker
- **WHEN** either bound refuses a request
- **THEN** the message names no barber, no slot and no count

### Requirement: The confirmation page is authorized by the cancellation token and leaks nothing

On success the client SHALL be redirected to a page addressed by the booking's `cancellationToken`, not by its id. The token is already unique and unguessable, is held by exactly this person, and is the same credential the confirmation email will carry — a second view-only secret would be two secrets for one holder.

That route SHALL send `Referrer-Policy: no-referrer`. Without it, the redirect to an external payment provider that B5 introduces would carry the token to a third party in the `Referer` header.

The page SHALL show the appointment, the deposit amount and the time remaining on the hold, and SHALL state in Spanish that the slot is held and that payment is not yet available. It SHALL NOT render the client's email or phone back, since the link can be shared or opened on a shared device. It SHALL read the booking's live state rather than trusting the redirect, so a hold that lapsed while the page was open is not shown counting down.

#### Scenario: A successful creation
- **WHEN** a booking is created
- **THEN** the response redirects to the confirmation page for that booking's cancellation token

#### Scenario: The token does not leak onward
- **WHEN** the confirmation page is served
- **THEN** it carries `Referrer-Policy: no-referrer`

#### Scenario: Contact details are not echoed
- **WHEN** the confirmation page renders
- **THEN** the client's email and phone appear nowhere in the response

#### Scenario: An unknown token
- **WHEN** the page is opened with a token that matches no booking
- **THEN** the response is 404 and discloses nothing about whether the token ever existed

### Requirement: Every outcome has a state, and the error survives without JavaScript

Each outcome — created, already held by this client, invalid input, slot taken, shop not ready, throttled — SHALL have a distinct rendered state. The handler SHALL answer a browser submission with a redirect carrying an outcome code in the URL, and the page SHALL render the message **from the server**.

Validation failures SHALL preserve every value the client typed and SHALL surface field-level errors accessibly. A rejection that clears three fields is worse than the error it reports.

The submit control SHALL be disabled while a submission is in flight, and that state SHALL be understood as a courtesy that exists only after hydration — the transaction, not the button, is what prevents a double booking.

This requirement is what makes the project's no-JavaScript promise true on the one surface where a stranger meets it. The promise SHALL NOT be satisfied by client-side action state, which does not restore after a no-script POST.

#### Scenario: A validation error with JavaScript disabled
- **WHEN** a client with JavaScript disabled submits an unusable phone number
- **THEN** the details step re-renders with a Spanish field error and the name and email still filled in

#### Scenario: Each outcome is distinguishable
- **WHEN** the six outcomes are exercised
- **THEN** each produces a different rendered state, and none is reported as a generic failure

#### Scenario: An infrastructure failure does not discard the input
- **WHEN** the write fails for a reason below the application
- **THEN** the client sees a Spanish failure state on the flow, not a replaced error page, and the shop's internals are not named

### Requirement: The write discloses no cause and enables no enumeration

Responses SHALL be indistinguishable between an id that never existed, an id belonging to another owner, and an entity that was deactivated. No response SHALL reveal whether a slot is blocked by a booking, an absence or a schedule change, and no response SHALL confirm the existence of a barber, service or client.

The handler SHALL bound the length of every submitted value **before** performing any database read, so a crafted payload cannot turn one request into an expensive query.

#### Scenario: An oversized payload
- **WHEN** a submission carries fields far longer than any legitimate value
- **THEN** it is refused before any database read occurs

#### Scenario: Probing for a client
- **WHEN** the same email is submitted for a shop where it has booked before and for one where it has not
- **THEN** the two responses are indistinguishable

### Requirement: Contact details never reach a log

No log line SHALL contain the client's name, email or phone, in any field, at any level, on any path including validation failure and infrastructure error. Log context for this flow SHALL carry identifiers only.

This is the first story in which a stranger's personal data enters the server, and the existing logging helpers were written for ids and driver messages. A single context object logged wholesale on an error path publishes a stranger's contact details into the deployment's log stream, where the project's own standards forbid them.

Each created booking SHALL emit one structured English log line carrying its identifiers, and each refused write due to a conflict SHALL emit one at warning level — the conflict rate is the only signal that will ever show whether the concurrency design holds.

#### Scenario: A validation failure is logged
- **WHEN** a submission is rejected for an invalid email
- **THEN** the log line records the outcome and no part of the submitted contact data

#### Scenario: A creation is logged
- **WHEN** a booking is created
- **THEN** one structured line records the booking, barber, service and owner identifiers and nothing else

#### Scenario: A conflict is counted
- **WHEN** a write is refused because the slot was taken
- **THEN** a warning-level line records it so the rate is observable

### Requirement: The write refuses to run on a runtime that cannot place an instant

The booking write SHALL assert business timezone support at its composition root, before any repository is built and before any instant is computed, and SHALL fail closed if it is unavailable.

A runtime without timezone data does not raise — it silently answers UTC, which is three hours from the business's clock. On the read side that produces a page of plausible wrong times; here it would **persist** an appointment at the wrong hour, and nothing downstream would ever detect it.

#### Scenario: Timezone data is unavailable
- **WHEN** the runtime cannot distinguish business local time from UTC
- **THEN** the write refuses before any booking is created

### Requirement: The new copy is Spanish and lives with the flow's copy

Every string this change introduces — field labels, validation messages, the six outcome states, the not-taking-bookings notice, the throttle message, and the confirmation page — SHALL be Spanish (es-AR) and SHALL live in the shared copy module under the booking flow's key, never inline beside logic.

Amounts SHALL be formatted in ARS and dates and times in `es-AR` through the existing formatters. Identifiers, comments, log messages and test names remain English.

#### Scenario: Copy location review
- **WHEN** the change is complete
- **THEN** no user-facing Spanish string in the new step, handler or confirmation page is written inline

#### Scenario: The deposit is readable
- **WHEN** the deposit amount renders
- **THEN** it is formatted as an ARS amount in es-AR

### Requirement: The new step is operable without a mouse, announced correctly, and holds together on a phone

Every control in the client-details step and on the confirmation page SHALL be reachable and operable by keyboard, with visible focus. Field errors SHALL be associated with their inputs and announced; the outcome notices SHALL be announced without stealing focus.

Both surfaces SHALL render without horizontal overflow at the project's narrow content bound, including a long unbroken name or email, and the step indicator SHALL absorb a sixth step without wrapping into an unreadable strip.

#### Scenario: Keyboard completion
- **WHEN** a client fills and submits the step using only the keyboard
- **THEN** every field and the submit control are reachable with visible focus

#### Scenario: An error is announced
- **WHEN** a submission is rejected
- **THEN** the error is programmatically associated with its field and announced

#### Scenario: The narrow viewport
- **WHEN** the step and the confirmation page render at the narrow content bound with a long unbroken email
- **THEN** neither overflows horizontally

### Requirement: The transaction is proven under concurrent requests before the story closes

This change SHALL NOT be considered complete until a verification script has run against the live database and demonstrated, in one execution: that N simultaneous submissions for one slot produce exactly one booking; that the same client's repeated submission is idempotent; that a lapsed hold releases its slot to another client; and that the per-barber lock mechanism the transaction depends on is available on the deployed database.

The roadmap forbids starting the payment stories, the expiry job and the receipt review until this holds — all four assume holds work. A passing unit suite is not evidence: every interesting failure here is a race that a mocked repository cannot express.

#### Scenario: The concurrency gate
- **WHEN** the verification script runs against the live database
- **THEN** the concurrent-submission, idempotency, lapsed-hold and lock-availability checks all pass and the script exits non-zero if any does not
