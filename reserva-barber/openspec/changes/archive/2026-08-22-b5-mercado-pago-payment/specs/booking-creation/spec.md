## MODIFIED Requirements

### Requirement: The confirmation page is authorized by the cancellation token and leaks nothing

On success the client SHALL be redirected to a page addressed by the booking's `cancellationToken`, not by its id. The token is already unique and unguessable, is held by exactly this person, and is the same credential the confirmation email will carry — a second view-only secret would be two secrets for one holder.

That route SHALL send `Referrer-Policy: no-referrer`. Without it, the redirect to Mercado Pago that this flow now performs would carry the token to a third party in the `Referer` header. Because that redirect now exists, the header SHALL be covered by a regression test: removing it would break nothing visible in the payment flow.

The page SHALL show the appointment, the deposit amount and the time remaining on the hold. It SHALL offer the client a way to pay that deposit — the payment states are specified in the `payment-mercado-pago` capability — and SHALL NOT state that payment is unavailable, which was true only while no payment path existed. It SHALL NOT render the client's email or phone back, since the link can be shared or opened on a shared device. It SHALL read the booking's live state rather than trusting the redirect, so a hold that lapsed while the page was open is not shown counting down, and a booking confirmed by a notification that arrived while the page sat open is shown as confirmed.

#### Scenario: A successful creation
- **WHEN** a booking is created
- **THEN** the response redirects to the confirmation page for that booking's cancellation token

#### Scenario: The token does not leak onward
- **WHEN** the confirmation page is served
- **THEN** it carries `Referrer-Policy: no-referrer`

#### Scenario: The header is protected by test
- **WHEN** `Referrer-Policy: no-referrer` is removed from the confirmation route
- **THEN** a test fails

#### Scenario: Contact details are not echoed
- **WHEN** the confirmation page renders
- **THEN** the client's email and phone appear nowhere in the response

#### Scenario: An unknown token
- **WHEN** the page is opened with a token that matches no booking
- **THEN** the response is 404 and discloses nothing about whether the token ever existed

#### Scenario: The page no longer denies that payment is possible
- **WHEN** the confirmation page renders for a live hold at a shop with Mercado Pago configured
- **THEN** it offers a payment control and contains no statement that payment is unavailable
