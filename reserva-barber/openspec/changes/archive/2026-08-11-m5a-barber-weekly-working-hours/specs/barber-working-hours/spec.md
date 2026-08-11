## ADDED Requirements

### Requirement: Owner defines a barber's weekly working hours
The dashboard SHALL provide a schedule editor at `/barberos/[id]/horarios` where the authenticated owner sets, for each of the seven weekdays, at most one working window with a start and an end time. Saving SHALL make the stored schedule match the submitted one exactly, and return the owner to `/barberos`.

The barber is resolved from the route parameter scoped to the session owner. A barber id that is unknown or belongs to another owner SHALL be reported as not found, never as forbidden, so the editor cannot be used to discover which ids exist.

#### Scenario: A weekly schedule is set for the first time
- **WHEN** the owner enters 09:00–18:00 for Monday through Friday and saves
- **THEN** five windows are stored for that barber and the weekend has none

#### Scenario: An existing schedule is changed
- **WHEN** a barber with Monday 09:00–18:00 is saved with Monday 10:00–19:00
- **THEN** Monday's stored window is 10:00–19:00 and no second Monday window exists

#### Scenario: A barber belonging to another owner
- **WHEN** the owner opens the editor for a barber id owned by someone else
- **THEN** the response is a not-found page that does not reveal whether the id exists

### Requirement: A day without a window is a non-working day
An empty pair of time fields SHALL mean the barber does not work that day, and MUST NOT be treated as a validation error. Submitting a form with every day empty is a valid save meaning the barber works no days.

There is deliberately no separate "closed" flag: absence of a window **is** the absence. A flag would create two representations of one fact, which can then disagree.

#### Scenario: A single day is cleared
- **WHEN** the owner clears both time fields for Wednesday and saves
- **THEN** Wednesday has no stored window and the other days are unchanged

#### Scenario: Every day is cleared
- **WHEN** the owner clears all seven days and saves
- **THEN** the save succeeds and the barber has no stored windows

### Requirement: A half-filled day is rejected and the day is named
A day with a start time but no end time, or an end time but no start time, SHALL be rejected. The error SHALL identify **which weekday** is at fault; a form-level message over a seven-day grid is not actionable.

#### Scenario: Start without end
- **WHEN** the owner enters a start time for Tuesday and leaves its end time empty
- **THEN** the save is rejected and the message names Tuesday
- **THEN** every value the owner entered is returned to the form

#### Scenario: End without start
- **WHEN** the owner enters an end time for Saturday and leaves its start time empty
- **THEN** the save is rejected and the message names Saturday

### Requirement: Times are validated against the slot grid and the day boundary
Both times SHALL be whole minutes, multiples of the slot granularity constant shared with service duration, and the end SHALL be strictly after the start. A window MUST NOT cross midnight.

The granularity is the same constant B3 uses to generate slots. A window that does not tile the grid would produce slot times no other part of the system expects.

#### Scenario: A window off the slot grid
- **WHEN** the owner enters 09:07 as a start time
- **THEN** the save is rejected as not matching the slot granularity

#### Scenario: End not after start
- **WHEN** the owner enters 18:00–09:00 for a day
- **THEN** the save is rejected and the day is named

#### Scenario: A zero-length window
- **WHEN** the owner enters 09:00–09:00 for a day
- **THEN** the save is rejected, since a window that contains no time is not a working day

### Requirement: The schedule is stored in business local time
Windows SHALL be stored as minutes from midnight in the business's local time, never as instants and never with an offset applied. Reading a stored window back SHALL yield the same wall-clock time the owner entered, independently of the runtime's own clock or zone.

A recurring schedule is a statement about a clock face. Storing it as an instant would mean that a change in civil time silently reinterprets what the owner said.

#### Scenario: Wall-clock round trip
- **WHEN** the owner saves 09:00 and reopens the editor
- **THEN** the field shows 09:00 regardless of the server's timezone

#### Scenario: The runtime clock does not decide the weekday
- **WHEN** a weekday is derived while the runtime clock is in a different calendar day than the business
- **THEN** the weekday resolved is the business's, not the runtime's

### Requirement: Saving the same schedule twice changes nothing
Submitting a schedule that is already stored SHALL succeed and leave the stored windows equivalent to the submission. A retry after a failed or timed-out save MUST NOT produce duplicate windows.

Because a working window has no natural business key, an additive write would silently double the week on retry. The end state must depend on the submission, not on how many times it was applied.

#### Scenario: The unchanged form is saved
- **WHEN** the owner opens the editor and submits it without changing anything
- **THEN** the save succeeds and the stored schedule is unchanged

#### Scenario: A committed-but-timed-out save is retried
- **WHEN** a save commits, the response times out, and the owner submits the same schedule again
- **THEN** the barber has exactly one window per configured day and none is duplicated

### Requirement: Every schedule read and write is scoped to the session owner
Every query and mutation SHALL carry the owner, resolved from the session and never from the payload. A barber reached through another owner's location MUST NOT be readable or writable.

#### Scenario: A foreign barber's schedule cannot be read
- **WHEN** a schedule is requested for a barber belonging to a different owner
- **THEN** no windows are returned

#### Scenario: A foreign barber's schedule cannot be written
- **WHEN** a save is attempted for a barber belonging to a different owner
- **THEN** no window is created, changed, or deleted

### Requirement: Authentication is re-checked inside every action
The session owner SHALL be resolved as the first statement of the schedule action, before any parsing of the submission. Middleware alone is not sufficient: Server Action requests are dispatched through a mechanism the route middleware passes through.

#### Scenario: Unauthenticated submission
- **WHEN** a schedule submission arrives without a valid session
- **THEN** it is rejected before the payload is parsed and no window is written

### Requirement: An out-of-range weekday is rejected in full
A submitted weekday SHALL be an integer from 0 to 6. A value outside that range, or a non-integer, SHALL reject the entire submission rather than being skipped.

A fractional value is the dangerous case: it satisfies a naive range comparison and then matches no day, so the window it carries would be discarded while the save reported success.

#### Scenario: A weekday outside the range
- **WHEN** a crafted submission carries a weekday of 7 or -1
- **THEN** the whole submission is rejected and no window is written for any day

#### Scenario: A non-integer weekday
- **WHEN** a crafted submission carries a weekday of 0.5
- **THEN** the whole submission is rejected rather than silently dropping that window

### Requirement: The editor is reachable and its states are Spanish and accessible
The barbers list SHALL link to each barber's schedule editor. The editor SHALL define its loading, pending and rejected states, and all user-facing copy SHALL be Spanish (es-AR) sourced from the copy module.

Days SHALL be presented in the es-AR week order, beginning on **Monday**, while the stored weekday index keeps 0 as Sunday. That mapping SHALL exist in exactly one place.

While a submission is in flight the whole form SHALL be disabled, not merely the submit control: React resets uncontrolled inputs when the action resolves, so a time edited mid-flight would be discarded with no explanation. On rejection the editor SHALL re-render the values that were **submitted**, not the values that are stored, and focus SHALL move to the first offending day.

#### Scenario: Week order
- **WHEN** the editor renders
- **THEN** the first day presented is Monday and the last is Sunday

#### Scenario: Submission in flight
- **WHEN** a save is pending
- **THEN** the submit control shows its pending label and every time field is disabled

#### Scenario: Rejected submission preserves what was typed
- **WHEN** a submission is rejected
- **THEN** all fourteen fields show what was submitted rather than what is stored
- **THEN** focus moves to the first day carrying an error

#### Scenario: Operable without client-side JavaScript
- **WHEN** the editor is submitted before hydration
- **THEN** the schedule is saved by the server action

#### Scenario: Narrow viewport
- **WHEN** the editor renders at a 360px viewport
- **THEN** no horizontal overflow occurs and no control is pushed off screen

### Requirement: Infrastructure failure during a submit preserves the owner's input
A database timeout, connection failure, or unexpected error raised while performing the write — that is, after the session owner has been resolved — SHALL be caught inside the action and returned as form state carrying a generic Spanish message. It MUST NOT propagate to the error boundary, which would discard fourteen entered values. The response MUST NOT contain stack traces, connection strings, SQL, or English technical text.

Because a timed-out write may nevertheless have committed, the message SHALL direct the owner to check the stored schedule before retrying. The retry itself is safe, since the write replaces rather than appends.

#### Scenario: The write fails after the owner is resolved
- **WHEN** the session resolves normally but the schedule write fails
- **THEN** the editor re-renders in place with the generic Spanish message and the submitted values intact

#### Scenario: No internal detail in the response
- **WHEN** any failure path renders
- **THEN** the response body contains no stack trace, connection string, table or column name, or constraint name
