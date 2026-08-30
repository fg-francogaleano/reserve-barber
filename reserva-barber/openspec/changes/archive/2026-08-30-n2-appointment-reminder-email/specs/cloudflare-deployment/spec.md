## MODIFIED Requirements

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

## ADDED Requirements

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
