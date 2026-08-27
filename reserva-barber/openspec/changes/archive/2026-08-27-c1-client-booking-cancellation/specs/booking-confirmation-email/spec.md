## MODIFIED Requirements

### Requirement: The email carries the appointment, the money and the client's own link

The message SHALL carry: the shop's public name, the branch name and address, the barber's display name, the service name, the appointment's date and start time, the deposit already paid, the balance payable at the shop, and a link to the client's booking page.

The appointment SHALL be formatted in the **business** timezone through the shared business-time module, never in the runtime's timezone and never in the recipient's. The rule the booking domain already states applies here: a second expression of a rule that reads a clock drifts from the first.

Monetary values SHALL be rendered from the canonical decimal strings the repository boundary produces, through the same formatter the pages use.

The link SHALL address the existing confirmation page by the booking's `cancellationToken`. **A URL for a route that does not yet exist SHALL NOT be emailed**, because an email cannot be redeployed and a 404 in an inbox is permanent.

**The link's described purpose SHALL name cancelling, now that the page can do it.** The message offered the page as somewhere to *see* the appointment because that was all it could do; the same sentence in the same inbox now understates a control that is one click away, and a client who cannot come would go on writing to the shop rather than using the link they were sent. The wording SHALL NOT imply that following the link cancels anything — the page renders, and cancelling takes a further deliberate step.

**The message SHALL NOT carry a direct link to the cancellation itself.** The cancellation is a `POST` behind a confirmation for the reason recorded against the unverified-recipient debt, and a URL in an email that performs the action would defeat exactly that.

The fallback used when no public origin is configured, which tells a client to contact the shop in order to change or cancel, SHALL remain unchanged: with no link there is still nothing else they can do.

The link SHALL appear as a visible, complete URL in addition to any styled control, so that a plain-text rendering, a forward, or a client that strips markup still carries it.

The message SHALL be sent with a plain-text alternative alongside any markup rendering, and SHALL reference no remote images.

#### Scenario: The appointment is in the shop's timezone
- **WHEN** the email is built for an appointment stored as an instant
- **THEN** the rendered date and time are the business-local ones, produced by the shared business-time module

#### Scenario: The balance is stated
- **WHEN** the email is built for a booking whose price exceeds its deposit
- **THEN** it states the deposit already paid and the amount payable at the shop

#### Scenario: The link says the page can cancel
- **WHEN** the message is composed with a public origin configured
- **THEN** its description of the link names cancelling as something the client can do there

#### Scenario: No URL in the message performs a cancellation
- **WHEN** every URL in the message is fetched
- **THEN** no booking changes status

#### Scenario: The no-link fallback is unchanged
- **WHEN** no public origin is configured
- **THEN** the message tells the client to contact the shop to change or cancel, and carries no URL

#### Scenario: The link survives plain text
- **WHEN** the plain-text alternative is rendered
- **THEN** the complete booking URL appears as readable text

#### Scenario: No remote assets
- **WHEN** the message is reviewed
- **THEN** it requests no image or asset from a remote host
