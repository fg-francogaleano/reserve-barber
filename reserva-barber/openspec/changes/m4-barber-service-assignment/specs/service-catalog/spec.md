## ADDED Requirements

### Requirement: A service that cannot be booked is presented as such
The services list SHALL present each service that is not bookable with an explicit Spanish marker and an explanation of what makes it bookable. A service is bookable only when all three of the following hold: the service is active, it has at least one assigned barber, and at least one of those barbers is active.

All three terms are load-bearing. Checking only the assignment would report a deactivated service as bookable once deactivation ships. Checking only activity would report a service nobody performs as bookable, which is the exact condition this story exists to make visible.

**Whether a barber's location must also be active is deliberately unresolved.** "Active barber" here means the barber's own flag; the branch the barber belongs to is not consulted, so a service performed only by barbers at a deactivated location is currently presented as bookable. That is an open product question, recorded in `docs/tech-debt.md` T23 — not a decision this requirement ratifies. The public booking flow must not treat the current behaviour as settled.

The marker MUST NOT be conveyed by colour alone, and MUST be part of the service's accessible description rather than decoration a screen reader skips.

#### Scenario: Service with no assigned barber
- **WHEN** the services list renders a service that no barber is assigned to
- **THEN** the service is marked as not bookable with an explanation of how to make it bookable

#### Scenario: Service assigned only to inactive barbers
- **WHEN** a service is assigned exclusively to barbers that are inactive
- **THEN** it is marked as not bookable

#### Scenario: Inactive service with an active assigned barber
- **WHEN** a service that has been deactivated is assigned to an active barber
- **THEN** it is not presented as bookable

#### Scenario: Bookable service carries no marker
- **WHEN** an active service is assigned to at least one active barber
- **THEN** no not-bookable marker is rendered for it

#### Scenario: The marker is perceivable without colour
- **WHEN** the marker renders
- **THEN** it carries text, and its meaning is available to assistive technology

### Requirement: The bookability state is derived, never stored
Bookability SHALL be computed at read time from the current assignments and activity flags. It MUST NOT be persisted as a column on the service.

A stored flag would require invalidation on four distinct events — assignment, unassignment, barber deactivation, and service deactivation — and would be wrong the first time one of them was missed, with the error presenting as a confident claim about revenue-bearing state. The derived read is a single indexed aggregate over a set bounded by the per-owner service cap.

#### Scenario: No bookability column exists
- **WHEN** the schema is reviewed after this change
- **THEN** the service entity carries no persisted bookability field

#### Scenario: The state reflects an assignment made elsewhere
- **WHEN** a barber is assigned to a previously unassigned service and the services list is opened
- **THEN** the service is no longer marked as not bookable, without any manual refresh
