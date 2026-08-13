## ADDED Requirements

### Requirement: The transfer section has three states, and the empty one is valid
The transfer configuration SHALL resolve to exactly one of three states on every save:

- **Unconfigured** — destination and holder name all empty. Transfer is not offered to clients. This is a legitimate choice for an owner who accepts Mercado Pago only.
- **Configured** — a holder name present together with at least one destination (CBU/CVU, alias, or both).
- **Invalid** — any other combination. The submission SHALL be rejected in full and nothing SHALL be written.

Clearing a configured transfer back to Unconfigured SHALL be permitted even when Mercado Pago is not configured and the business is consequently left with no payment method at all. Blocking it would trap an owner migrating from one method to the other. The rule that a business must have a usable payment method before it accepts bookings is enforced at the entry to the public booking flow, not by this form.

#### Scenario: All fields submitted empty
- **WHEN** the owner submits the form with destination and holder name blank
- **THEN** the transfer configuration is stored as Unconfigured and the save succeeds

#### Scenario: A destination with no holder name
- **WHEN** the owner submits a CBU or an alias without a holder name
- **THEN** the holder name is reported as required and the stored configuration is unchanged

#### Scenario: A holder name with no destination
- **WHEN** the owner submits a holder name with both destination fields blank
- **THEN** the submission is rejected for having no destination and the stored configuration is unchanged

#### Scenario: Clearing the only configured payment method
- **WHEN** the owner clears all three fields while Mercado Pago is unconfigured
- **THEN** the save succeeds and the response carries a warning that no payment method remains

### Requirement: A destination is CBU/CVU, alias, or both — never neither when configured
At least one of CBU/CVU and alias SHALL be present in the Configured state; both together SHALL be accepted. An owner who knows only their alias is the common case, and requiring both would block them.

When both are present, the CBU/CVU SHALL be the **primary** destination and the alias the secondary one. Banks route by CBU; the alias is a typing convenience. The editor SHALL render them in that order, and any later consumer SHALL follow the same precedence rather than choosing for itself.

The precedence is stated here, where both values are written, rather than left to the story that first displays them to clients — storing two destinations without saying which leads would make that an invented decision downstream.

#### Scenario: Only an alias is provided
- **WHEN** the owner submits an alias and a holder name with no CBU
- **THEN** the configuration is stored as Configured

#### Scenario: Both destinations are provided
- **WHEN** the owner submits a CBU, an alias and a holder name
- **THEN** both destinations are stored and the CBU is designated the primary one

#### Scenario: The editor renders the primary destination first
- **WHEN** a configuration holding both destinations is displayed
- **THEN** the CBU/CVU appears before the alias

### Requirement: The CBU/CVU check digits are verified
A CBU/CVU SHALL be normalized to digits only, SHALL then be exactly 22 digits, and its two check digits SHALL be verified before the value is accepted. CBU and CVU share the format, so one rule covers both.

Length validation alone is insufficient. A single transposed digit yields a 22-digit value that routes every client's deposit to an unrelated account, and the failure is silent until the owner asks where the money went. This is the only irreversible error in the story.

The algorithm SHALL be validated against fixtures taken from real accounts at more than one bank before it is trusted. A wrong weight table rejects valid accounts, which is a worse failure than the one the check exists to prevent.

#### Scenario: A CBU with a transposed digit
- **WHEN** the owner submits a 22-digit value whose check digits do not match its body
- **THEN** the field is rejected with a check-digit error and no write occurs

#### Scenario: A CBU pasted with separators
- **WHEN** the owner submits a value containing spaces, hyphens or a trailing newline around 22 valid digits
- **THEN** the separators are discarded and the value is accepted

#### Scenario: A destination of the wrong length
- **WHEN** the owner submits a destination of 21 or 23 digits
- **THEN** the field is rejected for its length

#### Scenario: A non-numeric destination
- **WHEN** the owner submits a destination containing letters
- **THEN** the field is rejected

### Requirement: The alias is normalized and constrained to the national format
An alias SHALL be trimmed, lowercased, and SHALL then consist of 6 to 20 characters drawn from lowercase letters, digits, `.` and `-`, with no leading or trailing `.` or `-`.

Lowercasing is normalization, not preference: the alias namespace is case-insensitive, and storing what the owner happened to type produces "it doesn't work" reports when the client's bank rejects the casing.

The alias SHALL NOT be checksum-verified, because the format carries no check digit. The confirmation requirement below exists precisely because no validation can catch a valid alias belonging to the wrong person.

#### Scenario: An alias typed in mixed case
- **WHEN** the owner submits `Mi.Barberia`
- **THEN** `mi.barberia` is stored

#### Scenario: An alias below the minimum length
- **WHEN** the owner submits an alias of 5 characters
- **THEN** the field is rejected for its length

#### Scenario: An alias with a disallowed character
- **WHEN** the owner submits an alias containing a space or an underscore
- **THEN** the field is rejected

#### Scenario: An alias bounded by a separator
- **WHEN** the owner submits an alias beginning or ending with `.` or `-`
- **THEN** the field is rejected

### Requirement: The holder name is required alongside a destination and constrained to a safe character set
`transferHolderName` SHALL be required whenever a destination is present, and SHALL be 2 to 120 characters after normalization.

Normalization SHALL apply Unicode NFKC, collapse internal whitespace, and discard C0/C1 control characters, zero-width characters and bidirectional overrides before validation runs. The remaining text SHALL consist only of Unicode letters, spaces, apostrophes, hyphens and periods.

The constraint is a whitelist rather than an escaping rule because this value is rendered to clients in the public flow and will later be interpolated into transactional email, where output is assembled as strings. A value that cannot carry markup or reverse its own rendering is a stronger guarantee than every future renderer escaping correctly.

#### Scenario: A holder name carrying a bidirectional override
- **WHEN** the owner submits a holder name containing a bidirectional override character
- **THEN** the character is discarded before validation and only the remaining text is stored

#### Scenario: A holder name that is empty after normalization
- **WHEN** the owner submits a holder name consisting solely of whitespace or discarded characters
- **THEN** the field is treated as empty rather than stored as blank

#### Scenario: A holder name containing markup
- **WHEN** the owner submits a holder name containing `<` or `>`
- **THEN** the field is rejected as containing disallowed characters

### Requirement: Changing a saved destination requires an explicit confirmation
When a submission would change an already-stored CBU/CVU or alias, the system SHALL NOT persist it on the first submission. It SHALL return a confirmation state carrying the normalized, formatted value, and SHALL persist only after the owner explicitly confirms.

Confirmation SHALL be required only when the destination differs from the stored one — never on a first configuration, never when only the holder name changed, and never on an unchanged re-save. Friction on every save would be trained away and stop being read.

The confirmation SHALL be a server-returned form state rather than a browser dialog, so it survives without JavaScript and cannot block the runtime.

#### Scenario: Editing an existing alias
- **WHEN** the owner submits an alias different from the stored one
- **THEN** the change is not persisted and a confirmation state carrying the normalized alias is returned

#### Scenario: Confirming the change
- **WHEN** the owner confirms a returned confirmation state
- **THEN** the normalized destination is persisted

#### Scenario: First configuration needs no confirmation
- **WHEN** the owner saves a destination while none is stored
- **THEN** the value is persisted without a confirmation step

#### Scenario: Editing only the holder name
- **WHEN** the owner changes the holder name while the destination is unchanged
- **THEN** the value is persisted without a confirmation step

### Requirement: Stored values are rendered back from the database, formatted
The editor SHALL render the currently stored configuration from the database rather than from submitted form state, and SHALL display a stored CBU/CVU grouped in blocks of four digits.

The owner's only defence against a mistyped destination is reading it back. A screen echoing what they typed cannot reveal a value that failed to store, and an unbroken 22-digit run cannot be checked by eye.

#### Scenario: A configured section is reopened
- **WHEN** the owner loads the editor with a destination stored
- **THEN** the stored value is shown, read from the database, with the CBU grouped for reading

### Requirement: The editor is owner-only and never cached
Every read and every write SHALL resolve the authenticated owner before any other work, and the route SHALL be declared non-cacheable at the page itself rather than relying on an ancestor layout.

#### Scenario: An unauthenticated visitor
- **WHEN** a request without a valid owner session reaches the editor or its action
- **THEN** the visitor is redirected to the login route and no configuration is read or written

### Requirement: Rejected submissions preserve what the owner typed
A rejected submission SHALL return every submitted value alongside its errors, and the form SHALL re-render them.

React resets uncontrolled forms when the action resolves, so any value not carried in the returned state is lost. A validation error that also erases a 22-digit destination is worse than the error it reports.

#### Scenario: A validation failure
- **WHEN** a submission is rejected for any reason
- **THEN** the destination and holder name the owner typed are still present in the form

### Requirement: An infrastructure failure is reported without ambiguity
A failure to write SHALL be returned as form state rather than thrown, SHALL preserve the submitted values, and SHALL instruct the owner to reload to see what was stored.

A write can commit and still report failure when the connection drops afterwards. Without that instruction the owner cannot distinguish "not saved" from "saved and not acknowledged", and the difference is where their clients' deposits go.

#### Scenario: The database is unreachable during the write
- **WHEN** the write fails
- **THEN** a generic Spanish message with a reload instruction is returned, the typed values are preserved, and the route error boundary is not reached

### Requirement: The no-payment-method warning is produced by the server
The warning shown when a save leaves the business with no configured payment method SHALL be computed on the server and returned as part of the save result.

Only the server knows whether Mercado Pago is configured. Computing the warning in the browser would require sending that fact to it, and it would not work before hydration.

#### Scenario: Transfer cleared while Mercado Pago is configured
- **WHEN** the owner clears the transfer section and Mercado Pago credentials are stored
- **THEN** the save succeeds and no warning is returned

### Requirement: Every user-facing string is Spanish (es-AR) and lives in the copy module
All labels, help text, error messages, the confirmation prompt and the warning SHALL be Spanish (es-AR) and SHALL be defined in `src/lib/copy.ts`. No Spanish literal SHALL appear in a component, an action or a schema.

Validation SHALL return error codes; mapping a code to a message is the presentation layer's responsibility. Each distinct rejection reason SHALL carry its own message — a destination rejected for its length and one rejected for its check digits explain different mistakes and SHALL NOT collapse into a single "invalid" message.

#### Scenario: A rejection reason reaches the owner
- **WHEN** a destination is rejected for its check digits
- **THEN** the message names that reason specifically rather than reporting a generic invalid value

### Requirement: Form controls submit reliably before hydration
The editor SHALL use a native form posting to a server action, with uncontrolled inputs. The destination field SHALL be `type="text"` with `inputMode="numeric"`, and no control SHALL carry `min`, `max`, `step` or `pattern`.

A number-typed control submits an empty string when the browser's parser rejects the input, making "missing" indistinguishable from "malformed" and leaving nothing to echo back. Browser-enforced constraints reject with messages in the browser's locale, drawn from strings that exist nowhere in the copy module, and prevent the server-side rule from ever running.

#### Scenario: The form is submitted before hydration
- **WHEN** the owner submits with JavaScript unavailable
- **THEN** the submission is validated on the server and its result rendered

### Requirement: The submit control is disabled while a submission is in flight
The submit control SHALL be disabled for the duration of a submission. The server SHALL remain the real guard: the write is idempotent, so a duplicate submission changes nothing.

#### Scenario: A double submission
- **WHEN** the same submission is received twice
- **THEN** the stored configuration is identical to the result of receiving it once

### Requirement: Writes are logged without exposing the destination
Every successful write SHALL emit a structured log entry recording the operation, the owner, whether each destination is present, and the last four digits of the previous and new CBU. The full CBU, the full alias and the holder name SHALL NOT be logged.

The last-four pair is what makes a change reconstructable if deposits later arrive at the wrong account; the full value in a log stream is a payment destination sitting outside the database.

Failures SHALL log the error code only. The driver's message embeds the submitted values, which would put the destination into the log stream and let a crafted value forge structured log fields.

#### Scenario: A destination is changed
- **WHEN** the write succeeds
- **THEN** the log entry carries the previous and new last four digits and neither full value

#### Scenario: A constraint violation is logged
- **WHEN** a database error is handled
- **THEN** only its code is logged and the driver message is discarded
