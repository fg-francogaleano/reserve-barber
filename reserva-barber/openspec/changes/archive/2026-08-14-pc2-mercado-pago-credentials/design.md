## Context

PC1 built the `PaymentConfig` row and settled its lifecycle: created by upsert on first save, written one story's columns at a time, retried once on a lost race, read through narrow projections. PC2 inherits all of it. What PC2 does not inherit is the kind of value it stores.

Every value the dashboard has handled so far is either public (a barber's name, a service price, a CBU) or held by someone else (the owner's password, which lives in Supabase Auth and never touches this codebase). `mpAccessToken` is the first **bearer credential this application stores itself**. It authorizes charges against the owner's Mercado Pago account and reads it. `data-model.md` §14 and `backend-standards.md` both require it encrypted at rest, and nothing in this repository can encrypt anything. There is no cipher, no key, no rotation story, and no precedent to copy — the last time this project added infrastructure with no precedent was S0.

That single fact cascades. A value that must never reach the browser cannot populate a form the way every other editor in the dashboard does; PC1's own confirmation mechanism, which carries pending values through hidden inputs, becomes a way to publish a live credential into the page source. And a value whose correctness cannot be checked locally forces the question PC1 had to leave open: PC1 could not verify that a CBU belonged to the owner, because no authority was available to ask. For Mercado Pago credentials there is one.

The runtime is unchanged — Workers, Prisma over the Supavisor pooler, server actions for dashboard mutations — with one first: this is the project's first outbound request to a third-party API from application code.

## Goals / Non-Goals

**Goals:**
- Make the access token unreadable at rest, and structurally unable to reach the browser rather than conventionally unlikely to.
- Catch a wrong credential while the owner is looking at the screen, not when a client's payment fails.
- Make "which Mercado Pago account will receive my clients' money" a question the owner answers explicitly, once, from evidence rather than from memory.
- Fail loudly when the credentials cannot be read, instead of rendering a healthy-looking page over an unusable configuration.
- Leave PC1's columns and PC3's columns provably untouched.

**Non-Goals:**
- Creating preferences, the checkout redirect, the webhook and its signature validation — B5.
- The deposit amount or policy — PC3.
- OAuth / Mercado Pago Marketplace onboarding. `project-context.md` §7 fixes this version on pasted credentials.
- Automatic key rotation or bulk re-encryption. The envelope makes it possible; performing it is deferred as debt.
- Proving that the public key belongs to the same Mercado Pago account as the access token. See D5 — this is partially, not fully, closed, and the residual gap is stated rather than papered over.
- A combined payment-readiness panel showing transfer, Mercado Pago and deposit together. That is PC3's, the story that first knows all three.

## Decisions

### D1 — AES-256-GCM via Web Crypto, in a versioned self-describing envelope
Encrypt with `crypto.subtle` using AES-GCM, 256-bit key, and store:

```
v1.<base64url iv>.<base64url ciphertext‖tag>
```

Three properties are load-bearing:

- **A fresh random 96-bit IV per encryption.** Never derived, never reused. IV reuse under GCM is a total break of both confidentiality and authenticity, and it is the standard way an otherwise correct AES-GCM implementation turns out to be broken. A test asserts that two encryptions of the same plaintext differ.
- **The `v1` prefix.** Without it, a future key rotation has to guess at a stored blob's provenance. With it, a value that does not parse is rejected outright — there is no "maybe it is plaintext" fallback, because a fallback that guesses is a fallback that silently accepts corrupted data.
- **The owner id bound as AAD**, with a purpose string (D7 reuses the same key for a different job, and the two ciphertexts must not be interchangeable). A ciphertext copied between rows or between purposes fails to decrypt rather than decrypting into the wrong place.

*Alternative — `node:crypto`:* rejected. `nodejs_compat` is enabled, but Web Crypto is the first-class API on `workerd` and the one module that must hold no surprises should not depend on a compatibility shim.

*Alternative — Supabase Vault / `pgcrypto`:* rejected. It puts the key in the same system as the data it protects, and Prisma cannot express it without raw SQL on the project's most sensitive column.

*Alternative — store plaintext and rely on database access control:* rejected outright; it contradicts `data-model.md` §14 and `backend-standards.md`.

### D2 — Encrypt and decrypt at the repository boundary
`PrismaPaymentConfigRepository` already performs the row's other boundary conversions: `Decimal` → `string` so the domain never handles a driver type, and `mpAccessToken` → `boolean` so the value stops at line one. Encryption joins them. The application layer hands the repository a plaintext token and receives a plaintext token; nothing above the repository knows that ciphertext exists.

*Alternative — encrypt in the service:* rejected. It leaks a ciphertext type upward into the layer whose job is business rules, and every future caller inherits the obligation to remember.

*Alternative — a Prisma middleware/extension:* rejected. Invisible encryption is worse than explicit encryption when the failure mode is "the token is readable"; and driver-adapter extension support is a moving target this project should not bet its credentials on.

### D3 — The access token is write-only, and an empty field means unchanged
The dashboard never receives the token. `findByOwner` keeps reducing it to `hasMercadoPagoCredentials` at the boundary. The input renders empty on every load, `autoComplete="off"`.

Consequently **empty must mean "leave it alone", not "clear it"** — otherwise saving an unrelated edit would delete the owner's credentials. Removal is a separate explicit intent. And an empty token combined with a *changed* public key is rejected: the two are issued as a pair, and a public key rotated without its token produces a checkout that fails only when a real client reaches it.

That last rule reads like a bug if the message does not explain it, so the copy states the reason, not just the refusal.

*Alternative — render a masked value as the field's default:* rejected. A masked default that submits back the mask stores the mask. It is the most common way this exact form is built wrong.

### D4 — Both credentials are required together
A public key alone cannot charge; an access token alone cannot initialize the client-side checkout. Half a pair is a payment method that fails at the moment a client tries to use it, so it is rejected in full, at form level — the mistake is the combination, not either field. Reuses PC1's `fieldErrors.form` channel.

### D5 — Credentials are verified against Mercado Pago before they are stored
Offline checks catch a *malformed* token. They cannot catch one that is well-formed but revoked, expired, or belonging to a different Mercado Pago account — and that last case routes clients' deposits to a stranger. PC1 faced the same hazard in the alias namespace and had no authority to ask. PC2 does.

The verifier sits behind `IMercadoPagoCredentialVerifier`, so it can be stubbed in every test and removed without restructuring anything. Its contract is: given an access token, return the identity of the account it belongs to, or a typed rejection.

**Failure policy:**

| Mercado Pago answers | Outcome |
|---|---|
| Identifies the account | Proceed to the confirmation step (D6) |
| 401 / 403 — credentials rejected | **Nothing is written.** Previous credentials remain intact. Reported as a credential error, not an infrastructure error |
| 5xx, network failure, timeout | **Saved anyway**, with an explicit "could not verify right now" notice |

Refusing to save because a third party is down would be this feature failing for a reason that has nothing to do with the owner's input. Blocking on a definitive rejection is different: Mercado Pago has actually answered, and the answer is no.

**An explicit timeout is mandatory.** Without one an unresponsive Mercado Pago leaves the server action hanging until the platform kills it; the owner clicks again, and two writes race. The upsert is idempotent on `ownerId` and absorbs that; the verification call is not, which is the second reason to bound it.

**What this does not close:** the call authenticates the *access token*. It does not prove the *public key* belongs to that same account — no available call ties the two. The public key is therefore checked for shape and environment only, and the residual risk is recorded below rather than described as solved.

*Resolved during implementation (task group 2, 2026-08-13).* Mercado Pago's official API reference documents the credential shapes but **does not document `/users/me`**; that endpoint is Mercado Libre's and accepts Mercado Pago tokens in practice. Depending on it for the confirmation to *exist* would build the story's main safety net on undocumented behavior.

It is not needed for that. The reference's own OAuth example shows the account id embedded in the access token itself — `access_token: "APP_USR-4934588586838432-XXXXXXXX-241983636"` alongside `user_id: 241983636`, the same value recurring in the refresh token. **The account id is therefore recoverable from the token offline, with no call at all.**

The verifier consequently has two jobs with different criticality:

- **Liveness** — a documented authenticated endpoint that answers 401/403 on a bad token. This drives the failure policy above and is the part that must be reliable.
- **A human-readable name** — `/users/me`, best-effort. When it answers, the confirmation shows the account nickname or email. When it does not, the confirmation still shows the offline account id and loses nothing structural.

The account id extraction is verified against the owner's real credentials before it is relied upon, exactly as PC1 gated its check-digit table on real fixtures. If the final segment does not match the account, the confirmation falls back to environment and last four, and D6a is dropped.

### D6 — The confirmation step shows the account, not the credentials
When credentials already exist and the owner submits different ones, the confirmation screen displays **the Mercado Pago account the new token belongs to** — the account id, always, recovered offline from the token itself, plus the account's nickname or email when Mercado Pago supplies one (D5) — alongside the stored token's environment and last four characters.

This is strictly better than PC1's mechanism, which could only echo back the normalized value the owner had just typed. Showing an account name answers the question the owner actually needs answered — *is this my account?* — and it is the only defence in the product against a valid credential belonging to somebody else.

It also keeps the credential out of the page. PC1's confirmation carries pending values in `<input type="hidden">` (`TransferDetailsForm.tsx:93-95`). For a bearer token that would put a live secret in the page source, in the bfcache, in any browser extension's reach, and in any screenshot the owner takes of the confirmation screen. Nothing that appears on the confirmation screen is secret.

The `intent` answer still rides **only on the pressed button**, never a hidden field — `FormData.get` returns the first value for a name, so a hidden field would beat the cancel button and the guard would commit exactly what the owner declined. That mechanism is inherited verbatim.

Confirmation is required when **replacing** existing credentials and when **removing** them. Not on a first configuration: there is no previous value to be confused with.

### D6a — ~~A replacement that switches Mercado Pago accounts says so, loudly~~ **WITHDRAWN**

**Withdrawn during verification (2026-08-13), by the gate that was built to test it.**

It rested on the account id being recoverable from the token offline: the OAuth reference example ends its `access_token` in the same number as `user_id`, so the trailing segment looked like the account. Task 2.6 required that be confirmed against a real credential before anything relied on it, and prescribed the remedy if it failed. It failed: the owner's real token ends in **1325562541**, and their Mercado Pago User ID is **156842883**.

So the comparison was between two numbers that identify nothing nameable. It could have been wrong in both directions — a false "different account" on a routine rotation trains the owner to click through the warning, and a false "same account" suppresses it exactly when a stranger's credentials were pasted. What it guarded was the owner's money, which is the wrong thing to guard with a guess.

**What replaces it:** the account identity Mercado Pago itself returns during verification (D5). The confirmation names the account when Mercado Pago answered, and shows nothing when it did not — no offline fallback, because inventing one is what produced this decision in the first place.

**What is lost:** the warning no longer works when Mercado Pago is unreachable, which was D6a's main selling point. A save that proceeds unverified now confirms only the last four characters. Recorded as T43.

*The lesson, and it is the same one D8 taught an hour earlier:* both decisions were built on the OAuth reference example, and both were wrong about the credentials owners actually paste. The tests written for each one passed, because their fixtures came from the same example as the code. **A fixture derived from the same source as the implementation tests nothing.** Task 2.6 was right to demand a real credential, and it is the only reason either error was caught before deployment rather than after a client's deposit went missing.

### D7 — The pending token waits in an encrypted, `httpOnly`, path-scoped cookie
D6 answers what the confirmation *shows*. It does not answer where the token waits between the verification and the confirmation, and that gap is real: the server needs the token again when the owner confirms.

The token is encrypted with the same cipher (D1) under a **distinct AAD purpose string**, and set as a cookie: `httpOnly` (JavaScript cannot read it), `Secure`, `SameSite=Strict`, `Path=/mercado-pago`, expiring in minutes. It is cleared on confirm, on cancel, and on a validation failure. Size is not a concern — the envelope for a Mercado Pago token is a few hundred bytes against a 4 KB limit.

This satisfies what D6 requires: the token is not in the HTML, not in the RSC payload, not in view-source, not in a screenshot, and not reachable by script.

*Alternative — a server-side store keyed by an opaque id:* equivalent security, more machinery. It needs a Workers KV binding (`wrangler.jsonc` has none today), a TTL, and a cleanup story. Chosen against because it adds infrastructure to a change that already adds a cipher.

*Alternative — no confirmation at all, relying on verification alone:* rejected. Verification proves the token is *live*; only the owner can say it is *theirs*.

*Alternative — save first, confirm afterwards:* rejected. It makes credentials live for the length of a human reading a screen, and B5 would happily charge against them in that window.

### D8 — ~~Mixed environments are rejected; a test pair saves with a persistent banner~~ **WITHDRAWN**

**This decision was wrong, and was withdrawn during verification (2026-08-13).**

It assumed Mercado Pago issues test and production credentials with different prefixes — `TEST-` and `APP_USR-`. That holds for **OAuth-issued** credentials, which is where the reference example in task 2.1 came from. It does **not** hold for the credentials owners actually paste: the "Tus integraciones" panel issues `APP_USR-` for **test and production alike**. Confirmed against the owner's real account, and against Mercado Pago's own docs on re-reading.

The consequence was not a missing feature but a **false statement about money**. The page printed `Entorno: Producción` over a test credential. That is worse than printing nothing: it reads as confirmation, and it removes exactly the doubt the display existed to create — an owner checking whether they are ready to take real payments would have been told yes.

**What replaces it:**

- `credentialEnvironment` returns `'test'` only for an explicit `TEST-` prefix, and `null` — *unknown* — otherwise. The type has no `production` member at all, so no code can claim one. That is what turned the correction into a compile error at every affected site rather than a silent behaviour change.
- The page shows the **Mercado Pago account id** where the environment used to be. It is recovered from the token, so it is a fact rather than an inference.
- The test banner still exists but now fires only when a credential says `TEST-` outright.
- The mismatch check survives only for the case it can still detect: one credential `TEST-`, the other not.

**What is genuinely lost:** an owner who ships with panel-issued *test* credentials gets no warning. That protection is not recoverable from the credential string, and no documented Mercado Pago call exposes it. It is recorded as debt (T42) with PC3 — the story that first knows whether the business is ready to take real money — as its trigger.

**What carries the weight instead:** D6a. The account id changes when the owner swaps test credentials for production ones, and the confirmation states it. That warning needs no prefix, no API call, and no guess.

*The lesson worth keeping:* task group 2 existed to confirm external facts before building on them, and it confirmed the wrong thing — an example from the OAuth reference, not from the panel the owner actually uses. A fact is only confirmed when it is checked against the path the user takes.

### D9 — Shape validation must distinguish the two credentials from each other
Both credentials share a prefix. An owner who pastes them into the wrong boxes stores the **access token in `mpPublicKey`** — the one column this design deliberately sends to the browser — publishing a live bearer credential to every guest who reaches the payment step.

Prefix-only validation does not catch this. *Confirmed during implementation (task 2.2):* the reference's examples are `APP_USR-4934588586838432-XXXXXXXX-241983636` for the access token and `APP_USR-d0a26210-XXXXXXXX-479f0400869e` for the public key. **The public key's body is a UUID; the access token's is not.** That is the discriminator — structural, stable, and independent of segment lengths that could vary.

The validators are therefore specific enough to reject each value in the other's field, and the error names the actual mistake — *the values look swapped* — rather than reporting both fields as invalid. D5's verification is the second net: a public key presented as a bearer token is rejected by Mercado Pago.

### D10 — Normalization strips invisible characters before validation and before encryption
Owners paste from Mercado Pago's dashboard. Trailing newlines, non-breaking spaces and zero-width characters ride along. A bearer token with a trailing `\n` passes every shape check and produces a 401 at payment time.

This project has already paid for this exact class of bug once: a polluted `wrangler secret put DATABASE_URL` failed at runtime as an unrelated connection error. Normalization strips surrounding whitespace and control/zero-width characters, and **validation runs on the normalized value**, never the raw one.

### D11 — The key is validated at this feature's composition root, not in `validateEnv()`
`PAYMENT_CREDENTIALS_KEY` is 32 random bytes, base64-encoded, held as a Wrangler secret in production and in `.dev.vars` locally.

Adding it to `REQUIRED_ENV_VARS` (`logger.ts:24`) would take the entire dashboard down on a deploy that forgot one secret. A missing key must break exactly the pages that need it, with an error naming the variable. It never appears in a log line, an error message, or a stack.

### D12 — Undecryptable credentials are a state of the page, not a surprise for B5
Because the dashboard reads only a presence flag (D3), a missing or corrupt key renders a perfectly healthy-looking "configured" page over a token nobody can read. The failure would surface for the first time inside B5, in a real client's checkout.

The page therefore attempts to decrypt on load and renders a **fourth state** — *stored credentials cannot be read* — distinct from configured and unconfigured, offering the only real remedy: paste them again. The cost is one AES-GCM operation per page load, negligible against the Supavisor round trip.

This is a deliberate, bounded exception to "the dashboard never decrypts": the plaintext is discarded immediately and never rendered, propped, or logged.

### D13 — The two read projections B5 needs are built now
`findMercadoPagoPublicKeyForPublic` (returns the public key, never selects the token) and `findMercadoPagoAccessToken` (returns the decrypted token, for server-side use only) are added by this change.

This is an exception to the rule M4 and PC1 both applied — no code path without a caller. It is made deliberately: the decryption path needs test coverage in the change that owns the cipher, not in the change that happens to consume it first. Keeping them as separate named methods is the same control as PC1's D7 — a projection that cannot carry the token cannot leak it, which is stronger than every downstream consumer remembering to strip it.

### D14 — Logs carry presence, environment and last four; nothing else
Success: `operation`, `ownerId`, `hasCredentials`, `environment`, `tokenLastFour`, `publicKeyLastFour`, `previousTokenLastFour`, `verified`, `leavesNoPaymentMethod`. The previous/new pair is what makes a rotation reconstructable, and it addresses T35's trigger, which named PC2 explicitly.

`toErrorLogContext` deliberately preserves messages for *unrecognized* errors so they stay diagnosable — which is precisely how a token could reach the log stream. PC1's `redactDestination` is generalized into a shared secret redactor and applied to every PC2 error path, **including Mercado Pago's own error bodies**, which routinely echo the credential they rejected.

Revealing four characters of a long high-entropy secret is accepted; it is not the same trade PC1 made with a CBU's last four, and it is worth stating so the next reader does not treat it as an oversight.

### D15 — Everything PC1 settled is inherited unchanged
The column-scoped upsert naming only `mpAccessToken` and `mpPublicKey` (PC1's D5); the single bounded retry on a `P2002` lost race, extracted to take a write callback rather than duplicated; `export const dynamic = 'force-dynamic'` declared on the page itself rather than inherited from the layout; submitted values echoed back so React 19's post-action form reset does not empty the form — **minus the token**, which is the one value that must not survive in form state, because that state is serialized into the RSC payload.

A test asserts that a Mercado Pago write leaves PC1's transfer columns and PC3's deposit columns untouched. That is the regression that would otherwise be discovered by a client's deposit disappearing.

## Risks / Trade-offs

**The cipher can pass every local test and fail in production, because the key exists only there.** → The change is not closed until a credential saved through the deployed Worker is read back. The secret is uploaded with exact bytes piped from a file or `node` stdout, never `echo` — the S0 `DATABASE_URL` failure was a BOM.

**Verification does not prove the public key belongs to the verified account.** → Shape (D9) and environment (D8) checks plus the account-identity confirmation (D6) narrow it; the remaining case — a well-formed public key from a *different* account of the owner's own — is undetectable with the calls available and is recorded as debt.

**Mercado Pago is now a dependency of a settings save.** → Bounded by an explicit timeout and a stated failure policy (D5); the save degrades to "saved, unverified" rather than failing. The verifier is isolated behind an interface so it can be disabled without restructuring.

**Losing the key makes stored credentials permanently unreadable.** → Recovery is re-pasting, which is acceptable; what is not acceptable is discovering it as a 500. D12 makes it a legible state with the remedy attached. Rotation tooling is deferred as debt with a stated trigger.

**The confirmation cookie is a plaintext credential's temporary home.** → Encrypted under a distinct AAD purpose, `httpOnly`, `Secure`, `SameSite=Strict`, path-scoped, minutes-long, cleared on every exit path. It cannot be read by script, replayed across owners, or swapped into the database column.

**Two tabs remain last-write-wins (T36).** → Unchanged and accepted for the same reason: one administrative user must race themselves. The blast radius stays inside PC2's two columns by construction (D15).

**Server actions remain unmetered for unauthenticated POSTs (T17).** → `requireOwner()` is the first line of the action and precedes any outbound call, so an unauthenticated caller cannot reach Mercado Pago through this endpoint. A *stolen owner session* could use the screen as a credential-testing oracle; that is bounded by session security, not by this change.

**The `/mercado-pago` page will later share its area with PC3.** → `intent` values must be namespaced per form before a second form lands, or two forms on one page will consume each other's answers — the same first-value hazard as D6, one level up.

## Migration Plan

No database migration. Both columns exist from PC1's `add_payment_config`, and `String?` holds the envelope — the payoff of PC1's D1.

1. Amend `docs/data-model.md` §14 first, per `base-standards.md` §7: the envelope format, `mpPublicKey` explicitly not encrypted, the pair-completeness rule.
2. Generate the key and set it locally in `.dev.vars`; verify the cipher round-trips in `npm run dev` and in `npm run preview` (the Workers runtime, where Web Crypto behaves as deployed rather than as Node emulates).
3. `wrangler secret put PAYMENT_CREDENTIALS_KEY` with exact bytes.
4. Deploy, then save and read back a real credential through the deployed Worker. This step is the only one that exercises the production key.

**Rollback:** the change is additive. Reverting the code leaves two populated columns that nothing reads; a `v1.` envelope is inert to PC1 and PC3, whose writes name only their own columns. No data migration is needed in either direction.

## Open Questions

- ~~**The exact Mercado Pago endpoint and credential formats.**~~ **Resolved (task group 2, 2026-08-13).** The credential shapes are confirmed and distinguishable (D9). `/users/me` is not documented by Mercado Pago, so the confirmation no longer depends on it: the account id comes out of the token offline, and the endpoint contributes only a friendly name when it answers (D5).
- ~~**How the account identity is displayed.**~~ **Resolved (task 2.4).** Account id always, nickname or email when available. The numeric id alone would indeed be ceremonial — which is why D6a exists: comparing it against the stored token's account turns an unrecognizable number into a statement the owner can act on.
- **Whether the offline account extraction holds for real credentials.** The final segment matching `user_id` is established from the official reference example. It is verified against the owner's own credentials before D6a is relied upon, exactly as PC1 gated its check-digit table on real fixtures. If it does not hold, D6a is dropped and the widened risk recorded.
- **Whether the test-credentials banner belongs on other dashboard pages.** It protects against forgetting, and the settings page is the one place the owner has no reason to revisit. Deferred to PC3, which builds the payment-readiness view and is the natural home for a global warning.
