## MODIFIED Requirements

### Requirement: Secrets via Wrangler
Runtime secrets (`DATABASE_URL`, `PAYMENT_CREDENTIALS_KEY`) SHALL be provided to the deployed Worker exclusively via `wrangler secret put`, and locally via `.dev.vars` (git-ignored). Deploy without a secret set MUST be diagnosable from a single startup log line.

Secret values SHALL be uploaded as exact bytes, piped from a file or a program's output rather than typed through a shell echo. A byte-order mark or a trailing newline is invisible in the terminal and corrupts the value; for `DATABASE_URL` it surfaced as an unrelated connection error, and for `PAYMENT_CREDENTIALS_KEY` it surfaces as stored credentials that cannot be decrypted.

`PAYMENT_CREDENTIALS_KEY` SHALL be validated at the composition root of the feature that uses it rather than in the application's global startup validation, so that a deploy missing it breaks that feature alone instead of the whole dashboard. `DATABASE_URL` remains globally validated, because nothing in the application works without it.

#### Scenario: Deploy with missing secret
- **WHEN** the app is deployed without `DATABASE_URL` set
- **THEN** the first request logs one English line naming the missing variable and the visitor sees the generic error state

#### Scenario: Deploy without the credential encryption key
- **WHEN** the app is deployed without `PAYMENT_CREDENTIALS_KEY` set
- **THEN** the payment credentials feature reports the missing variable by name and every other dashboard page continues to work

#### Scenario: A secret uploaded with stray bytes
- **WHEN** a secret is set from a value carrying a byte-order mark or a trailing newline
- **THEN** the resulting runtime failure is attributable to the secret rather than presented as an unrelated error

## ADDED Requirements

### Requirement: The encryption path is verified against the deployed Worker
Before this change is closed, a credential SHALL be stored and read back through the deployed Worker, using the production key.

The cipher can pass every local test and fail in production, because the production key exists only there and only the deployed runtime exercises it. No local or preview run substitutes for this check.

#### Scenario: Post-deploy verification
- **WHEN** the change is ready to close
- **THEN** a credential saved through the deployed Worker has been read back successfully, and the result is recorded
