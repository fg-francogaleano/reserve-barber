## ADDED Requirements

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
