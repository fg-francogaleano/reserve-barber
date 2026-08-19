## ADDED Requirements

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
