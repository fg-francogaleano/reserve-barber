## ADDED Requirements

### Requirement: The public flow decrypts in exactly one named place

A surface that has no need to decrypt a stored credential SHALL construct no cipher, and the public booking flow SHALL keep exactly one surface that does: the composition root serving payment initiation.

The guarantee has changed shape twice and SHALL NOT be allowed to weaken further. It began as an absent dependency — the public flow wired no payment repository at all — and became a projection type with no field the token fits into once a payment gate had to be asked. Charging requires the plaintext, so it now becomes a single named composer, with the two earlier protections still standing around it: the booking write's composer SHALL still construct no cipher, and the public readiness projection SHALL still have no field capable of carrying the token.

An absent dependency protects until someone adds it; a type that cannot carry a value protects afterwards; a single named composer is what remains once the value must genuinely exist. Reviewing the blast radius SHALL be possible by listing the callers of the cipher interface.

#### Scenario: The booking write composer remains cipherless
- **WHEN** the booking creation composition root is constructed
- **THEN** it builds no cipher, and a token read attempted through it fails rather than returning plaintext

#### Scenario: The readiness projection remains incapable of carrying the token
- **WHEN** the public payment readiness type is inspected
- **THEN** it has no field whose type could hold an access token

#### Scenario: The decrypting surface is enumerable
- **WHEN** the callers of the cipher interface are listed
- **THEN** exactly one of them belongs to the public booking flow

### Requirement: A decrypted credential does not travel above the adapter that uses it

A decrypted credential SHALL be passed directly to the infrastructure adapter that authenticates with it and SHALL NOT be stored on, returned by, or passed through any application-layer or domain-layer type.

No log context, component prop, serialized response, redirect, cookie or error object SHALL have a field capable of holding it. Responses from the third party authenticated by it SHALL NOT be logged, because rejection payloads routinely echo the credential they rejected.

#### Scenario: A credential is used without being carried
- **WHEN** an outbound call authenticated by a stored credential is made
- **THEN** the plaintext exists only within the adapter making the call

#### Scenario: A failure logs nothing from the authenticated request
- **WHEN** such a call fails, times out, or is rejected
- **THEN** no log line contains the credential, the authorization header, or the response body

### Requirement: An unreadable credential is a client-facing failure, not only a dashboard state

Where a stored credential that cannot be decrypted would otherwise reach an end user's flow, that flow SHALL fail in a way that names the shop's configuration as the cause and SHALL NOT attribute the failure to the user.

A presence check performed in the database answers true for an envelope that cannot be decrypted. Any gate relying on presence alone SHALL therefore be understood as not proving usability, and the surface that consumes the credential SHALL be the one that discovers and reports the difference.

#### Scenario: A client meets an undecryptable credential
- **WHEN** a stored credential cannot be decrypted at the moment a client's flow needs it
- **THEN** the user-facing message states that the business cannot process the operation right now, never that the user's action failed

#### Scenario: A presence gate is not mistaken for a usability gate
- **WHEN** a readiness check reports a credential present
- **THEN** that result is not treated as proof the credential can be decrypted or used
