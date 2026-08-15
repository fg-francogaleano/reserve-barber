## MODIFIED Requirements

### Requirement: A partial configuration write touches only its own columns
Each story's write SHALL name only the columns it owns and SHALL NOT include any other column in its update. Its create branch SHALL supply only those columns plus the schema defaults.

- The transfer write SHALL set `transferCbuCvu`, `transferAlias` and `transferHolderName`.
- The Mercado Pago write SHALL set `mpAccessToken` and `mpPublicKey`.
- The deposit policy write SHALL set `depositType` and `depositValue`.

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

#### Scenario: Saving a deposit policy with both payment methods already configured
- **WHEN** the deposit policy write is applied to a row holding a transfer destination and Mercado Pago credentials
- **THEN** the destination and the credentials are unchanged

#### Scenario: The create branch of the deposit policy write
- **WHEN** the row is created by a deposit policy save
- **THEN** the transfer columns and both Mercado Pago columns are null

#### Scenario: Removing the deposit policy
- **WHEN** the deposit policy write clears the value
- **THEN** `depositValue` becomes null, `depositType` is left as stored, and every other column is unchanged

## ADDED Requirements

### Requirement: The public flow reads the deposit policy through a narrow projection
A read of the deposit policy intended for the public booking flow SHALL use a projection selecting only `depositType` and `depositValue`. The full entity SHALL NOT cross into the public surface.

This is the same control the transfer and public-key projections apply. `mpAccessToken` lives in this row and must never reach the browser, and a projection that does not select it cannot leak it — a stronger guarantee than every downstream consumer remembering to strip it.

#### Scenario: The booking flow reads the policy
- **WHEN** the deposit policy is read for the public flow
- **THEN** the query selects neither credential column and the returned object carries no credential field

#### Scenario: No policy is configured
- **WHEN** the projection is read for an owner whose `depositValue` is null
- **THEN** the read reports the policy as unconfigured rather than substituting a default value

### Requirement: The deposit value crosses the repository boundary as a string in both directions
The deposit value SHALL be converted from the driver's decimal to a canonical two-decimal string when read, and from that string form to the driver's decimal when written. No layer above infrastructure SHALL hold the driver's decimal type for this column, and no conversion SHALL pass through a floating-point intermediate.

The read direction is already required of every monetary field; stating the write direction here is what keeps a value the owner typed from being rounded by a `Number` conversion on its way into a column that decides what clients are charged.

#### Scenario: A value is written and read back
- **WHEN** a deposit value of 8000.50 is saved and read back
- **THEN** the domain receives the string `8000.50` and no floating-point conversion occurred on either leg
