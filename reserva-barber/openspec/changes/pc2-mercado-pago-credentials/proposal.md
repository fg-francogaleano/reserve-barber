## Why

Mercado Pago is the automatic half of the deposit story: the client pays online, a webhook confirms it, and the booking is confirmed with no manual step. None of that can be built until the owner's credentials are stored, so B5 is blocked on this change and PC3's "at least one payment method" precondition is only half satisfiable.

PC1 already settled how the shared `PaymentConfig` row is created and partially written, and PC2 inherits every one of those decisions unchanged. What PC2 does **not** inherit is the nature of the value being stored. PC1 stored a bank destination — public data, printed verbatim to every client. PC2 stores a **bearer credential that can move money and read the owner's Mercado Pago account**. Three requirements follow, and each one breaks a pattern the dashboard has used everywhere so far:

- `data-model.md` §14 and `backend-standards.md` both require `mpAccessToken` to be **encrypted at rest**. This codebase has no encryption primitive, no key, and no key-management story. PC2 builds it. It is the first piece of infrastructure since S0 that has no precedent to copy.
- The token can never be sent to the browser, so the form cannot be populated from the database the way every other editor in the dashboard is. "Empty field" has to mean *unchanged*, not *clear*.
- A wrong-but-well-formed token is silent. It does not fail on save; it fails when a real client tries to pay, or worse, it succeeds and deposits the client's money into a stranger's Mercado Pago account. PC1 met the same hazard in the alias namespace and had no authority to ask; PC2 does — Mercado Pago itself.

## What Changes

- Add a Mercado Pago credentials editor at `/mercado-pago`: the owner saves an Access Token and a Public Key together, replaces them, or removes them.
- **Add AES-256-GCM encryption at rest for `mpAccessToken`**, via Web Crypto, with a versioned self-describing envelope (`v1.<iv>.<ciphertext>`) that makes rotation possible later, a fresh random IV per encryption, and the owner id bound as additional authenticated data. New Wrangler secret `PAYMENT_CREDENTIALS_KEY`. No migration: the existing `String?` column holds the envelope.
- **The access token is write-only.** The dashboard never receives it — the repository already reduces it to a boolean at the boundary, and that stays. The page shows presence, environment, the last four characters, the public key in full, and when it last changed. The token input always renders empty.
- **An empty token field means "leave it alone", never "clear it".** Because the field always renders empty, treating empty as a clear would delete the owner's credentials every time they saved an unrelated edit. Removal is a separate, explicit intent.
- **The two credentials are required together.** A public key alone cannot charge anything; an access token alone cannot initialize the client-side checkout. Half a pair is a payment method that fails at the moment a real client tries to use it, so it is rejected in full.
- **Credentials are verified against Mercado Pago before they are stored.** A definitive rejection blocks the save and leaves the previous credentials intact; an unreachable or failing Mercado Pago saves anyway with an explicit "could not verify" notice, because refusing to save when a third party is down is this feature failing for a reason that has nothing to do with the owner's input.
- **The confirmation step shows which Mercado Pago account the credentials belong to**, not the credentials. This is the only defence against a valid token that belongs to somebody else — the hazard PC1 could not close. It also keeps the token out of the DOM: PC1's confirmation carries pending values in hidden inputs, which for a bearer credential would put a live secret in the page source. The token waits in an encrypted, `httpOnly`, path-scoped, short-lived cookie instead.
- **Test and production credentials must not be mixed**, and a saved test pair raises a persistent banner. A mixed pair produces a checkout that looks like it works and never charges. Test credentials are still allowed — testing the booking flow before launch is what they are for — but the owner who forgets to swap them loses every real deposit.
- **The page surfaces credentials it cannot decrypt** as a state of its own, distinct from "configured" and "not configured". Because the dashboard only reads a presence flag, a missing or corrupt key would otherwise render a perfectly healthy-looking page and fail for the first time inside B5, in a client's checkout. The `DATABASE_URL` byte-hygiene failure in S0 is the same shape.
- Add the two narrow read projections B5 will consume — the public key for the browser, the decrypted access token for server-side use only — so the decryption path is covered by tests in the change that owns the cipher.
- Warn when a save leaves the business with no payment method at all, computed on the server, symmetric with PC1. Removal is still permitted: an owner migrating between payment methods must not be trapped.

## Capabilities

### New Capabilities
- `payment-mercado-pago-credentials`: the owner records, verifies, replaces and removes the Mercado Pago credential pair — the write-only token, the pair-completeness and environment rules, verification against Mercado Pago and its failure policy, the account-identity confirmation, the four states of the page, and the Spanish (es-AR) copy for each of them.
- `credential-encryption`: encryption of stored credentials at rest — the AES-GCM envelope and its version prefix, IV freshness, AAD binding, key sourcing and validation, and how an undecryptable value is reported rather than swallowed.

### Modified Capabilities
- `data-persistence`: the Mercado Pago columns join the column-scoped partial write already specified for PC1; ciphertext is produced and consumed at the repository boundary so no layer above it handles an encrypted value; two new narrow projections keep the token out of the browser and the public key out of the token's path.
- `cloudflare-deployment`: `PAYMENT_CREDENTIALS_KEY` joins the Wrangler secrets, with the exact-bytes requirement that `DATABASE_URL` learned the hard way, and is validated at its own composition root rather than globally, so a missing secret breaks one page instead of the whole dashboard.

## Impact

**Docs** — `docs/data-model.md` §14 amended before implementation: the envelope format, the fact that `mpPublicKey` is deliberately *not* encrypted, and the pair-completeness rule. `docs/roadmap.md` PC2 ticked on completion. `docs/tech-debt.md`: T37 verified and closed (its trigger names PC2), T35 re-scoped to cover credential rotation, and new entries for key rotation, unrecoverable decryption, and the confirmation cookie's lifetime.

**Schema** — none. Both columns exist from PC1's migration, and `String?` holds the envelope. This is the payoff of PC1's D1.

**Server layers** — new `ICredentialCipher` + `WebCryptoCipher`; new `IMercadoPagoCredentialVerifier` + its adapter; new `mercadoPagoCredentials` domain module and `mercadoPagoCredentialsSchema`; `IPaymentConfigRepository`, `PrismaPaymentConfigRepository`, `PaymentConfigService` and `PaymentConfigErrors` extended. PC1's `redactDestination` generalized to a shared secret redactor — two call sites is where the duplication becomes structural.

**Presentation** — new route `app/(dashboard)/mercado-pago/`; modifications to `app/(dashboard)/layout.tsx` (nav link) and `src/lib/copy.ts`.

**Configuration** — new secret `PAYMENT_CREDENTIALS_KEY` in `.dev.vars` and Wrangler; README gains its generation and upload procedure.

**Runtime risk** — the highest of any story so far, and concentrated in two places. The cipher can pass every local test and fail in production, because the key only exists there; verification must therefore run against the deployed Worker before the change is closed. The Mercado Pago call is the first outbound third-party request in the project, so it needs an explicit timeout — without one, an unresponsive Mercado Pago leaves the action hanging until the platform kills it, and the owner clicks again.

**Downstream** — unblocks B5 entirely and completes PC3's precondition. B5 inherits the two read projections and must not widen them.

**Not affected** — the transfer destination and its editor, the deposit policy, the booking flow, and every catalogue story in Phase 1a. PC1's columns are untouched by construction, and a test asserts it.
