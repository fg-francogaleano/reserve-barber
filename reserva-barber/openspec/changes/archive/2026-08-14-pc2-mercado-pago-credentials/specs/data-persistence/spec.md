## MODIFIED Requirements

### Requirement: A partial configuration write touches only its own columns
Each story's write SHALL name only the columns it owns and SHALL NOT include any other column in its update. Its create branch SHALL supply only those columns plus the schema defaults.

- The transfer write SHALL set `transferCbuCvu`, `transferAlias` and `transferHolderName`.
- The Mercado Pago write SHALL set `mpAccessToken` and `mpPublicKey`.

Three stories write to one row. A write that supplies the whole entity would silently reset another story's columns to whatever the submitting editor happened to hold, and the write would report success while doing it.

#### Scenario: Saving transfer details with Mercado Pago already configured
- **WHEN** the transfer write is applied to a row holding Mercado Pago credentials and a deposit policy
- **THEN** the credentials and the deposit policy are unchanged

#### Scenario: The create branch of the transfer write
- **WHEN** the row is created by a transfer save
- **THEN** `depositValue` is null and `depositType` holds its default

#### Scenario: Saving Mercado Pago credentials with a transfer destination already configured
- **WHEN** the Mercado Pago write is applied to a row holding a transfer destination and a deposit policy
- **THEN** the destination and the deposit policy are unchanged

#### Scenario: The create branch of the Mercado Pago write
- **WHEN** the row is created by a Mercado Pago save
- **THEN** the transfer columns are null, `depositValue` is null, and `depositType` holds its default

#### Scenario: Removing Mercado Pago credentials
- **WHEN** the Mercado Pago write clears both credentials
- **THEN** only those two columns become null and every other column is unchanged

## ADDED Requirements

### Requirement: The Mercado Pago access token is ciphertext in the database
`mpAccessToken` SHALL be persisted as an encryption envelope, never as plaintext. `mpPublicKey` SHALL be persisted as plaintext.

The public key is disclosed to every client who reaches the payment step; encrypting it would add a decryption step to a public read path in exchange for nothing. The access token authorizes charges and is the opposite case.

No schema migration is required: the existing nullable string column holds the envelope.

#### Scenario: A stored token is inspected in the database
- **WHEN** the row is read directly from the database
- **THEN** `mpAccessToken` holds an encryption envelope and the token value is not recoverable from the row alone

#### Scenario: The public key is stored
- **WHEN** credentials are saved
- **THEN** `mpPublicKey` holds the value as submitted after normalization, unencrypted

### Requirement: Encryption is applied and removed at the persistence boundary
The persistence layer SHALL encrypt the access token as it writes and decrypt it as it reads, so that callers exchange plaintext with it and never handle an envelope.

This is the boundary that already converts the driver's decimal type to a string and reduces the stored token to a presence flag. Encryption belongs with those conversions: a layer above that handles envelopes is a layer that can log one, serialize one, or forget to decrypt one.

#### Scenario: A caller stores a token
- **WHEN** an application service saves Mercado Pago credentials
- **THEN** it passes the plaintext token and the persistence layer produces the envelope

#### Scenario: A caller reads a token
- **WHEN** the server-side token read is performed
- **THEN** the caller receives plaintext and never sees the stored envelope

### Requirement: The dashboard read reduces the token to a presence flag
The read serving the dashboard SHALL NOT return the access token's value. It SHALL return whether one is stored, and SHALL additionally return the configuration's last-changed timestamp and the last four characters of the stored token.

The value is reduced at the persistence boundary, so nothing above it can leak what it never received. The last-four and last-changed values are what let the dashboard distinguish a completed rotation from an uncertain one without ever handling the credential.

#### Scenario: The dashboard loads the configuration
- **WHEN** the dashboard read is performed on a row holding credentials
- **THEN** the result reports that credentials are present, with the last four characters and the last-changed timestamp, and carries no token value

### Requirement: The public key and the access token are read through separate narrow projections
Two distinct reads SHALL exist for the Mercado Pago columns:

- A projection returning **only** `mpPublicKey`, for the surface that renders the client-side checkout. It SHALL NOT select `mpAccessToken`.
- A projection returning **only** the decrypted access token, for server-side use. Its result SHALL NOT be passed to a component, serialized into a response, or logged.

Keeping them separate is the same control the transfer projection applies: a read that cannot carry the token cannot leak it, which is a stronger guarantee than every consumer remembering to strip it.

#### Scenario: The booking flow reads the public key
- **WHEN** the public key is read for the client-side checkout
- **THEN** the query does not select the access token column and the result carries no token field

#### Scenario: The server reads the access token
- **WHEN** the access token is read for a server-side call
- **THEN** the query selects no other credential or configuration field and returns the decrypted value alone

### Requirement: An unreadable stored token is distinguishable from an absent one
A read of the access token SHALL distinguish three outcomes: no credential stored, a credential stored and decrypted, and a credential stored that cannot be decrypted.

Collapsing the third into the first would report an owner's configured credentials as missing; collapsing it into the second would report them as usable. Both mislead, and both surface far from the cause.

#### Scenario: The stored envelope cannot be decrypted
- **WHEN** the access token read encounters an envelope it cannot decrypt
- **THEN** the caller receives a decryption failure distinct from the no-credential result
