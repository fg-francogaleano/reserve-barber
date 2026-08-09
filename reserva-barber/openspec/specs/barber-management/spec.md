# barber-management Specification

## Purpose
TBD - created by archiving change m2-barber-management. Update Purpose after archive.
## Requirements
### Requirement: Owner registers a barber
The dashboard SHALL provide a create form at `/barberos/nuevo` where the authenticated owner supplies a `displayName` (required), a `locationId` chosen from their own locations (required), and a `bio` (optional). On success the barber SHALL be persisted against the chosen location with `isActive` defaulted to `true`, and the owner SHALL be redirected to `/barberos` with the new barber visible in the list.

Ownership MUST NOT be read from the submitted payload in any form. The barber carries no `ownerId` of its own; it belongs to the owner solely through its location, and the location named by the payload SHALL be resolved through an owner-scoped lookup before any write. Fields the forms do not expose — `isActive`, `avatarUrl`, `createdAt` — MUST be ignored when present in a payload.

#### Scenario: Barber created with name, location and bio
- **WHEN** the owner submits "Juan Pérez", one of their locations, and a bio
- **THEN** a barber is persisted against that location with `isActive = true`
- **THEN** the owner lands on `/barberos` and the new barber is listed under its location

#### Scenario: Barber created without a bio
- **WHEN** the owner submits a valid name and location and leaves the bio blank
- **THEN** the barber is persisted with `bio` stored as `null`, not as an empty string

#### Scenario: Injected fields are ignored
- **WHEN** the create submission carries `isActive = false`, an `avatarUrl`, or an `ownerId`
- **THEN** the barber is created active, with no avatar, for the session owner, and the submitted values have no effect

#### Scenario: Location belonging to another owner
- **WHEN** the create submission names a `locationId` owned by someone else
- **THEN** no row is written and the response is identical to the response for an unknown location id

### Requirement: Owner edits a barber and may reassign its location
The dashboard SHALL provide an edit form at `/barberos/[id]/editar` allowing the authenticated owner to change a barber's `displayName`, `bio`, and assigned location. On success the row SHALL be updated, `updatedAt` SHALL advance, and the owner SHALL be redirected to `/barberos`. The form MUST NOT expose `isActive`, which belongs to story M6.

#### Scenario: Name, bio and location updated
- **WHEN** the owner changes an existing barber's name, bio and location and saves
- **THEN** the row is updated and the list reflects all three changes

#### Scenario: Saving an unchanged form succeeds
- **WHEN** the owner opens the edit form and submits it without changing any value
- **THEN** the update reports one affected row and succeeds
- **THEN** the barber is not reported as a duplicate of itself

#### Scenario: Deactivation is not offered
- **WHEN** the edit form is rendered
- **THEN** no control for `isActive` is present and the submitted payload cannot change it

### Requirement: Display name is validated and normalized
`displayName` SHALL be normalized by the shared name-normalization rule before validation and persistence, and MUST be between 2 and 120 characters after normalization. `bio` SHALL be trimmed, MUST NOT exceed 500 characters, and a blank value MUST be stored as `null`. Validation SHALL run server-side before any business logic, regardless of what the browser enforced.

#### Scenario: Surrounding and internal whitespace normalized
- **WHEN** the owner submits "  Juan   Pérez  "
- **THEN** the persisted display name is "Juan Pérez"

#### Scenario: Name below or above the length bounds
- **WHEN** the owner submits a name of 1 character, or of 121 characters
- **THEN** a field-level Spanish error renders on the name input and nothing is persisted

#### Scenario: Whitespace-only and zero-width names rejected
- **WHEN** the owner submits a name consisting only of spaces, or only of zero-width characters
- **THEN** it is treated as empty and rejected by the required rule

#### Scenario: Bio at the boundary
- **WHEN** the owner submits a bio of 501 characters
- **THEN** a field-level Spanish error renders and nothing is persisted

### Requirement: Display name is unique per location
Two barbers assigned to the same location MUST NOT carry the same normalized `displayName`. The same name under two different locations SHALL be accepted, because one person's name recurring across branches is legitimate while two identically-named barbers at one branch are indistinguishable in the booking flow. The database constraint SHALL be the authoritative guarantee; a case-insensitive pre-check in the application layer exists only to produce a readable error and MUST NOT be relied upon for correctness, because the check and the write cannot share a transaction on a transaction-mode pooler.

The duplicate message SHALL name the location the collision occurred in. During a reassignment the collision is evaluated against the **destination** location, which is not the one the owner was looking at when the form was rendered, so an unqualified message would be actively misleading.

#### Scenario: Duplicate name in the same location rejected
- **WHEN** the owner creates a barber whose normalized name already exists at that location, in any letter casing
- **THEN** a Spanish field-level error naming that location renders on the name input
- **THEN** no row is written and the values the owner typed remain in the form

#### Scenario: Same name at a different location accepted
- **WHEN** the owner creates "Juan" at a location where no "Juan" exists, while another location already has one
- **THEN** the barber is created successfully

#### Scenario: Pattern metacharacters are not treated as wildcards
- **WHEN** the owner creates "Juan 50%" at a location that already has "Juan 500", or "Juan_1" where "Juan 1" exists
- **THEN** both are created successfully and no duplicate error is reported

#### Scenario: Reassignment collides at the destination
- **WHEN** the owner moves a barber to a location that already has a barber with that normalized name
- **THEN** a field-level Spanish error naming the **destination** location renders
- **THEN** no row is modified and the typed name, bio and selected location are preserved

#### Scenario: Concurrent creation of the same name
- **WHEN** two submissions of the same name at the same location interleave such that both pass the application pre-check
- **THEN** the database constraint rejects the second write
- **THEN** exactly one barber exists with that name at that location and the owner sees the field-level duplicate error
- **THEN** no constraint name, column name, SQL fragment, or Prisma error text appears in the response

### Requirement: Every barber read and write is scoped to the session owner through its location
A barber carries no owner of its own. All barber reads and writes SHALL therefore be constrained by the owner resolved from the session, expressed as a predicate over the barber's location relation. Ownership MUST be a required parameter of every repository finder and mutator so that an unscoped query cannot be expressed. The update path SHALL carry the ownership predicate itself rather than relying on a prior read. A barber that does not belong to the session owner SHALL be indistinguishable from one that does not exist — the response MUST NOT reveal that the row exists, and MUST NOT be a forbidden/permission error.

Reassignment requires **two** ownership decisions in the same submission: the barber being edited and the destination location must both belong to the session owner. Neither check may be skipped because the other passed.

#### Scenario: Editing a barber belonging to another owner
- **WHEN** the owner submits the edit action carrying the id of a barber owned by someone else
- **THEN** no row is modified
- **THEN** the response is identical to the response for an unknown id

#### Scenario: Reassigning to a foreign location
- **WHEN** the owner submits the edit action for their own barber but names a destination location owned by someone else
- **THEN** no row is modified and the destination is reported as unavailable

#### Scenario: Opening an unknown barber
- **WHEN** the owner opens `/barberos/<unknown-id>/editar`
- **THEN** a not-found page renders

#### Scenario: The barber vanished since the form was loaded
- **WHEN** the edit form is submitted for a barber that no longer resolves for this owner
- **THEN** the scoped update affects zero rows and the result is treated as not-found
- **THEN** it is never treated as a silent success

#### Scenario: The list shows only this owner's barbers
- **WHEN** the list at `/barberos` renders
- **THEN** it contains every barber at every location owned by the session owner, and no barber belonging to anyone else

### Requirement: A barber can never be moved into an inactive location
A barber MUST belong to an active location to be bookable (`docs/data-model.md` §5), but a barber sitting at a location that was deactivated after the assignment is a legal state, not a broken one. The system SHALL therefore permit a barber to **remain** at an inactive location while refusing to **move** one there.

On create, the destination location MUST be active. On update, the destination MUST be active **unless** it is the location the barber is already assigned to.

The "already assigned to" exemption SHALL be resolved by reading the barber's stored location inside the action. It MUST NOT be derived from any value supplied by the submission: a payload-supplied "current location" would let the caller choose the operand of the check and thereby assign a barber to any inactive location at will. No form field carrying the barber's current location may exist.

The destination's active state SHALL be verified **at write time**, not merely reflected in the options the form rendered. The rendered option set is a convenience that is stale the moment it reaches the browser.

#### Scenario: Creating into an inactive location
- **WHEN** the owner submits a create naming an inactive location of theirs
- **THEN** no row is written and a Spanish message reports the location as unavailable

#### Scenario: Keeping a barber at a location that has since been deactivated
- **WHEN** the owner edits a barber assigned to an inactive location and saves without changing the location
- **THEN** the update succeeds

#### Scenario: Forged current location
- **WHEN** the update payload names an inactive location as the destination and the submission also asserts that this is the barber's current location, while the stored barber is assigned elsewhere
- **THEN** the assertion in the payload is ignored, the stored location is used for the comparison, and the submission is rejected as unavailable
- **THEN** no row is modified

#### Scenario: The location is deactivated between rendering and submitting
- **WHEN** the create form was rendered while a location was active and that location is deactivated before the form is submitted
- **THEN** the destination is re-verified at write time and the submission is rejected as unavailable

#### Scenario: The current location is offered when editing
- **WHEN** the edit form renders for a barber assigned to an inactive location
- **THEN** the location control offers the owner's active locations plus that inactive location, visibly marked as inactive
- **THEN** the barber's current location is the selected one, so saving an unrelated field cannot silently reassign the barber

### Requirement: Number of barbers per location is capped
The application SHALL reject a create when the number of barbers already observed at the destination location has reached a documented server-side maximum. M2 ships create and edit but neither delete nor deactivation, so without a ceiling an unbounded loop leaves rows the owner cannot remove from the application. Reaching the cap SHALL produce a Spanish explanatory message, not a generic failure.

The cap is **advisory, not transactionally guaranteed**: the count and the write are separate round trips against a transaction-mode pooler and no database constraint backs the count, so concurrent creates may exceed it. This limitation SHALL be recorded in `docs/tech-debt.md` rather than claimed away.

#### Scenario: Cap reached
- **WHEN** the owner attempts to create a barber at a location already holding the maximum
- **THEN** no row is written and a Spanish message explains the limit

#### Scenario: Cap does not block editing
- **WHEN** a location is at the cap and the owner edits one of its barbers
- **THEN** the edit succeeds

#### Scenario: Cap is per location, not per owner
- **WHEN** one location is at the cap and the owner creates a barber at a different location
- **THEN** the create succeeds

#### Scenario: The advisory nature is documented
- **WHEN** `docs/tech-debt.md` is reviewed after this change
- **THEN** it records that concurrent creates can exceed the cap, and the trigger that would justify enforcing it

### Requirement: Authentication is re-checked inside every action
Each barber page and each barber Server Action SHALL resolve the owner through `requireOwner()` as its first step. The route middleware deliberately allows Server Action requests through, so the action's own check is the only barrier between an unauthenticated request and a database write.

#### Scenario: Unauthenticated page request
- **WHEN** a visitor without a session requests `/barberos`, `/barberos/nuevo`, or an edit page
- **THEN** they are redirected to `/login` carrying a `next` parameter
- **THEN** no barber name, bio, location name, or other database-derived content appears in the response

#### Scenario: Unauthenticated action invocation
- **WHEN** the create or edit Server Action is invoked with no valid session
- **THEN** `requireOwner()` redirects to `/login` and no row is written
- **THEN** the response is not a plain HTML redirect that would break the action client

#### Scenario: Session expires while the form is open
- **WHEN** the owner submits a form whose session has expired since it was loaded
- **THEN** they are redirected to `/login` and no barber is created or updated

### Requirement: The barbers section is usable before any location exists
A barber cannot exist without a location, so an owner who has created none must be guided rather than blocked. Both `/barberos` and `/barberos/nuevo` SHALL detect this state and render Spanish guidance pointing at location creation. The create page MUST NOT render an empty or unsatisfiable location control, and the list MUST NOT offer a create call to action that leads to a form the owner cannot complete.

#### Scenario: List with no locations and no barbers
- **WHEN** an owner with no locations opens `/barberos`
- **THEN** the empty state explains that a location is required first and links to location creation
- **THEN** it does not present the ordinary "create your first barber" call to action

#### Scenario: Create page reached directly with no locations
- **WHEN** an owner with no locations opens `/barberos/nuevo` by URL
- **THEN** the same guidance renders instead of a form with an empty location control

#### Scenario: List with locations but no barbers
- **WHEN** an owner who has locations but no barbers opens `/barberos`
- **THEN** the ordinary empty state and a working create call to action render

### Requirement: Form states are defined, accessible, and Spanish
Both forms SHALL define an idle state, a submitting state whose submit control is visibly disabled, a field-level invalid state, and a form-level infrastructure-error state. Labels MUST be bound to their controls — including the location control — invalid fields MUST carry `aria-invalid`, the error region MUST be announced and MUST receive focus, and the optional nature of `bio` MUST be stated. Focus SHALL move to the first error in a deterministic field order. Every user-facing string SHALL live in the central Spanish copy module; all identifiers, comments, and log messages remain English.

The location control SHALL be a form-associated native control so the form still submits before hydration and with JavaScript disabled, consistent with the house form pattern in `docs/frontend-standards.md`.

#### Scenario: Validation failure preserves typed input
- **WHEN** any submission is rejected for validation, duplication, or an unavailable location
- **THEN** the typed name, the typed bio, **and the selected location** are still present in the form
- **THEN** focus moves to the first error and the error region is announced

#### Scenario: Submitting state
- **WHEN** a submission is in flight
- **THEN** the submit control is disabled and legibly indicates progress

#### Scenario: Error on the location control
- **WHEN** a submission is rejected because the location is missing or unavailable
- **THEN** the location control carries `aria-invalid` and its error message is associated with it

#### Scenario: Submission without client-side scripting
- **WHEN** the form is submitted before hydration completes
- **THEN** the submission still reaches the server carrying all three fields

#### Scenario: Double submit before hydration
- **WHEN** the create form is submitted twice before the pending state can be applied
- **THEN** exactly one barber exists afterwards

#### Scenario: Copy review
- **WHEN** the barber pages and forms are reviewed
- **THEN** every Spanish string is imported from the copy module and no Spanish text appears in logs or error objects

### Requirement: Long free text renders without breaking the layout
`bio` is the first multi-line free-text field in the product. The list SHALL constrain how much of it renders, so that a bio consisting of many short lines cannot stretch one card far beyond its neighbours and destroy the grid. The full value remains available on the edit form. Long unbroken names and bios MUST wrap rather than overflow horizontally.

#### Scenario: Bio of many lines
- **WHEN** a barber's bio contains many line breaks
- **THEN** the card renders a bounded number of lines and the grid keeps its shape

#### Scenario: Narrow viewport with maximal content
- **WHEN** the list renders at a 360px viewport with a 120-character name and a 500-character bio
- **THEN** text wraps, no horizontal overflow occurs, and no control is pushed off screen

### Requirement: Infrastructure failure during a submit preserves the owner's input
A database timeout, connection failure, or unexpected error raised **while performing the write** — that is, after the session owner has been resolved — SHALL be caught inside the action and returned as form state carrying a generic Spanish message. It MUST NOT propagate to the error boundary, which would discard everything the owner typed, including a bio of up to 500 characters. The response MUST NOT contain stack traces, connection strings, SQL, or English technical text, and a structured English log entry SHALL record the operation and cause.

A failure to resolve the session owner is deliberately **not** covered by this rule: at that point the request has no established identity and the whole dashboard is unavailable, so it surfaces to the error boundary instead. The two are distinguishable by position — `requireOwner()` runs before the `try`, the write runs inside it.

#### Scenario: The write fails after the owner is resolved
- **WHEN** the session resolves normally but the create or update write fails
- **THEN** the form re-renders in place with the generic Spanish infrastructure message and the typed values intact
- **THEN** the full-page error boundary is not shown and a structured English log entry is emitted

#### Scenario: The destination location disappears between the check and the write
- **WHEN** the location passes the ownership and active checks but no longer exists when the write executes
- **THEN** the owner is told the location is unavailable, not that an unspecified technical failure occurred

#### Scenario: No internal detail in the response
- **WHEN** any failure path renders
- **THEN** the response body contains no stack trace, connection string, table or column name, or constraint name

### Requirement: Concurrent edits resolve as last-write-wins
When two edits to the same barber are saved in sequence, the later write SHALL overwrite the earlier one without warning. This is an accepted limitation, re-affirmed rather than inherited: `docs/tech-debt.md` T8 named this story as its trigger. There is no version column and no precondition on `updatedAt`, because the system still has exactly one administrative user. The decision and its new trigger SHALL be recorded.

#### Scenario: Two sessions edit the same barber
- **WHEN** the same barber is edited from two sessions and both are saved
- **THEN** the value from the later save is persisted and the earlier change is lost silently

#### Scenario: The decision is documented
- **WHEN** `docs/tech-debt.md` is reviewed after this change
- **THEN** T8 records that M2 evaluated it, why it was re-accepted, and the condition that brings it back

### Requirement: Barbers are reachable from the dashboard navigation
The dashboard shell SHALL link to `/barberos`. A route with no navigation entry is unreachable in practice.

#### Scenario: Navigation entry present
- **WHEN** the authenticated owner views any dashboard page
- **THEN** a link to the barbers section is present in the dashboard shell

