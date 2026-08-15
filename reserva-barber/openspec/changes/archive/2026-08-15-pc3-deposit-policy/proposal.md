## Why

Every booking in this product is confirmed by a deposit, and nothing yet says how much that deposit is. `PaymentConfig.depositValue` has been nullable since PC1 precisely so no story would invent a policy the owner never chose — which means B4, B5 and B6 are all blocked on a number that does not exist. `docs/roadmap.md` states it plainly: deposit configuration is not optional polish, it is upstream of any payment.

PC1 and PC2 stored values the owner **transcribes** from somewhere else — a CBU printed by their bank, a token issued by Mercado Pago's panel. The failure mode there is a typo, and both stories answered it with checksums, verification calls and a confirmation screen. PC3 stores a value the owner **invents**, and that changes the nature of the hazard in three ways:

- **Nothing external can validate it.** `30` and `3` are both legal percentages. A mistyped deposit does not fail on save, does not fail on the first booking, and is discovered by counting money at the end of the month.
- **The type and the value are only meaningful together.** `depositType` carries a `PERCENT` column default. A `50` typed as *fifty pesos* and submitted as `PERCENT` charges half of every service, and both halves of that mistake look correct in isolation.
- **It is the last configuration story.** After PC3 the owner has everything needed to take real bookings, and there is no screen in the product that says so. `docs/tech-debt.md` T42 names PC3 as the story that should build that answer.

## What Changes

- Add a deposit policy editor at `/sena`: the owner chooses `FIXED` (an amount in ARS) or `PERCENT` (a share of the service price), saves it, replaces it, or removes it.
- **Add the `DepositPolicy` value object as the single authoritative deposit computation.** `backend-standards.md` names it and requires that the calculation live in exactly one place, reused by the booking flow and the stats module. B4, B5 and B6 consume it; none of them reimplements it.
- **A fixed deposit is capped at the service price, and every deposit is floored at a minimum chargeable amount.** A $5.000 fixed deposit against a $3.000 service would charge the client more than the service costs; 1% of a $50 service rounds to $0,50, which no payment gateway will accept. The save-time warnings name the affected services, but the **clamp is the actual protection** — a warning is a snapshot that stops being true the moment a cheaper service is created.
- **Percentages are whole numbers, 1 to 100.** `100` is permitted and labelled as full prepayment.
- **`depositType` must be submitted explicitly.** An absent or unrecognized type is a validation error and never falls back to the column default, because the fallback silently converts pesos into a percentage.
- **The replacement confirmation shows the effect on the owner's real services** — `Corte $8.000 → seña $2.400` — computed on the server. This is the only defence against a value that passes every format check and is still off by a factor of ten. First configurations are not confirmed: friction on every save is friction that gets clicked through (PC1 design D14).
- **An empty value field is a validation error, never a removal.** This is a single-field form; if empty meant "clear", one keystroke would leave the business unable to take bookings while looking like an ordinary save. Removal is a separate explicit intent, as it is in PC2.
- **Add the payment readiness panel** — at least one payment method configured *and* a deposit policy set. This is `data-model.md` §14's bookability gate: PC3 reports it, B4 enforces it. `PaymentConfig.ts` has referenced an `isBookable` helper since PC1 that was deliberately never written for want of a caller; PC3 is the caller.
- **The readiness panel must not depend on the encryption key.** It reads the presence flag the repository already derives, so a missing `PAYMENT_CREDENTIALS_KEY` cannot take down a page that has nothing to do with Mercado Pago.
- Add the narrow public projection B5 and B6 will read, keeping `mpAccessToken` out of a path that does not need it — PC1's design D7, now binding on a third read.
- Warn when a save leaves the business with no payment method at all, computed on the server, symmetric with PC1 and PC2. Removal stays permitted: an owner migrating between models must not be trapped.
- **Close T41 before the second confirming form lands.** PC1 and PC2 both carry the owner's confirmation answer as `intent`, and `FormData.get` returns the first value for a name. The debt entry names PC3 as its trigger and states that the fix goes in *before* the collision is possible, not after: intents become `transfer-*`, `mp-*` and `deposit-*`.
- **Extract the es-AR money parser** from `serviceSchema.ts` into a shared domain module. Two call sites is where the duplication becomes structural — the same judgment PC2 applied to `redactDestination`, and here the thing that would drift is a money rule.

## Capabilities

### New Capabilities
- `payment-deposit-policy`: the owner configures, replaces and removes the deposit policy — the two policy types and their validation ranges, the explicit-type rule, the authoritative computation with its rounding, price cap and minimum floor, the effect preview and its confirmation gate, the payment readiness view, the states of the page, and the Spanish (es-AR) copy for each of them. The **snapshot guarantee** for bookings already in flight is stated in `docs/data-model.md` §11 and enforced by B4, not by this capability: PC3 has no booking to protect, and a requirement here would claim an enforcement that does not exist.

### Modified Capabilities
- `data-persistence`: the two deposit columns join the column-scoped partial write already specified for PC1 and PC2 — the third story to write this shared row; a new narrow projection serves the public booking flow without carrying the access token; `Decimal` is converted at the repository boundary in both directions.

## Impact

**Docs** — `docs/data-model.md` amended **before** implementation: §14 gains the rounding mode, the price cap, the minimum floor, the whole-number percentage rule and the removal semantics; §11 gains the snapshot rule, which is a Booking guarantee this story is the first to need. `docs/roadmap.md` PC3 ticked on completion. `docs/tech-debt.md`: **T41 closed**; **T35** updated with the deposit log line; **T42** updated with what PC3 built and what it deliberately left out; **T44** decided rather than silently inherited.

**Schema** — none. `depositType` and `depositValue` exist from PC1's migration with the right types and nullability. This is the second payoff of PC1's design D1.

**Domain** — new `depositPolicy` value object and `money` module; `PaymentConfig` gains the policy types, `hasDepositConfigured`, `isBookable` and the readiness shape; `IPaymentConfigRepository` gains one write and one projection.

**Application** — `depositPolicySchema`; `PaymentConfigService` gains four methods and reuses `writeWithSingleRetry` unchanged. `serviceSchema` is refactored onto the shared money module with its existing tests unmodified — that is the verification of the refactor.

**Presentation** — new route `app/(dashboard)/sena/`; modifications to `app/(dashboard)/layout.tsx` and `src/lib/copy.ts`; `intent` values renamed in the transfer and Mercado Pago actions.

**Configuration** — none. No new secret, no new outbound third-party call. PC3 is the first payment story whose runtime risk is ordinary.

**Known open item** — `MIN_DEPOSIT_AMOUNT` ships with a provisional value. Mercado Pago's real minimum chargeable amount **must be confirmed and the constant updated before B5**, and this is recorded as an explicit pending item rather than assumed correct.

**Downstream** — unblocks B4 (which needs the computation and enforces the bookability gate), B5 and B6. All three consume `DepositPolicy` and the snapshot rule; none may recompute a deposit for a booking that already has one.

**Not affected** — the transfer destination, the Mercado Pago credentials, the credential cipher, and every catalogue story in Phase 1a. PC1's and PC2's columns are untouched by construction, and a test asserts it.
