## ADDED Requirements

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
