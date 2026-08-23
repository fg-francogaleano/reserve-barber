## ADDED Requirements

### Requirement: The transfer destination is readable by the public booking flow through a projection that cannot carry the access token

The destination stored by this capability SHALL be readable by the public booking flow, which until now consulted no payment configuration at all.

That read SHALL be a **narrow projection** selecting only `transferCbuCvu`, `transferAlias`, `transferHolderName` and a boolean derived **in SQL** from whether the Mercado Pago access token is present. The encrypted access token lives in the same row and SHALL NOT be selected, and the returned type SHALL have no field capable of holding it.

The projection SHALL be resolved on the server. No composition root serving the public flow SHALL construct a credential cipher in order to render a destination.

#### Scenario: The destination reaches a client
- **WHEN** a client who has committed to bank transfer views their confirmation page
- **THEN** the stored CBU/CVU, alias and holder name are rendered

#### Scenario: The token is not selected
- **WHEN** the public projection is executed for a shop with Mercado Pago configured
- **THEN** the query does not select the access token column and the returned value has no field that could hold it

#### Scenario: No cipher is built to show a bank account
- **WHEN** the composition root serving the confirmation page is reviewed
- **THEN** it constructs no credential cipher, and a missing encryption key does not prevent the destination from rendering

### Requirement: A destination without a holder name is not offered to a client

A stored destination SHALL be treated as unusable by the public booking flow when `transferHolderName` is absent, even though a CBU/CVU or alias is present.

The holder name is what lets a client confirm from their bank's own screen that they are paying the right business. A destination without it is not a destination a stranger can safely use.

This is a public-flow rule and SHALL NOT change what the owner may save: the editor's own validation already requires a holder name alongside a destination, and this requirement is what happens if a row nonetheless reaches the flow without one.

#### Scenario: A half-configured destination is not offered
- **WHEN** the confirmation page renders for a shop whose row has a CBU and no holder name
- **THEN** no transfer control appears and no CBU is rendered

#### Scenario: A complete destination is offered
- **WHEN** the confirmation page renders for a shop whose row has an alias and a holder name
- **THEN** the transfer control appears

### Requirement: Clearing a destination does not invalidate a transfer already in progress

The owner SHALL remain able to clear or change the destination at any time, as this capability already permits, and doing so SHALL NOT prevent a client who has already committed to transfer from submitting a receipt.

The destination was correct when it was shown, and the money may already have moved. A submission SHALL be accepted on the strength of the booking's own state, never re-validated against the current configuration.

#### Scenario: A cleared destination does not reject a receipt
- **WHEN** the owner clears the transfer destination while a client holds a committed transfer, and that client submits a valid receipt
- **THEN** the receipt is accepted and the booking moves to `PENDING_APPROVAL`

#### Scenario: A changed destination does not reject a receipt
- **WHEN** the owner replaces the CBU while a client holds a committed transfer, and that client submits a valid receipt
- **THEN** the receipt is accepted
