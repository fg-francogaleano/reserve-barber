## 1. Amend the specification first

- [x] 1.1 Amend `docs/data-model.md` §14: state the encryption envelope format for `mpAccessToken` (versioned, IV, ciphertext with tag) and that the column type is unchanged
- [x] 1.2 Amend `docs/data-model.md` §14: state explicitly that `mpPublicKey` is **not** encrypted, and why — it is disclosed to every client at the payment step
- [x] 1.3 Amend `docs/data-model.md` §14: add the pair-completeness rule — `mpAccessToken` and `mpPublicKey` are both present or both absent, enforced in the application layer
- [x] 1.4 Amend `docs/data-model.md` §14 "Secrets": name `PAYMENT_CREDENTIALS_KEY` as the key protecting the token, and state that losing it makes stored credentials unreadable with re-entry as the only recovery

## 2. Confirm the external facts before building against them

- [x] 2.1 Confirm against Mercado Pago's current documentation: the exact prefixes and structural shape of an Access Token and a Public Key, in both test and production. Record what was checked and when, in the domain module's header. **Confirmed 2026-08-13** from the official API reference (`/developers/en/reference/authentication/oauth/_oauth_token/post`): access token `APP_USR-4934588586838432-XXXXXXXX-241983636`, public key `APP_USR-d0a26210-XXXXXXXX-479f0400869e`; `TEST-` replaces `APP_USR-` in the sandbox
- [x] 2.2 Confirm the two shapes are **distinguishable from each other**, and that a Public Key placed in the token field can be rejected on shape alone (design D9). **Confirmed:** the public key's body is a UUID (8-4-4-4-12 hex), the access token's is not. Structural, stable, independent of segment lengths
- [x] 2.3 Confirm the endpoint that authenticates an Access Token and returns an account identity (design D5, open question 1). **Amended:** `/users/me` is **not** in Mercado Pago's public API reference — it is Mercado Libre's and accepts MP tokens in practice. The reference's own OAuth example instead shows the account id **inside the token** (`access_token: "APP_USR-…-241983636"` with `user_id: 241983636`), so the identity is recoverable offline. Liveness comes from a documented authenticated endpoint; `/users/me` contributes only a friendly name, best-effort
- [x] 2.4 Decide which identity is shown on the confirmation screen (open question 2). **Decided:** account id always (offline, no dependency) plus nickname/email when available. The bare id would be ceremonial on its own, which is why 2.5 was added
- [x] 2.5 **Added after 2.3, then WITHDRAWN by 2.6.** The account-switch comparison (design D6a) was built and removed the same day: the token segment it compared is not the Mercado Pago account. See T43
- [x] 2.6 **Added after 2.3. The gate FIRED.** Owner real credential: trailing segment 1325562541, actual Mercado Pago User ID 156842883 — they do not match, so the offline extraction was dropped exactly as this task prescribed, and T43 records the widened risk. No credential values committed

## 3. The cipher, gated before anything depends on it

- [x] 3.1 Add `src/server/domain/repositories/ICredentialCipher.ts` — `encrypt(plaintext, ownerId, purpose)` / `decrypt(envelope, ownerId, purpose)`, no crypto imports, typed decryption failure
- [x] 3.2 Write the failing tests first: round trip; **two encryptions of the same plaintext differ** (IV freshness, design D1); a flipped byte in the ciphertext, the IV or the tag fails; a wrong `ownerId` fails; a wrong `purpose` fails; an unversioned or malformed envelope is rejected with a typed error and never treated as plaintext
- [x] 3.3 Implement `src/server/infrastructure/crypto/WebCryptoCipher.ts` — AES-256-GCM via `crypto.subtle`, fresh 96-bit IV per call, `v1.<iv>.<ct>` envelope, `ownerId` + `purpose` as AAD
- [x] 3.4 Test key handling: absent, wrong length, non-base64 — each produces a configuration error naming `PAYMENT_CREDENTIALS_KEY`, distinguishable from a decryption failure
- [x] 3.5 Test that no cipher error carries the key, the ciphertext, or any recovered bytes
- [x] 3.6a Node leg: `scripts/pc2-gate.ts` + `src/server/infrastructure/crypto/WebCryptoCipher.probe.ts`, following the M5a shared-probe precedent. **Passed** — envelope shape, round trip, plaintext absent, 10/10 distinct IVs, tampering rejected, owner binding, purpose binding
- [x] 3.6b **Route abandoned, purpose met another way.** pp/api/_gate/cipher 404d on the deployed Worker: a Next.js folder starting with _ is a PRIVATE folder and never routes — it had never been in the build listing either. Not renamed, because 12.7 proved the same thing more convincingly (real key, real DB, real path). Route deleted. Residual: IV freshness, tamper rejection and owner/purpose binding are verified under Node only

## 4. Domain layer

- [x] 4.1 Add `src/server/domain/models/mercadoPagoCredentials.ts` — `normalizeCredential` (strips whitespace, control and zero-width characters, design D10), `checkAccessToken`, `checkPublicKey`, `looksSwapped`, `credentialEnvironment`, `credentialLastFour`, `accountIdFromToken` (design D6a). Zero dependencies; returns error **codes**, never Spanish strings
- [x] 4.2 Test the swap case explicitly: a token in the public key field and a public key in the token field are both rejected, and the condition is reported as a swap
- [x] 4.3 Test normalization: trailing newline, non-breaking space, zero-width character — and assert the **normalized** value is what validation and storage receive
- [x] 4.4 Test environment detection and the mismatch case
- [x] 4.4a Test `accountIdFromToken`: extracts the trailing account segment, returns null for a shape it cannot read, and never throws on malformed input
- [x] 4.5 Extend `src/server/domain/models/PaymentConfig.ts` — `MercadoPagoCredentials` input type, `MercadoPagoPublicView` (presence, environment, last four, last changed), `hasMercadoPagoConfigured`
- [x] 4.6 Extend `src/server/domain/errors/PaymentConfigErrors.ts` — `CredentialDecryptionError`, `CredentialKeyMissingError`, `MercadoPagoRejectedError`, `MercadoPagoUnavailableError`
- [x] 4.7 Add `src/server/domain/repositories/IMercadoPagoCredentialVerifier.ts` — returns an account identity or a typed rejection, with the two failure kinds distinct (rejected vs unavailable), because they drive different outcomes
- [x] 4.8 Extend `IPaymentConfigRepository` — `upsertMercadoPagoCredentials`, `findMercadoPagoPublicKeyForPublic`, `findMercadoPagoAccessToken`

## 5. The Mercado Pago verifier

- [x] 5.1 Write the failing tests first against a stubbed transport: identifies the account; 401/403 → `MercadoPagoRejectedError`; 5xx → `MercadoPagoUnavailableError`; network failure → unavailable; **no response within the timeout → unavailable, and the call is abandoned**
- [x] 5.2 Implement `src/server/infrastructure/payments/MercadoPagoCredentialVerifier.ts` with an explicit timeout (design D5). No retry — a settings save is not the place to amplify load against a struggling third party
- [x] 5.2a Separate the verifier's two jobs (design D5, amended): **liveness** against a documented authenticated endpoint drives the failure policy; the **friendly name** is best-effort and its absence SHALL NOT degrade liveness to "unavailable". A name lookup that fails is not a verification that failed
- [x] 5.3 Test that a Mercado Pago error payload echoing the submitted token is redacted before anything is logged or thrown onward

## 6. Application layer

- [x] 6.1 Add `src/server/application/paymentConfig/mercadoPagoCredentialsSchema.ts` — the hand-rolled parser shape used everywhere in this project (`{ ok, data } | { ok: false, fieldErrors }`), not Zod
- [x] 6.2 Encode the six distinct rejections as codes: malformed token, malformed public key, apparently swapped, environment mismatch, half a pair, empty token with a changed public key
- [x] 6.3 Test the empty-token matrix (design D3): empty + unchanged public key → unchanged, reported as saved; empty + changed public key → rejected; empty on a first configuration → rejected as half a pair
- [x] 6.4 Extract PC1's `writeWithSingleRetry` to take a write callback, so PC2 reuses the bounded `P2002` retry rather than duplicating it. Re-run PC1's tests unchanged
- [x] 6.5 Add `PaymentConfigService.saveMercadoPagoCredentials` — verify, then gate on confirmation, then write. Verification precedes the confirmation because the confirmation displays what verification returns
- [x] 6.6 Implement the failure policy from design D5 as tests first: rejected → nothing written and previous credentials intact; unavailable → written, flagged unverified
- [x] 6.6a Compute the account-switch flag in the service (design D6a): compare the submitted token's account with the stored one's, omit the comparison when the stored token cannot be decrypted, and test all three outcomes — same, different, unavailable for comparison
- [x] 6.7 Add `PaymentConfigService.removeMercadoPagoCredentials`, gated on confirmation, clearing only the two columns
- [x] 6.8 Implement `leavesNoPaymentMethod` using the stored transfer destination, and test both directions
- [x] 6.9 Add `PaymentConfigService.getMercadoPagoView` returning the presence/environment/last-four/last-changed view, and prove by test that no method on the service can return the token to a caller other than the dedicated server-side read

## 7. Infrastructure layer

- [x] 7.1 Implement `upsertMercadoPagoCredentials` naming **only** `mpAccessToken` and `mpPublicKey` in both branches (design D15)
- [x] 7.2 Test that a Mercado Pago write leaves the three transfer columns and both deposit columns untouched — and that the create branch supplies nothing but its own two columns plus schema defaults
- [x] 7.3 Wire the cipher into the repository: encrypt on write, decrypt on the dedicated read (design D2). The service passes and receives plaintext
- [x] 7.4 Extend the dashboard projection with `updatedAt` and the token's last four, keeping `mpAccessToken` reduced to a boolean at the boundary. Test that no dashboard read returns the token value
- [x] 7.5 Implement `findMercadoPagoPublicKeyForPublic` as a narrow `select`; test that the query does not select the token column
- [x] 7.6 Implement `findMercadoPagoAccessToken`; test that it returns plaintext, selects nothing else, and surfaces a decryption failure as distinct from "no credential stored"
- [x] 7.7 Test that every new query carries the owner predicate

## 8. The confirmation hand-off

- [x] 8.1 Implement the pending-credential cookie (design D7): encrypted under a purpose distinct from storage, `httpOnly`, `Secure`, `SameSite=Strict`, `Path=/mercado-pago`, minutes-long expiry
- [x] 8.2 Test that it is cleared on confirm, on decline, and on a validation failure
- [x] 8.3 Test that a pending-purpose envelope fails to decrypt when presented as a stored-credential envelope, and vice versa
- [x] 8.4 Test the expired-cookie path: the owner returns to the editor, not to a stale confirmation that would commit nothing

## 9. Presentation

- [x] 9.1 Add the `mercadoPago` block to `src/lib/copy.ts` — Spanish (es-AR), one message per distinct mistake, including the explanation for why the token field empties on rejection and why the pair must be re-entered together
- [x] 9.2 Add `app/(dashboard)/mercado-pago/paymentConfigService.ts` — composition root wiring repository, cipher and verifier; **this is where `PAYMENT_CREDENTIALS_KEY` is validated** (design D11), not in `validateEnv()`
- [x] 9.3 Add `formState.ts` — every submitted value echoed back **except the access token** (design D15), plus `saved`, `unverified`, `noPaymentMethod`, `pendingConfirmation` (account identity only, never a credential)
- [x] 9.4 Add `actions.ts` — `requireOwner()` as the first line and **before any Mercado Pago call**; `intent` read from the pressed button only; redacted error logging; `revalidatePath`; no redirect
- [x] 9.5 Add `MercadoPagoCredentialsForm.tsx` — uncontrolled inputs, token field always empty, confirmation rendered as server-returned form state, "return to editor" as a submit control carrying `name`/`value`, no click handlers
- [x] 9.6 Add `page.tsx` with `export const dynamic = 'force-dynamic'` declared on the page itself, rendering the four states including **Unreadable** (design D12) and the persistent test-credentials banner
- [x] 9.7 Add `loading.tsx` matching the page's card layout
- [x] 9.8 Distinguish the two pending labels: a local save and one awaiting Mercado Pago
- [x] 9.9 Add the nav link to `app/(dashboard)/layout.tsx`
- [x] 9.10 Component test: **no part of the access token appears in the rendered output**, in any state, including the confirmation step
- [x] 9.11 Component test: focus moves to the first error in a deterministic order; `aria-invalid`, `aria-describedby`, `role="alert"` and `aria-live` present as on the transfer form

## 10. Logging and redaction

- [x] 10.1 Generalize PC1's `redactDestination` into a shared secret redactor in `src/server/infrastructure/`, and repoint the transfer action at it with its tests unchanged
- [x] 10.2 Emit the success log with presence, environment, new and previous token last-four, public key last-four, `verified`, `leavesNoPaymentMethod` (design D14)
- [x] 10.3 Test that no error path emits a credential, a key, or a ciphertext — including the Mercado Pago failure path and the unrecognized-error path that `toErrorLogContext` deliberately keeps verbose

## 11. Secrets and configuration

- [x] 11.1 Generate the key and add it to `.dev.vars`; add it to `.dev.vars.example` with the generation command
- [x] 11.2 Document the upload procedure in the README, with the **exact-bytes** warning — pipe from a file or `node` stdout, never `echo`. A BOM here surfaces as credentials that cannot be decrypted
- [x] 11.3 Update the secrets comment in `wrangler.jsonc`
- [x] 11.4 Confirm `PAYMENT_CREDENTIALS_KEY` is **not** added to `REQUIRED_ENV_VARS`, and that removing it breaks only `/mercado-pago`

## 12. Verification

- [x] 12.1 `npx tsc --noEmit`, ESLint and the full Vitest suite green
- [~] 12.2 Browser pass. **Done:** swapped fields, mixed environments, public-key-only change, unchanged save, removal confirmation + cancel (nothing written), the four page states. **Blocked:** the replacement confirmation needs a token Mercado Pago accepts, which means the owner pasting one. Found three copy defects in the process — a removal claiming to contact Mercado Pago, a removal confirmation titled "Confirmá la cuenta", and secondary controls that stayed live during an in-flight submit — all fixed and covered by tests
- [~] 12.3 **Rejected: verified live.** A well-formed fake token was rejected by the real Mercado Pago API; nothing was written and the stored credentials survived. **Unavailable: covered by tests only** (verifier on 5xx/network/timeout, service still writes, form renders the notice) — an end-to-end run under a real outage was not staged
- [x] 12.4 **Verified.** With a valid-but-wrong key the page rendered the Unreadable state ("No podemos leer tus credenciales") instead of a healthy Configured panel. Key restored and confirmed identical to `.dev.vars`; stored credentials intact
- [x] 12.5 **Done, and the answer is no.** With JavaScript disabled against a PRODUCTION build: the form does not render at all (the (dashboard) group Suspense boundary), and when forced to render by removing it, a submission that must error reported nothing (useActionState does not restore state after a no-JS POST). Nothing was written in any attempt. Both causes are project-wide, not in this form. Files restored; recorded as T44
- [x] 12.6 Grep the rendered page source and the log output for the token value and for the key; both must be clean
- [x] 12.7 **Verified.** Secret uploaded with exact bytes (piped from node stdout through Git Bash, not PowerShell, which appends a newline). Deployed; the Worker rendered the stored credential last-four and timestamp, which required decrypting the envelope with the PRODUCTION key on workerd. Also hardened the key reader to tolerate surrounding whitespace/BOM, with tests
- [x] 12.8 **Verified twice.** The deployed /transferencia still shows PC1s CBU and holder name intact; and a read-only query against the production database confirms 	ransferCbuCvu/	ransferHolderName present, depositValue still null, depositType still the schema default — design D5 holding on real data

## 15. Raised by `/adversarial-review` (2026-08-14)

- [x] 15.1 **BLOCKER: replacing stored credentials was impossible.** The confirmation screen renders no credential fields — that is what keeps the token out of the DOM — but the action still read `publicKey` from the submitted form. It arrived empty, the parser returned `incomplete_pair`, and the owner could never rotate their credentials. **Fix:** the encrypted cookie now carries the whole pair, chosen over a hidden field because the confirmation must commit exactly the pair whose account was verified and shown
- [x] 15.2 **BLOCKER: two tests asserted the broken behaviour was correct.** `actions.test.ts` hand-fed a `publicKey` the real form never sends; `MercadoPagoCredentialsForm.test.tsx` asserted "no hidden inputs at all", which forbade the obvious fix. Both rewritten against `CONFIRMATION_FORM_DATA()` — literally what the screen emits — with the reason recorded in each so neither is "simplified" back
- [x] 15.3 **MAJOR: cancelling the confirmation blanked the Public Key**, because `values` was rebuilt from a form that carries no fields. Now re-read from the database. **Verified in the browser:** the field survives "Volver a editar"
- [x] 15.4 **MINOR:** a removal logged no `previousTokenLastFour` — the most destructive operation left the thinnest trace, against T35's intent. Now read before the write
- [x] 15.5 Added a regression test proving a `publicKey` injected into the confirmation POST is ignored in favour of the verified pair
- [x] 15.6 **Verified live, end to end.** With a real token: Mercado Pago verified it, the confirmation appeared naming the account (`/users/me` returned a nickname — the undocumented endpoint does answer), and confirming wrote the pair. `updatedAt` moved from 13/08 21:14 to 14/08 19:57 with the last four unchanged; a database read confirmed a `v1.` envelope, no plaintext, PC1's columns intact and PC3's still null. Before the fix this path ended in "incomplete pair" every time

## 14. Raised by `/opsx:verify` (2026-08-14)

- [x] 14.1 **Requirement 24 contradicted requirement 25 and the shipped code.** Its body still mandated the withdrawn D6a — an account id recovered from the token, "always" — and one scenario asserted the confirmation shows one when Mercado Pago is unreachable. Both rewritten to match what ships. A spec that disagrees with itself is worse than one that is merely incomplete: the next reader cannot tell which half is current
- [x] 14.2 **Added `page.test.tsx` (13 tests) and `actions.test.ts` (19 tests).** PC1 has both and PC2 had neither, so the four page states, the authorization boundary, the pending-cookie lifecycle and the log redaction were verified only by hand in a browser. `vitest.config.ts` scopes its coverage thresholds to `src/server/**`, so nothing flagged the gap
- [x] 14.3 `docs/frontend-standards.md:233` still promised the no-JavaScript path, sitting *above* the correction added lower down. Corrected in place
- [x] 14.4 Removed two copy strings orphaned by the withdrawn D6a (`accountHelp`, `confirmDifferentAccount`)

## 13. Documentation and debt

- [x] 13.1 Tick PC2 in `docs/roadmap.md`
- [x] 13.2 **T37 closed** with the 12.5 result: it silently required JavaScript, and worse than suspected — the form never rendered. Every design choice PC1 listed was correct and none was the cause. Superseded by T44, and docs/frontend-standards.md corrected to stop claiming the promise holds
- [x] 13.3 Re-scope T35 to cover credential rotation, noting the new-and-previous last-four log line as what makes a rotation reconstructable
- [x] 13.4 Record new debt: no key-rotation or re-encryption tooling, with a suspected compromise as its trigger
- [x] 13.5 Record new debt: the public key cannot be proven to belong to the verified account, with the calls available today
- [x] 13.6 Record new debt: `intent` values must be namespaced per form before PC3 adds a second form to this settings area
- [x] 13.7 Update `docs/backend-standards.md` if the cipher's placement establishes a convention worth stating for future secrets
