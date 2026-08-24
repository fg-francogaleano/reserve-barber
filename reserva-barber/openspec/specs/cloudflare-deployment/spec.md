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

**A secret reaches request-handling code and scheduled code by different routes**, and the difference SHALL be respected rather than assumed away: request handling reads the process environment the adapter populates, while a scheduled invocation receives its bindings as an argument. A secret that is correctly set is still unreadable from a scheduled handler that looks for it in the wrong place, and that failure produces no log line from the startup validation, because no request started.

#### Scenario: Deploy with missing secret
- **WHEN** the app is deployed without `DATABASE_URL` set
- **THEN** the first request logs one English line naming the missing variable and the visitor sees the generic error state

#### Scenario: Deploy without the credential encryption key
- **WHEN** the app is deployed without `PAYMENT_CREDENTIALS_KEY` set
- **THEN** the payment credentials feature reports the missing variable by name and every other dashboard page continues to work

#### Scenario: A secret uploaded with stray bytes
- **WHEN** a secret is set from a value carrying a byte-order mark or a trailing newline
- **THEN** the resulting runtime failure is attributable to the secret rather than presented as an unrelated error

#### Scenario: A scheduled invocation reads the same secret from its own environment
- **WHEN** a scheduled handler needs `DATABASE_URL`
- **THEN** it reads it from the invocation's environment argument and reports its absence by name
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

### Requirement: A scheduled job is deployed as its own Worker, never as a handler on the application's

Work triggered by a schedule SHALL be deployed as a separate Worker with its own configuration, its own secrets and its own trigger. The application's Worker SHALL continue to be the unmodified OpenNext build output, and its configuration SHALL declare no schedule.

**The reason is a measured size property, not a preference.** The generated worker exports `fetch` and its Durable Object classes and nothing else, and it is rewritten by every build, so a scheduled handler can only be added by a committed entrypoint that wraps it. Such an entrypoint costs nothing by itself — but anything it imports from application source is compiled by the deployment tool's own bundler, separately from the copy the framework adapter already bundled, and the Prisma query compiler is therefore carried **twice**. Measured at 2924 KiB gzip for the wrapper alone and 3812 KiB once it imported the job, against a 3 MiB plan ceiling.

This generalizes beyond one job: **a custom entrypoint cannot import application code that reaches the database client.** A separate Worker makes the duplication moot, because the one copy it carries is the only copy in it.

A scheduled Worker SHALL declare the same compatibility date and flags as the application's, since both run the same database client against the same database and a divergence between them would be invisible until one misbehaved.

It SHALL NOT expose a `fetch` handler. A job nobody can reach over HTTP needs no authentication, no rate limit and no entry in the route guard.

The rejected alternative SHALL be recorded with its reason: an HTTP endpoint invoked by the schedule would keep a single deploy at the cost of a door in a deny-by-default route guard plus a shared secret to defend it.

#### Scenario: The application's build output is deployed unmodified
- **WHEN** the application Worker is deployed
- **THEN** its entrypoint is the generated build output and its configuration declares no schedule

#### Scenario: Each Worker stays under the plan's size ceiling
- **WHEN** both Workers are measured before deploy
- **THEN** neither carries a second copy of the database query compiler, and each is reported under the ceiling

#### Scenario: The scheduled Worker cannot be reached over HTTP
- **WHEN** the scheduled Worker is reviewed
- **THEN** it exports no `fetch` handler and no route guard entry exists for it

#### Scenario: Its secrets are its own
- **WHEN** the scheduled Worker needs the database connection string
- **THEN** it is set on that Worker separately from the application's, and its absence is reported by name

### Requirement: A scheduled invocation runs in a different environment from every request

Code reached from a scheduled invocation SHALL obtain its configuration from the invocation's environment argument, and SHALL NOT rely on the request-scoped process environment or on request-scoped caching.

There is no request context in a scheduled invocation: the per-request client factory used everywhere else in this project is memoized with a request-scoped cache and reads its connection string from the process environment, and neither is populated here. A scheduled job written against those assumptions fails in a way nothing else in the product reveals — every page keeps working, and the job simply never does anything.

A missing or unusable binding SHALL be reported as an error naming the variable, and SHALL NOT be reported as a run that found no work.

#### Scenario: The scheduled path builds its own client
- **WHEN** the scheduled handler needs database access
- **THEN** it constructs a client from the connection string on the environment argument rather than from the request-scoped factory

#### Scenario: A missing binding is named
- **WHEN** the scheduled handler runs without a usable connection string
- **THEN** an error naming the variable is emitted

### Requirement: The scheduled trigger is exercised before deploy

A scheduled handler SHALL be fired by hand against the local runtime before it is deployed, because no unit test executes the entrypoint and no page reveals whether the handler works.

The three-environment verification order applies to this handler as it does to a route, with the local runtime's own scheduled-trigger facility standing in for opening a page.

The command that fires it SHALL be committed as a script rather than left to be typed. The local scheduled endpoint exists **only** when the dev server is started with the flag that enables it; without that flag the same URL is an ordinary path, and in this application the route guard answers it with a redirect and a `200` — a green-looking result that fired no handler at all.

#### Scenario: The handler is fired locally
- **WHEN** the local runtime's scheduled trigger is invoked for the configured schedule
- **THEN** the handler executes against the real database and emits its summary

#### Scenario: The flag cannot be forgotten
- **WHEN** a developer runs the committed preview script for a scheduled Worker
- **THEN** the flag enabling the scheduled endpoint is already part of it

#### Scenario: The schedule is registered after deploy
- **WHEN** the deploy completes
- **THEN** the configured schedule is visible on the deployed Worker
