## ADDED Requirements

### Requirement: The flow is six steps and its progress is computed, never counted by hand

The flow SHALL be branch, service, barber, date, time, details. The step indicator and the selection summary SHALL derive the total and the current position from the flow definition rather than from a literal, so that B2's single-offerable-branch skip continues to produce a correct indicator without a second rule.

Every step SHALL keep the explicit back control and the persistent summary of what is already selected, and the summary SHALL name the chosen date and time once they exist.

#### Scenario: Six steps with a branch choice
- **WHEN** a shop with two offerable branches renders any step
- **THEN** the indicator reports six steps and marks the current one programmatically

#### Scenario: Five steps when the branch is implied
- **WHEN** a shop with exactly one offerable branch renders any step
- **THEN** the indicator reports five steps, and the branch is named in the summary and remains changeable

#### Scenario: The summary carries the whole selection
- **WHEN** the details step renders with a branch, service, barber, date and time chosen
- **THEN** all five appear in the summary in es-AR

### Requirement: The route reads no payment credential

No request to `/b/{slug}/reservar` SHALL read `PaymentConfig.mpAccessToken`, construct a credential cipher, or construct a Supabase client. The composition root SHALL hand over no repository method capable of returning a stored credential.

The route MAY read the **payment-readiness projection** — the presence of Mercado Pago credentials, the transfer destination fields and the deposit value — and only on the details step, which is where the readiness gate is enforced. That projection's type SHALL have no field able to hold the access token.

This is the narrowing B2 anticipated. Its requirement forbade reading `PaymentConfig` at all, and the reason it gave was the encrypted token, not the row: *"moving the payment gate here would put the encrypted token one query away from an anonymous, unauthenticated, unrate-limited route."* B4 is the story that must ask whether a deposit can be charged, so the guarantee moves from an absent dependency to a type that cannot express the leak.

The earlier steps SHALL still read nothing. A client on the branch, service, barber, date or time step SHALL issue no payment-configuration query at all.

#### Scenario: The gate reads only what it needs
- **WHEN** the details step renders
- **THEN** the executed query selects no credential column and the readiness type cannot represent one

#### Scenario: Earlier steps read nothing
- **WHEN** a client is on the branch, service, barber, date or time step
- **THEN** no `PaymentConfig` row is read

#### Scenario: Composition review
- **WHEN** the change is complete
- **THEN** the public composition root constructs no Supabase client and no credential cipher, and a missing encryption key does not affect this route

## REMOVED Requirements

### Requirement: The flow is five steps and its progress is computed, never counted by hand

**Reason**: The flow gains a sixth step — the client's contact details — which is where a selection becomes a booking. The requirement's substance is unchanged and is restated above with the new count; only the number and the final step's name differ.

**Migration**: Replaced by "The flow is six steps and its progress is computed, never counted by hand" in this same capability. The derived-rather-than-literal rule and the single-branch skip behave exactly as before; a correct implementation of the old requirement needs the flow definition extended, not the indicator rewritten.

### Requirement: The route reads no payment configuration

**Reason**: The prohibition was absolute because no surface in B1, B2 or B3 needed the row, and the cheapest guarantee was to hand the flow no repository at all. B4 enforces the payment-readiness gate, which is a question about that row, so an absolute prohibition would make the gate unimplementable at the place the specification puts it. What the requirement was protecting — the encrypted access token — is protected more strongly by a projection that cannot carry it.

**Migration**: Replaced by "The route reads no payment credential" in this same capability. The accepted consequence B2 named — that a client can complete the catalogue and schedule steps at a shop with no deposit configured — still stands; the wall is now built at the details step, which is where B2 said it would be.

### Requirement: A completed selection ends in a disclosed, inert confirmation

**Reason**: The inert call to action existed because the route it would point at did not. This change builds that route. Keeping the requirement would forbid the story from doing the one thing it exists to do.

**Migration**: The behaviour moves to the `booking-creation` capability, which requires the completed selection to lead to the client-details step. The disclosure the inert control carried is not dropped — it moves to the hold-confirmation page, where "your slot is held and payment is not available yet" is finally a true statement rather than a placeholder. The rules the retired requirement carried — never link to a route that does not exist, never link into a dashboard route — remain in force through `booking-creation`'s outcome-state and no-disclosure requirements.
