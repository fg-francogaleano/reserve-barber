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
Runtime secrets (`DATABASE_URL`) SHALL be provided to the deployed Worker exclusively via `wrangler secret put`, and locally via `.dev.vars` (git-ignored). Deploy without the secret set MUST be diagnosable from a single startup log line.

#### Scenario: Deploy with missing secret
- **WHEN** the app is deployed without `DATABASE_URL` set
- **THEN** the first request logs one English line naming the missing variable and the visitor sees the generic error state

### Requirement: Stack validation decision note
Upon completing the walking skeleton, a decision note SHALL be recorded in `docs/` documenting: the Next.js and `@opennextjs/cloudflare` versions used, the Prisma version and adapter configuration validated on `workerd`, the pooler configuration (host, port, transaction mode), and any workarounds required.

#### Scenario: Decision note exists after completion
- **WHEN** the change is ready to archive
- **THEN** the decision note exists in `docs/` with the validated versions and configuration
