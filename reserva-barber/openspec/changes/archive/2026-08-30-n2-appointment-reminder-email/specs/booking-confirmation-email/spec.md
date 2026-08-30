## MODIFIED Requirements

### Requirement: Configuration for sending is validated at this feature's own composition root

The provider API key SHALL be a deployment secret, supplied by `wrangler secret put` and by the git-ignored local variables file, uploaded as exact bytes.

The sender address SHALL be a non-secret deployment variable belonging in the committed Wrangler configuration, so that a deploy from a fresh clone does not silently lack it.

**Neither value SHALL have a default, and the sender address especially SHALL NOT fall back to a provider's shared onboarding sender.** Such a sender delivers only to the provider account owner's own address — so it would pass a verification performed from that inbox and silently drop every real client, which is the one failure this capability has no way to detect. Until a verified sender exists the variable SHALL be **absent**, which is a handled state, rather than populated with a value that partly works.

The key SHALL be validated at the composition root of this capability and **never** in the application's global startup validation. A missing value SHALL disable confirmation emails alone; it SHALL NOT break the notification endpoint, the review queue, or any page.

**Reading those values from the process environment is a convenience of the request-served composition roots, not the contract.** The shared sender factory SHALL accept the key and the sender address as explicit arguments, and the process-environment read SHALL be a thin wrapper over that entry point. A caller with no request context — a scheduled invocation, where the process environment is not populated from deployment bindings — SHALL be able to construct a fully configured sender without depending on runtime behaviour this project has not measured.

The factory SHALL continue to return a sender that cannot send, rather than throwing, when either value is absent by either route.

#### Scenario: The key is missing
- **WHEN** the application is deployed without the provider key
- **THEN** confirmations are still processed, the failure is logged by name, and no other feature is affected

#### Scenario: The sender address is missing
- **WHEN** the application is deployed without a sender address
- **THEN** it is reported by name alongside any other missing value, and no default sender is substituted

#### Scenario: The committed configuration carries no placeholder
- **WHEN** the deployment configuration is reviewed before a domain has been verified
- **THEN** the sender variable is absent, and its intended value is documented rather than guessed

#### Scenario: A caller with no request context configures the sender explicitly
- **WHEN** the sender factory is called with a key and a sender address supplied directly
- **THEN** it returns a sending adapter without reading any process environment

#### Scenario: The request-served roots are unchanged
- **WHEN** a confirmation is sent from the notification endpoint or the receipt review
- **THEN** the configuration still comes from the process environment and every existing behaviour is unchanged
