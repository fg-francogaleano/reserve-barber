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

**This applies to every configuration value a scheduled job reaches, not only the database connection string.** A shared factory whose only entry point reads the process environment SHALL gain one that takes its values as arguments, and the scheduled composition root SHALL use that one. A scheduled path SHALL NOT depend on the runtime populating a process environment from deployment bindings, whether or not a given compatibility date does so — that is a runtime behaviour this project has not measured, and the project's rule is to measure a runtime difference rather than assume it.

**The severity of getting this wrong depends on what the job writes first.** A job that records its work only after an external call fails visibly and retries; a job that claims its work before the call, in order to be idempotent, marks everything as done and delivers nothing — permanently, on its first run, with every page, test and status check still reporting correctly. A scheduled composition root SHALL therefore be covered by a test asserting that it constructs configured collaborators when the environment supplies the values.

A missing or unusable binding SHALL be reported as an error naming the variable, and SHALL NOT be reported as a run that found no work.

#### Scenario: The scheduled path builds its own client
- **WHEN** the scheduled handler needs database access
- **THEN** it constructs a client from the connection string on the environment argument rather than from the request-scoped factory

#### Scenario: A missing binding is named
- **WHEN** the scheduled handler runs without a usable connection string
- **THEN** an error naming the variable is emitted

#### Scenario: Every collaborator is configured from the environment argument
- **WHEN** a scheduled job needs an outbound integration's credentials
- **THEN** they come from the invocation's environment argument, passed explicitly into the factory that builds it

#### Scenario: The composition root is tested
- **WHEN** the scheduled composition root is built with a complete environment
- **THEN** a test asserts that it produced configured collaborators rather than their unconfigured stand-ins

---

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

**Every Worker that composes an outbound link SHALL carry it, not only the one that serves pages.** A scheduled Worker that sends a message containing a link needs the same variable, in its own committed configuration, set separately from the application's — and any comment in that configuration asserting the Worker has no such variable SHALL be rewritten rather than left standing, because a justification a change has falsified is a statement the next reader will trust.

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

#### Scenario: The scheduled Worker carries the origin too
- **WHEN** the scheduled Worker's configuration is reviewed after it gains a job that composes a link
- **THEN** the origin variable is declared there, and no comment claims the Worker has none

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


### Requirement: A second scheduled job shares the Worker but not its failure

A further scheduled job SHALL be added to the existing scheduled Worker rather than to a new one. The reason the first job left the application's Worker — a custom entrypoint cannot import application code that reaches the database client without bundling the query compiler a second time — does not apply between two jobs that already share that one copy, and a further Worker would cost a further deploy, a further connection-string upload and a further copy of the same compiler.

**The jobs SHALL be dispatched by the schedule expression that fired the invocation, and SHALL NOT be invoked from one shared handler body.** A scheduled job rethrows on failure specifically so the platform marks the invocation failed, since a dead job that looks healthy is the failure this whole family of jobs is written against. Sharing a handler would mean either one job's fault marking the other's invocation failed, or one job's rethrow preventing the other from reporting. Dispatching preserves both properties.

Each job SHALL declare its own schedule expression, and a cadence SHALL be chosen as a data-freshness property rather than a correctness one. A job whose candidate rule is self-healing SHALL NOT have a cadence its correctness depends on.

The Worker SHALL still expose no `fetch` handler.

Each job SHALL emit its own summary under its own operation name, so that an operator can tell which of them ran.

#### Scenario: Both schedules are declared
- **WHEN** the scheduled Worker's configuration is reviewed
- **THEN** it declares one schedule expression per job

#### Scenario: An invocation runs exactly one job
- **WHEN** a scheduled invocation arrives
- **THEN** the handler selects one job from the schedule expression that fired it and runs only that one

#### Scenario: One job's failure leaves the other's schedule healthy
- **WHEN** one job throws during its invocation
- **THEN** no invocation of the other job is marked failed

#### Scenario: The Worker is still unreachable over HTTP
- **WHEN** the scheduled Worker is reviewed after gaining a second job
- **THEN** it still exports no `fetch` handler

---

### Requirement: A secret shared by two Workers is uploaded to each of them, as exact bytes, from a file

When two Workers need the same credential, it SHALL be set on each of them separately. There is no shared secret store between Workers in this deployment, and a credential present on one is absent on the other with no symptom other than the feature that needs it failing.

It SHALL be uploaded as **exact bytes**, from a file or a program's output, never typed at an interactive prompt and never echoed through a shell. A byte-order mark, a trailing newline or a truncated paste is invisible in every listing, because a listing shows the name and never the value — and a guard that tests for an absent value is satisfied by an empty string just as it is by an undefined one.

The deployment configuration SHALL record which credentials it expects and the command that sets them, so that a Worker deployed from a fresh clone does not silently lack one.

#### Scenario: The same credential reaches both Workers
- **WHEN** a credential is required by a job on the scheduled Worker and by a route on the application Worker
- **THEN** it is uploaded to each Worker separately and each reports its own absence by name

#### Scenario: The upload is not interactive
- **WHEN** the documented procedure for setting a credential is reviewed
- **THEN** it uploads from a file rather than from an interactive prompt or a shell echo

#### Scenario: An absent credential disables one feature and nothing else
- **WHEN** the scheduled Worker is deployed without the provider credential
- **THEN** its other job runs normally and the affected job reports the missing variable by name
