## MODIFIED Requirements

### Requirement: Owner lookup failures degrade gracefully
A database failure (including a timeout) while resolving the domain `Owner` — during login, after a successful auth-provider sign-in, or during session resolution (`requireOwner`) — SHALL NOT propagate as an unhandled exception to the user. Login SHALL return the generic infrastructure error. Both paths SHALL emit a structured English error log.

Session resolution SHALL distinguish **an answer** from **the absence of an answer**:

- The lookup completed and reported no matching `Owner` — this is an authentication outcome. The request SHALL be treated as unauthenticated and redirected to `/login`.
- The lookup could not be performed at all (connection refused, timeout, driver error) — this is an infrastructure failure, not a statement about the visitor's identity. It MUST NOT be treated as unauthenticated. The failure SHALL surface to the route's error boundary so the generic Spanish message and its retry control render.

Collapsing the second case into the first produces an **infinite redirect loop**, because the two guards consult different systems: `requireOwner()` reads the database and concludes "not authenticated", while the middleware reads only Supabase Auth, still sees a valid session, and bounces the visitor off `/login` back into the dashboard. Each guard sends the visitor to the other's territory and the browser gives up with a redirect-limit error page — in English, with no explanation and no way forward. This is not a hypothetical outage profile: the Supabase free tier pauses PostgreSQL while Auth keeps serving, which is exactly the shape that triggers it.

The distinction is deliberately asymmetric in the safe direction: an infrastructure failure never grants access, it only changes how the failure is reported.

For that failure to be *presentable*, a boundary must exist above the dashboard layout. A route group's own `error.tsx` wraps the children of its layout, not the layout itself, and session resolution runs **in** the layout — so the application SHALL provide a root-level error boundary rendering generic Spanish copy with a retry control. Without it the failure reaches Next.js's built-in English error page.

#### Scenario: Root boundary catches a failure thrown by the dashboard layout
- **WHEN** session resolution throws inside `app/(dashboard)/layout.tsx`
- **THEN** the root error boundary renders the generic Spanish message and a retry control, not Next.js's built-in English page

#### Scenario: Owner lookup times out during login
- **WHEN** Supabase authenticates the credentials successfully but the subsequent `Owner` lookup times out
- **THEN** the login action returns "No pudimos iniciar sesión. Intentá de nuevo más tarde." instead of a raw server error, and a structured English error log is emitted

#### Scenario: Owner lookup fails during session resolution
- **WHEN** `requireOwner()` resolves a valid Supabase session but the `Owner` lookup throws
- **THEN** the request is NOT redirected to `/login`
- **THEN** the failure reaches the route error boundary, which renders the generic Spanish message with a retry control
- **THEN** a structured English error log is emitted and no stack trace, connection string, or driver text appears in the response

#### Scenario: Database outage does not trap the owner in a redirect loop
- **WHEN** the database is unreachable while the Supabase Auth session is still valid, and the owner opens any dashboard route
- **THEN** the response is a rendered error state, not a redirect
- **THEN** the browser never reaches its redirect limit and the owner is never shown a browser-generated error page

#### Scenario: Session without a domain owner still denies access
- **WHEN** the `Owner` lookup completes successfully and returns no row for the session's `authUserId`
- **THEN** access is still denied as unauthenticated and the request is redirected to `/login`
- **THEN** the infrastructure-failure path has not widened the set of sessions that are granted access
