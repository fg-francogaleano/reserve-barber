## MODIFIED Requirements

### Requirement: Secrets via Wrangler
Runtime secrets (`DATABASE_URL`, `PAYMENT_CREDENTIALS_KEY`, `RESEND_API_KEY`) SHALL be provided to the deployed Worker exclusively via `wrangler secret put`, and locally via `.dev.vars` (git-ignored). Deploy without a secret set MUST be diagnosable from a single startup log line.

Secret values SHALL be uploaded as exact bytes, piped from a file or a program's output rather than typed through a shell echo. A byte-order mark or a trailing newline is invisible in the terminal and corrupts the value; for `DATABASE_URL` it surfaced as an unrelated connection error, for `PAYMENT_CREDENTIALS_KEY` it surfaces as stored credentials that cannot be decrypted, and for `RESEND_API_KEY` it surfaces as a provider rejection that looks like a wrong key rather than a mangled one.

`PAYMENT_CREDENTIALS_KEY` and `RESEND_API_KEY` SHALL each be validated at the composition root of the feature that uses them rather than in the application's global startup validation, so that a deploy missing one breaks that feature alone instead of the whole dashboard. `DATABASE_URL` remains globally validated, because nothing in the application works without it.

`RESEND_API_KEY` SHALL be set on the application Worker only. The scheduled Worker sends nothing, and a secret placed where it is not needed is a second place to remember when rotating it.

**A secret reaches request-handling code and scheduled code by different routes**, and the difference SHALL be respected rather than assumed away: request handling reads the process environment the adapter populates, while a scheduled invocation receives its bindings as an argument. A secret that is correctly set is still unreadable from a scheduled handler that looks for it in the wrong place, and that failure produces no log line from the startup validation, because no request started.

#### Scenario: Deploy with missing secret
- **WHEN** the app is deployed without `DATABASE_URL` set
- **THEN** the first request logs one English line naming the missing variable and the visitor sees the generic error state

#### Scenario: Deploy without the credential encryption key
- **WHEN** the app is deployed without `PAYMENT_CREDENTIALS_KEY` set
- **THEN** the payment credentials feature reports the missing variable by name and every other dashboard page continues to work

#### Scenario: Deploy without the email provider key
- **WHEN** the app is deployed without `RESEND_API_KEY` set
- **THEN** bookings still confirm, the missing variable is reported by name in the log, and no page, endpoint or dashboard action fails

#### Scenario: A secret uploaded with stray bytes
- **WHEN** a secret is set from a value carrying a byte-order mark or a trailing newline
- **THEN** the resulting runtime failure is attributable to the secret rather than presented as an unrelated error

#### Scenario: The scheduled Worker carries no sending credential
- **WHEN** the scheduled Worker's secrets are reviewed
- **THEN** the email provider key is not among them

#### Scenario: A scheduled invocation reads the same secret from its own environment
- **WHEN** a scheduled handler needs `DATABASE_URL`
- **THEN** it reads it from the invocation's environment argument and reports its absence by name

## ADDED Requirements

### Requirement: The public origin stops being cosmetic and its absence is reported

`APP_ORIGIN` SHALL remain a committed, non-secret variable in the application's Wrangler configuration, and the sender address belongs in the same place and for the same reason: a value kept only in the hosting dashboard is a value the next deploy from a fresh clone silently lacks.

**A non-secret variable whose correct value is not yet known SHALL be left absent, never populated with a plausible placeholder.** The absence is reported by the feature that needs it; a placeholder is not, and one that partly works — a shared sender that reaches the account owner and nobody else — is indistinguishable from a working deployment until real clients stop receiving mail. The intended value SHALL be documented in the configuration instead.

**Its absence SHALL no longer be silent.** Until this change, a missing origin degraded only the public profile's social-preview tags, with no error and no log — the sole symptom being a preview nobody sees. It now also removes the link from every confirmation email, which is the reason the email exists. Any path that composes an outbound link SHALL log an error naming the missing origin when none resolves.

The origin used in an outbound link SHALL come from configuration alone and SHALL be checked by the shared origin module that already refuses loopback and private addresses. No request header SHALL contribute to it, and no loopback or relative URL SHALL be emitted into a message.

#### Scenario: A deploy without an origin is reported
- **WHEN** a booking is confirmed on a deployment with no `APP_ORIGIN`
- **THEN** an error naming the missing origin is logged and the message is sent without a link

#### Scenario: A local origin is refused for an outbound link
- **WHEN** the configured origin is a loopback or private address
- **THEN** no such URL is composed into an outbound message

#### Scenario: A value that is not yet known is absent rather than guessed
- **WHEN** the Wrangler configuration is reviewed before a sending domain has been verified
- **THEN** the sender variable is absent, its intended form is documented in the file, and no shared-sender placeholder stands in for it

---

### Requirement: A Worker size measurement is taken before and after a change that adds an outbound integration

Any change that introduces a new outbound integration SHALL measure the deployed bundle with a dry-run build before and after, and SHALL record both figures with the remaining headroom.

The reported figure SHALL be treated as a **lower bound and never as a gate**: Cloudflare's server-side measurement is stricter than the number the tool prints, proven by a build reporting a fit of seven kibibytes that the API rejected. A dry run can establish "definitely too big"; it cannot establish "this will fit".

A vendor SDK SHALL NOT be added for an integration that a small number of endpoints can reach over the platform `fetch`.

#### Scenario: The change is measured
- **WHEN** the integration is complete
- **THEN** the before and after gzip figures and the remaining headroom are recorded

#### Scenario: No SDK is introduced
- **WHEN** the dependency manifest is compared before and after
- **THEN** no vendor package was added for the integration

#### Scenario: A fit is not claimed from the dry run
- **WHEN** the measurement is reported
- **THEN** it states remaining headroom rather than asserting that a further amount may safely be added
