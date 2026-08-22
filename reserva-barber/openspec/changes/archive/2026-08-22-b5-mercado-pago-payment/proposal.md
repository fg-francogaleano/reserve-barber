## Why

B4 ends with a slot held and a paragraph admitting nobody can pay for it. The hold is
real, the deposit is computed and snapshotted, the cancellation token exists — and the
last thing the client reads is that paying is not possible yet. B5 is where the deposit
stops being a number on a page and becomes money in the owner's Mercado Pago account,
and where a booking reaches `CONFIRMED` without a human touching it.

It is also the first story in this project that **takes money from a stranger and lets a
third party decide what happened**. Every rule below follows from that. Until now the
public flow held one guarantee by construction: no surface in it could reach the
encrypted Mercado Pago token, first because no repository was wired at all (B1–B3), then
because the only payment type it could see had no field the token fits into (B4). B5 has
to charge, so it has to decrypt — and a guarantee that has survived four stories is not
deleted casually.

Three things converge here and none can be deferred:

- **The webhook is the only authority, and it arrives unauthenticated.** The client's
  return from Mercado Pago proves nothing — it is a browser navigation anyone can type.
  A notification is a hint. What decides whether a booking confirms has to be something
  an attacker cannot forge, and it has to work for a product where every owner brings
  their own Mercado Pago account.
- **The hold is 15 minutes and a checkout is not.** `HOLD_DURATION_MINUTES = 15`; a
  Checkout Pro session with one card rejection and a retry exceeds that easily. When it
  does, `blocksAvailability` stops counting the booking, the slot returns to sale,
  somebody else takes it, and *then* the approved notification arrives. That is money
  taken for an appointment that does not exist, and refund automation is out of MVP
  scope by `base-standards.md` §4.
- **`Payment` does not exist.** B3 pre-created the booking tables so B4 would not alter a
  live schema. That arrangement ended with B4: `prisma/schema.prisma` stops at `Booking`,
  and this is the story that writes `data-model.md` §12 into the database.

## What Changes

### The confirmation page stops apologizing

- The "paying is not possible yet" block on `/b/{slug}/reserva/{token}` — the disclosure
  B4 shipped attached to a statement that was finally true — is **retired** and replaced
  by a **"Pagar seña"** submit inside a native `<form method="post">`. The house pattern:
  no JavaScript required, a full navigation to Mercado Pago.
- The page becomes a small state machine over live booking and payment state: hold live
  and unpaid · payment already in flight · returned and awaiting confirmation · confirmed
  · rejected with time left · hold lapsed · **paid but the slot was lost** · payments
  impossible. It already reads live state rather than trusting the redirect that sent the
  client there, which is what makes the last three expressible at all.

### Two public endpoints, both static paths

- **`POST /api/payments/mercadopago`** creates the preference for exactly
  `booking.depositAmount` in ARS, writes a `PENDING` `Payment` row, and answers `303` to
  the `init_point`.
- **`POST /api/webhooks/mercadopago?ref={paymentId}`** confirms or refuses.
- **The route guard gains exactly two more named exact entries.** `routeGuard.ts` already
  records that B5's webhook "needs its own exact entry when it arrives; it does not
  inherit this one". Both are `===` comparisons, never prefixes — and because
  `decideGuardAction` cannot express a token-parameterized path without introducing
  pattern matching into the one place where a loose match is most expensive, the
  `cancellationToken` travels in the **request body**, never in the path.

### Authenticity is a re-fetch, not a signature — and the standards document is wrong

`backend-standards.md` rule #3 says the handler "validates the signature". That cannot be
the load-bearing check here: Mercado Pago's `x-signature` HMAC is keyed by a
per-integration webhook secret, this product is multi-tenant against MP, there is no
column for such a secret, and choosing *which owner's* secret to validate with requires
resolving the notification first. So:

- `notification_url` carries `?ref={payment.id}` — not a secret, authorizing nothing,
  existing only to resolve whose account the notification concerns. T43 already
  established that the MP account id is not derivable from the token, so nothing in the
  payload can answer that question.
- The authority is **`GET /v1/payments/{id}` with that owner's own access token**. An
  attacker cannot forge a payment that the owner's own account confirms.
- **Three fields are re-verified and a mismatch refuses rather than confirms:**
  `external_reference === booking.id`, `transaction_amount === booking.depositAmount`,
  `currency_id === 'ARS'`. Without the amount check, any $1 payment on that account
  confirms a $5.000 booking.
- **No signature validation ships at all**, and that is a decision rather than an
  omission — opened as **T60**. A `validateSignature()` that returns `true` when no
  secret is configured reads as protection in every later review while protecting
  nothing.

### The cipher seal breaks, in one file, deliberately

B5 needs the plaintext access token. The guarantee changes shape a second time rather
than weakening: `PublicPaymentReadiness` gains no field, `bookingCreationService()`
still constructs no cipher, and a **new, separate composition root** becomes the only
one in the public flow that does. A reviewer can see the whole blast radius by listing
the callers of `ICredentialCipher`.

### Three layers against the payment that arrives too late

Prevention, detection, and an honest ending — because each covers a case the others do
not:

- `date_of_expiration` on the preference is `booking.holdExpiresAt`, so Mercado Pago
  itself refuses a late attempt. This narrows the race; it does not close it.
- A late-but-approved webhook re-checks availability **under the same per-barber
  `pg_advisory_xact_lock` B4 established**, calling `blocksAvailability` — the same
  function, never a copy. **If the slot is still free the booking confirms anyway**: a
  client who paid and whose slot nobody wanted should not lose it to a clock.
- If the slot was resold, nothing confirms, the `Payment` is still recorded `APPROVED`
  because it is a real charge, and the outcome is surfaced to both the client and the
  owner. A refund the owner never learns about is not out of scope — it is a defect.

**B4 warned that "an advisory lock binds only code that takes it" and named B7 and D2 as
the callers that must take it. B5 is a third, and the roadmap does not say so.**

### Idempotency is a constraint, not handler logic

`mpPaymentId` is `@unique`; the confirmation is a conditional update guarded on the
booking still being `PENDING_PAYMENT`; a partial unique index permits at most one
non-rejected payment per booking. Every recognized-but-unactionable notification answers
`200` — a `4xx` or `5xx` makes Mercado Pago retry, and retrying a notification we
correctly decided to ignore is a self-inflicted load loop. Only a genuinely transient
failure answers `503`, because that one *should* be retried.

### A rule for the money coming back

A `refunded`, `charged_back` or `cancelled` notification on an already-`CONFIRMED`
booking **changes no row**, answers `200`, and logs one `warn` line. Automatically
cancelling a confirmed appointment because a dispute was *filed* — one the owner may
win — would silently empty their agenda and leave the client arriving to nothing. A human
owns that decision; C2 is the control. Written as a rule rather than left as a missing
branch, because a handler that never contemplates `refunded` looks identical to one that
forgot.

## Capabilities

### New Capabilities
- `payment-mercado-pago`: the payment control on the confirmation page and its states,
  preference creation and the `Payment` record it writes, the checkout redirect, the
  webhook and the re-fetch that authenticates it, the amount and reference checks, the
  idempotency rules, the three-layer late-payment policy, the post-confirmation refund
  rule, and the single composition root permitted to decrypt the access token.

### Modified Capabilities
- `booking-creation`: the confirmation page's terminal state is no longer "payment is not
  possible"; it becomes the entry to a payment. **This spec lands in `openspec/specs/`
  only when B4 archives** — B4 still has open verification tasks, so this delta has no
  base until then, and that ordering gates apply, not proposal.
- `booking-availability`: the shared blocking predicate and B4's per-barber advisory lock
  acquire a third caller, and for the first time a caller that *confirms* rather than
  creates. The rule that choosing a time reserves nothing is unchanged; the rule about
  who must take the lock is not.
- `data-persistence`: `Payment` gains its first writer — the unique `mpPaymentId` as an
  idempotency key, the partial unique index bounding live payments per booking, and the
  `Decimal(12,2)` convention `Service.price` established and `Booking` follows.
- `owner-authentication`: the deny-by-default public set gains exactly two more
  explicitly named exact paths, proven by test rather than by reading the matcher.
- `credential-encryption`: the rule that no public-flow surface constructs a cipher
  narrows to name the one surface that must, and states where the decrypted value is
  permitted to exist.
- `payment-mercado-pago-credentials`: the stored token acquires its first consumer that
  actually authorizes a charge, which makes an undecryptable envelope a client-facing
  failure rather than only a dashboard state.

## Impact

**Database** — **a migration, and the first since B3.** New `Payment` table, new
`PaymentMethod` and `PaymentStatus` enums, `Booking.payments` back-relation, plus a
partial unique index Prisma cannot declare and which must be commented in
`schema.prisma` the way `Booking` comments its hold constraint. `PaymentConfig` is not
touched: no `mpWebhookSecret` column, per T60.

**New code** — `app/api/payments/mercadopago/route.ts` and its composition root (the only
one with a cipher), `app/api/webhooks/mercadopago/route.ts`, `domain/models/Payment.ts`,
`IPaymentRepository`, `IPaymentGateway`, `PrismaPaymentRepository`, `MercadoPagoGateway`,
`PaymentInitiationService`, `PaymentConfirmationService`,
`mercadoPagoWebhookSchema.ts`, `PayDepositButton.tsx`, `scripts/b5-gate.ts`.

**Changed code** — `prisma/schema.prisma`, `routeGuard.ts`, the confirmation page and its
service, `bookingOutcome.ts`, `src/lib/copy.ts`, `depositPolicy.ts` (T45).

**Unchanged by contract** — `bookingCreationService()` still constructs no cipher;
`PublicPaymentReadiness` gains no field; the availability read is untouched; the
confirmation page still renders no client email or phone; the route still declares no
`loading.tsx` above the slug resolution; nothing in the public flow is cached or indexed.

**Third party, by raw `fetch`** — two Mercado Pago endpoints (`POST
/checkout/preferences`, `GET /v1/payments/{id}`), following
`MercadoPagoCredentialVerifier`'s established pattern: injected transport,
`AbortSignal.timeout`, bearer in a header, transport failures collapsed, nothing from an
error body allowed to escape. **The `mercadopago` npm SDK is rejected**: T51 records the
Worker is one story away from the free plan's size ceiling, and two endpoints do not
justify spending it.

**Documents this change must correct before code** — `backend-standards.md` rule #3
(signature → re-fetch); `data-model.md` §12 (the `Payment` rules as built, including the
idempotency key and the live-payment bound) and §14 (T45); `roadmap.md`'s B5 line, which
names no migration and no cipher dependency, **and** its "Dependency Notes" advisory-lock
entry, which names B7 and D2 as the lock's callers and omits B5.

**Tech debt this change must answer** — **T45** closes here by its own named trigger
(Mercado Pago's real minimum chargeable ARS amount, confirmed and de-provisionalized in
all three places). **T60** opens (webhook signature deferred, with the trigger recorded).
**T42** becomes consequential for the first time: an owner shipping test credentials now
confirms real appointments against play money. **T17/T47/T55** are re-costed — the
payment initiation endpoint joins the metered public writes and the throttle is still
per-isolate.

**Accepted product consequence** — a client can pay, have the slot lost to the clock, and
end on a page that tells them so. That is the honest shape of a 15-minute hold, a hosted
checkout and no refund automation. It is surfaced rather than hidden, and B7 shortening
the window it lives in is three stories away.
