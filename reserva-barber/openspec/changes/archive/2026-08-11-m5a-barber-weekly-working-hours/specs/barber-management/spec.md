## ADDED Requirements

### Requirement: The barbers list shows whether a barber has a schedule and routes to the editor
Each entry in the barbers list SHALL indicate whether the barber has a working schedule, and SHALL offer a labelled route to that barber's schedule editor.

A barber with no schedule cannot be booked at any time, which makes it the same class of fact as having no assigned services: invisible unless surfaced, and expensive to discover only from the public booking flow. The indicator SHALL therefore be present for every barber rather than shown only in the negative case.

"No schedule yet" and "configured to work no days" are the same stored state and the product does not distinguish them; the copy SHALL be true of both.

The indicator SHALL be obtained from a single aggregate for the whole list rather than one query per barber.

#### Scenario: A barber with no schedule
- **WHEN** the barbers list renders a barber with no working windows
- **THEN** the entry indicates that no schedule is configured

#### Scenario: A barber with a schedule
- **WHEN** the barbers list renders a barber with at least one working window
- **THEN** the entry indicates that a schedule exists

#### Scenario: The route into the editor identifies its barber
- **WHEN** the barbers list renders
- **THEN** each entry offers a route to its schedule editor whose accessible name identifies which barber it belongs to

#### Scenario: A barber who works no days reads the same as one never configured
- **WHEN** a barber's schedule is saved with every day empty
- **THEN** the list shows the same indication as for a barber whose schedule was never set
