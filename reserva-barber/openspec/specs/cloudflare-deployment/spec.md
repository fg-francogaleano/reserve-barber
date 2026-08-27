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

