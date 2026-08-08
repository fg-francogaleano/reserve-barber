## ADDED Requirements

### Requirement: Locations page lists the owner's locations
The locations route (`/sucursales`, rendered by `app/(dashboard)/sucursales/page.tsx`, authenticated) SHALL render the locations belonging to the session owner, read from the PostgreSQL database at request time, displaying each location's `name` and, when present, its `address`. Because this is a management surface and M1 ships no way to deactivate a location, the list SHALL include inactive locations as well — filtering them out would make a location invisible and therefore uneditable. The read path MUST traverse the layered architecture: Server Component → application service → repository interface → Prisma implementation, and the query MUST be scoped by the owner resolved from the session. The page MUST NOT query the database directly from the presentation layer.

The list moves off the dashboard home (`/`), which `docs/frontend-standards.md` reserves for the Inicio summary delivered by story D1. Until D1 lands, `/` continues to render its existing content so no route is left without a page. There is no public page at `/`: public content lives at `/b/[slug]` (B1) instead.

The route-level `loading.tsx` SHALL live alongside `app/(dashboard)/sucursales/page.tsx`, so the **Loading state** requirement keeps applying to the location list.

The **Error state without technical disclosure** requirement also keeps applying, but it is deliberately **not** bound to a particular boundary file. When the database is unreachable, session resolution in the dashboard layout fails before the page's own read ever runs, and an error thrown by a layout is caught by the boundary *above* it, never by a sibling `error.tsx`. What this requirement guarantees is the rendered outcome — the generic Spanish message with a retry control, and no redirect — not which file produced it.

#### Scenario: Owner's locations are rendered
- **WHEN** the authenticated owner opens `/sucursales` and owns 2 locations
- **THEN** the page displays both location names (and addresses when present) inside shadcn/ui Card components under a Spanish heading

#### Scenario: Inactive locations remain visible and editable
- **WHEN** one of the owner's locations has `isActive = false`
- **THEN** it is still listed and can still be opened for editing

#### Scenario: Another owner's locations are excluded
- **WHEN** the database contains locations belonging to a different owner
- **THEN** those locations are not rendered

#### Scenario: Location without address renders cleanly
- **WHEN** a location has no `address` value
- **THEN** its card renders the name without dangling separators or empty lines

#### Scenario: Deterministic order
- **WHEN** the list renders twice with unchanged data
- **THEN** the locations appear in the same order both times, sorted by name ascending

#### Scenario: Unauthenticated visitor cannot reach the list
- **WHEN** an unauthenticated visitor requests `/sucursales`
- **THEN** they are redirected to `/login` and no location names, addresses, or database-derived content appear in the response

#### Scenario: Loading state follows the page
- **WHEN** the locations page is slow to render
- **THEN** the skeleton placeholder cards render for that route

#### Scenario: A failed read renders the Spanish error state
- **WHEN** the database is unreachable while the owner opens the locations page
- **THEN** the generic Spanish message renders with a retry control, from whichever boundary catches the failure
- **THEN** the visitor is not redirected, and no stack trace, SQL, connection string, or constraint name appears in the response

## MODIFIED Requirements

### Requirement: Empty state
The page SHALL render a defined empty state when the query succeeds but returns no locations for the owner. The empty state MUST use neutral (non-error) styling and MUST present the create action, since it is the first screen a newly provisioned owner sees. The empty state and the error state MUST be visually distinct: a failed read MUST NOT be presented as "you have no locations", which would invite the owner to create duplicates once the database recovers.

#### Scenario: No locations exist
- **WHEN** the location query returns an empty list
- **THEN** the page displays a neutral Spanish empty state with an intact layout and a visible control to create a location

#### Scenario: Empty is distinguishable from failed
- **WHEN** the location query fails
- **THEN** the error state renders with a retry control, and the create action is not presented as the remedy

## REMOVED Requirements

### Requirement: Dashboard home page lists active locations from the database
**Reason**: The requirement's identity changed, not just its wording. It bound the location list to the dashboard home (`/`) and to a global `isActive = true` filter. Both premises are gone: `docs/frontend-standards.md` reserves `/` for the Inicio summary built in story D1, and a management surface must show inactive locations too or they become uneditable. Keeping the old title over the new behaviour would leave the spec describing a page that no longer exists.

**Migration**: Replaced by **Requirement: Locations page lists the owner's locations** in this same delta, which moves the list to `/sucursales`, scopes the query to the session owner, drops the active-only filter, and carries over the loading, error, copy-isolation, and responsive requirements unchanged. No data migration is involved; `/` keeps rendering its existing content until D1 replaces it.
