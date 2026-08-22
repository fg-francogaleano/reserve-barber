## ADDED Requirements

### Requirement: The stored credentials acquire a consumer that charges, and its failures are the owner's to see

The stored Mercado Pago credentials SHALL now be consumed by a client-facing flow that authorizes real charges, and every way that consumption can fail SHALL be reachable in the owner's logs with the cause distinguished.

Until now the credentials were written, verified once at save time, and read only as a presence flag. A credential that was rejected, revoked, rate-limited or made undecryptable after being saved had no surface that would reveal it. That surface is now a client standing at a payment screen, and the owner SHALL NOT depend on a client telling them.

The credentials editor SHALL NOT be required to poll or re-verify for this change; what is required is that a consumption failure is logged with its cause named, rather than collapsed into a generic error.

#### Scenario: A revoked token surfaces its cause
- **WHEN** Mercado Pago rejects the stored token during a client's payment
- **THEN** the failure is logged with the rejection distinguished from an unreachable gateway and from an undecryptable credential

#### Scenario: The owner is not told by the client
- **WHEN** any credential-caused payment failure occurs
- **THEN** it appears in the logs without requiring a client report

### Requirement: Test credentials in production become materially consequential

Where the stored credential states that it belongs to a test environment, that fact SHALL be treated as materially significant rather than cosmetic, because appointments now reach a confirmed state against payments that moved no money.

The environment SHALL continue to be claimed only when the credential states it outright, and SHALL never be asserted as production by inference. This change does not itself add the warning; it records that the risk the existing debt entry describes has become a confirmed booking rather than a configuration curiosity.

#### Scenario: A test credential still names itself only when it says so
- **WHEN** a stored credential does not declare its environment
- **THEN** no environment is claimed for it

#### Scenario: A confirmation is possible against test credentials
- **WHEN** a payment is approved using a test credential
- **THEN** the booking confirms exactly as it would otherwise, which is the reason the warning is owed

### Requirement: No webhook secret is stored, and that is a decision with a recorded trigger

This change SHALL NOT add a webhook secret column, a form field for one, or a signature validation routine.

The signature scheme for this gateway is keyed by a per-integration secret issued in the gateway's own dashboard. With one gateway account per owner, storing it means a new encrypted column, a new cipher purpose, a new field on this editor with its own verified and unreadable states, and a manual step every owner must be walked through. That is an amendment to this capability wearing another story's name.

A validation routine that passes when no secret is configured SHALL NOT be introduced under any circumstance: it reads as protection in every later review while protecting nothing. Notification authenticity is established by re-fetching the payment with the owner's own access token, which is specified in the `payment-mercado-pago` capability.

#### Scenario: The credentials row is unchanged by this change
- **WHEN** the migration for this change is inspected
- **THEN** it adds no column to the payment configuration table

#### Scenario: No permissive validator exists
- **WHEN** the notification handler is inspected
- **THEN** it contains no signature check that can pass in the absence of a configured secret
