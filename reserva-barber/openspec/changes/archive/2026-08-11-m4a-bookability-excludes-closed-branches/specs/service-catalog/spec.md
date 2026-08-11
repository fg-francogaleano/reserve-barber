## MODIFIED Requirements

### Requirement: A service that cannot be booked is presented as such
The services list SHALL present each service that is not bookable with an explicit Spanish marker and an explanation of what makes it bookable. A service is bookable only when all four of the following hold: the service is active, it has at least one assigned barber, at least one of those barbers is active, and that barber works at an **active location**.

All four terms are load-bearing. Checking only the assignment would report a deactivated service as bookable once deactivation ships. Checking only activity would report a service nobody performs as bookable, which is the exact condition this story exists to make visible. Omitting the location would report a service as bookable when every barber who performs it works at a closed branch — and the public booking flow selects a location **first**, so no client could ever reach that service.

The location term is now **normative**, replacing the provisional wording M4 shipped. The question it left open — whether a closed branch suppresses bookability — is answered yes: deactivating a branch means nothing behind it can be booked, and a dashboard that claimed otherwise would assert revenue that cannot be earned.

**A separate question remains open and this requirement does not settle it:** bookability is presented as a single global fact per service, while the location-first booking flow makes the honest unit the **(service, location) pair**. A service with active barbers at one branch and none at another is bookable at the first and not the second, and the marker currently reports only "bookable". Recorded in `docs/tech-debt.md` T23 with B2 as its trigger.

The marker MUST NOT be conveyed by colour alone, and MUST be part of the service's accessible description rather than decoration a screen reader skips.

#### Scenario: Service with no assigned barber
- **WHEN** the services list renders a service that no barber is assigned to
- **THEN** the service is marked as not bookable with an explanation of how to make it bookable

#### Scenario: Service assigned only to inactive barbers
- **WHEN** a service is assigned exclusively to barbers that are inactive
- **THEN** it is marked as not bookable

#### Scenario: Service assigned only to barbers at a deactivated branch
- **WHEN** a service is assigned exclusively to active barbers whose location is inactive
- **THEN** it is marked as not bookable

#### Scenario: Inactive service with an active assigned barber
- **WHEN** a service that has been deactivated is assigned to an active barber
- **THEN** it is not presented as bookable

#### Scenario: Bookable service carries no marker
- **WHEN** an active service is assigned to at least one active barber at an active location
- **THEN** no not-bookable marker is rendered for it

#### Scenario: One open branch is enough
- **WHEN** a service is assigned to two active barbers, one at a closed branch and one at an open branch
- **THEN** it is not marked as not bookable

#### Scenario: The marker is perceivable without colour
- **WHEN** the marker renders
- **THEN** it carries text, and its meaning is available to assistive technology
