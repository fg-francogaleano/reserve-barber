## ADDED Requirements

### Requirement: Owner assigns services to a barber
The dashboard SHALL provide an assignment editor at `/barberos/[id]/servicios` where the authenticated owner sees the barber's assignable services as a checkbox list, pre-checked for those already assigned, and saves the whole set in one submission. On success the stored assignments SHALL match the submitted selection and the owner SHALL be returned to `/barberos`.

Ownership MUST NOT be read from the submitted payload in any form. The barber is resolved from the route parameter scoped to the session owner; a barber id that is unknown or belongs to another owner SHALL be reported as not found, never as forbidden, so the editor cannot be used to discover which ids exist.

#### Scenario: Services assigned to a barber with none
- **WHEN** the owner checks two services for a barber that had no assignments and saves
- **THEN** exactly two assignment rows exist for that barber
- **THEN** the owner lands on `/barberos` and the barber shows a count of two

#### Scenario: Selection replaces the previous set
- **WHEN** a barber assigned to "Corte" and "Barba" is saved with only "Barba" checked
- **THEN** the assignment to "Corte" is removed and the assignment to "Barba" is retained

#### Scenario: A barber belonging to another owner
- **WHEN** the owner opens the editor for a barber id owned by someone else
- **THEN** the response is a not-found page that does not reveal whether the id exists

### Requirement: The assignment set is diffed against the baseline the form rendered
The editor SHALL submit two parallel multi-value fields: every service id it rendered, and the subset of those that were checked. The write SHALL add `checked − stored` and remove `(rendered − checked) ∩ stored`.

Removals MUST be confined to ids the form actually displayed. Diffing against stored state alone is forbidden: the checkbox list is a snapshot taken at render time, so under that rule an assignment created after the page loaded would be deleted by a form that never displayed it and whose owner never saw it — and the loss is a service that silently stops being bookable, not a value that has to be retyped.

#### Scenario: An assignment created after the page loaded survives
- **GIVEN** the editor rendered "Corte" and "Barba" for a barber
- **WHEN** a second session assigns "Color" to the same barber
- **AND** the first form is submitted with only "Corte" checked
- **THEN** "Barba" is unassigned, "Corte" is retained, and "Color" remains assigned

#### Scenario: A conflict over a co-rendered service resolves last-write-wins
- **WHEN** two sessions that both rendered "Corte" save opposite states for it
- **THEN** the later save wins and the earlier one is lost silently

### Requirement: An empty selection is a valid save
Submitting the editor with nothing checked SHALL remove every assignment the form rendered and MUST NOT be treated as a validation failure. An all-unchecked form omits the checked-ids field entirely, so the rendered-baseline field is what proves a submission occurred; a missing selection and an empty selection MUST be distinguishable by that field alone.

#### Scenario: All services unchecked
- **WHEN** the owner unchecks every service and saves
- **THEN** every rendered assignment is removed and the save reports success

#### Scenario: The barber then reads as performing nothing
- **WHEN** the barbers list renders after that save
- **THEN** the barber shows a count of zero rather than an error state

### Requirement: An inactive service may remain assigned but cannot be newly added
The assignable set SHALL be the owner's active services **union** the services already assigned to that barber. A service deactivated after it was assigned SHALL remain assigned and SHALL be rendered with a marker identifying it as inactive; a service that is inactive and not already assigned MUST NOT be assignable.

Forcing removal on deactivation would mean deactivating a service silently rewrites every barber's assignment set, destroying information the owner would have to reconstruct by hand on reactivation. The exemption SHALL be decided from stored state, never from a value carried in the submission.

#### Scenario: A previously assigned service is deactivated
- **WHEN** the editor renders for a barber assigned to a service that has since been deactivated
- **THEN** the service appears checked and marked inactive, and saving the unchanged form retains it

#### Scenario: Adding a service that became inactive
- **WHEN** a submission checks a service that is inactive and was not already assigned
- **THEN** the save is rejected and the offending service is identified

### Requirement: A submission referencing a service the owner does not own is rejected in full
Every submitted id — checked and rendered alike — SHALL be verified to belong to the session owner before any write. A foreign or unknown id SHALL reject the entire submission; it MUST NOT be filtered out so the remainder can proceed, because a silently dropped id means the save did something other than what the form showed.

#### Scenario: A foreign service id is submitted
- **WHEN** a crafted submission includes a service belonging to a different owner alongside two valid ones
- **THEN** no assignment row is created or removed for any of the three
- **THEN** the response carries no indication of whether the foreign id exists

#### Scenario: An unknown service id is submitted
- **WHEN** a submission includes a service id that matches no row
- **THEN** the save is rejected and no partial write occurs

### Requirement: The submitted set is bounded before any database read
The submitted lists SHALL be deduplicated, verified to contain only strings, and rejected when they exceed a documented upper bound — all before the barber lookup or any other query runs. A submission is client-controlled and unbounded by default; bounding it after the reads would let one save become an unbounded query and an unbounded insert.

**The specific bound is provisional.** It is currently the per-owner **active**-service cap, which is known to be the wrong quantity: the editor offers `active ∪ already-assigned` services, so once deactivation exists the form can legitimately render more entries than the bound admits and reject the owner's own submission. See `docs/tech-debt.md` T22. What is normative here is that the bound is applied before any query; the value itself is expected to change to the size of the assignable set.

#### Scenario: A submission exceeding the cap
- **WHEN** a submission carries more service ids than the per-owner cap allows
- **THEN** it is rejected without any database query having been issued

#### Scenario: A submission carrying duplicates
- **WHEN** the same service id appears several times in one submission
- **THEN** it is treated as a single selection and the save succeeds

### Requirement: A repeated assignment is absorbed, never reported as an error
Saving a selection that is already stored, in whole or in part, SHALL succeed and leave the stored set unchanged. A duplicate assignment MUST NOT surface to the owner as a field error.

Every other unique constraint in the product reports to the owner because a duplicate name is a mistake they can correct. A duplicate assignment is not a mistake — it is the same intent expressed twice by a double click or a retried timeout — so reporting it would be reporting success as failure.

#### Scenario: The unchanged form is saved
- **WHEN** the owner opens the editor and submits it without changing anything
- **THEN** the save succeeds and the stored assignments are unchanged

#### Scenario: Double submit before hydration
- **WHEN** the same selection is submitted twice before the page hydrates
- **THEN** the resulting set matches the selection exactly, with no duplicate row and no duplicate error

### Requirement: Authentication is re-checked inside every action
The session owner SHALL be resolved as the first statement of the assignment action, before any parsing of the submission. Middleware alone is not sufficient: Server Action requests are dispatched through a mechanism the route middleware passes through.

#### Scenario: Unauthenticated submission
- **WHEN** an assignment submission arrives without a valid session
- **THEN** it is rejected before the payload is parsed and no assignment is written

### Requirement: The editor is reachable and usable when the owner has no services
The barbers list SHALL link to each barber's assignment editor. When the owner has no services at all, the editor SHALL render an explanatory Spanish empty state with a route to create one, rather than an operable form with no options.

#### Scenario: Owner has no services
- **WHEN** the editor opens for an owner whose catalogue is empty
- **THEN** an empty state explains that a service must exist first and links to service creation
- **THEN** no submit control is presented as operable

#### Scenario: Entry point present
- **WHEN** the barbers list renders
- **THEN** each barber offers a labelled route into its assignment editor

### Requirement: Editor states are defined, accessible, and Spanish
The editor SHALL define its loading, empty, pending, and rejected states, and all user-facing copy SHALL be Spanish (es-AR) sourced from the copy module.

The checkbox list SHALL be grouped in a fieldset with a legend, and every checkbox SHALL carry a real label association. While a submission is in flight the whole group SHALL be disabled, not merely the submit control: React resets uncontrolled forms when the action resolves, so a toggle made mid-flight would be discarded with no explanation. On rejection the editor SHALL re-render the selection that was **submitted**, not the selection that is stored, and focus SHALL move to the error summary — with up to fifty controls, an error rendered above the fold while the submit control sits below it is an error the owner never sees.

#### Scenario: Submission in flight
- **WHEN** a save is pending
- **THEN** the submit control shows its pending label and the entire checkbox group is disabled

#### Scenario: Rejected submission preserves the attempted selection
- **WHEN** a submission is rejected
- **THEN** the checkboxes reflect what was submitted rather than what is stored
- **THEN** focus moves to the error summary and the offending service is identified inline

#### Scenario: Long service names
- **WHEN** the editor renders at a 360px viewport with 120-character service names
- **THEN** the labels wrap, no horizontal overflow occurs, and no control is pushed off screen

#### Scenario: Operable without client-side JavaScript
- **WHEN** the editor is submitted before hydration
- **THEN** the selection is saved by the server action

### Requirement: Infrastructure failure during a submit preserves the owner's selection
A database timeout, connection failure, or unexpected error raised while performing the write — that is, after the session owner has been resolved — SHALL be caught inside the action and returned as form state carrying a generic Spanish message. It MUST NOT propagate to the error boundary, which would discard the selection. The response MUST NOT contain stack traces, connection strings, SQL, or English technical text.

Because a timed-out write may nevertheless have committed, the message SHALL direct the owner to check the current state before retrying. A retry itself is safe: additions are absorbed as already-present, removals of absent rows are no-ops, and the diff is recomputed against fresh state.

#### Scenario: The write fails after the owner is resolved
- **WHEN** the session resolves normally but the assignment write fails
- **THEN** the editor re-renders in place with the generic Spanish message and the submitted selection intact

#### Scenario: A committed-but-timed-out write is retried
- **WHEN** the write commits, the response times out, and the owner submits the same selection again
- **THEN** the stored set matches the selection and no row was needlessly removed and recreated

#### Scenario: No internal detail in the response
- **WHEN** any failure path renders
- **THEN** the response body contains no stack trace, connection string, table or column name, or constraint name
