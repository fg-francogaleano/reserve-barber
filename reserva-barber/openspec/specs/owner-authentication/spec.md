# owner-authentication Specification

## Purpose

Owner login/logout with Supabase Auth cookie sessions; middleware plus server-side guarding of every dashboard route and server action; anti-enumeration, throttling, session-invalidation and redirect-safety requirements; Spanish (es-AR) UI states for the login flow.
## Requirements
### Requirement: Owner login with credentials
The system SHALL allow the owner to log in at `/login` with email and password, authenticated against Supabase Auth (email/password provider, sign-ups disabled). The login form SHALL be processed by a Server Action that validates input (trimmed, lowercased email; non-empty password) before calling the auth provider. On success the owner SHALL be redirected to the dashboard home.

#### Scenario: Successful login
- **WHEN** the owner submits their correct email and password
- **THEN** a session is established and they are redirected to the dashboard home

#### Scenario: Email is normalized
- **WHEN** the owner submits ` Owner@Example.com ` with the correct password
- **THEN** authentication succeeds as if `owner@example.com` had been submitted

### Requirement: Credential errors do not enable user enumeration
Failed logins SHALL return a single generic Spanish message — exactly `"Email o contraseña incorrectos."` — regardless of whether the email exists or the password is wrong. The response MUST NOT reveal which field failed, in the message, response shape, or observable timing. Infrastructure failures (auth provider unreachable, 5xx, timeout) SHALL return a distinct generic Spanish message — exactly `"No pudimos iniciar sesión. Intentá de nuevo más tarde."` — and MUST NOT expose provider error text.

To make the timing guarantee real rather than aspirational, every login SHALL be padded to a constant minimum duration that exceeds the slowest credential-checking path, so response time does not distinguish a registered address from an unregistered one.

#### Scenario: Unknown email and wrong password are indistinguishable
- **WHEN** a login is attempted with a non-existent email, and another with a real email but wrong password
- **THEN** both receive the identical generic message with no observable difference in response shape

#### Scenario: Timing does not distinguish the two failures
- **WHEN** the auth provider answers faster for an unregistered address than for a registered one with a wrong password
- **THEN** both logins still take the same total time, equal to the configured minimum duration

#### Scenario: Work that already exceeds the floor is not delayed further
- **WHEN** a login takes longer than the configured minimum duration
- **THEN** no additional padding is applied

#### Scenario: Auth provider outage
- **WHEN** Supabase Auth is unreachable or returns a server error
- **THEN** the visitor sees "No pudimos iniciar sesión. Intentá de nuevo más tarde.", a structured English error log is emitted, and no provider detail reaches the response

### Requirement: Bounded auth provider response
Every call to the auth provider SHALL be subject to an explicit timeout of **5 seconds** so a hung provider degrades into the generic infrastructure error within bounded time instead of hanging the Worker. Failed auth calls SHALL NOT be retried automatically; the owner retries by resubmitting the form.

#### Scenario: Auth provider hangs
- **WHEN** the auth provider accepts the connection but never responds
- **THEN** the request completes within the configured timeout, the generic Spanish infrastructure error is rendered, and one structured English error log is emitted

#### Scenario: No automatic retry
- **WHEN** an auth call fails with a server error or timeout
- **THEN** the action returns the infrastructure error without re-issuing the request

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

### Requirement: Response semantics without REST endpoints
This change SHALL NOT add REST endpoints; login and logout are Server Actions. A failed login SHALL return a `200` response carrying form-error state (never `401`), middleware redirects SHALL use `307`, and an unauthenticated server action SHALL redirect to `/login` rather than returning a `5xx`.

#### Scenario: Failed login is not an HTTP error
- **WHEN** invalid credentials are submitted
- **THEN** the response status is `200` and carries the generic error in form state

#### Scenario: Guard redirects use 307
- **WHEN** middleware redirects an unauthenticated request away from a protected route
- **THEN** the response status is `307` with a `Location` header pointing at `/login`

#### Scenario: Server Actions are never answered with a redirect
- **WHEN** a Server Action is invoked without a valid session
- **THEN** middleware lets the request reach the action rather than redirecting it, and the action's own `requireOwner()` performs the redirect, so the client receives a response it can follow instead of an unusable HTML page

### Requirement: Session in hardened cookies
The session SHALL be stored exclusively in cookies flagged `HttpOnly`, `Secure`, and `SameSite=Lax`, managed via `@supabase/ssr`. Session tokens MUST never be stored in `localStorage`, exposed to client-side JavaScript, or written to logs. Session refresh SHALL occur in middleware so that refreshed cookies are set before the response streams.

#### Scenario: Cookie flags
- **WHEN** the session cookie is set after login
- **THEN** it carries `HttpOnly`, `Secure`, and `SameSite=Lax` attributes

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

### Requirement: Safe post-login redirect
The login flow MAY carry a `next` parameter set by the middleware for deep links. Only same-origin relative paths (starting with `/`, not `//`) SHALL be honored; any other value SHALL fall back to the dashboard home.

#### Scenario: Deep link resumes after login
- **WHEN** an unauthenticated owner opens a protected path and then logs in
- **THEN** they land on the originally requested path

#### Scenario: External redirect target rejected
- **WHEN** the `next` parameter contains an absolute URL or protocol-relative path to another origin
- **THEN** the owner is redirected to the dashboard home instead

### Requirement: Logout fully invalidates the session
Logout SHALL invalidate the session server-side (Supabase `signOut`), clear the session cookies, and redirect to `/login`. A previously captured cookie value MUST NOT grant access after logout. Protected pages SHALL be rendered dynamically and non-cacheable so the browser Back button after logout does not display protected content.

Logout SHALL always end with the owner signed out and back at `/login`, even when the provider rejects the sign-out call. The provider answers `403 bad_jwt` once the access token has expired — the exact moment a logout is most likely — so that failure MUST be logged and tolerated, with the session cookies cleared locally, rather than surfacing as an error page.

#### Scenario: Provider rejects the sign-out call
- **WHEN** the access token has already expired and the provider rejects `signOut`
- **THEN** the session cookies are cleared anyway, the owner lands on `/login`, no error page is shown, and one structured English error log records the provider failure

#### Scenario: Cookie replay after logout
- **WHEN** the owner logs out and the previous cookie value is replayed
- **THEN** access to protected routes is denied

#### Scenario: Back button after logout
- **WHEN** the owner logs out and presses the browser Back button
- **THEN** no protected content is displayed from cache

### Requirement: Login attempt throttling
Repeated failed login attempts SHALL be rejected after **5 failed attempts for the same email + IP pair within a 15-minute window**, for a **60-second cooldown**, as defense-in-depth over the auth provider's own rate limits. A successful login SHALL reset the counter. Throttled attempts SHALL return the generic credential error (throttling MUST NOT be distinguishable from a wrong password, to avoid confirming that an email exists). Throttling events SHALL emit one structured English log entry that never contains the password.

Only **credential** failures SHALL count toward the threshold; infrastructure failures (provider unavailable, timeout) MUST NOT, so an outage never locks the owner out of their own dashboard.

The tracking store SHALL be bounded in size so that an attacker rotating email addresses cannot exhaust the isolate's memory. Records still serving an active cooldown MUST NOT be evicted to make room — otherwise a lockout could be flushed by spraying keys; when no evictable slot remains, the new key SHALL go untracked instead.

#### Scenario: Provider outage does not lock the owner out
- **WHEN** the auth provider is unavailable and login is attempted repeatedly with correct credentials
- **THEN** no attempt counts toward the throttle threshold and the owner is not placed in cooldown

#### Scenario: Key spraying cannot exhaust memory
- **WHEN** failed attempts arrive for far more distinct email addresses than the tracking cap
- **THEN** the number of tracked pairs stays at or below the cap

#### Scenario: An active cooldown survives key spraying
- **WHEN** an account is in cooldown and an attacker floods the tracker with distinct keys
- **THEN** that account remains in cooldown

#### Scenario: Burst of failures is throttled
- **WHEN** a 6th failed attempt arrives for the same email + IP within 15 minutes
- **THEN** it is rejected without calling the auth provider, the generic credential error is returned, and one structured English log entry records the throttling event

#### Scenario: Cooldown expires
- **WHEN** 60 seconds elapse after throttling began
- **THEN** authentication attempts are accepted again

#### Scenario: Successful login resets the counter
- **WHEN** the owner authenticates successfully after 4 failed attempts
- **THEN** the failure counter for that email + IP is cleared

### Requirement: Login UI states in Spanish
The login page SHALL present all user-facing text in Spanish (es-AR) from the copy constants module: idle form, submitting state (submit button disabled showing a loading indicator, double-submit prevented), credential error (`"Email o contraseña incorrectos."`), and infrastructure error (`"No pudimos iniciar sesión. Intentá de nuevo más tarde."`). Identifiers, comments, and logs remain in English.

Errors SHALL be presented **inline in an `aria-live="polite"` region directly below the form** — not as a toast or modal. After a failed attempt the inputs SHALL remain enabled with their values preserved (password cleared), and focus SHALL move to the error region so assistive technology announces it.

#### Scenario: Double submit prevented
- **WHEN** the owner activates submit twice in quick succession
- **THEN** only one authentication attempt is processed and the control is disabled while pending

#### Scenario: Error is announced and recoverable
- **WHEN** a login attempt fails
- **THEN** the message renders inline in the `aria-live` region, focus moves to it, the email value is preserved, the password is cleared, and the form is immediately usable again

### Requirement: Auth flow validated on the three-environment gate
Login, guarded navigation, and logout SHALL be verified in order on (1) `next dev`, (2) `npm run preview` (workerd), and (3) the deployed URL, per the S0 protocol. A failure on workerd blocks deploy; any workaround required SHALL be recorded in `docs/s0-versions-decision.md`.

#### Scenario: workerd cookie regression caught at preview
- **WHEN** session cookies work on `next dev` but are dropped on the workerd preview
- **THEN** the failure is caught at the preview gate before any deploy

### Requirement: The two public payment paths are named exactly, and neither is a prefix

The guard's deny-by-default public set SHALL gain exactly two entries: the payment initiation endpoint and the Mercado Pago notification endpoint. Both SHALL be matched by exact string equality, never by prefix and never by pattern.

Opening `/api` — or any path segment above these two — as a prefix would admit every endpoint created afterwards, including the dashboard's own, at the moment it exists. That is precisely the failure deny-by-default exists to prevent.

Because the match is exact, neither endpoint SHALL carry an identifier in its path. The booking is identified by a token in the request body and the notification by a query parameter, so both paths stay fixed strings the guard can compare.

Each entry SHALL be asserted by test, including negative cases for the parent segments and for a sibling path. Neither an owner's normal use of the dashboard nor a guest's normal use of the booking flow would reveal a missing or an over-broad entry.

Permitting these paths SHALL NOT be taken as permitting anything in the dashboard route group or any server action. Neither endpoint authenticates anybody or authorizes anything by session.

#### Scenario: The payment endpoint is reachable without a session
- **WHEN** an anonymous request posts to the payment initiation path
- **THEN** the guard permits it and no redirect to `/login` occurs

#### Scenario: The notification endpoint is reachable without a session
- **WHEN** an anonymous request posts to the Mercado Pago notification path
- **THEN** the guard permits it and no redirect to `/login` occurs

#### Scenario: The parent segments stay protected
- **WHEN** an anonymous request is made to `/api/payments`, `/api/webhooks`, or `/api`
- **THEN** each is redirected to `/login`

#### Scenario: A path beneath a permitted entry stays protected
- **WHEN** an anonymous request is made to a path extending either permitted entry with a further segment
- **THEN** it is redirected to `/login`

#### Scenario: An unrelated future endpoint is protected the moment it exists
- **WHEN** an anonymous request is made to any other `/api/*` path
- **THEN** it is redirected to `/login`

### Requirement: The public cancellation path is named exactly, and is not a prefix

The guard's deny-by-default public set SHALL gain exactly **one** entry: the client cancellation endpoint. It SHALL be matched by exact string equality, never by prefix and never by pattern.

Opening `/api/bookings` — or any path segment above this endpoint — as a prefix would admit every endpoint created beneath it afterwards, at the moment it exists. That is precisely the failure deny-by-default exists to prevent, and the public booking write already sits under that root as an exact entry rather than as the licence for one.

Because the match is exact, the endpoint SHALL carry **no identifier in its path**. The booking is identified by the cancellation token in the request body, so the path stays a fixed string the guard can compare.

The endpoint SHALL remain reachable with **no session**, and the surrounding namespace SHALL keep the response header policy the booking confirmation route already requires: a URL that contains a credential must not travel in a `Referer` header, including on the request the confirmation step's form submits.

#### Scenario: An anonymous client can reach the endpoint

- **WHEN** a request with no session submits a cancellation
- **THEN** the guard admits it rather than redirecting to the login page

#### Scenario: The entry does not admit its neighbours

- **WHEN** a request is made to another path beneath the same segment that is not itself listed
- **THEN** the guard protects it

#### Scenario: The credential does not leak in a header

- **WHEN** the confirmation step's form is submitted from the booking page
- **THEN** no `Referer` carrying the cancellation token accompanies the request

