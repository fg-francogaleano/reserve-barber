## ADDED Requirements

### Requirement: The barbers list shows assigned services and routes to the editor
Each entry in the barbers list SHALL show how many services the barber is assigned to, and SHALL offer a labelled route to that barber's assignment editor. A barber assigned to nothing SHALL be distinguishable at a glance, because such a barber cannot be booked for anything and that fact is otherwise only discoverable by opening them one at a time.

The count SHALL be obtained by a single aggregate for the whole list rather than one query per barber.

#### Scenario: Counts rendered
- **WHEN** the barbers list renders
- **THEN** each barber shows its assigned-service count and a labelled route into its assignment editor

#### Scenario: A barber assigned to nothing
- **WHEN** a barber has no assignments
- **THEN** the list shows a count of zero rather than omitting the indicator

#### Scenario: The accessible name identifies the barber
- **WHEN** the route into the editor renders
- **THEN** its accessible name identifies which barber it belongs to

## MODIFIED Requirements

### Requirement: Long free text renders without breaking the layout
`bio` is the first multi-line free-text field in the product. The list SHALL constrain how much of it renders, so that a bio consisting of many short lines cannot stretch one card far beyond its neighbours and destroy the grid. The full value remains available on the edit form. Long unbroken names and bios MUST wrap rather than overflow horizontally.

Wrapping SHALL be made effective at every level of the layout that establishes an intrinsic minimum width, not only on the element carrying the wrap rule. A flex or grid item refuses to shrink below its content's intrinsic width by default, so a wrap rule applied to an inner element alone never gets the chance to act and a long unbroken name still overflows. This correction was recorded as technical debt when the equivalent defect was fixed for the services list, and this change — which adds a further element to the same row — corrects it here.

#### Scenario: Bio of many lines
- **WHEN** a barber's bio contains many line breaks
- **THEN** the card renders a bounded number of lines and the grid keeps its shape

#### Scenario: Narrow viewport with maximal content
- **WHEN** the list renders at a 360px viewport with a 120-character name and a 500-character bio
- **THEN** text wraps, no horizontal overflow occurs, and no control is pushed off screen

#### Scenario: A long unbroken name alongside the assigned-service count
- **WHEN** a barber with a 120-character unbroken display name renders with its count
- **THEN** the name wraps, the count remains legible, and the card does not overflow horizontally

### Requirement: Infrastructure failure during a submit preserves the owner's input
A database timeout, connection failure, or unexpected error raised **while performing the write** — that is, after the session owner has been resolved — SHALL be caught inside the action and returned as form state carrying a generic Spanish message. It MUST NOT propagate to the error boundary, which would discard everything the owner typed, including a bio of up to 500 characters. The response MUST NOT contain stack traces, connection strings, SQL, or English technical text.

A structured English log entry SHALL record the operation and the failure. When the failure is a recognized constraint violation, that entry SHALL record the driver's error code and the operation and MUST NOT record the driver's message, which embeds the submitted values. This closes the exposure recorded as technical debt when the equivalent correction was made for the services write path; the trigger recorded there was the next change to touch this file, which this change does.

A failure to resolve the session owner is deliberately **not** covered by this rule: at that point the request has no established identity and the whole dashboard is unavailable, so it surfaces to the error boundary instead. The two are distinguishable by position — `requireOwner()` runs before the `try`, the write runs inside it.

#### Scenario: The write fails after the owner is resolved
- **WHEN** the session resolves normally but the create or update write fails
- **THEN** the form re-renders in place with the generic Spanish infrastructure message and the typed values intact
- **THEN** the full-page error boundary is not shown and a structured English log entry is emitted

#### Scenario: A recognized violation logs only the code
- **WHEN** a unique-constraint violation is caught during a barber write
- **THEN** the log entry contains the driver error code and the operation name, and no driver message
- **THEN** it contains no display name, no key value, and no SQL fragment

#### Scenario: The destination location disappears between the check and the write
- **WHEN** the location passes the ownership and active checks but no longer exists when the write executes
- **THEN** the owner is told the location is unavailable, not that an unspecified technical failure occurred

#### Scenario: No internal detail in the response
- **WHEN** any failure path renders
- **THEN** the response body contains no stack trace, connection string, table or column name, or constraint name
