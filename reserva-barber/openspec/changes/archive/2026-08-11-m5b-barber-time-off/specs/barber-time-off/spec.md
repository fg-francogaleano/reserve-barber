## ADDED Requirements

### Requirement: Owner records a barber's absence
The dashboard SHALL provide an absences editor at `/barberos/[id]/ausencias` where the authenticated owner sees the barber's recorded absences and can add one by supplying a start date, an end date, optional times, and an optional reason.

The barber is resolved from the route parameter scoped to the session owner. A barber id that is unknown or belongs to another owner SHALL be reported as not found, never as forbidden, so the editor cannot be used to discover which ids exist.

#### Scenario: A whole-day absence is recorded
- **WHEN** the owner submits a start date and an end date with no times
- **THEN** the absence is stored and appears in the list

#### Scenario: A partial-day absence is recorded
- **WHEN** the owner submits a start and end on the same date with times
- **THEN** the absence is stored covering only that part of the day

#### Scenario: A barber belonging to another owner
- **WHEN** the owner opens the editor for a barber id owned by someone else
- **THEN** the response is a not-found page that does not reveal whether the id exists

### Requirement: An absence is a half-open instant range
An absence SHALL be stored as two UTC instants and interpreted as `[startsAt, endsAt)` — the start is included, the end is not.

This matches the interval convention bookings use. If absences were inclusive at the end, a booking beginning exactly when an absence ends would be blocked or allowed depending on which rule the availability code evaluated first, and the disagreement would surface as an unbookable slot rather than as a failing test.

#### Scenario: The boundary instant is outside the absence
- **WHEN** availability is evaluated for a moment exactly equal to an absence's end
- **THEN** that moment is treated as outside the absence

#### Scenario: The start instant is inside the absence
- **WHEN** availability is evaluated for a moment exactly equal to an absence's start
- **THEN** that moment is treated as inside the absence

### Requirement: Whole days are expressed by omitting the times, and the end date is inclusive
When both time fields are empty, the absence SHALL cover whole days: from the start of the start date to the **start of the day after** the end date, in business local time. "Hasta el 15" means the 15th is a day off.

When both times are given, the range SHALL be exactly the instants named. When one is given and the other is not, the submission SHALL be rejected and the offending field identified.

The two readings are each correct for their input, and the conversion SHALL live in one place: an off-by-one here silently hands the barber back a day, and nothing else in the system would notice.

#### Scenario: A single whole day
- **WHEN** the owner records an absence with the same start and end date and no times
- **THEN** the stored range covers that entire day and ends at the start of the following day

#### Scenario: A multi-day whole-day absence includes its last day
- **WHEN** the owner records an absence from the 1st to the 15th with no times
- **THEN** the 15th is fully covered and the 16th is not

#### Scenario: A timed range ends where it says
- **WHEN** the owner records an absence from 14:00 to 18:00 on one date
- **THEN** the stored range starts at 14:00 and ends at 18:00, and 18:00 itself is outside it

#### Scenario: A half-filled time pair
- **WHEN** the owner supplies a start time but no end time
- **THEN** the submission is rejected and the missing field is identified

### Requirement: An absence must describe real, bounded time
`endsAt` SHALL be strictly after `startsAt`. An absence SHALL NOT exceed 365 days, SHALL NOT start more than two years in the future, and SHALL NOT start more than one year in the past.

Without bounds a mistyped year is accepted and permanently disables a barber with no error anywhere. Past absences remain allowed because recording one after the fact is legitimate — which is also why the backward bound is tighter than the forward one.

#### Scenario: A zero-length absence
- **WHEN** the owner submits a range whose end equals its start
- **THEN** it is rejected, since a range containing no time records nothing

#### Scenario: An end before the start
- **WHEN** the owner submits an end date earlier than the start date
- **THEN** it is rejected

#### Scenario: An absence longer than the maximum
- **WHEN** the owner submits a range spanning more than 365 days
- **THEN** it is rejected as too long

#### Scenario: A mistyped year far in the future
- **WHEN** the owner submits an absence starting more than two years ahead
- **THEN** it is rejected rather than silently disabling the barber

### Requirement: Absences may overlap each other
Two absences covering overlapping periods SHALL both be accepted. They union when availability is computed, and there is nothing to reconcile.

Rejecting overlaps would mean an owner who recorded a long holiday could not then record a specific appointment inside it.

#### Scenario: An absence inside another
- **WHEN** the owner records an absence for a week and then another for one afternoon within that week
- **THEN** both are stored

### Requirement: Re-submitting the same absence does not create a duplicate
An absence is identified by its barber and its two boundaries. Submitting a range that already exists for that barber SHALL leave a single record, so a retry after a failed or timed-out save is safe.

Two absences with identical boundaries are the same absence. The only thing that could differ is the reason, and a duplicate range carrying a different note is not a second fact.

#### Scenario: The same absence is submitted twice
- **WHEN** the owner submits an absence and then submits the identical range again
- **THEN** exactly one record exists for that range

#### Scenario: A committed-but-timed-out create is retried
- **WHEN** a create commits, the response times out, and the owner submits the same absence again
- **THEN** exactly one record exists and no error is reported

### Requirement: The reason never leaves the dashboard
`reason` is optional free text of at most 255 characters. It MUST NOT appear in any log entry, and MUST NOT be exposed by any read intended for a consumer other than the absences editor.

It can hold medical information. Confinement SHALL be structural — a projection that does not carry the field — rather than a matter of remembering, because discipline fails the first time the entity is handed to a public component.

#### Scenario: A failure during a write logs no reason
- **WHEN** a write fails while recording an absence that carries a reason
- **THEN** the log entry contains no part of that text

#### Scenario: A blank reason is stored as absence
- **WHEN** the owner leaves the reason empty
- **THEN** it is stored as null rather than as an empty string

### Requirement: Owner removes an absence, and removing twice succeeds
The editor SHALL let the owner remove any of the barber's absences. A removal that matches no record SHALL report success rather than an error: from the owner's point of view the absence is gone either way, and two open tabs must not produce a failure.

No confirmation dialog is presented. The action is cheap to reverse by re-adding, and a dialog on a cheap action trains people to dismiss dialogs.

#### Scenario: An absence is removed
- **WHEN** the owner removes an absence
- **THEN** it no longer appears in the list

#### Scenario: The same absence is removed twice
- **WHEN** two tabs remove the same absence
- **THEN** both report success and no error is shown

#### Scenario: Another owner's absence cannot be removed
- **WHEN** a removal names an absence belonging to a different owner
- **THEN** no record is deleted

#### Scenario: A removal that fails leaves the absence visible
- **WHEN** the removal write fails for an infrastructure reason
- **THEN** the failure is logged and the absence is still listed after the page refreshes
- **AND** no error page replaces the editor

The removal is a plain form action with no state to carry a message back, so the persisting row is the only signal the owner gets. That is a deliberate trade — a per-row client component just to surface a rare failure would cost more than it saves — and it is recorded as debt rather than presented as complete.

### Requirement: Every absence read and write is scoped to the session owner
Every query and mutation SHALL carry the owner, resolved from the session and never from the payload. A barber reached through another owner's location MUST NOT have absences readable, creatable or removable.

#### Scenario: A foreign barber's absences cannot be read
- **WHEN** absences are requested for a barber belonging to a different owner
- **THEN** none are returned

#### Scenario: A foreign barber's absence cannot be created
- **WHEN** a create is attempted for a barber belonging to a different owner
- **THEN** no record is written

### Requirement: Authentication is re-checked inside every action
The session owner SHALL be resolved as the first statement of both the create and the remove action, before any parsing of the submission. Middleware alone is not sufficient: Server Action requests are dispatched through a mechanism the route middleware passes through.

#### Scenario: Unauthenticated submission
- **WHEN** an absence submission arrives without a valid session
- **THEN** it is rejected before the payload is parsed and nothing is written

### Requirement: The number of absences per barber is bounded
The editor SHALL refuse to record a new absence once the barber has reached the documented maximum.

The bound is advisory, not a guarantee: the count and the insert are separate round trips against a transaction-mode pooler, so concurrent creates can exceed it. This SHALL be recorded as such rather than presented as enforced.

#### Scenario: At the maximum
- **WHEN** the barber already has the maximum number of absences and another is submitted
- **THEN** it is refused with a message explaining the limit

### Requirement: Editor states are defined, accessible, and Spanish
The editor SHALL define its loading, empty, pending and rejected states, and all user-facing copy SHALL be Spanish (es-AR) sourced from the copy module. Dates SHALL be rendered in es-AR format on the server, so the build's locale data and the browser's cannot disagree.

While a submission is in flight the form SHALL be disabled, not merely the submit control. On rejection the editor SHALL re-render the values that were **submitted**, not the stored ones, and focus SHALL move to the error.

The list SHALL be ordered with the most recent and upcoming absences first, and SHALL present an empty state rather than a bare heading when the barber has none.

#### Scenario: Empty list
- **WHEN** the barber has no absences
- **THEN** an explanatory Spanish empty state is shown rather than an empty region

#### Scenario: Submission in flight
- **WHEN** a save is pending
- **THEN** the submit control shows its pending label and every field is disabled

#### Scenario: Rejected submission preserves what was typed
- **WHEN** a submission is rejected
- **THEN** every field shows what was submitted rather than being cleared

#### Scenario: Operable without client-side JavaScript
- **WHEN** the form is submitted before hydration
- **THEN** the absence is recorded by the server action

#### Scenario: Narrow viewport
- **WHEN** the editor renders at a 360px viewport
- **THEN** no horizontal overflow occurs and no control is pushed off screen

### Requirement: Infrastructure failure during a submit preserves the owner's input
A database timeout, connection failure, or unexpected error raised while performing the write — after the session owner has been resolved — SHALL be caught inside the action and returned as form state with a generic Spanish message. It MUST NOT propagate to the error boundary, which would discard what the owner typed, including a reason of up to 255 characters. The response MUST NOT contain stack traces, connection strings, SQL, or English technical text.

#### Scenario: The write fails after the owner is resolved
- **WHEN** the session resolves normally but the write fails
- **THEN** the form re-renders in place with the generic Spanish message and the submitted values intact

#### Scenario: No internal detail in the response
- **WHEN** any failure path renders
- **THEN** the response body contains no stack trace, connection string, table or column name, or constraint name
