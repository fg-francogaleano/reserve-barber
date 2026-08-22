# payment-mercado-pago-credentials Specification

## Purpose
The owner records, verifies, replaces and removes the Mercado Pago credential pair that lets clients pay the booking deposit online. Created by archiving change pc2-mercado-pago-credentials.
## Requirements
### Requirement: The Mercado Pago section has four states
The Mercado Pago configuration SHALL resolve to exactly one of four states, and the page SHALL render each one distinguishably:

- **Unconfigured** — no credentials stored. Mercado Pago is not offered to clients. A legitimate choice for an owner who accepts transfers only.
- **Configured** — an access token and a public key stored together, readable.
- **Unreadable** — credentials are stored but cannot be decrypted. Distinct from both of the above, because the owner's remedy is different.
- **Invalid** — the submission is not storable. Rejected in full; nothing SHALL be written.

Removing credentials SHALL be permitted even when no transfer destination is configured and the business is consequently left with no payment method at all. Blocking it would trap an owner migrating from one method to the other. The rule that a business must have a usable payment method before it accepts bookings is enforced at the entry to the public booking flow, not by this form.

#### Scenario: Nothing has ever been configured
- **WHEN** the owner opens the page with no credentials stored
- **THEN** the Unconfigured state is rendered, naming what is missing and what it unblocks

#### Scenario: Removing the only configured payment method
- **WHEN** the owner confirms removal of their credentials while no transfer destination is configured
- **THEN** the removal succeeds and the response carries a warning that no payment method remains

### Requirement: Both credentials are required together
An access token and a public key SHALL be stored together or not at all. A submission carrying exactly one of the two SHALL be rejected in full at form level, because the mistake is the combination rather than either field.

A public key alone cannot authorize a charge; an access token alone cannot initialize the client-side checkout. Half a pair is a payment method that fails at the moment a real client tries to use it.

#### Scenario: An access token with no public key
- **WHEN** the owner submits an access token and leaves the public key blank on a first configuration
- **THEN** the submission is rejected at form level and nothing is written

#### Scenario: A public key with no access token on a first configuration
- **WHEN** the owner submits a public key with no access token and no credentials are stored
- **THEN** the submission is rejected at form level and nothing is written

### Requirement: The access token is never sent to the browser
The stored access token SHALL NOT appear in any response to the browser — not in rendered HTML, not in a hidden input, not in a serialized server-component payload, not in server-action form state, and not in a data attribute or inline script.

The dashboard SHALL show only: whether credentials are configured, the token's environment, the token's last four characters, the public key in full, and when the configuration last changed. The public key is not a secret and is displayed whole.

The token input SHALL render empty on every load and SHALL NOT be pre-filled with a masked placeholder. A masked default that submits back the mask stores the mask.

#### Scenario: The page is rendered with credentials stored
- **WHEN** the owner opens the page while credentials are stored
- **THEN** no part of the access token appears anywhere in the response, and the token input is empty

#### Scenario: A submission is rejected after the token was typed
- **WHEN** a submission carrying an access token is rejected for any reason
- **THEN** the returned form state carries every other submitted value but not the access token

### Requirement: An empty access token field means unchanged, never cleared
Because the token field always renders empty, a submission with an empty token field SHALL leave the stored token unchanged. It SHALL NOT be interpreted as a request to clear the credentials.

Removal SHALL be an explicit separate intent, never the absence of a value.

A submission with an empty token field and a **changed** public key SHALL be rejected: the two credentials are issued as a pair, and a public key rotated without its token produces a checkout that fails only when a real client reaches it. The message SHALL state why both are required together, so the rule does not read as a defect.

#### Scenario: Saving with the token field left empty and nothing else changed
- **WHEN** the owner submits with an empty token field and an unchanged public key
- **THEN** the stored credentials are unchanged and the save is reported as successful

#### Scenario: Changing only the public key
- **WHEN** the owner submits a changed public key with an empty token field
- **THEN** the submission is rejected, the stored credentials are unchanged, and the message explains that the pair must be re-entered together

#### Scenario: Removing credentials
- **WHEN** the owner submits the explicit removal intent and confirms it
- **THEN** both credentials are cleared and no other column of the configuration is modified

### Requirement: The two credentials are validated as distinct shapes
Each credential SHALL be validated against its own shape, specifically enough that a value belonging in the other field is rejected. Validating only a shared prefix is insufficient.

An owner who pastes the two values into the wrong fields would otherwise store the **access token in the public key column** — the one value this feature deliberately sends to the browser — publishing a live bearer credential to every guest who reaches the payment step.

When the two values appear to be transposed, the error SHALL name that specific mistake rather than reporting both fields as generically invalid.

#### Scenario: The two credentials are pasted into each other's fields
- **WHEN** the owner submits an access token in the public key field and a public key in the access token field
- **THEN** the submission is rejected, the error names the values as apparently swapped, and no access token is written to the public key column

#### Scenario: A malformed access token
- **WHEN** the owner submits a value that does not match the access token shape
- **THEN** the field is rejected with an error describing that specific mistake and no write occurs

### Requirement: Credentials are normalized before validation and before storage
Submitted credentials SHALL be stripped of surrounding whitespace and of control and zero-width characters before they are validated, and the normalized value SHALL be the one validated, verified and stored.

Owners paste from Mercado Pago's dashboard, and a trailing newline or a zero-width character rides along invisibly. Such a value passes every shape check and produces an authentication failure at payment time.

#### Scenario: A credential pasted with a trailing newline
- **WHEN** the owner submits an access token whose value ends with a newline and contains a zero-width character
- **THEN** the stored credential contains neither, and the value validated is the normalized one

### Requirement: The environment is never claimed unless the credential states it
The system SHALL NOT infer a credential's Mercado Pago environment from the `APP_USR-` prefix. That prefix is issued for **test and production alike** by the credentials panel, and identifies nothing.

A credential SHALL be reported as a test credential **only** when it carries an explicit `TEST-` prefix. In every other case the environment is **unknown**, and the interface SHALL say nothing rather than assert a value.

Displaying an unverified environment is worse than displaying none. An owner checking whether they are ready to accept real payments reads "Producción" as confirmation, which is precisely the doubt the display existed to create.

Where the environment used to be shown, the interface SHALL show the **Mercado Pago account id**, which is recovered from the token itself and is therefore a fact rather than an inference.

A pair SHALL still be rejected when one credential carries an explicit `TEST-` prefix and the other does not — the one mismatch that remains detectable.

A test pair SHALL be accepted and stored. Exercising the booking flow before launch is what test credentials exist for.

Whenever a credential explicitly identifies itself as a test credential, the page SHALL render a persistent, non-dismissible notice stating that real clients will not be charged. The notice SHALL survive reloads and navigation, because the owner it protects is one who stopped noticing.

#### Scenario: A panel-issued credential
- **WHEN** the owner stores a credential carrying the `APP_USR-` prefix
- **THEN** no environment is displayed, and the account id is displayed in its place

#### Scenario: An explicit test credential
- **WHEN** the owner opens the page while a `TEST-` prefixed credential is stored
- **THEN** a persistent notice states that real clients will not be charged, and it cannot be dismissed away permanently

#### Scenario: A legacy test credential paired with a panel-issued one
- **WHEN** the owner submits one `TEST-` credential and one that is not
- **THEN** the submission is rejected with an environment-mismatch error and nothing is written

#### Scenario: The interface never asserts production
- **WHEN** any credential is displayed, in the status panel or the confirmation
- **THEN** no text claims the credential is a production credential

### Requirement: Credentials are verified against Mercado Pago before they are stored
A submission carrying an access token SHALL be verified against Mercado Pago before any write, and the outcome SHALL determine what happens next:

- Mercado Pago identifies the account → proceed to the confirmation step.
- Mercado Pago definitively rejects the credentials (an authentication or authorization failure) → **nothing SHALL be written**, previously stored credentials SHALL remain intact, and the failure SHALL be reported as a credential error rather than an infrastructure error.
- Mercado Pago is unreachable, fails with a server error, or exceeds the timeout → the credentials **SHALL be stored anyway**, and the owner SHALL be told they could not be verified.

Refusing to save because a third party is unavailable would be this feature failing for a reason unrelated to the owner's input. A definitive rejection is different: Mercado Pago has answered, and the answer is no.

The verification call SHALL be bounded by an explicit timeout. Without one, an unresponsive Mercado Pago leaves the request pending until the platform terminates it, and the owner submits again.

#### Scenario: Mercado Pago rejects the credentials
- **WHEN** Mercado Pago answers with an authentication failure for the submitted token
- **THEN** nothing is written, the previously stored credentials remain intact, and the error is reported as a credential problem

#### Scenario: Mercado Pago is unavailable
- **WHEN** Mercado Pago returns a server error or does not answer within the timeout
- **THEN** the credentials are stored and the owner is told they could not be verified at this time

#### Scenario: Verification never runs unbounded
- **WHEN** Mercado Pago accepts the connection but does not respond
- **THEN** the call is abandoned at the configured timeout rather than running until the platform terminates the request

### Requirement: Replacing or removing credentials requires confirmation, and the confirmation shows the account
When credentials are already stored, a submission that would replace or remove them SHALL NOT be written until the owner explicitly confirms it.

The confirmation screen SHALL display **the account Mercado Pago says the submitted token belongs to**, together with the stored token's last four characters. It SHALL NOT display, carry, or embed any credential value.

The account identity SHALL come **only from Mercado Pago's verification response** — see the requirement "No account identity is derived from the credential itself". When Mercado Pago supplies no name, the confirmation SHALL show none, and SHALL NOT substitute a value computed locally.

This is a known weakness, stated rather than hidden: when Mercado Pago is unreachable the save still proceeds (a third party being down must not block a settings save) and the confirmation falls back to four characters, which identifies very little. Closing it requires storing the verified account id, which needs a migration; it is recorded as T43.

Showing the account is the only defence in this product against a credential that is valid but belongs to somebody else, and it is only as good as Mercado Pago being reachable.

The owner's answer SHALL travel only on the control they activated, never on a hidden field declaring the answer in advance. When a form carries a hidden field and a control under the same name, the hidden value is read first, so a cancel control would commit exactly what the owner declined.

Confirmation SHALL NOT be required on a first configuration: there is no previously stored value to be mistaken for the new one.

#### Scenario: Replacing stored credentials
- **WHEN** the owner submits credentials different from the stored ones and has not confirmed
- **THEN** nothing is written and the confirmation screen is shown, naming the Mercado Pago account the new token belongs to

#### Scenario: The confirmation screen carries no credential
- **WHEN** the confirmation screen is rendered
- **THEN** no part of either submitted credential appears in the response, in a hidden input, in a serialized payload, or in any script

#### Scenario: Declining the confirmation
- **WHEN** the owner activates the control that returns to the editor
- **THEN** nothing is written and the owner is returned to the form with their entry recoverable

#### Scenario: First configuration is not gated
- **WHEN** the owner submits credentials while none are stored
- **THEN** no confirmation is required and the credentials are stored directly

#### Scenario: The confirmation is reached while Mercado Pago is unreachable
- **WHEN** the confirmation is shown for a save that could not be verified
- **THEN** no account is named, the confirmation says the credentials could not be verified, and no identifier computed from the token is shown in place of one

### Requirement: No account identity is derived from the credential itself
The system SHALL NOT derive a Mercado Pago account identifier from any part of an access token, and SHALL NOT display one obtained that way.

The token's trailing numeric segment resembles an account id and is not one: measured against a real credential, the segment was `1325562541` while the owner's Mercado Pago User ID was `156842883`. It is retained as a **shape** requirement — it separates a well-formed token from a malformed public key — and nothing more.

The account identity SHALL come only from Mercado Pago, during verification. When Mercado Pago does not supply one, the interface SHALL show no account rather than substituting a value derived locally.

Consequently the confirmation SHALL NOT claim that a replacement switches accounts. Such a comparison, built on an identifier that identifies nothing, can be wrong in both directions: a false alarm on a routine rotation teaches the owner to click through the warning, and a false reassurance suppresses it exactly when a stranger's credentials were pasted.

#### Scenario: Mercado Pago names the account
- **WHEN** verification succeeds and Mercado Pago returns a nickname or email
- **THEN** the confirmation displays it as the account the credentials belong to

#### Scenario: Mercado Pago names no account
- **WHEN** verification could not be completed, or returned no usable name
- **THEN** the confirmation displays no account, and no identifier derived from the token appears anywhere in it

#### Scenario: No token-derived identifier reaches the interface
- **WHEN** any credential is displayed or confirmed
- **THEN** no segment of the access token appears as an account identifier

### Requirement: A pending credential awaiting confirmation is never exposed to the browser
Between the verification and the owner's confirmation, the submitted access token SHALL be held in a form the browser cannot read: encrypted, marked `httpOnly` and `Secure`, restricted to this feature's path, restricted to same-site requests, and expiring within minutes.

It SHALL be discarded when the owner confirms, when the owner declines, and when validation fails.

It SHALL be encrypted under a purpose distinct from the stored-credential purpose, so a value from one context cannot be decrypted in the other.

#### Scenario: The pending credential is unreachable from the page
- **WHEN** the confirmation step is active
- **THEN** the pending token is not readable by page scripts and does not appear in the rendered document

#### Scenario: The confirmation is abandoned
- **WHEN** the owner leaves the confirmation without answering and returns after the expiry window
- **THEN** the pending credential is gone and the owner is returned to the editor rather than to a stale confirmation

#### Scenario: A pending value cannot be redirected into storage
- **WHEN** a pending-credential value is presented where a stored credential is expected
- **THEN** it fails to decrypt rather than being accepted

### Requirement: Credentials that cannot be decrypted are reported on this page
The page SHALL determine on load whether the stored access token can be decrypted, and SHALL render the Unreadable state when it cannot, offering the remedy — entering the credentials again.

Without this, a missing or corrupted encryption key renders an apparently healthy Configured page over an unusable token, and the failure surfaces for the first time inside the public booking flow, during a real client's payment.

The decrypted value SHALL be discarded immediately and SHALL NOT be rendered, passed to a component, or logged.

#### Scenario: The encryption key is missing or corrupt
- **WHEN** the owner opens the page while the stored token cannot be decrypted
- **THEN** the Unreadable state is rendered with the remedy, rather than the Configured state

#### Scenario: The check does not leak the token
- **WHEN** the decryption check succeeds
- **THEN** the plaintext is discarded and no part of it reaches the response or the logs

### Requirement: The no-payment-method warning is produced by the server
When a save or removal leaves the business with no payment method configured at all, the response SHALL carry a warning to that effect, determined on the server.

Only the server knows whether a transfer destination is configured, and the warning must be correct before the page hydrates.

The warning SHALL be presented alongside the success confirmation, never in place of it. The save did happen, and replacing the confirmation with a warning would read as a failure.

#### Scenario: Removal leaves no payment method
- **WHEN** the owner removes their credentials while no transfer destination is configured
- **THEN** the response reports both that the removal succeeded and that no payment method remains

#### Scenario: Removal leaves transfer configured
- **WHEN** the owner removes their credentials while a transfer destination is configured
- **THEN** the response reports success without the warning

### Requirement: The editor is owner-only and never cached
The page and its write actions SHALL require an authenticated owner, re-checked inside the action itself rather than relying on middleware alone. The authorization check SHALL precede any outbound request to Mercado Pago.

The page SHALL declare itself dynamic and non-cacheable on the page itself, not by inheritance from an ancestor layout.

#### Scenario: An unauthenticated write attempt
- **WHEN** an unauthenticated request invokes the save action directly
- **THEN** it is rejected before any Mercado Pago call is made and before any read or write of the configuration

#### Scenario: The page is not cached
- **WHEN** the page is requested
- **THEN** it is rendered dynamically and no response containing configuration state is cached

### Requirement: Writes are logged without exposing any credential
Every successful write SHALL emit one structured log entry carrying: the operation, the owner id, whether credentials are now configured, the environment, the last four characters of the new and previous access tokens, the last four of the public key, whether verification succeeded, and whether the business is left without a payment method.

No log entry SHALL contain a credential value, an encryption key, or a ciphertext. Error contexts SHALL be redacted before emission, **including error payloads returned by Mercado Pago**, which routinely echo the credential they rejected.

The new-and-previous pair is what makes a credential rotation reconstructable from the log stream if payments later fail.

#### Scenario: A successful rotation is logged
- **WHEN** the owner replaces their credentials
- **THEN** one entry records the previous and new last-four values with the presence and environment flags, and no credential value

#### Scenario: A Mercado Pago error echoes the credential
- **WHEN** Mercado Pago returns an error payload containing the submitted token
- **THEN** the token is redacted from everything that reaches the log stream

### Requirement: An infrastructure failure is reported without ambiguity
When a write fails in a way that leaves the outcome unknown — a dropped connection after the statement was sent — the owner SHALL be told the outcome is uncertain and told what to check.

Because the page cannot display the stored token, a presence flag alone cannot distinguish "the new token is stored" from "the old token is still stored". The page SHALL therefore surface the token's last four characters and the configuration's last-changed timestamp, which together answer the question.

#### Scenario: The connection drops after the write is sent
- **WHEN** a save fails with an infrastructure error of unknown outcome
- **THEN** the owner is told the result is uncertain and directed to the last-four and last-changed values

#### Scenario: The owner reloads after an uncertain save
- **WHEN** the page is reloaded following an uncertain save
- **THEN** the last four characters of the stored token and its last-changed timestamp are displayed

### Requirement: Rejected submissions preserve what the owner typed, except the token
A rejected submission SHALL return every submitted value except the access token, so the owner is not made to retype work that was accepted.

The access token SHALL NOT be preserved in returned form state, because that state is serialized to the browser. Re-entering it is the cost of keeping it out of the page, and the copy SHALL say so rather than leaving the emptied field looking like a bug.

#### Scenario: A rejection preserves the public key
- **WHEN** a submission is rejected
- **THEN** the public key field retains the submitted value and the token field is empty with an explanation

### Requirement: Every user-facing string is Spanish (es-AR) and lives in the copy module
All text presented to the owner SHALL be Spanish (es-AR) and SHALL be defined in the shared copy module, never inline in a component. Identifiers, log messages and error codes SHALL remain English.

Each distinct mistake SHALL have its own message. Malformed token, malformed public key, apparently swapped values, environment mismatch, half a pair, and an empty token with a changed public key are six different mistakes; collapsing any of them describes the wrong problem to the owner.

#### Scenario: A validation failure names the actual mistake
- **WHEN** any of the six rejection reasons occurs
- **THEN** the message shown is specific to that reason and originates from the copy module

### Requirement: The editor is built for progressive enhancement, and its limits are stated
The editor SHALL be built so that nothing in **its own** construction depends on client-side
JavaScript: a native `<form action={serverAction}>`, uncontrolled inputs, no click handlers, the
confirmation rendered as server-returned form state rather than a dialog, and the control that
returns to the editor implemented as a submit control carrying its own `name`/`value`.

It SHALL NOT be claimed that the editor works with JavaScript disabled. Measured against a production
build with JavaScript off, it does not, for two reasons outside this feature: the segment's Suspense
boundary prevents client components from rendering at all, and `useActionState` does not restore its
returned state after a no-JavaScript POST — so a submission is accepted and nothing is reported back.
Both are recorded as T44 and are project-wide.

Stating this is itself a requirement. A false claim of graceful degradation is worse than an
acknowledged limitation: it stops anyone from checking, and the step it protects — a confirmation
standing between a mistyped credential and a client's money — is exactly the one where believing you
confirmed something matters.

#### Scenario: The editor's own construction has no JavaScript dependency
- **WHEN** the editor and its confirmation are inspected
- **THEN** the form posts to a server action natively, the inputs are uncontrolled, and every control that changes state is a submit control carrying its own value rather than a script handler

#### Scenario: The limitation is recorded rather than assumed away
- **WHEN** the change is closed
- **THEN** the measured no-JavaScript behaviour is recorded as debt, and no artifact claims the editor degrades gracefully

### Requirement: The submit control is disabled while a submission is in flight
Submit controls SHALL be disabled for the duration of a submission, and the pending state SHALL distinguish a local save from one awaiting Mercado Pago.

A verification call may take seconds. Presenting it with the same label as a sub-second write makes a working save look hung, which is what produces the second click and the racing write.

#### Scenario: A slow verification
- **WHEN** a submission is awaiting Mercado Pago
- **THEN** the control is disabled and the pending state names the verification rather than a generic save

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

