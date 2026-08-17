## MODIFIED Requirements

### Requirement: The selection travels in the query string and every id is verified against the resolved shop
The selection SHALL be carried as `?local=`, `?servicio=`, `?barbero=`, `?fecha=` and `?hora=`, so that back, forward, reload and a shared link all restore the same step.

Each value is supplied entirely by a stranger. Each SHALL be bounded by length **before** any query, and SHALL then be verified to belong to the resolved shop **and** to be consistent with the rest of the selection: the service bookable at the given location, the barber active at that location and performing that service, the date a real calendar date inside the booking horizon, and the time a member of the list of starts generated for that date.

`?fecha` and `?hora` are not identifiers and are not looked up. A date is validated as a canonical calendar date within bounds; a time is only ever matched against the generated list. Neither is ever parsed into a value that is then trusted.

A value that fails any check MUST NOT be rendered, MUST NOT be used to select a substitute, and MUST NOT reach a query that is not owner-scoped.

#### Scenario: An id belonging to a different barbershop
- **WHEN** a request carries a valid service id owned by another barbershop
- **THEN** no field of that service is rendered and no data belonging to the other shop appears in the response

#### Scenario: An inconsistent triple
- **WHEN** the location, service and barber are each valid for the shop but the barber does not work at the given location
- **THEN** the barber selection is discarded and the barber step renders

#### Scenario: A time that is not on offer
- **WHEN** a request carries an `hora` that is not among the starts generated for the given `fecha`
- **THEN** it is discarded and the slot step renders

#### Scenario: An overlong parameter
- **WHEN** a parameter carries several thousand characters
- **THEN** it is rejected before any query is issued

#### Scenario: A repeated or array-valued parameter
- **WHEN** the same parameter appears more than once in the query string
- **THEN** the request is resolved deterministically and no driver error reaches the response

### Requirement: A selection that no longer resolves falls back to the last valid step
When a parameter is discarded, the request SHALL render the step that parameter belongs to, **preserving every upstream selection that is still valid**, and SHALL disclose in Spanish that the previous choice is no longer available. It SHALL NOT produce a 404 and SHALL NOT silently substitute another option.

Changing an upstream selection SHALL discard every downstream one. Carrying a service from a branch the client just changed produces an inconsistent triple that would have to be caught later anyway. The date and the time are downstream of the barber, so changing the branch, the service or the barber discards them too.

The links shared on WhatsApp outlive the catalogue they were built from, and they outlive the calendar even faster: a date that was in range last week may be in the past today, and a time that was free an hour ago may be taken. A stale link is the normal case, not the exception, and 404ing the whole page for a barber who was deactivated last week discards a branch and a service choice that are both still correct.

#### Scenario: The chosen barber was deactivated after the link was shared
- **WHEN** a link carrying a valid location, service and barber is opened after that barber is deactivated
- **THEN** the location and service selections are preserved, the barber step renders with the remaining barbers, and a Spanish notice states the previous choice is unavailable
- **THEN** the response is not a 404

#### Scenario: A date that has since passed
- **WHEN** a link carrying a date now in the past is opened
- **THEN** the location, service and barber selections are preserved, the date step renders, and a Spanish notice states the date is no longer available
- **THEN** the response is not a 404

#### Scenario: A time taken between sharing and opening
- **WHEN** a link carrying a start that another client has since booked is opened
- **THEN** the slot step renders with the remaining starts and a Spanish notice, and no other start is selected on the client's behalf

#### Scenario: The branch is changed
- **WHEN** the client returns to the branch step and selects a different location
- **THEN** the service, barber, date and time selections are discarded rather than carried forward

#### Scenario: The whole shop stops being bookable mid-flow
- **WHEN** every location is deactivated while the client is on the barber step
- **THEN** the next navigation renders the designed empty state rather than an operable list

### Requirement: The catalogue is one composed read with an explicit projection
The catalogue SHALL be obtained in a single database round trip per request, built with an explicit `select`. It SHALL NOT return persisted rows.

The projection SHALL carry only what the flow renders or hands to the availability step: for a location its id, name and address; for a service its id, name, description, price and duration; for a barber its id, display name, bio and avatar URL. No `ownerId`, no timestamps, and **no `isActive`** — that flag has already been applied as a filter, and returning it tells a stranger the shop has deactivated rows.

Four sequential round trips is the shape T47 warns about on the busiest public route, against a transaction-mode pooler shared with the owner's dashboard.

`durationMinutes` is included because slot generation sizes appointments by it and would otherwise re-issue this whole query.

**The availability read is a second composed read, not an extension of this one.** On the steps that need it, the request costs exactly one round trip more: the catalogue, then the barber's windows, absences and blocking bookings together. A step that does not need availability SHALL NOT issue that second read.

#### Scenario: The read is a projection
- **WHEN** the catalogue read executes
- **THEN** it issues explicit column selections rather than reading whole records

#### Scenario: One round trip
- **WHEN** a request renders any step
- **THEN** the catalogue is obtained in a single database round trip

#### Scenario: Availability costs exactly one more round trip
- **WHEN** a request renders the date or the slot step
- **THEN** it issues the catalogue read and one further read, and no more

#### Scenario: The earlier steps do not pay for availability
- **WHEN** a request renders the branch, service or barber step
- **THEN** no availability read is issued

#### Scenario: Excluded columns stay excluded
- **WHEN** the response is inspected
- **THEN** no owner identifier, timestamp or activity flag appears

### Requirement: Navigation in the public flow does not prefetch
Every link in the booking flow, and the profile page's call to action, SHALL disable router prefetching. The setting SHALL live in a single shared component rather than being repeated at each call site.

**Measured in the browser, not anticipated.** The router prefetches the RSC payload of each link that enters the viewport, and on this route that payload is a full catalogue read — so the branch step issued one extra server request *per branch* before the client touched anything, and a service step at the per-owner cap of fifty would issue fifty. The client picks exactly one option per step, so every other prefetch is work discarded, on the one route with neither a cache nor a rate limit and a pool shared with the owner's dashboard.

**The slot step raises the stakes rather than changing the rule.** Its payload is a catalogue read *and* an availability computation, and on a five-minute grid it can render on the order of a hundred links on one screen. Every link the date step and the slot step render therefore goes through the same shared component.

The cost is accepted and named: a tap waits for the navigation rather than finding it warmed. The per-option pending state covers that wait.

One component holds the decision because a setting repeated at six call sites is one that gets re-enabled at five of them without anyone noticing.

#### Scenario: The branch step is rendered
- **WHEN** a client opens the branch step for a shop with several branches
- **THEN** exactly one request is issued, and no prefetch request is made for any branch

#### Scenario: The slot step is rendered
- **WHEN** a client opens a slot step carrying a hundred starts
- **THEN** exactly one request is issued, and no prefetch request is made for any start

#### Scenario: A step is chosen
- **WHEN** the client selects an option
- **THEN** exactly one further request is issued

#### Scenario: The setting has one home
- **WHEN** the flow's navigation is reviewed
- **THEN** prefetching is disabled in a single shared component that every public-flow link uses

## ADDED Requirements

### Requirement: The flow is five steps and its progress is computed, never counted by hand

The flow SHALL be branch, service, barber, date, time. The step indicator and the selection summary SHALL derive the total and the current position from the flow definition rather than from a literal, so that B2's single-offerable-branch skip continues to produce a correct indicator without a second rule.

Every step SHALL keep the explicit back control and the persistent summary of what is already selected, and the summary SHALL name the chosen date and time once they exist.

#### Scenario: Five steps with a branch choice
- **WHEN** a shop with two offerable branches renders any step
- **THEN** the indicator reports five steps and marks the current one programmatically

#### Scenario: Four steps when the branch is implied
- **WHEN** a shop with exactly one offerable branch renders any step
- **THEN** the indicator reports four steps, and the branch is named in the summary and remains changeable

#### Scenario: The summary carries the whole selection
- **WHEN** the slot step renders with a branch, service, barber and date chosen
- **THEN** all four appear in the summary in es-AR

### Requirement: A completed selection ends in a disclosed, inert confirmation

When a valid time is selected the flow SHALL render a summary of the complete selection with a **non-actionable** call to action and a Spanish disclosure that booking cannot be completed yet. It MUST NOT link to a route that does not exist, and MUST NOT link to any dashboard route.

B1 shipped "Reservar" inert with a disclosure when `/b/{slug}` did not exist, and B2 inherited that answer. Linking a client into a route that redirects to `/login` is worse than saying so on the page they are already on.

The step SHALL NOT read `PaymentConfig`, so the accepted consequence B2 named stands unchanged: a client can complete every step at a shop whose owner never configured a deposit.

#### Scenario: The selection is complete
- **WHEN** a client selects a valid start time
- **THEN** the complete selection renders with a Spanish disclosure and no operable control that leads anywhere

#### Scenario: No payment configuration is read
- **WHEN** the completed step renders
- **THEN** no `PaymentConfig` row is read and no credential cipher is constructed
