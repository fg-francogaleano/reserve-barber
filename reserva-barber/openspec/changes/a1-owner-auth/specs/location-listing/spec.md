## MODIFIED Requirements

### Requirement: Dashboard home page lists active locations from the database
The home route (`/`, rendered by `app/(dashboard)/page.tsx`, authenticated) SHALL render the list of active locations (`isActive = true`) read from the PostgreSQL database at request time, displaying each location's `name` and, when present, its `address`. The read path MUST traverse the layered architecture: Server Component → application service (`LocationService.listActiveLocations()`) → repository interface (`ILocationRepository.findAllActive()`) → Prisma implementation. The page MUST NOT query the database directly from the presentation layer. There is no public page at `/`: S0's public version is removed, since `docs/frontend-standards.md`'s route table reserves `/` for the dashboard home and public content lives at `/b/[slug]` (B1) instead.

The route-level `loading.tsx` and `error.tsx` SHALL move into the `(dashboard)` route group together with the page, so the **Loading state** and **Error state without technical disclosure** requirements keep applying to the location list.

#### Scenario: Seeded locations are rendered
- **WHEN** the authenticated owner opens the dashboard home and the database contains 2 active seeded locations
- **THEN** the page displays both location names (and addresses when present) inside shadcn/ui Card components under the Spanish heading "Nuestras sucursales"

#### Scenario: Inactive locations are excluded
- **WHEN** the database contains locations with `isActive = false`
- **THEN** those locations are not rendered on the page

#### Scenario: Location without address renders cleanly
- **WHEN** an active location has no `address` value
- **THEN** its card renders the name without dangling separators or empty lines

#### Scenario: Unauthenticated visitor cannot reach the list
- **WHEN** an unauthenticated visitor requests `/`
- **THEN** they are redirected to `/login` and no location names, addresses, or database-derived content appear in the response

#### Scenario: Loading and error boundaries follow the page
- **WHEN** the dashboard home is slow or its database read fails
- **THEN** the skeleton placeholder cards and the Spanish error boundary render for the dashboard home
