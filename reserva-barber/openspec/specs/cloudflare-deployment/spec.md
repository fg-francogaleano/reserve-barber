# cloudflare-deployment Specification

## Purpose

Build, preview (`workerd` locally), and deploy pipeline via `@opennextjs/cloudflare` + Wrangler, with secrets management and the three-environment verification gate (dev → preview → deployed).

## Requirements

### Requirement: Cloudflare build and deploy pipeline
The project SHALL build and deploy to Cloudflare Workers via `@opennextjs/cloudflare` and Wrangler, exposing `npm run preview` (local `workerd` runtime) and `npm run deploy` scripts. The OpenNext/Next.js version compatibility MUST be verified before implementation; if Next.js 16.2.x is unsupported, Next.js SHALL be pinned to the latest supported minor and the decision recorded.

#### Scenario: Preview on workerd is the pass/fail gate
- **WHEN** `npm run preview` runs the OpenNext build on the local `workerd` runtime
- **THEN** the home page renders the seeded locations from the real database — failure here blocks deploy and triggers the stack-revisit protocol from `docs/roadmap.md` Dependency Notes

#### Scenario: Deployed app serves the page
- **WHEN** `npm run deploy` completes and the Cloudflare URL is opened
- **THEN** the home page renders the seeded location list end to end

### Requirement: Three-environment verification order
Verification SHALL be executed and gated in order: (1) `next dev` (Node), (2) `npm run preview` (`workerd` locally), (3) deployed Cloudflare URL. Each environment MUST pass before proceeding to the next.

#### Scenario: workerd-only failure surfaces before deploy
- **WHEN** code passes `next dev` but fails on `npm run preview` (driver-adapter incompatibility, Node built-ins, bundle limits)
- **THEN** the failure is caught at the preview gate, before any deploy attempt

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

### Requirement: Stack validation decision note
Upon completing the walking skeleton, a decision note SHALL be recorded in `docs/` documenting: the Next.js and `@opennextjs/cloudflare` versions used, the Prisma version and adapter configuration validated on `workerd`, the pooler configuration (host, port, transaction mode), and any workarounds required.

#### Scenario: Decision note exists after completion
- **WHEN** the change is ready to archive
- **THEN** the decision note exists in `docs/` with the validated versions and configuration

### Requirement: The encryption path is verified against the deployed Worker
Before this change is closed, a credential SHALL be stored and read back through the deployed Worker, using the production key.

The cipher can pass every local test and fail in production, because the production key exists only there and only the deployed runtime exercises it. No local or preview run substitutes for this check.

#### Scenario: Post-deploy verification
- **WHEN** the change is ready to close
- **THEN** a credential saved through the deployed Worker has been read back successfully, and the result is recorded
