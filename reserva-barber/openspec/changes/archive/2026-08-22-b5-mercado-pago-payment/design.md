## Context

B4 left a working hold and no way to pay for it. The pieces B5 needs already exist and are
deliberately shaped: `booking.depositAmount` is a snapshot that is never recomputed,
`holdExpiresAt` is clamped so a hold cannot outlive its appointment, `blocksAvailability`
is the single blocking predicate both the read and the write call, a per-barber
`pg_advisory_xact_lock` is the concurrency guarantee, and `Referrer-Policy: no-referrer`
was put on the confirmation route in B4 explicitly for the redirect this change performs.

What does not exist: the `Payment` table, any outbound call that spends money, and any
public-flow surface permitted to decrypt `PaymentConfig.mpAccessToken`.

Three constraints shape everything below.

**The gateway is multi-tenant from our side.** Each owner brings their own Mercado Pago
account. Nothing about a notification tells us whose account it concerns — T43 already
established that the account id is not derivable from the token — and every question we
want to ask Mercado Pago requires knowing that first.

**The hold is 15 minutes and a hosted checkout is not bounded by it.** This is not an
exotic edge; a single card rejection and retry exceeds it.

**The runtime is Cloudflare Workers, near a bundle ceiling.** T51 records the Worker is
one story from the free plan's limit. `MercadoPagoCredentialVerifier` already established
how to call this gateway from here without a vendor SDK.

## Goals / Non-Goals

**Goals:**
- A client pays the deposit and the booking reaches `CONFIRMED` with no human involved.
- A notification cannot confirm a booking unless Mercado Pago itself, queried with the
  owner's own credential, says the payment is approved for the right amount and reference.
- Duplicate, out-of-order and replayed notifications are harmless.
- A payment that lands after the hold lapsed has a defined, honest ending in both
  directions — slot still free, and slot resold.
- The four-story-old guarantee that the encrypted token cannot leak from the public flow
  survives in a weaker but still enumerable form.

**Non-Goals:**
- Bank transfer (B6), the hold sweeper (B7), the confirmation email (N1), client
  cancellation (C1), dashboard cancellation (C2).
- Refund automation — explicitly out of MVP scope. B5 owes *visibility* of a refund that
  is owed, not the refund.
- Webhook signature validation (deferred as T60, decided in D3).
- Any change to `PaymentConfig`'s columns or its dashboard editors.
- Polling, websockets or live updates on the confirmation page.

## Decisions

### D1 — Authenticity is a re-fetch with the owner's token; the signature is deferred

`backend-standards.md` rule #3 says the handler "validates the signature". That rule is
not implementable as written and must be corrected before code.

Mercado Pago's `x-signature` is an HMAC keyed by a per-integration webhook secret issued
in their dashboard. We store no such secret, and choosing *which* owner's secret to
validate with requires resolving the notification first — the chicken-and-egg that makes
the signature unusable as the first gate in a multi-tenant integration.

**Decision.** `notification_url` carries `?ref={payment.id}` — the id of the `Payment` row
written at preference creation. It is not a secret and authorizes nothing; it resolves
owner → access token. The handler then calls `GET /v1/payments/{data.id}` with that token,
and **that response is the sole authority**. Three fields are compared against our row
before anything transitions: `external_reference === booking.id`, `transaction_amount ===
payment.amount`, `currency_id === 'ARS'`.

*Why this is not weaker than a signature.* A valid signature proves only that Mercado Pago
sent the bytes. The re-fetch proves the payment exists, is approved, is for the right
amount, and is bound to our booking — every property the transition actually depends on.
An attacker cannot forge a payment the owner's own account will confirm.

**Alternatives considered.**
- *Add `PaymentConfig.mpWebhookSecret` and validate properly.* Rejected for this change:
  it needs a migration column, a fourth `CredentialPurpose`, a field on PC2's form with
  its own verified/unreadable states, and a manual dashboard step for every owner. That is
  a PC2 amendment inside a B5 change, against `base-standards.md` §1. Opened as **T60**
  with its trigger: the first owner who asks, or forged traffic visible in the
  ref-unresolved counters.
- *Validate the signature when a secret exists, skip when it does not.* Rejected outright.
  A check that passes when unconfigured reads as protection in every later review while
  protecting nothing. Worse than having none.
- *Put the owner id in `notification_url` instead of the payment id.* Rejected: it
  discloses an internal identifier for no gain, and the payment row is what we need to
  load anyway.

### D2 — Two static paths, and the token in the body

`decideGuardAction` admits the public write with `pathname === PUBLIC_BOOKING_API` — exact
string equality. A token-parameterized path like `/api/bookings/{token}/pago` cannot join
the public set without introducing pattern matching into the deny-by-default guard, which
is the single place in this application where a loose match is most expensive: a bare
`startsWith('/b')` there would have exposed every barber, schedule and absence, and the
guard's own spec records that as the one defect a browser check cannot catch.

**Decision.** `POST /api/payments/mercadopago` and `POST /api/webhooks/mercadopago`, both
fixed strings, both added as `===` entries with negative-case tests for `/api/payments`,
`/api/webhooks`, `/api`, a deeper segment, and an unrelated `/api/*`. The
`cancellationToken` travels in the POST body.

*Second benefit, not incidental.* A token in a path lands in access logs, proxy caches and
the next request's `Referer`. B4 already paid for this rule once, routing contact details
through an httpOnly cookie rather than a redirect URL.

**Alternative considered.** *Teach the guard a tested regex, as `isBookingConfirmationRoute`
already is.* Rejected: that regex governs a response header, not an authorization
decision. Introducing pattern matching into the authorization path to save a body
parameter is a bad trade.

### D3 — `external_reference` is `booking.id`, never the cancellation token

The obvious binding between an MP payment and our booking is the token already in the URL.
It is the wrong one. `external_reference` is stored by Mercado Pago, displayed in their
dashboard, echoed in notifications and reachable by their support tooling. The
cancellation token is the client's only credential for cancelling, is `@unique`, and cannot
be rotated without invalidating the link the client holds.

**Decision.** `external_reference` is `booking.id`; `metadata` carries `bookingId`; the
token appears in no field of the preference, including `back_urls`.

### D4 — One new composition root, and the two older guarantees left standing

`bookingCreationService.ts` documents at length that it constructs no `ICredentialCipher`,
and `PublicPaymentReadiness` is a type with no field the token fits into. B5 must decrypt.

**Decision.** A new composition root at `app/api/payments/mercadopago/paymentInitiationService.ts`
is the only one in the public flow that builds a cipher. `PublicPaymentReadiness` gains no
field. `bookingCreationService()` is untouched. The plaintext is handed straight to
`MercadoPagoGateway` and exists nowhere above it.

*Why a new file rather than widening the existing one.* The blast radius stays enumerable:
listing the callers of `ICredentialCipher` answers "what can decrypt a credential?" in one
grep, forever. Widening the booking write's composer would make that question require
reading the composer.

**T57 applies directly.** B4's runtime check caught a payment repository wired into the
write composer and not the read one, because the argument was optional and an omitted
optional argument compiles, typechecks and passes every unit test. The payment composers
get a test over the composer's *source*, and no constructor argument on this path is
optional.

### D5 — The amount is read, never recomputed

`booking.depositAmount` is the snapshot. `DepositPolicy` is not called anywhere in B5 —
neither to build the preference nor to verify the webhook's amount.

The failure this prevents is specific: an owner edits their deposit policy while a client
is at the checkout, and the client's correct payment is rejected as the wrong amount. The
natural implementation of an amount check is to recompute, which is why this is a decision
rather than an assumption, and why it gets a test.

### D6 — Three layers against the late payment, and the free-slot branch confirms

Prevention alone is insufficient (a payment authorized at 14:59:58 can be notified minutes
later); detection alone wastes the cheap gateway-side refusal; and neither says what to do
when the slot is gone.

**Decision — all three.**

1. `date_of_expiration` on the preference = `booking.holdExpiresAt`.
2. A late-but-approved notification re-checks under **the same per-barber
   `pg_advisory_xact_lock`** the booking write takes, calling `blocksAvailability`.
3. Slot free → **confirm anyway.** Slot resold → do not confirm, record the `Payment` as
   `APPROVED` because it is a real charge, surface the outcome to client and owner.

*The free-slot branch is the one that is easy to get wrong by omission.* The tempting
implementation refuses every late payment. But a client who paid, whose slot nobody
wanted, would lose their appointment to a clock — and B7 does not exist yet, so the
booking is still sitting there unexpired. Confirming is both correct and what the owner
would want.

*Why `APPROVED` and not `REJECTED` on the slot-lost branch.* The charge happened. Recording
it as rejected would make the money invisible to the owner's own accounting, which is the
opposite of the point. The booking simply never confirms.

**Named consequence for downstream stories:** this creates the first `Payment APPROVED`
row against a booking that is not `CONFIRMED`. D1's income counters must not count it as
revenue and D5's statistics must not count the booking.

**B4 warned that "an advisory lock binds only code that takes it" and named B7 and D2 as
the callers that must take it. This is a third, and the roadmap's dependency note must be
corrected.**

### D7 — Idempotency at the database, and `200` for everything not worth retrying

`mpPaymentId` is `@unique`; the confirmation is a conditional update guarded on the booking
still being `PENDING_PAYMENT`; a partial unique index (`WHERE status <> 'REJECTED'`) bounds
live payments per booking.

**Response policy.** `200` for handled, ignored, refused-by-verification, and unresolvable
`ref`. `503` only for a genuinely transient failure. `400` only for a body that will not
parse at all. A `4xx`/`5xx` makes Mercado Pago retry, and retrying a notification we
correctly decided to ignore is a self-inflicted load loop on an endpoint that also spends
an outbound call.

**Responses must be indistinguishable** across ref-not-found, already-processed and
verification-refused, or the endpoint becomes an oracle for which bookings exist.

**T15 applies:** the `P2002` translation must be qualified on the violated constraint. This
codebase already carries a defect where an unqualified violation reports as a duplicate
name.

### D8 — Post-confirmation reversals change nothing and are logged

A `refunded` / `charged_back` / `cancelled` notification on a `CONFIRMED` booking changes
no row, answers `200`, logs one `warn` with booking id, payment id and reported status.

Auto-cancelling on a *filed* dispute — one the owner may win — would silently empty an
agenda and leave a client arriving to nothing. C2 gives the owner the control; B5 owes them
the information. Written as an explicit rule because a handler with no branch for
`refunded` is indistinguishable from one that forgot.

### D9 — Raw `fetch`, following the verifier's established shape

Injected `typeof fetch`, `AbortSignal.timeout` on every call, bearer in a header never a
query parameter, transport failures collapsed to a null result, and **no response body
from either endpoint ever logged** — rejection payloads routinely echo the credential they
rejected. 8 s for preference creation (an owner-facing wait), 5 s for the webhook
re-fetch. No Mercado Pago call inside a transaction.

**Alternative considered.** *The `mercadopago` npm SDK.* Rejected: two endpoints against a
bundle T51 says is one story from the ceiling, and the verifier already proves the pattern
works here.

### D11 — The gateway is never told the confirmation page's address

Found while writing the initiation service: D3 says the cancellation token appears in **no**
field of the preference, and the obvious `back_urls` value is the confirmation page —
which is addressed by that token. The spec and the implementation collided, and the spec
was right.

**Decision.** `back_urls` points at `/b/{slug}/pago/retorno`, a landing route naming no
credential. The token travels in an httpOnly, `SameSite=Lax`, `/b`-scoped cookie set when
the payment is initiated, and the landing route reads it back and `303`s to the
confirmation page with an outcome code. This is B4's own mechanism — the rejected-form
echo cookie — reused for the same reason and with the same cross-site-navigation
properties.

**Alternatives considered.**
- *Put the payment id in `back_urls` and resolve the booking from it.* Rejected, and this
  one is a trap worth naming: the id is already in `notification_url`, so it looks free.
  But a route that turns a payment id into a cancellation token makes `ref` **authorize
  something**, and `ref`'s entire safety argument in D1 is that it authorizes nothing.
- *Mint a return-only secret.* Rejected: two secrets for one holder, which B4 refused when
  it chose to address the confirmation page by the token the client already had.
- *Accept the token in `back_urls`.* Rejected: it stores a live cancellation credential in
  Mercado Pago's preference data and dashboard. B4 added `Referrer-Policy: no-referrer` to
  this exact route to stop the token reaching a third party through a header; handing it
  over in a field would undo that for a saving of thirty lines.

**Accepted cost.** A client returning in a different browser, or with a cleared cookie
jar, lands on the shop's public page with a message rather than on their confirmation.
The return URL does carry Mercado Pago's own `external_reference` — the booking id — and
the route deliberately **does not** use it, because resolving a token from it would
recreate the escalation the first alternative was rejected for.

### D10 — The return from Mercado Pago decides nothing

`back_urls` carry only an outcome code; the page reads live booking and payment state. A
return URL is a browser navigation anyone can type. The page already reads live state —
B4 built it that way so a hold that lapsed while the page sat open shows as lapsed — so
this costs nothing new and makes a forged success return inert.

The countdown stays **server-rendered minutes**. A client-side ticking timer would be a
hydration mismatch on the one page whose value is being truthful about time.

## Risks / Trade-offs

- **[No signature validation ships]** → The re-fetch is the stronger check and is
  mandatory; the `ref` lookup is a single indexed read that rejects garbage before any
  outbound call is spent. T60 carries the trigger. Accepted deliberately, not overlooked.
- **[The webhook is unauthenticated and triggers an outbound call]** → Resolve `ref`
  first, cheaply; never call Mercado Pago for a notification we cannot place. Still an
  unmetered public endpoint — same family as T47/T55, re-costed rather than re-solved.
- **[A client can pay and still lose the slot]** → Narrowed by `date_of_expiration`,
  detected under the lock, and surfaced honestly to both parties. Cannot be eliminated
  without refund automation, which is out of MVP scope. B7 will shrink the window.
- **[The plaintext token now exists on a public code path]** → One composition root, one
  adapter, no application type able to hold it, no MP response body logged, and `T57`'s
  lesson applied: no optional constructor argument on this path, plus a test over the
  composer's source.
- **[An undecryptable credential fails in front of a client]** → The SQL presence gate
  cannot detect it. Surfaced as a shop-side message that never blames the client, and
  logged with the cause distinguished so the owner learns without a client report.
- **[Test credentials confirm real appointments against play money]** → T42 already
  describes the gap; this change makes it consequential and says so. Not fixed here.
- **[`Decimal` comparison against MP's reported amount]** → Canonical strings across the
  repository boundary and integer-cent arithmetic. The driver returns `2000.50` as
  `2000.5`; this was measured in PC3 and already binds `Service.price` and `Booking`.
- **[Worker bundle size]** → No SDK. Two `fetch` calls.
- **[B4 is not archived, so `booking-creation` has no base spec]** → The `MODIFIED` delta
  here assumes B4's spec lands first. This gates `/opsx:apply`, not this proposal.

## Migration Plan

1. **B4 archives first.** It has open verification tasks (the post-21:00 gate run, the
   deploy, Franco's sign-off) and this change's `booking-creation` delta modifies a
   requirement that only enters `openspec/specs/` when B4 archives.
2. **Documents before code** (`base-standards.md` §7): correct `backend-standards.md`
   rule #3, `data-model.md` §12 and §14, the roadmap's B5 line and its advisory-lock
   dependency note. Open T60, close T45.
3. **Migration**: `Payment` + two enums + `Booking.payments` + the partial unique index in
   raw SQL, with a schema comment recording it. Additive only — no existing column or
   table is altered, so rollback is a table drop with no data loss to any prior story.
4. **Code**, then the gate script against a deployed preview.
5. **Rollback**: the feature is reachable only from the payment control on the confirmation
   page; removing that control disables the flow without touching the schema. Bookings
   already confirmed stay confirmed.

## Open Questions

None blocking. Two resolved during enrichment and recorded above rather than left open:
the signature (D1 → T60) and the late-payment policy (D6). One question is answered *by*
this change rather than before it: **Mercado Pago's real minimum chargeable ARS amount**,
which T45 named B5 as the trigger for — it must be confirmed from Mercado Pago's
documentation during the change and written into `MIN_DEPOSIT_AMOUNT`, with the
"provisional" wording removed from all three places in the same commit.
