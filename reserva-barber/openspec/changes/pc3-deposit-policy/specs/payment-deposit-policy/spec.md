## ADDED Requirements

### Requirement: The owner configures a deposit policy of one of two types
The dashboard SHALL provide an editor at `/sena` where the owner records a deposit policy as either a fixed amount in ARS (`FIXED`) or a share of the service price (`PERCENT`). The policy SHALL be stored on the owner's shared `PaymentConfig` row and SHALL apply to every location, barber and service.

A single policy is what `docs/base-standards.md` §4 fixes for this version: the payment configuration is shared across all locations.

#### Scenario: A first deposit policy is saved
- **WHEN** the owner with no stored policy saves `PERCENT` 30
- **THEN** the policy is stored and the page reports it as configured

#### Scenario: The row does not exist yet
- **WHEN** the owner saves a deposit policy before configuring any payment method
- **THEN** the configuration row is created and holds only the deposit policy

### Requirement: The policy type is submitted explicitly and is never defaulted
The submitted `depositType` SHALL be one of `FIXED` or `PERCENT`. A missing, empty or unrecognized type SHALL be a validation error, and the stored policy SHALL remain unchanged. The database column default SHALL NOT be used as a fallback for a submission that omits the type.

The type and the value are only meaningful together. A `50` typed as fifty pesos and stored as `PERCENT` charges half of every service, and neither half of that mistake looks wrong on its own.

#### Scenario: The type is missing from the submission
- **WHEN** a submission carries a value but no `depositType`
- **THEN** nothing is written and the form reports the type as required

#### Scenario: The type is not a recognized value
- **WHEN** a submission carries a `depositType` outside the enum
- **THEN** nothing is written and the value is never passed to the persistence layer

### Requirement: A fixed deposit is a positive amount below the catalogue ceiling
A `FIXED` value SHALL be greater than zero and at most `MAX_PRICE` (9 999 999,99), with at most two decimal places.

The ceiling SHALL be the same constant the service catalogue uses, not a second copy of the number. Validating below the column's own limit is what makes a PostgreSQL numeric overflow — which is not a typed Prisma error and would surface as a generic infrastructure failure — unreachable by construction.

#### Scenario: A fixed deposit of zero
- **WHEN** the owner saves `FIXED` 0
- **THEN** the value is rejected and nothing is written

#### Scenario: A fixed deposit above the ceiling
- **WHEN** the owner saves a `FIXED` value greater than `MAX_PRICE`
- **THEN** the value is rejected before any database call is made

### Requirement: A percentage is a whole number from 1 to 100
A `PERCENT` value SHALL be an integer between 1 and 100 inclusive. A fractional percentage SHALL be rejected. A value of 100 SHALL be permitted and SHALL be presented to the owner as full prepayment rather than as an ordinary deposit.

#### Scenario: A fractional percentage
- **WHEN** the owner saves `PERCENT` 12,5
- **THEN** the value is rejected and the form reports that the percentage must be a whole number

#### Scenario: A percentage outside the range
- **WHEN** the owner saves `PERCENT` 0 or `PERCENT` 101
- **THEN** the value is rejected and nothing is written

#### Scenario: Full prepayment
- **WHEN** the owner saves `PERCENT` 100
- **THEN** the policy is stored and the page states that clients will pay the full service price in advance

### Requirement: Amounts are parsed in the forms an es-AR owner types, and nothing else
The value SHALL be accepted as `8000`, `8000.50` or `8000,50` — an optional decimal separator, written as either a dot or a comma, and at most two decimal places. It SHALL be rejected as exponent notation, infinity, a signed number, a non-ASCII digit sequence, a number carrying more than two decimal places, or a **thousands-grouped** number such as `8.000,50` or `4.500`.

Grouped input is refused rather than interpreted because it is genuinely ambiguous: `4.500` means four thousand five hundred under es-AR grouping and four and a half under a dot decimal, and no rule can recover which the owner meant. The service catalogue already refuses it for the same reason and reports it with its own error code, so the owner is told they used a thousands separator rather than that they wrote too many decimals.

Parsing SHALL be performed by a single shared money module, reused by the service catalogue with identical behaviour. Two implementations of what counts as a valid amount will diverge, and what would diverge here is a rule about money.

#### Scenario: A grouped amount
- **WHEN** the owner types `8.000,50` as a fixed deposit
- **THEN** the value is rejected with the thousands-separator code, and the owner is asked to write it without grouping

#### Scenario: A decimal written either way
- **WHEN** the owner types `8000,50` and when the owner types `8000.50`
- **THEN** both are stored as 8000.50

#### Scenario: Exponent notation
- **WHEN** a submission carries `1e5`
- **THEN** the value is rejected and never converted to a number

#### Scenario: Excess precision
- **WHEN** a submission carries a value with three decimal places
- **THEN** the value is rejected rather than rounded

### Requirement: Validation reports a distinct code per mistake
The parser SHALL return error **codes**, never user-facing Spanish strings, and SHALL use a distinct code per distinct mistake. Mapping a code to a message SHALL be the presentation layer's responsibility.

A value rejected for its range and one rejected for its format explain different things to the owner, so they SHALL NOT collapse into a single "invalid".

#### Scenario: Two different rejections
- **WHEN** a percentage is out of range and when a percentage is fractional
- **THEN** the parser returns different codes for the two cases

### Requirement: The deposit amount is computed by one authoritative rule
A `DepositPolicy` value object SHALL be the only implementation of the deposit calculation. The booking flow, the payment stories and the statistics module SHALL consume it and SHALL NOT reimplement it.

The calculation SHALL apply in this order:

1. `raw` is the fixed value, or the service price multiplied by the percentage and divided by 100.
2. `raw` is rounded half-up to two decimal places, using integer-cent arithmetic over `Decimal`. A floating-point intermediate SHALL NOT be used.
3. The result is capped at the service price.
4. The result is floored at `MIN_DEPOSIT_AMOUNT`, except where the service price is itself below that floor, in which case the deposit is the service price.

#### Scenario: A percentage that does not divide evenly
- **WHEN** a 30% policy is applied to a price of 2501.67
- **THEN** the deposit is 750.50

#### Scenario: A fixed deposit larger than the service price
- **WHEN** a `FIXED` policy of 5000.00 is applied to a service priced 3000.00
- **THEN** the deposit is 3000.00, never 5000.00

#### Scenario: A computed deposit below the minimum chargeable amount
- **WHEN** a policy computes a deposit below `MIN_DEPOSIT_AMOUNT` for a service priced above it
- **THEN** the deposit is raised to `MIN_DEPOSIT_AMOUNT`

#### Scenario: A service cheaper than the minimum chargeable amount
- **WHEN** a service is priced below `MIN_DEPOSIT_AMOUNT`
- **THEN** the deposit equals the service price and is not raised above it

### Requirement: The minimum chargeable amount is a named constant carrying a stated open item
`MIN_DEPOSIT_AMOUNT` SHALL be declared once as a project constant. Its initial value SHALL be documented as **provisional**, and confirming Mercado Pago's real minimum chargeable amount and updating the constant SHALL be recorded as a pending item that closes before B5 ships.

An unverified floor is a guess about what a payment gateway will accept. Stating that in the code is what stops the next story from treating it as established.

#### Scenario: The constant is read
- **WHEN** the constant is inspected
- **THEN** it carries a note that the value is provisional and names B5 as the point of confirmation

### Requirement: Changing the policy writes nothing beyond the policy itself
A save or removal SHALL write only the deposit policy. It SHALL NOT read, recompute or modify any deposit already recorded elsewhere, and SHALL NOT require any other stored value to be revisited.

This is the half of the snapshot rule that PC3 can actually hold. The other half — that a booking's `depositAmount` is computed once at creation and never recomputed — is a **Booking** guarantee stated in `docs/data-model.md` §11, and belongs to the story that creates bookings (B4). It is deliberately not restated here as a requirement of this capability, because no code in this change can satisfy or violate it, and a spec that claims it would describe an enforcement that does not exist.

#### Scenario: A policy change is self-contained
- **WHEN** the deposit policy is saved or removed
- **THEN** the write touches the policy columns alone and no other stored amount is read or rewritten

### Requirement: Replacing a stored policy requires a confirmation that shows its effect
When a save would replace a stored policy with a different one, the write SHALL NOT proceed on the first submission. The owner SHALL be shown a confirmation listing their existing services with the deposit the submitted policy would charge for each, and the write SHALL proceed only on an explicit confirmation.

The confirmation SHALL be a round trip through the same server action, and the effect SHALL be computed on the server using the same `DepositPolicy` rule as the booking flow. A client-side preview would be a second implementation of a money calculation.

A value that is off by a factor of ten passes every format check. Seeing what it charges against a real service price is the only thing that catches it.

#### Scenario: A percentage is replaced
- **WHEN** the owner with a stored `PERCENT` 3 policy submits `PERCENT` 30
- **THEN** nothing is written and the confirmation shows each service with the deposit 30% would charge

#### Scenario: The owner returns to the editor
- **WHEN** the owner declines the confirmation
- **THEN** nothing is written and the submitted values are returned to the form for editing

#### Scenario: The owner has no services yet
- **WHEN** the confirmation is shown for an owner with no services
- **THEN** the effect list renders an empty state rather than a blank panel

### Requirement: A first configuration and an unchanged re-save are not confirmed
A save SHALL proceed without confirmation when no policy is stored, and when the submitted policy is identical to the stored one.

Friction on every save is friction that gets clicked through, which would defeat the confirmation in the one case it exists for. Going from no policy to a policy has no previous value to be confused with.

#### Scenario: The first policy
- **WHEN** an owner with no stored policy saves one
- **THEN** the policy is written on the first submission

#### Scenario: Re-saving the same policy
- **WHEN** the owner submits a policy identical to the stored one
- **THEN** the save proceeds without a confirmation step

### Requirement: An empty value is a validation error, and removal is an explicit intent
A submission with an empty value SHALL be rejected as a missing required field, and the stored policy SHALL remain unchanged. Removing the policy SHALL require a separate explicit action, and removal of a stored policy SHALL itself require confirmation.

This is a single-field form. If an empty field meant "clear", one keystroke followed by an ordinary save would leave the business unable to take bookings while looking like a successful edit.

#### Scenario: An empty value is submitted
- **WHEN** the owner submits the form with the value field empty
- **THEN** nothing is written, the field reports that a value is required, and the stored policy is intact

#### Scenario: The policy is removed
- **WHEN** the owner invokes the removal action and confirms it
- **THEN** `depositValue` becomes null and the page reports the policy as not configured

#### Scenario: Removal leaves the business unable to take bookings
- **WHEN** removal would leave the owner with no deposit policy
- **THEN** the removal is permitted and the page states that bookings cannot be taken until a policy is set

### Requirement: A fixed deposit that exceeds service prices is reported by name
When a saved `FIXED` policy exceeds the price of one or more existing services, the page SHALL warn the owner and SHALL name the affected services. The warning SHALL NOT block the save.

The warning is a snapshot of the catalogue at save time and stops being true the moment a cheaper service is created. The price cap in the computation is the actual protection; this warning exists so the owner learns about the mismatch at the moment they can act on it.

#### Scenario: A fixed deposit above some prices
- **WHEN** a `FIXED` policy of 5000.00 is saved and two services are priced below it
- **THEN** the policy is stored and the page names those two services

#### Scenario: A fixed deposit below every price
- **WHEN** every service is priced above the fixed deposit
- **THEN** no such warning is shown

### Requirement: A policy that computes below the minimum chargeable amount is reported
When a saved policy would compute a deposit below `MIN_DEPOSIT_AMOUNT` for one or more existing services, the page SHALL warn the owner and SHALL name the affected services and the computed amounts. The warning SHALL NOT block the save.

Without it the failure appears for the first time in a client's checkout, as a payment the gateway refuses to create.

#### Scenario: A small percentage against a cheap service
- **WHEN** a `PERCENT` 1 policy is saved and a service is priced 50.00
- **THEN** the policy is stored and the page reports that the deposit for that service computes below the minimum chargeable amount

### Requirement: The page reports whether the business can take bookings
The page SHALL render a payment readiness panel stating whether the business can accept bookings. Readiness SHALL be true when at least one payment method is configured — Mercado Pago credentials present, or a transfer destination present — **and** a deposit policy is stored.

This is the bookability rule of `docs/data-model.md` §14. This story reports it; the booking flow enforces it. The rule SHALL be expressed as a single domain predicate, not restated per surface.

#### Scenario: Everything configured
- **WHEN** a transfer destination and a deposit policy are stored
- **THEN** the panel reports the business as ready to take bookings

#### Scenario: A payment method with no deposit policy
- **WHEN** Mercado Pago credentials are stored and no deposit policy is
- **THEN** the panel reports the business as not ready and names the missing piece

#### Scenario: A deposit policy with no payment method
- **WHEN** a deposit policy is stored and no payment method is
- **THEN** the panel reports the business as not ready and names the missing piece

### Requirement: The deposit editor never redirects for a missing payment method
The editor SHALL be reachable and usable regardless of whether any payment method is configured. A save that leaves the business without a payment method SHALL be permitted and SHALL be reported by a server-computed warning.

Blocking would trap an owner configuring in a different order, and would contradict the transfer and Mercado Pago editors, which both permit a save that leaves the business unable to take bookings.

#### Scenario: Opening the editor with nothing configured
- **WHEN** an owner with no payment method opens `/sena`
- **THEN** the editor renders and the readiness panel states what is missing

#### Scenario: Saving with no payment method
- **WHEN** a policy is saved while no payment method is configured
- **THEN** the policy is stored and the page warns that no payment method exists

### Requirement: The deposit page does not depend on the credential encryption key
Rendering the deposit editor and its readiness panel SHALL NOT decrypt any stored credential and SHALL NOT construct the credential cipher. Mercado Pago's contribution to readiness SHALL come from the presence flag the repository already derives.

A page about deposit amounts must not fail because of a secret belonging to a different feature. The credential key is validated at the Mercado Pago editor's own composition root precisely so a missing secret breaks one page rather than the dashboard.

#### Scenario: The encryption key is absent
- **WHEN** `PAYMENT_CREDENTIALS_KEY` is not configured and Mercado Pago credentials are stored
- **THEN** `/sena` renders, the readiness panel counts Mercado Pago as configured, and no decryption is attempted

### Requirement: The stored policy is echoed back normalized, in the form each surface needs
After a successful save the owner SHALL be shown what was stored rather than the characters they typed. Two surfaces show it differently, and the difference is required:

- The **input field** SHALL carry the canonical value (`8000.50`, `30`). It must be re-submittable unchanged: an es-AR rendering here would put a thousands separator in the field, and pressing save again without touching anything would be rejected — a save that succeeds and then fails on the identical value.
- The **stored-policy panel and the effect preview** SHALL render es-AR (`$8.000,50`, `30%`), because they are read, not re-submitted.

A percentage SHALL drop the decimals the `Decimal(12, 2)` column adds: a stored `30.00` is shown as `30`, which is what the owner wrote and the only value the whole-number rule accepts back.

Reading back what was actually stored is the owner's only check that the value they intended is the value the system holds.

#### Scenario: A fixed amount is saved
- **WHEN** the owner saves `8000,50` as a fixed deposit
- **THEN** the input field holds `8000.50` and the stored-policy panel shows `$8.000,50`

#### Scenario: The echoed value is submitted again unchanged
- **WHEN** the owner saves, and then submits the echoed value again without editing it
- **THEN** the second submission is accepted and stores the same amount

#### Scenario: A stored percentage is shown without the column's decimals
- **WHEN** a policy stored as `30.00` is loaded into the editor
- **THEN** the input field holds `30` and the stored-policy panel shows `30%`

### Requirement: The editor is owner-authenticated at the action boundary
Every server action in this feature SHALL resolve the authenticated owner as its first statement, before reading any submitted field.

Middleware passes the action request through, so the action itself is the entire authorization boundary.

#### Scenario: An unauthenticated invocation
- **WHEN** a deposit policy action is invoked without an authenticated owner
- **THEN** the action does not read the submission and does not write

### Requirement: Confirmation answers are namespaced per form
The confirmation answer SHALL travel on the pressed button, and its values SHALL be prefixed per feature — `deposit-*` for this editor, and the transfer and Mercado Pago editors' existing values renamed to `transfer-*` and `mp-*`.

A form request returns the first value for a repeated name. Once two confirming forms can appear on one page, one form's confirmation would be consumed by the other's action, and both of those forms decide where a client's money goes.

#### Scenario: Two confirming forms on one page
- **WHEN** a page renders the deposit form alongside another confirming form
- **THEN** each action reads only its own prefixed intent

### Requirement: A write that cannot be acknowledged tells the owner to reload
When a save fails at the persistence layer, the page SHALL tell the owner to reload to see the current state, rather than asserting that nothing was saved.

The write may have committed before the connection dropped. Reporting a definite failure would leave the owner unable to distinguish "not saved" from "saved and not acknowledged", and the value decides what every future client is charged.

#### Scenario: The database fails during a save
- **WHEN** the persistence call throws
- **THEN** the page reports the uncertainty and asks the owner to reload

### Requirement: Each successful write emits one structured log line carrying the full values
A successful save or removal SHALL emit one structured log entry carrying the operation, the owner id, the previous type and value, the new type and value, whether the business is left without a payment method, and how many services fall below the computed deposit.

The deposit policy is not a secret — it is disclosed to every client who books — so it SHALL be logged in full rather than redacted. This is a deliberate difference from the transfer and credential editors, and it is what makes a later question about when the deposit changed answerable from the log stream.

#### Scenario: A policy is replaced
- **WHEN** a stored `PERCENT` 30 policy is replaced by `FIXED` 2000.00
- **THEN** one log line records both the previous and the new type and value

### Requirement: The editor renders a distinct state for each outcome
The page SHALL render distinguishable states for: loading, no policy configured, a policy configured, the replacement confirmation with its effect list, a field-level validation error, a completed save, a fixed deposit exceeding service prices, a save leaving no payment method, the readiness panel, and an infrastructure failure.

The policy type selector SHALL be a labelled group of options. Its choice SHALL change which validation rule applies, and that rule SHALL be re-derived on the server from the submitted type; any client-side affix or hint SHALL be presentation only.

All owner-facing copy SHALL be Spanish (es-AR) and SHALL be defined in the shared copy module.

#### Scenario: A client-side hint is bypassed
- **WHEN** a submission carries a type and a value that the client-side hint would not have allowed together
- **THEN** the server applies the rule for the submitted type and rejects the value on its own merits

#### Scenario: No policy is configured
- **WHEN** an owner with no stored policy opens the page
- **THEN** the page renders an explicit unconfigured state rather than an empty form
