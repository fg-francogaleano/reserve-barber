# location-management Specification

## Purpose

The owner creates and edits their own locations from the dashboard: input validation and name normalization, uniqueness per owner, ownership enforcement on every read and write, a per-owner cap, and the Spanish (es-AR) states of both forms — idle, submitting, field-level invalid, duplicate name, infrastructure error, and not-found.
## Requirements
### Requirement: Owner creates a location
The dashboard SHALL provide a create form at `/sucursales/nueva` where the authenticated owner supplies a `name` (required) and an `address` (optional). On success the location SHALL be persisted with `ownerId` taken from the session, `isActive` defaulted to `true`, and the owner SHALL be redirected to `/sucursales` with the new location visible in the list. The `ownerId` MUST NOT be read from the submitted form under any circumstance; an `ownerId` field present in the payload MUST be ignored.

#### Scenario: Location created with name and address
- **WHEN** the owner submits the name "Sucursal Centro" and the address "Av. Corrientes 1234"
- **THEN** a location is persisted carrying the session owner's id and `isActive = true`
- **THEN** the owner lands on `/sucursales` and the new location is listed

#### Scenario: Location created without address
- **WHEN** the owner submits a valid name and leaves the address blank
- **THEN** the location is persisted with `address` stored as `null`, not as an empty string

#### Scenario: Injected ownerId is ignored
- **WHEN** the create submission carries an `ownerId` field naming a different owner
- **THEN** the location is created for the session owner and the submitted value has no effect

### Requirement: Owner edits a location
The dashboard SHALL provide an edit form at `/sucursales/[id]/editar` allowing the authenticated owner to change a location's `name` and `address`. The form MUST NOT expose `isActive`, which belongs to story M6. On success the row SHALL be updated, `updatedAt` SHALL advance, and the owner SHALL be redirected to `/sucursales`.

#### Scenario: Name and address updated
- **WHEN** the owner changes an existing location's name and address and saves
- **THEN** the row is updated and the list reflects both changes

#### Scenario: Saving an unchanged form succeeds
- **WHEN** the owner opens the edit form and submits it without changing any value
- **THEN** the update reports one affected row and succeeds
- **THEN** the location is not reported as a duplicate of itself

#### Scenario: Deactivation is not offered
- **WHEN** the edit form is rendered
- **THEN** no control for `isActive` is present and the submitted payload cannot change it

### Requirement: Location name is validated and normalized
Location `name` SHALL be normalized before validation and persistence by applying Unicode NFC normalization, removing zero-width and **bidirectional control** characters, collapsing runs of internal whitespace to a single space, and trimming surrounding whitespace. After normalization the name MUST be between 2 and 120 characters. `address` SHALL be trimmed, MUST NOT exceed 255 characters, and a blank value MUST be stored as `null`. Validation SHALL run server-side before any business logic, regardless of what the browser enforced.

This normalization is a **shared domain rule**, not a location-specific one. It SHALL live in a single domain module consumed by every entity whose name is subject to a uniqueness constraint, so that two entities cannot drift into disagreeing about what "the same name" means.

Bidirectional control characters (U+202A–U+202E, U+2066–U+2069) are removed for the same reason zero-width characters are: they are invisible, they survive a length check, and they defeat the uniqueness constraint by making two names that render identically differ in bytes. Unlike zero-width characters they also reverse the rendering direction of *surrounding* text, so a single crafted name corrupts the display of the rows next to it.

#### Scenario: Surrounding and internal whitespace normalized
- **WHEN** the owner submits "  Sucursal   Centro  "
- **THEN** the persisted name is "Sucursal Centro"

#### Scenario: Name below or above the length bounds
- **WHEN** the owner submits a name of 1 character, or of 121 characters
- **THEN** a field-level Spanish error renders on the name input and nothing is persisted

#### Scenario: Whitespace-only and zero-width names rejected
- **WHEN** the owner submits a name consisting only of spaces, or only of zero-width characters
- **THEN** it is treated as empty and rejected by the required rule

#### Scenario: Bidirectional control characters removed
- **WHEN** the owner submits a name containing a bidirectional override or isolate character
- **THEN** the character is removed before validation and persistence
- **THEN** two names differing only by such characters cannot both be stored for one owner

#### Scenario: Address at the boundary
- **WHEN** the owner submits an address of 256 characters
- **THEN** a field-level Spanish error renders and nothing is persisted

#### Scenario: The rule has one home
- **WHEN** the codebase is inspected for name normalization
- **THEN** exactly one domain module implements it and every consumer imports it

### Requirement: Location name is unique per owner
Two locations belonging to the same owner MUST NOT carry the same normalized name. The database constraint SHALL be the authoritative guarantee; a case-insensitive pre-check in the application layer exists only to produce a readable error and MUST NOT be relied upon for correctness, because the check and the write cannot share a transaction on a transaction-mode pooler. A constraint violation SHALL surface as a field-level error on the name input, never as a raw database error.

#### Scenario: Duplicate name rejected with a field-level error
- **WHEN** the owner creates a location whose normalized name already exists for them, in any letter casing
- **THEN** a Spanish field-level error renders on the name input
- **THEN** no row is written and the values the owner typed remain in the form

#### Scenario: Whitespace and accent variants collide
- **WHEN** an owner with "Sucursal Centro" submits "Sucursal  Centro", or submits a decomposed-accent spelling of an existing name
- **THEN** it is rejected as a duplicate after normalization

#### Scenario: Pattern metacharacters are not treated as wildcards
- **WHEN** an owner with "Sucursal 500" creates "Sucursal 50%", or an owner with "Sucursal 1" creates "Sucursal_1"
- **THEN** both are created successfully and no duplicate error is reported

#### Scenario: Concurrent creation of the same name
- **WHEN** two submissions of the same name interleave such that both pass the application pre-check
- **THEN** the database constraint rejects the second write
- **THEN** exactly one location exists with that name and the owner sees the field-level duplicate error
- **THEN** no constraint name, column name, SQL fragment, or Prisma error text appears in the response

#### Scenario: A location is not a duplicate of itself
- **WHEN** the owner saves the edit form without changing the name
- **THEN** the uniqueness check excludes the location being edited and the save succeeds

### Requirement: Every location read and write is scoped to the session owner
All location reads and writes SHALL be constrained by the owner resolved from the session. Ownership MUST be a required parameter of every repository finder and mutator so that an unscoped query cannot be expressed. The update path SHALL carry `ownerId` in its own predicate rather than relying on a prior read. A location that does not belong to the session owner SHALL be indistinguishable from one that does not exist — the response MUST NOT reveal that the row exists.

#### Scenario: Editing a location belonging to another owner
- **WHEN** the owner submits the edit action carrying the id of a location owned by someone else
- **THEN** no row is modified
- **THEN** the response is identical to the response for an unknown id, and is not a forbidden/permission error

#### Scenario: Opening an unknown location
- **WHEN** the owner opens `/sucursales/<unknown-id>/editar`
- **THEN** a not-found page renders

#### Scenario: The location vanished since the form was loaded
- **WHEN** the edit form is submitted for a location that no longer resolves for this owner
- **THEN** the scoped update affects zero rows and the result is treated as not-found
- **THEN** it is never treated as a silent success

#### Scenario: The list shows only this owner's locations
- **WHEN** the list at `/sucursales` renders
- **THEN** it contains every location owned by the session owner and no location owned by anyone else

### Requirement: Authentication is re-checked inside every action
Each location page and each location Server Action SHALL resolve the owner through `requireOwner()` as its first step. The route middleware deliberately allows Server Action requests through, so the action's own check is the only barrier between an unauthenticated request and a database write.

#### Scenario: Unauthenticated page request
- **WHEN** a visitor without a session requests `/sucursales`, `/sucursales/nueva`, or an edit page
- **THEN** they are redirected to `/login` carrying a `next` parameter
- **THEN** no location name, address, or other database-derived content appears in the response

#### Scenario: Unauthenticated action invocation
- **WHEN** the create or edit Server Action is invoked with no valid session
- **THEN** `requireOwner()` redirects to `/login` and no row is written
- **THEN** the response is not a plain HTML redirect that would break the action client

#### Scenario: Session expires while the form is open
- **WHEN** the owner submits a form whose session has expired since it was loaded
- **THEN** they are redirected to `/login` and no location is created or updated

### Requirement: Number of locations per owner is capped
The application SHALL enforce a server-side maximum number of locations per owner. M1 ships create and edit but neither delete nor deactivation, so without a ceiling an unbounded loop leaves rows the owner cannot remove from the application. Reaching the cap SHALL produce a Spanish explanatory message, not a generic failure.

#### Scenario: Cap reached
- **WHEN** the owner attempts to create a location while already holding the maximum
- **THEN** no row is written and a Spanish message explains the limit

#### Scenario: Cap does not block editing
- **WHEN** the owner is at the cap and edits an existing location
- **THEN** the edit succeeds

### Requirement: Form states are defined, accessible, and Spanish
Both forms SHALL define an idle state, a submitting state whose submit control is visibly disabled, a field-level invalid state, and a form-level infrastructure-error state. Labels MUST be bound to their inputs, invalid fields MUST carry `aria-invalid`, the error region MUST be announced and MUST receive focus, and the optional nature of `address` MUST be stated. Every user-facing string SHALL live in the central Spanish copy module; all identifiers, comments, and log messages remain English.

#### Scenario: Validation failure preserves typed input
- **WHEN** any submission is rejected for validation or duplication
- **THEN** the values the owner typed are still present in the fields
- **THEN** focus moves to the first error and the error region is announced

#### Scenario: Submitting state
- **WHEN** a submission is in flight
- **THEN** the submit control is disabled and legibly indicates progress

#### Scenario: Double submit before hydration
- **WHEN** the create form is submitted twice before the pending state can be applied
- **THEN** exactly one location exists afterwards
- **THEN** the response shown to the owner does not present the successful outcome as a failure

#### Scenario: Copy review
- **WHEN** the location pages and forms are reviewed
- **THEN** every Spanish string is imported from the copy module and no Spanish text appears in logs or error objects

### Requirement: Infrastructure failure during a submit preserves the owner's input
A database timeout, connection failure, or unexpected error raised **while performing the write** — that is, after the session owner has been resolved — SHALL be caught inside the action and returned as form state carrying a generic Spanish message. It MUST NOT propagate to the error boundary, which would discard everything the owner typed. The response MUST NOT contain stack traces, connection strings, SQL, or English technical text, and a structured English log entry SHALL record the operation and cause.

A failure to resolve the session owner is deliberately **not** covered by this rule. At that point the request has no established identity and the whole dashboard is unavailable, not just this form; it surfaces to the error boundary instead (see `owner-authentication`). The two are distinguishable in the code by position: `requireOwner()` runs before the `try`, the write runs inside it.

#### Scenario: The write fails after the owner is resolved
- **WHEN** the session resolves normally but the create or update write fails
- **THEN** the form re-renders in place with the generic Spanish infrastructure message and the typed values intact
- **THEN** the full-page error boundary is not shown and a structured English log entry is emitted

#### Scenario: Session resolution fails
- **WHEN** the database is unreachable, so the owner cannot be resolved at all
- **THEN** the error boundary renders the generic Spanish message with a retry control
- **THEN** the visitor is not redirected, and no redirect loop occurs

#### Scenario: No internal detail in the response
- **WHEN** any failure path renders
- **THEN** the response body contains no stack trace, connection string, table or column name, or constraint name

### Requirement: Concurrent edits resolve as last-write-wins
When two edits to the same location are saved in sequence, the later write SHALL overwrite the earlier one without warning. This is an accepted limitation of M1, not an oversight: there is no version column and no precondition on `updatedAt`. It SHALL be recorded in `docs/tech-debt.md` with the trigger that brings it back.

#### Scenario: Two sessions edit the same location
- **WHEN** the same location is edited from two sessions and both are saved
- **THEN** the value from the later save is persisted and the earlier change is lost silently

#### Scenario: The limitation is documented
- **WHEN** `docs/tech-debt.md` is reviewed after this change
- **THEN** it records the last-write-wins behaviour and the condition under which it must be revisited

### Requirement: Locations are reachable from the dashboard navigation
The dashboard shell SHALL link to `/sucursales`. A route with no navigation entry is unreachable in practice.

#### Scenario: Navigation entry present
- **WHEN** the authenticated owner views any dashboard page
- **THEN** a link to the locations section is present in the dashboard shell

