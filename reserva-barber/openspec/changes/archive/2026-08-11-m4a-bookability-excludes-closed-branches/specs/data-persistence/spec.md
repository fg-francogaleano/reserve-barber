## MODIFIED Requirements

### Requirement: Assignment queries are indexed and free of N+1
The per-barber assigned-service count and the per-service active-barber count SHALL each be obtained with a single aggregate query per list page for the whole owner, joined in memory. Counting per rendered row is forbidden. Both result sets are bounded by the existing per-owner service cap and per-location barber cap.

The per-service count SHALL exclude barbers who are inactive **and** barbers whose location is inactive. Both exclusions belong in the aggregate rather than at the caller: a filter each caller applies for itself is a filter two callers will eventually disagree about, and the count is consumed as a bookability signal whose meaning must not vary by page. Adding the location term costs no extra query — it extends the existing relation filter, which already traverses `barber.location` to scope by owner.

#### Scenario: The barbers list issues one aggregate
- **WHEN** the barbers list renders with many barbers
- **THEN** the assigned-service counts are obtained by a single aggregate query, not one per barber

#### Scenario: The services list issues one aggregate
- **WHEN** the services list renders with many services
- **THEN** the active-barber counts are obtained by a single aggregate query, not one per service

#### Scenario: The per-service count excludes barbers at closed branches
- **WHEN** a service is assigned to an active barber whose location is inactive
- **THEN** that barber does not contribute to the service's active-barber count

#### Scenario: The location filter adds no query
- **WHEN** the services list renders after this change
- **THEN** the active-barber counts are still obtained by exactly one aggregate query
