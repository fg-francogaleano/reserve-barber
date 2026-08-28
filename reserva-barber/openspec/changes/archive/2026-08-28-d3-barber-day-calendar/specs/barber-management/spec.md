## ADDED Requirements

### Requirement: The barbers list routes to each barber's calendar
Each entry in the barbers list SHALL offer a labelled route to that barber's day calendar, alongside the routes it already offers to the editor, the assignment editor, the schedule editor and the absences.

The barbers list is the card-per-barber surface the product's brief describes as the entry point to a barber's individual calendar. The route SHALL be added here rather than on a second card grid elsewhere in the dashboard, so that one list remains the single place a barber is opened from.

The route SHALL cost the list no additional query: it is composed from the barber id the entry already carries.

Its accessible name SHALL identify which barber it belongs to, as every other route on the entry does.

#### Scenario: The calendar route renders for every barber
- **WHEN** the barbers list renders
- **THEN** each entry offers a route to that barber's calendar

#### Scenario: The accessible name identifies the barber
- **WHEN** the calendar route renders
- **THEN** its accessible name identifies which barber it belongs to

#### Scenario: The list's query count is unchanged
- **WHEN** the barbers list renders with the calendar route present
- **THEN** it issues the same number of queries as it did before the route existed
