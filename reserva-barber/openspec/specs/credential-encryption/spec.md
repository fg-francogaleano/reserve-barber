# credential-encryption Specification

## Purpose
How credentials this application stores itself are encrypted at rest: an authenticated cipher, a versioned self-describing envelope, a fresh initialization vector per write, and ciphertexts bound to their owner and purpose. Created by archiving change pc2-mercado-pago-credentials.
## Requirements
### Requirement: Stored credentials are encrypted with an authenticated cipher
Credentials stored by this application SHALL be encrypted at rest with AES-256-GCM through the platform's Web Crypto implementation.

An authenticated cipher is required, not merely an encrypting one: the system must be able to tell a corrupted or substituted value from a valid one, and must never decrypt tampered input into plausible-looking plaintext.

#### Scenario: A credential is stored
- **WHEN** a credential is written to the database
- **THEN** the persisted value is ciphertext produced by AES-256-GCM and the plaintext appears nowhere in the row

#### Scenario: The ciphertext is tampered with
- **WHEN** any byte of a stored envelope is altered
- **THEN** decryption fails with a typed error rather than returning altered plaintext

### Requirement: Every encryption uses a fresh random initialization vector
A new cryptographically random 96-bit initialization vector SHALL be generated for each encryption operation. It SHALL NOT be derived from the plaintext, from the record, or from any counter that could repeat.

Reusing an initialization vector under AES-GCM destroys both confidentiality and authenticity, and it is the failure mode most likely to survive review in an otherwise correct implementation.

#### Scenario: The same value encrypted twice
- **WHEN** the same plaintext is encrypted on two separate occasions
- **THEN** the two resulting envelopes differ

### Requirement: The stored envelope is self-describing and versioned
The persisted value SHALL be a single string carrying a version marker, the initialization vector, and the ciphertext with its authentication tag, in a documented and parseable form.

The version marker SHALL be present from the first stored value, so a later key or algorithm change can identify what it is reading rather than inferring it.

A value that does not parse as a recognized envelope SHALL be rejected. There SHALL be no fallback that treats an unparseable value as plaintext.

#### Scenario: A legacy or corrupt value is encountered
- **WHEN** a stored value does not parse as a recognized envelope version
- **THEN** it is rejected as unreadable and is never interpreted as plaintext

#### Scenario: The envelope identifies its version
- **WHEN** an envelope is produced
- **THEN** its version is recoverable from the stored string alone, without external context

### Requirement: Ciphertexts are bound to their owner and their purpose
Each encryption SHALL bind the owner's identifier and a purpose identifier as additional authenticated data. Decryption SHALL supply the same values and SHALL fail when they do not match.

This makes a ciphertext non-transferable: a value produced for one owner or for one purpose cannot be decrypted in another context, so it cannot be relocated into a place it did not belong.

#### Scenario: A ciphertext is moved between owners
- **WHEN** an envelope encrypted for one owner is presented for decryption as another owner's
- **THEN** decryption fails

#### Scenario: A ciphertext is moved between purposes
- **WHEN** an envelope encrypted for one purpose is presented for decryption under a different purpose
- **THEN** decryption fails

### Requirement: The encryption key is supplied as a secret and validated where it is used
The key SHALL be 32 bytes, supplied to the runtime as a deployment secret and never committed. It SHALL be validated — present, correctly encoded, correct length — at the composition root of the feature that uses it, and SHALL NOT be added to the application's global startup validation.

Global validation would take the entire dashboard down when one secret is missing from a deploy. A missing key must break only what depends on it, with an error naming the variable.

The key SHALL NOT appear in any log entry, error message, or stack trace.

#### Scenario: The key is missing
- **WHEN** the feature that requires the key is used while the key is absent
- **THEN** the failure names the missing variable and is confined to that feature, leaving the rest of the dashboard usable

#### Scenario: The key is malformed
- **WHEN** the key is present but is not valid encoding of exactly 32 bytes
- **THEN** the failure is reported as a configuration error naming the variable, not as a decryption failure

#### Scenario: The key never reaches a log
- **WHEN** any error occurs in the cipher
- **THEN** no part of the key appears in the emitted context

### Requirement: Encryption and decryption happen at the persistence boundary
Encryption SHALL be applied where the record is written and decryption where it is read, so that no layer above persistence handles an encrypted value.

The application and domain layers SHALL exchange plaintext with the persistence layer and SHALL be unaware that encryption exists, in the same way they are unaware of the driver's decimal representation.

#### Scenario: A service saves a credential
- **WHEN** an application service stores a credential
- **THEN** it passes plaintext and never constructs, inspects, or transports an envelope

### Requirement: An unreadable credential is reported, never swallowed
A failure to decrypt a stored credential SHALL raise a typed error that callers can distinguish from "no credential stored".

A caller that cannot tell an absent credential from an unreadable one will present a configuration as missing when it exists, or as present when it cannot be used. Both are wrong in ways that surface far from their cause.

#### Scenario: Decryption fails on a stored value
- **WHEN** a stored credential cannot be decrypted
- **THEN** the caller receives a typed decryption error, distinct from the absent-credential result

#### Scenario: The error carries no material
- **WHEN** a decryption error is raised
- **THEN** it carries neither the ciphertext, nor any recovered bytes, nor the key

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

