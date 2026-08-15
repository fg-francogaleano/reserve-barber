## MODIFIED Requirements

### Requirement: Dashboard is guarded at three layers
Every route in the `(dashboard)` group and every server action SHALL require a valid owner session, enforced at three layers: (1) `middleware.ts` redirects unauthenticated requests to `/login`; (2) the dashboard layout re-validates the session server-side; (3) every server action resolves the owner through a single `requireOwner()` helper before executing. Middleware alone MUST NOT be the security boundary. A session whose `authUserId` has no matching `Owner` row SHALL be treated as unauthenticated.

The guard is deny-by-default: it permits an explicitly named set of paths and protects everything else, so a route added tomorrow is protected the moment it exists rather than when someone remembers to list it. That set now holds two entries — the login route and the public profile namespace `/b/**`.

**The public exception SHALL be an exact-segment prefix test**: the path is either exactly `/b` or begins with `/b/`. A bare `startsWith('/b')` SHALL NOT be used. It would admit `/barberos`, `/barberos/{id}/horarios`, `/barberos/{id}/ausencias` and `/barberos/{id}/servicios` — every barber, schedule and absence in the business, readable by anyone — and it would do so with no visible symptom, since the pages would simply render. This is the one defect in this file that cannot be caught by opening a browser, so it SHALL be asserted by test.

Opening a path in the guard SHALL NOT be taken as opening it in layers two and three. `/b/**` is served by its own route tree outside the `(dashboard)` group, and no dashboard page, layout or server action becomes reachable through it.

#### Scenario: Direct URL access without session
- **WHEN** an unauthenticated visitor opens a protected dashboard URL directly
- **THEN** they are redirected to `/login` and no protected data is rendered or fetched

#### Scenario: A dashboard route sharing the public namespace's first letter
- **WHEN** an unauthenticated request opens `/barberos`, or any path beneath it, after the public namespace has been opened
- **THEN** it is still redirected to `/login` carrying its `next` parameter, and no barber data is rendered or fetched

#### Scenario: The public namespace is reachable without a session
- **WHEN** an unauthenticated request opens `/b/{slug}`
- **THEN** the guard permits it and no redirect to `/login` occurs

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

### Requirement: A path that cannot be percent-decoded is refused before the router
The guard SHALL answer **404** to any request whose pathname cannot be percent-decoded, before applying any other rule — including the Server Action exemption. Legitimately encoded paths SHALL be unaffected.

Measured on the deployment runtime: `/b/barberia%` returned **500**. The application decodes defensively and answers not-found, but Next.js decodes the path again inside its own stack and raises where nothing catches it. The middleware is the only layer that runs earlier, so this is the only place the refusal can happen.

A stray `%` is not a link anyone was given; it is someone probing. On a route now reachable without a session, a one-character way to turn a request into a 500 is a cheap source of error-rate noise, and 404 is both the correct answer and the cheaper one.

#### Scenario: A malformed percent sequence
- **WHEN** a request arrives for `/b/barberia%` or `/%zz`
- **THEN** the response is 404 and no 500 is produced

#### Scenario: A legitimately encoded path still resolves
- **WHEN** a request arrives for `/b/barber%C3%ADa-don-juan`
- **THEN** the guard permits it, so accented business names keep working
