## MODIFIED Requirements

### Requirement: Dashboard is guarded at three layers
Every route in the `(dashboard)` group and every server action SHALL require a valid owner session, enforced at three layers: (1) `middleware.ts` redirects unauthenticated requests to `/login`; (2) the dashboard layout re-validates the session server-side; (3) every server action resolves the owner through a single `requireOwner()` helper before executing. Middleware alone MUST NOT be the security boundary. A session whose `authUserId` has no matching `Owner` row SHALL be treated as unauthenticated.

The guard is deny-by-default: it permits an explicitly named set of paths and protects everything else, so a route added tomorrow is protected the moment it exists rather than when someone remembers to list it. That set now holds three entries — the login route, the public profile namespace `/b/**`, and the public booking write `/api/bookings`.

**The public profile exception SHALL be an exact-segment prefix test**: the path is either exactly `/b` or begins with `/b/`. A bare `startsWith('/b')` SHALL NOT be used. It would admit `/barberos`, `/barberos/{id}/horarios`, `/barberos/{id}/ausencias` and `/barberos/{id}/servicios` — every barber, schedule and absence in the business, readable by anyone — and it would do so with no visible symptom, since the pages would simply render. This is the one defect in this file that cannot be caught by opening a browser, so it SHALL be asserted by test.

**The booking-write exception SHALL be an exact path match**, not a prefix. `/api` is not opened; one endpoint beneath it is. A prefix test would admit every future API route the moment it is created, which is precisely the failure mode deny-by-default exists to prevent, and the dashboard's own future endpoints live under the same root.

Opening a path in the guard SHALL NOT be taken as opening it in layers two and three. `/b/**` is served by its own route tree outside the `(dashboard)` group, the booking write authenticates nobody and authorizes nothing by session, and no dashboard page, layout or server action becomes reachable through either.

Both public exceptions SHALL be asserted by test. Neither is observable to the owner in normal use: the profile exception fails silently open, and the booking exception fails silently closed — an owner browsing their own shop while logged in would never see the guest's `307` to `/login`.

#### Scenario: Direct URL access without session
- **WHEN** an unauthenticated visitor opens a protected dashboard URL directly
- **THEN** they are redirected to `/login` and no protected data is rendered or fetched

#### Scenario: A dashboard route sharing the public namespace's first letter
- **WHEN** an unauthenticated request opens `/barberos`, or any path beneath it, after the public namespace has been opened
- **THEN** it is still redirected to `/login` carrying its `next` parameter, and no barber data is rendered or fetched

#### Scenario: The public namespace is reachable without a session
- **WHEN** an unauthenticated request opens `/b/{slug}`
- **THEN** the guard permits it and no redirect to `/login` occurs

#### Scenario: The booking write is reachable without a session
- **WHEN** an unauthenticated request posts to `/api/bookings`
- **THEN** the guard permits it and no redirect to `/login` occurs

#### Scenario: Opening the booking write does not open the API root
- **WHEN** an unauthenticated request opens `/api`, `/api/bookings/anything`, or any other path beneath `/api`
- **THEN** it is redirected to `/login`

#### Scenario: An authenticated owner in the public namespace
- **WHEN** an owner with a valid session opens `/b/{slug}`
- **THEN** the guard permits it and does not redirect them to the dashboard

#### Scenario: Server action with expired session
- **WHEN** a server action is invoked after the session has expired
- **THEN** the mutation does not execute and the caller is redirected to `/login` without a raw 500 or internal detail

#### Scenario: Authenticated visitor opens login
- **WHEN** an owner with a valid session navigates to `/login`
- **THEN** they are redirected to the dashboard home

#### Scenario: Session without domain owner
- **WHEN** a session's `authUserId` matches no `Owner` row
- **THEN** access is denied as unauthenticated and a structured English error log records the mismatch
