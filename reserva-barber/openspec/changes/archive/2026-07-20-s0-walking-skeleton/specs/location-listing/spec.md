## ADDED Requirements

### Requirement: Public home page lists active locations from the database
The home page SHALL render the list of active locations (`isActive = true`) read from the PostgreSQL database at request time, displaying each location's `name` and, when present, its `address`. The read path MUST traverse the layered architecture: Server Component → application service (`LocationService.listActiveLocations()`) → repository interface (`ILocationRepository.findAllActive()`) → Prisma implementation. The page MUST NOT query the database directly from the presentation layer.

#### Scenario: Seeded locations are rendered
- **WHEN** a visitor requests the home page and the database contains 2 active seeded locations
- **THEN** the page displays both location names (and addresses when present) inside shadcn/ui Card components under the Spanish heading "Nuestras sucursales"

#### Scenario: Inactive locations are excluded
- **WHEN** the database contains locations with `isActive = false`
- **THEN** those locations are not rendered on the page

#### Scenario: Location without address renders cleanly
- **WHEN** an active location has no `address` value
- **THEN** its card renders the name without dangling separators or empty lines

### Requirement: Empty state
The page SHALL render a defined empty state when the query succeeds but returns no active locations. The empty state MUST use neutral (non-error) styling.

#### Scenario: No active locations exist
- **WHEN** the location query returns an empty list
- **THEN** the page displays "Todavía no hay sucursales cargadas." with neutral styling and an intact layout

### Requirement: Loading state
The page SHALL provide a route-level loading UI (`loading.tsx`) showing a skeleton of 2–3 placeholder cards matching the card layout, so a slow database (e.g., paused Supabase project waking up) never leaves a blank page.

#### Scenario: Slow database response
- **WHEN** the database takes multiple seconds to respond
- **THEN** the visitor sees the skeleton placeholder cards until content or an error renders

### Requirement: Error state without technical disclosure
The page SHALL provide a route-level error boundary (`error.tsx`) rendering the Spanish message "No pudimos cargar las sucursales. Intentá de nuevo más tarde." with a retry affordance. The response body MUST NOT contain stack traces, connection strings, English technical text, or any other internal detail, regardless of the failure cause (connection refused, timeout, missing table).

#### Scenario: Database is unreachable
- **WHEN** the database is paused or refusing connections
- **THEN** the error boundary renders the generic Spanish message with a retry control, and no stack trace or connection string appears in the response
- **THEN** a structured English JSON error log entry is emitted with the failure cause

#### Scenario: Table does not exist
- **WHEN** the database is reachable but the `Location` table is missing (migration not applied)
- **THEN** the error state is rendered (not the empty state)

### Requirement: Bounded response time on failure
The database read SHALL be subject to an explicit connection/query timeout so that a hung connection degrades into the error state within a bounded time instead of hanging the Worker indefinitely.

#### Scenario: Hung database connection
- **WHEN** the database accepts the TCP connection but never responds to the query
- **THEN** the request completes within the configured timeout and renders the error state

### Requirement: User-facing copy is Spanish and isolated
All user-facing strings for this page (heading, empty state, error message) SHALL be in Spanish (es-AR) and SHALL live in a dedicated copy constants module, not inline in component logic. All identifiers, comments, and log messages SHALL be in English.

#### Scenario: Copy module review
- **WHEN** the page components are reviewed
- **THEN** every Spanish string is imported from the copy constants module and no Spanish text appears in logs or error objects

### Requirement: Responsive rendering
The location list SHALL render correctly at mobile viewport widths and SHALL tolerate a location name at the schema maximum (120 characters) without layout overflow.

#### Scenario: Mobile viewport
- **WHEN** the page renders at a small (mobile) viewport
- **THEN** the cards lay out without horizontal overflow

#### Scenario: Maximum-length name
- **WHEN** a location name of 120 characters is rendered
- **THEN** the card wraps or truncates the text without breaking the layout
