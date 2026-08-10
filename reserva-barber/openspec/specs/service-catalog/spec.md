# service-catalog Specification

## Purpose

The owner creates and edits the services their business offers from the dashboard: server-side name normalization and per-owner uniqueness, server-authoritative price parsing accepting either decimal separator, a duration that tiles the slot grid, ownership enforcement on every read and write, a per-owner cap counting active services only, and the Spanish (es-AR) states of both forms.
## Requirements
### Requirement: Owner creates a service
The dashboard SHALL provide a create form at `/servicios/nuevo` where the authenticated owner supplies a `name` (required), a `price` (required), a `durationMinutes` (required), and a `description` (optional). On success the service SHALL be persisted against the session owner with `isActive` defaulted to `true`, and the owner SHALL be redirected to `/servicios` with the new service visible in the list.

Ownership MUST NOT be read from the submitted payload in any form. Fields the forms do not expose — `isActive`, `createdAt`, `id` on create — MUST be ignored when present in a payload.

#### Scenario: Service created with all fields
- **WHEN** the owner submits "Corte Clásico", a price of 4500, a duration of 30, and a description
- **THEN** a service is persisted for the session owner with `isActive = true`
- **THEN** the owner lands on `/servicios` and the new service is listed with its price and duration

#### Scenario: Service created without a description
- **WHEN** the owner submits a valid name, price and duration and leaves the description blank
- **THEN** the service is persisted with `description` stored as `null`, not as an empty string

#### Scenario: Injected fields are ignored
- **WHEN** the create submission carries `isActive = false`, an `ownerId`, or an `id`
- **THEN** the service is created active, for the session owner, and the submitted values have no effect

### Requirement: Owner edits a service
The dashboard SHALL provide an edit form at `/servicios/[id]/editar` allowing the authenticated owner to change a service's `name`, `price`, `durationMinutes` and `description`. On success the row SHALL be updated, `updatedAt` SHALL advance, and the owner SHALL be redirected to `/servicios`. The form MUST NOT expose `isActive`, which belongs to story M6.

Editing a price SHALL NOT alter any previously recorded value elsewhere in the system. `Booking.priceAtBooking` is a deliberate historical snapshot; nothing in this change may treat the service price as the retroactive source of truth for past bookings.

#### Scenario: All fields updated
- **WHEN** the owner changes an existing service's name, price, duration and description and saves
- **THEN** the row is updated and the list reflects all four changes

#### Scenario: Saving an unchanged form succeeds
- **WHEN** the owner opens the edit form and submits it without changing any value
- **THEN** the update reports one affected row and succeeds
- **THEN** the service is not reported as a duplicate of itself

#### Scenario: Deactivation is not offered
- **WHEN** the edit form is rendered
- **THEN** no control for `isActive` is present and the submitted payload cannot change it

### Requirement: Service name is validated, normalized, and unique per owner
`name` SHALL be normalized by the shared name-normalization rule before validation and persistence, and MUST be between 2 and 120 characters after normalization. `description` SHALL be trimmed, MUST NOT exceed 500 characters, and a blank value MUST be stored as `null`. Validation SHALL run server-side before any business logic, regardless of what the browser enforced.

Two services belonging to the same owner MUST NOT carry the same normalized `name`. Uniqueness is scoped to the **owner**, not to a location: a service is offered by the business, not by a branch. The database constraint SHALL be the authoritative guarantee; a case-insensitive pre-check in the application layer exists only to produce a readable error and MUST NOT be relied upon for correctness, because the check and the write cannot share a transaction on a transaction-mode pooler.

#### Scenario: Surrounding and internal whitespace normalized
- **WHEN** the owner submits "  Corte   Clásico  "
- **THEN** the persisted name is "Corte Clásico"

#### Scenario: Name below or above the length bounds
- **WHEN** the owner submits a name of 1 character, or of 121 characters
- **THEN** a field-level Spanish error renders on the name input and nothing is persisted

#### Scenario: Whitespace-only and invisible-character names rejected
- **WHEN** the owner submits a name consisting only of spaces, only of zero-width characters, or only of bidirectional control characters
- **THEN** it is treated as empty and rejected by the required rule

#### Scenario: Duplicate name rejected
- **WHEN** the owner creates a service whose normalized name already exists for them, in any letter casing
- **THEN** a Spanish field-level error renders on the name input
- **THEN** no row is written and the values the owner typed remain in the form

#### Scenario: Pattern metacharacters are not treated as wildcards
- **WHEN** the owner creates "Corte 50%" while "Corte 500" exists, or "Corte_1" while "Corte 1" exists
- **THEN** both are created successfully and no duplicate error is reported

#### Scenario: Concurrent creation of the same name
- **WHEN** two submissions of the same name interleave such that both pass the application pre-check
- **THEN** the database constraint rejects the second write
- **THEN** exactly one service exists with that name and the owner sees the field-level duplicate error
- **THEN** no constraint name, column name, SQL fragment, or Prisma error text appears in the response

#### Scenario: Description at the boundary
- **WHEN** the owner submits a description of 501 characters
- **THEN** a field-level Spanish error renders and nothing is persisted

### Requirement: The price is parsed server-side and never guessed
`price` SHALL be parsed and validated on the server, which is the sole authority regardless of what the browser produced. The parser SHALL accept a decimal separator of either `.` or `,`, because the platform and an es-AR keyboard disagree about which one is correct and the owner must not have to know which won. The accepted value SHALL be canonicalized to a single representation with exactly two decimal places before persistence.

A value carrying a thousands separator SHALL be **rejected as ambiguous** rather than interpreted. `4.500` cannot be distinguished from a decimal value without guessing, and a wrong guess is a thousandfold pricing error that surfaces only at reconciliation.

A value with more than two decimal places SHALL be rejected, never silently rounded: the owner must see the price they will charge.

#### Scenario: Both decimal separators accepted
- **WHEN** the owner submits "4500", "4500.50", or "4500,50"
- **THEN** each is accepted and canonicalized, and "4500,50" and "4500.50" persist identically

#### Scenario: Ambiguous thousands separator rejected
- **WHEN** the owner submits "4.500" or "4,500"
- **THEN** no row is written, a Spanish field-level error names the expected format, and the submitted text is still present in the price control

#### Scenario: Excess precision is refused, not rounded
- **WHEN** the owner submits "4500.555"
- **THEN** a Spanish field-level error renders and nothing is persisted
- **THEN** no value of "4500.56" or "4500.55" is written

#### Scenario: Non-numeric and out-of-domain values rejected
- **WHEN** the owner submits "abc", "", "1e5", "Infinity", or a negative number
- **THEN** each is rejected with a field-level Spanish error and nothing is persisted

#### Scenario: Zero is a legal price
- **WHEN** the owner submits a price of 0
- **THEN** the service is created successfully

#### Scenario: A price above the documented ceiling is a field error
- **WHEN** the owner submits a price above the documented maximum
- **THEN** it is rejected by validation before reaching the database
- **THEN** the owner sees a field-level Spanish error, never the generic infrastructure message

### Requirement: The duration must describe a slot grid that tiles
`durationMinutes` SHALL be a positive integer, a multiple of the documented slot granularity, and within the documented minimum and maximum. The granularity constant SHALL live in the domain layer so that slot generation (B3) and booking sizing (B5) consume the same definition; a second definition of the slot grid would surface not as a failing test but as appointments that cannot be booked.

#### Scenario: A duration that does not tile the grid is refused
- **WHEN** the owner submits a duration of 37
- **THEN** no row is written and a Spanish field-level error names the granularity
- **THEN** the error originates from the server, not from a native browser tooltip

#### Scenario: Duration outside the bounds
- **WHEN** the owner submits a duration of 0, a negative duration, or one above the documented maximum
- **THEN** a field-level Spanish error renders and nothing is persisted

#### Scenario: Non-integer duration
- **WHEN** the owner submits "4.5" or "abc" as the duration
- **THEN** a field-level Spanish error renders and nothing is persisted

### Requirement: Every service read and write is scoped to the session owner
All service reads and writes SHALL be constrained by the owner resolved from the session. Ownership MUST be a required parameter of every repository finder and mutator so that an unscoped query cannot be expressed. The update path SHALL carry the ownership predicate itself rather than relying on a prior read. A service that does not belong to the session owner SHALL be indistinguishable from one that does not exist — the response MUST NOT reveal that the row exists, and MUST NOT be a forbidden/permission error.

#### Scenario: Editing a service belonging to another owner
- **WHEN** the owner submits the edit action carrying the id of a service owned by someone else
- **THEN** no row is modified
- **THEN** the response is identical to the response for an unknown id

#### Scenario: Opening an unknown service
- **WHEN** the owner opens `/servicios/<unknown-id>/editar`
- **THEN** a not-found page renders

#### Scenario: The service vanished since the form was loaded
- **WHEN** the edit form is submitted for a service that no longer resolves for this owner
- **THEN** the scoped update affects zero rows and the result is treated as not-found
- **THEN** it is never treated as a silent success

#### Scenario: The list shows only this owner's services
- **WHEN** the list at `/servicios` renders
- **THEN** it contains every service of the session owner and no service belonging to anyone else

### Requirement: Authentication is re-checked inside every action
Each service page and each service Server Action SHALL resolve the owner through `requireOwner()` as its first step. The route middleware deliberately allows Server Action requests through, so the action's own check is the only barrier between an unauthenticated request and a database write.

#### Scenario: Unauthenticated page request
- **WHEN** a visitor without a session requests `/servicios`, `/servicios/nuevo`, or an edit page
- **THEN** they are redirected to `/login` carrying a `next` parameter
- **THEN** no service name, price, duration, or other database-derived content appears in the response

#### Scenario: Unauthenticated action invocation
- **WHEN** the create or edit Server Action is invoked with no valid session
- **THEN** `requireOwner()` redirects to `/login` and no row is written
- **THEN** the response is not a plain HTML redirect that would break the action client

#### Scenario: Session expires while the form is open
- **WHEN** the owner submits a form whose session has expired since it was loaded
- **THEN** they are redirected to `/login` and no service is created or updated

### Requirement: Number of services per owner is capped, counting active services only
The application SHALL reject a create when the number of **active** services already observed for the owner has reached a documented server-side maximum. M3 ships create and edit but neither delete nor deactivation, so without a ceiling an unbounded loop leaves rows the owner cannot remove from the application. Reaching the cap SHALL produce a Spanish explanatory message, not a generic failure.

The count SHALL exclude inactive services. Counting every row would mean that once M6 introduces deactivation, an owner who deactivated the maximum number of services would be permanently unable to create another, with no remedy available anywhere in the application. The cap exists to bound accidental over-creation, not to bound the historical record.

The cap is **advisory, not transactionally guaranteed**: the count and the write are separate round trips against a transaction-mode pooler and no database constraint backs the count, so concurrent creates may exceed it. This limitation SHALL be recorded in `docs/tech-debt.md` rather than claimed away.

#### Scenario: Cap reached
- **WHEN** the owner attempts to create a service while already at the maximum number of active services
- **THEN** no row is written and a Spanish message explains the limit

#### Scenario: Cap does not block editing
- **WHEN** the owner is at the cap and edits an existing service
- **THEN** the edit succeeds

#### Scenario: Inactive services do not consume the cap
- **WHEN** the count of active services is below the maximum while the total row count is at or above it
- **THEN** the create is accepted

#### Scenario: The advisory nature is documented
- **WHEN** `docs/tech-debt.md` is reviewed after this change
- **THEN** it records that concurrent creates can exceed the cap, and the trigger that would justify enforcing it

### Requirement: Monetary values are rendered in Spanish (es-AR) currency format on the server
A price SHALL be formatted for display in the server-rendered output, using the es-AR ARS locale format. Formatting MUST NOT be performed in a Client Component, because the build's locale data and the browser's need not agree and a mismatch would surface as a hydration error rather than as a wrong number.

The rendered format SHALL be verified on the deployment runtime, not only under the test runner. A trimmed internationalization dataset degrades silently to a different format instead of failing, so a passing unit test under Node is not evidence about production.

#### Scenario: Price rendered in the list
- **WHEN** a service priced 4500.50 is listed
- **THEN** its price renders in es-AR ARS format

#### Scenario: Formatting is verified on the deployment runtime
- **WHEN** the application is exercised on the Cloudflare Workers runtime
- **THEN** the rendered price is the es-AR ARS format and not an untranslated fallback

### Requirement: Form states are defined, accessible, and Spanish
Both forms SHALL define an idle state, a submitting state whose submit control is visibly disabled, a field-level invalid state, and a form-level infrastructure-error state. Labels MUST be bound to their controls, invalid fields MUST carry `aria-invalid`, the error region MUST be announced and MUST receive focus, and the optional nature of `description` MUST be stated. Focus SHALL move to the first error in the deterministic field order `name → price → durationMinutes → description`. Every user-facing string SHALL live in the central Spanish copy module; all identifiers, comments, and log messages remain English.

The idle state SHALL communicate the expected price format and the duration granularity **before** a submission fails. A rule discoverable only by violating it is a rule stated badly.

#### Scenario: Validation failure preserves typed input
- **WHEN** any submission is rejected for validation, duplication, or the cap
- **THEN** the typed name, price, duration **and** description are all still present in the form
- **THEN** focus moves to the first error and the error region is announced

#### Scenario: Submitting state
- **WHEN** a submission is in flight
- **THEN** the submit control is disabled and legibly indicates progress

#### Scenario: Submission without client-side scripting
- **WHEN** the form is submitted before hydration completes
- **THEN** the submission still reaches the server carrying all four fields

#### Scenario: Double submit before hydration
- **WHEN** the create form is submitted twice before the pending state can be applied
- **THEN** exactly one service exists afterwards

#### Scenario: Copy review
- **WHEN** the service pages and forms are reviewed
- **THEN** every Spanish string is imported from the copy module and no Spanish text appears in logs or error objects

### Requirement: No form attribute may block submission or silently alter a value
The price and duration controls MUST NOT use `type="number"`, `min`, `max`, `step`, or `pattern`.

A number-typed control submits an **empty string** when the browser's own parser rejects the value — which is what an es-AR keyboard's `4500,50` produces. The server would then report a missing price for a price that was typed, the echo-back that preserves input on rejection would have nothing to echo, and "missing" would become indistinguishable from "malformed". Constraint attributes additionally let the browser block the submission with a message in the browser's locale, from a string that exists nowhere in the copy module — so the validation the specification describes would not be the validation the owner meets.

The price control SHALL still present a numeric keypad on touch devices.

#### Scenario: A comma decimal separator reaches the server intact
- **WHEN** the owner types "4500,50" and submits
- **THEN** the server receives that exact string
- **THEN** no "price is required" error is produced

#### Scenario: A rejected value is echoed back
- **WHEN** any submission is rejected on the price or duration field
- **THEN** the text the owner typed is still present in that control

#### Scenario: Validation messages come from the application
- **WHEN** an invalid price or duration is submitted
- **THEN** the message shown is the Spanish message from the copy module, not a native browser tooltip

### Requirement: Infrastructure failure during a submit preserves the owner's input
A database timeout, connection failure, or unexpected error raised **while performing the write** — that is, after the session owner has been resolved — SHALL be caught inside the action and returned as form state carrying a generic Spanish message. It MUST NOT propagate to the error boundary, which would discard everything the owner typed. The response MUST NOT contain stack traces, connection strings, SQL, or English technical text, and a structured English log entry SHALL record the operation and cause.

Because a timed-out write may nonetheless have been committed, the message SHALL direct the owner to check the list before retrying. A blind retry would meet the duplicate-name error and report their own successful creation as a failure.

A failure to resolve the session owner is deliberately **not** covered by this rule: at that point the request has no established identity and the whole dashboard is unavailable, so it surfaces to the error boundary instead. The two are distinguishable by position — `requireOwner()` runs before the `try`, the write runs inside it.

#### Scenario: The write fails after the owner is resolved
- **WHEN** the session resolves normally but the create or update write fails
- **THEN** the form re-renders in place with the generic Spanish infrastructure message and all typed values intact
- **THEN** the full-page error boundary is not shown and a structured English log entry is emitted

#### Scenario: The message accounts for an uncertain outcome
- **WHEN** the infrastructure error message is rendered
- **THEN** it directs the owner to verify the list before retrying

#### Scenario: A redirect is not mistaken for a failure
- **WHEN** a create or update succeeds and the action redirects
- **THEN** the redirect signal is not caught by the write error handler
- **THEN** the owner lands on `/servicios` and exactly one row was written

#### Scenario: No internal detail in the response
- **WHEN** any failure path renders
- **THEN** the response body contains no stack trace, connection string, table or column name, or constraint name

### Requirement: Long free text and extreme values render without breaking the layout
The list SHALL constrain how much of `description` renders, so that a description of many short lines cannot stretch one card far beyond its neighbours and destroy the grid. The full value remains available on the edit form. Long unbroken names MUST wrap rather than overflow horizontally.

#### Scenario: Description of many lines
- **WHEN** a service's description contains many line breaks
- **THEN** the card renders a bounded number of lines and the grid keeps its shape

#### Scenario: Narrow viewport with maximal content
- **WHEN** the list renders at a 360px viewport with a 120-character name, a 500-character description, and a maximal price
- **THEN** text wraps, no horizontal overflow occurs, and no control is pushed off screen

### Requirement: The services section is reachable and usable when empty
The dashboard shell SHALL link to `/servicios`. A route with no navigation entry is unreachable in practice. When the owner has no services, the list SHALL render Spanish guidance and a working create call to action. Unlike barbers, a service has no upstream prerequisite: it requires neither a location nor a barber to exist, so no "create something else first" state applies.

#### Scenario: Navigation entry present
- **WHEN** the authenticated owner views any dashboard page
- **THEN** a link to the services section is present in the dashboard shell

#### Scenario: Empty list
- **WHEN** an owner with no services opens `/servicios`
- **THEN** the ordinary empty state and a working create call to action render

### Requirement: Concurrent edits resolve as last-write-wins
When two edits to the same service are saved in sequence, the later write SHALL overwrite the earlier one without warning. This is an accepted limitation, re-affirmed rather than inherited. There is no version column and no precondition on `updatedAt`, because the system still has exactly one administrative user. The decision SHALL be recorded.

#### Scenario: Two sessions edit the same service
- **WHEN** the same service is edited from two sessions and both are saved
- **THEN** the value from the later save is persisted and the earlier change is lost silently

#### Scenario: The decision is documented
- **WHEN** `docs/tech-debt.md` is reviewed after this change
- **THEN** it records that M3 evaluated the limitation and the condition that brings it back
