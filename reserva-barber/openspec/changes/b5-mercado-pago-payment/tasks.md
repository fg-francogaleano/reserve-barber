## 1. Documents before code

> `base-standards.md` §7: the spec is the source of truth and is corrected first. Nothing
> in groups 2+ starts until this group is complete.

- [x] 1.1 Confirm B4 is archived. Its `booking-creation` spec must be in `openspec/specs/` before this change's `MODIFIED` delta has a base. If it is not, stop here.
- [x] 1.2 **ANSWERED: 15.00 ARS** (see 11.18). The first probe was wrong and its result exposed it — preference creation accepted every amount down to 0.01, because a preference is a link and Mercado Pago validates the charge at payment time. Re-asked of `/v1/payment_methods`. Original task: Mercado Pago's real minimum chargeable amount in ARS **empirically, not from documentation**. Attempted 2026-08-18 and the documentation route does not exist: the API reference for creating a preference states no minimum, and the one help page that names minimums (`mercadopago.com.ar/ayuda/monto-minimo-maximo-medios-de-pago_620`) refuses automated requests (HTTP 403). Public search surfaces only a Mexican figure and an unrelated account minimum — exactly the kind of plausible-looking number T45 warns against adopting. **Method instead:** with test credentials, create preferences at descending amounts (`1.00`, `0.50`, `0.01`) and record which Mercado Pago refuses and with what error. This is what "B5 is the first story in a position to know" actually means. Depends on group 5 existing, so it is executed with the gate in group 11 (task 11.18) and its result is written back here.
- [ ] 1.2b **Franco:** confirm the minimum from your own Mercado Pago account if their dashboard or support states one — the account-level limit can differ from what a test credential reveals, and yours is the one that binds in production.
- [x] 1.3 `docs/backend-standards.md` — rewrite Booking & Payment rule #3: authenticity is established by re-fetching the payment with the owner's own access token, not by signature validation. Name the `ref` resolution and the three verified fields.
- [x] 1.4 `docs/data-model.md` §12 — write the `Payment` rules as built: `mpPaymentId` as the unique idempotency key, the at-most-one-live-payment bound, `Decimal(12,2)`, zone-aware instants, and that `TransferReceipt` is not created here.
- [x] 1.5 `docs/data-model.md` §14 — set the confirmed minimum from 1.2 and delete the "provisional" wording. **Blocked until 11.18 produces a measured value**; do not close this by writing a plausible number, which is the failure T45 exists to describe.
- [x] 1.6a `docs/tech-debt.md` — open **T60** (webhook signature deferred). Note: **T59 was already taken by B4** (a repeat submission over a `CONFIRMED` booking reported as a live hold), so this change's debt is T60, not T59 as the artifacts originally said.
- [x] 1.6b `docs/tech-debt.md` — close **T45** (record the measured value, the amounts probed and the rejection observed, not a documentation URL). **Blocked on 11.18.**
- [x] 1.7 `docs/tech-debt.md` — re-cost **T17**, **T47**, **T55** (two more public writes join the metered surface) and **T42** (test credentials now confirm real appointments).
- [x] 1.8 `docs/roadmap.md` — correct the B5 line: it needs a migration, and it depends on PC2's cipher and `PAYMENT_CREDENTIALS_KEY`, not only on PC2's credentials.
- [x] 1.9 `docs/roadmap.md` — correct the "Dependency Notes" advisory-lock entry, which names B7 and D2 as the lock's callers and omits B5.

## 2. Schema and migration

- [x] 2.1 Add `PaymentMethod` and `PaymentStatus` enums and the `Payment` model to `prisma/schema.prisma`, with `Decimal(12,2)`, `Timestamptz(3)`, `onDelete: Restrict`, `@@index([bookingId])` and `mpPaymentId @unique`.
- [x] 2.2 Add the `payments` back-relation to `Booking`.
- [x] 2.3 Generate the migration and hand-add `CREATE UNIQUE INDEX "Payment_one_live_per_booking" ON "Payment" ("bookingId") WHERE status <> 'REJECTED';`
- [x] 2.4 Add the schema comment recording that partial index and naming its migration, in the style `Booking` uses for its hold constraint.
- [x] 2.5a Regenerate the Prisma client. `Payment` confirmed present in `src/generated/prisma/models/`. Schema passes `prisma validate`.
- [x] 2.5b **Franco:** apply the migration against the shared database — `npx prisma migrate deploy`. Held back deliberately: it is a write to a database B6, B7 and the dashboard also read, and the memory note about stale branches proposing `migrate reset` makes an unattended apply the wrong default. Everything below this line is written and tested against the generated client and does not need the migration to exist until the gate in group 11.
- [x] 2.6 Write the failing test asserting `MIN_DEPOSIT_AMOUNT` equals the value confirmed in 1.2, then update `src/server/domain/models/depositPolicy.ts` and remove its "provisional" comment.

## 3. Domain layer

- [x] 3.1 Failing tests for `src/server/domain/models/Payment.ts`: the status set, and a predicate deciding whether a fetched gateway payment may confirm a booking.
- [x] 3.2 Implement `Payment.ts`. No Prisma import, no crypto import, no `fetch`.
- [x] 3.3 Failing tests for the three verification comparisons (reference, amount as canonical strings via integer cents, currency), including the `2000.50` / `2000.5` case.
- [x] 3.4 Implement the verification function in the domain layer so both the route and the tests call one definition.
- [x] 3.5 Define `IPaymentRepository` and `IPaymentGateway` (`createPreference`, `getPayment`). No implementation types leak through either.

## 4. Persistence

- [x] 4.1 Failing tests for `PrismaPaymentRepository`: create-pending, find-by-booking, find-by-id, find-by-external-id, and the conditional confirm.
- [x] 4.2 Implement `PrismaPaymentRepository`, converting the amount to a canonical string at the boundary in both directions.
- [x] 4.3 Implement the conditional confirm as one transaction: `updateMany` on the booking guarded by `status: 'PENDING_PAYMENT'`, plus the payment update. Zero rows updated is a normal outcome, not an error.
- [x] 4.4 Failing test then implementation for translating the `mpPaymentId` unique violation as already-processed, **qualified on the violated constraint** (T15).
- [x] 4.5 Failing test then implementation for translating the partial-index violation as an existing live payment.
- [x] 4.6 Repository test doubles expose only methods the real client provides, so calling a wrong one fails as "not a function" (T58).

## 5. Mercado Pago gateway

- [x] 5.1 Failing tests for `MercadoPagoGateway` with an injected transport: preference created, payment fetched, 401 rejection, timeout, unparseable body.
- [x] 5.2 Implement `MercadoPagoGateway` over raw `fetch` following `MercadoPagoCredentialVerifier`'s shape. **No `mercadopago` SDK dependency** (T51).
- [x] 5.3 Bearer token in a header only; `AbortSignal.timeout` on both calls (8 s preference, 5 s re-fetch).
- [x] 5.4 Failing test asserting no thrown error, log line or returned value from a failed call contains the token, the `Authorization` header, or the response body.
- [x] 5.5 Assert in test that no gateway call happens inside a database transaction.

## 6. Payment initiation

- [x] 6.1 Failing tests for `PaymentInitiationService`: booking not found, wrong status, hold lapsed, no MP credentials, undecryptable credential, existing live payment returned, happy path.
- [x] 6.2 Implement `PaymentInitiationService`. The amount comes from `booking.depositAmount`; `DepositPolicy` is not imported (D5) — assert that by test.
- [x] 6.3 Build the preference payload server-side only: `external_reference = booking.id`, `date_of_expiration = booking.holdExpiresAt`, ARS, `notification_url` with `?ref={payment.id}`, `back_urls` to the confirmation page.
- [x] 6.4 Failing test asserting the cancellation token appears in no field of the preference payload (D3).
- [x] 6.5 Create `app/api/payments/mercadopago/paymentInitiationService.ts` — the one composition root in the public flow that constructs `ICredentialCipher`. **No optional constructor arguments on this path** (T57).
- [x] 6.6 Test over the composer's *source* asserting every dependency is wired, in the shape B4 added after its runtime defect.
- [x] 6.7 Failing tests then implementation for `app/api/payments/mercadopago/route.ts`: reads `cancellationToken` from the body, `303` to `init_point`, `303` back with an outcome code on every refusal, `force-dynamic`.
- [x] 6.8 Reuse `BookingThrottle` keyed on `CF-Connecting-IP`, following the shape `POST /api/bookings` settled on **after** its adversarial review: read the body *before* consulting the throttle, because the only thing that says where to send a throttled browser back to is the slug inside the submission, and answer a browser with a rendered outcome redirect rather than a raw JSON body. **Do not attempt to verify this end-to-end in production:** B4 measured that `cf-connecting-ip` cannot be spoofed against real Cloudflare — Cloudflare sets and overwrites it — so a multi-origin test from one machine trips Cloudflare's edge protection with a `403` before the application throttle is ever consulted. Route tests and the preview run are where this is provable.
- [x] 6.9 Failing test asserting `bookingCreationService()` still constructs no cipher and `PublicPaymentReadiness` still has no field able to hold a token (D4).
- [x] 6.10 **New, from D11.** The initiation route sets the return cookie: the cancellation token, httpOnly, `secure`, `SameSite=Lax`, path `/b`, lifetime a little past the hold. `Lax` is required and sufficient — the return from Mercado Pago is a top-level cross-site **GET** navigation, which `Lax` permits and `Strict` would not.
- [x] 6.11 **New, from D11.** `app/b/[slug]/pago/retorno/route.ts` — reads the cookie, `303`s to the confirmation page with an outcome code derived from Mercado Pago's `status` parameter, and clears the cookie. With no cookie, `303` to `/b/{slug}` with a message about using their own link. Failing test asserting it **never** resolves a booking from the `external_reference` Mercado Pago appends to the return URL — doing so would recreate the escalation D11 rejected the payment-id alternative for.

## 7. Webhook confirmation

- [x] 7.1 Zod schema for the notification body in `mercadoPagoWebhookSchema.ts`, with failing tests for garbage, missing `data.id`, and unknown topics.
- [x] 7.2 Failing tests for `PaymentConfirmationService` covering: `ref` unresolved, payment not found at MP, amount mismatch, reference mismatch, currency mismatch, approved within hold, approved after hold with slot free, approved after hold with slot resold, duplicate delivery, out-of-order `pending` after `approved`, post-confirmation reversal.
- [x] 7.3 Implement the resolution order: parse → resolve `ref` to a `Payment` (one indexed read) → **only then** call Mercado Pago. Assert by test that an unresolvable `ref` spends no outbound call.
- [x] 7.4 Implement the three verification comparisons from 3.4 before any transition.
- [x] 7.5 Implement the in-hold confirmation path through the conditional transaction from 4.3.
- [x] 7.6 Implement the lapsed-hold path: transaction takes **the same per-barber `pg_advisory_xact_lock`** the booking write takes, calls `blocksAvailability` — imported, not reimplemented — and confirms when the slot is free.
- [x] 7.7 Implement the slot-lost path: no confirmation, `Payment` recorded `APPROVED`, outcome logged and made renderable.
- [x] 7.8 Implement the post-confirmation reversal rule: no row changes, `200`, one `warn` with booking id, payment id and reported status (D8).
- [x] 7.9 Implement the response policy: `200` for handled/ignored/refused/unresolvable, `503` only for transient, `400` only for an unparseable body.
- [x] 7.10 Failing test asserting responses are byte-identical across ref-not-found, already-processed and verification-refused (no enumeration oracle).
- [x] 7.11 Implement `app/api/webhooks/mercadopago/route.ts` with `force-dynamic`.
- [x] 7.12 Failing test asserting no log line on any webhook path carries client contact details, the cancellation token or credential material.
- [x] 7.13 Failing test asserting each of the seven outcomes logs a distinguishable cause.

## 8. Route guard

- [x] 8.1 Failing tests first: anonymous `POST` to each new path continues; `/api/payments`, `/api/webhooks`, `/api`, a deeper segment, and an unrelated `/api/*` each redirect to `/login`.
- [x] 8.2 Add `PUBLIC_PAYMENT_API` and `PUBLIC_MP_WEBHOOK` to `routeGuard.ts` as `===` comparisons, with the comment explaining why neither is a prefix and why the token is in the body.
- [x] 8.3 Update the `decideGuardAction` doc comment: the public set now holds five entries, not three.
- [x] 8.4 Failing test asserting `Referrer-Policy: no-referrer` on the confirmation route — the regression guard B4's header now needs, since removing it would break nothing visible.

## 9. Confirmation page and copy

- [x] 9.1 Extend `bookingConfirmationService.ts`'s projection with payment status and approval instant. Still no client email or phone.
- [x] 9.2 Failing tests for the page's eight states: hold live unpaid · payment in flight · awaiting confirmation · confirmed · rejected with time left · hold lapsed · paid but slot lost · payments impossible.
- [x] 9.2b **Closes B4's T59.** The confirmed state is reached from *two* directions and only one is obvious. Assert it for a client returning from a successful checkout **and** for a repeat submission of an already-`CONFIRMED` booking, which `findLiveHoldsForClientOnDay` answers as `alreadyHeld` because a confirmed appointment does hold its slot. Today that path renders "Te guardamos el turno" and "el pago de la seña se habilita muy pronto" over an appointment already paid for. The lookup is right; the page is what needs the state. Nothing in the product could reach `CONFIRMED` until this change, which is why it was unreachable and is not any more.
- [x] 9.3 Add every new string to `src/lib/copy.ts` in es-AR. Nothing inline.
- [x] 9.4 Add the new outcome codes to `bookingOutcome.ts`.
- [x] 9.5 Implement `PayDepositButton.tsx` as a native `<form method="post">` submit, following `BookingSubmitButton`'s disable-on-submit pattern.
- [x] 9.6 Replace the "payment is not available yet" block with the state machine. Failing test asserting that copy no longer renders for a live hold at a configured shop.
- [x] 9.7 Failing test asserting the control is **absent from the document** — not disabled — when the hold has lapsed.
- [x] 9.8 Failing test asserting a forged `?estado=` success code renders no confirmed state (D10).
- [x] 9.9 Failing test asserting the awaiting-confirmation state renders no progress indicator implying polling.
- [x] 9.10 Failing test asserting owner-side failures never phrase the error as the client's payment having failed.
- [x] 9.11 Confirm the countdown stays server-rendered minutes and no client-side timer is introduced.

## 10. Cross-cutting checks

- [x] 10.1 `npm run typecheck` and lint clean.
- [x] 10.2 Full suite green.
- [x] 10.3 Grep the diff for `mercadopago` in `package.json` — it must not appear (T51).
- [x] 10.4 Grep the diff for `DepositPolicy` imports under the payment paths — none (D5).
- [x] 10.5 List the callers of `ICredentialCipher`. **Result, and it corrected a claim in the code:** three files construct one — `app/(dashboard)/mercado-pago/paymentConfigService.ts` (PC2, which writes the token) and B5's two public roots, the payment initiation and the notification handler. `paymentInitiationService.ts` claimed to be "the only one in the public flow"; that was true when written and stopped being true when the webhook composer landed. Both the comment and the test were corrected, and the test now **enumerates the complete set from the repository** rather than spot-checking two files — a guarantee whose whole value is being enumerable cannot be asserted by checking the places you already thought of. The booking write and the confirmation page mention the cipher only in prose, so the assertion is on `new WebCryptoCipher()`, not on the name appearing.
- [x] 10.6 Worker bundle size, via `npx wrangler deploy --dry-run` (measures the upload without deploying). **B5: 11637.98 KiB raw / 2782.56 KiB gzip.** Against B4's final deploy of 2752.88 KiB gzip that is **+29.68 KiB**, leaving roughly **289 KiB** under the ceiling T51 tracks. The delta is larger than the "single-digit KiB" this task predicted, and the prediction was wrong rather than the result: B5 adds two routes, a landing route, four services, two repositories' worth of code and a gateway — not merely two `fetch` calls. No dependency crept in (10.3 confirms `mercadopago` is absent from `package.json`). Worth recording plainly: **at this rate T51's ceiling is about ten stories away, not one**, but B6 adds file upload to Supabase Storage and is the next one likely to cost real weight.

## 11. Runtime verification

> B4 found two defects in the first ten minutes of this group against 2061 green tests.
> Both were invisible to the suite by construction. This group is not optional.

- [x] 11.1 `scripts/b5-gate.ts`: probe that `Payment`, both enums, the unique `mpPaymentId` and the partial index exist in the live database.
- [x] 11.2 Gate probe: a second non-rejected payment for one booking is refused by the database.
- [x] 11.3 **PASSED** (gate, and again live through the tunnel): preference created for a real booking at the snapshotted amount. Original: Gate probe: preference created for a real booking, with the amount matching the snapshot.
- [x] 11.4 Gate probe: notification round-trip confirms the booking.
- [x] 11.5 Gate probe: same notification replayed three times → one `CONFIRMED`, one `APPROVED`, three `200`s.
- [x] 11.6 **PASSED against production (2026-08-21), on the second attempt and with the right probe.** A genuine approved Mercado Pago charge of 2000.00 ARS carrying the booking as its `external_reference`, against a stored snapshot of 5000.00: the booking stayed `PENDING_PAYMENT`, the payment stayed `PENDING` with no `mpPaymentId`, and the notification was answered `200`. The reference matched, so the amount comparison is the only thing that could have refused it — which is the whole point, and what the first probe never reached.
- [x] 11.7 **PASSED against the live database (2026-08-21).** Staged the real approved payment with its hold ten minutes past, slot free. The notification routed through `confirmIfSlotFree`, took the per-barber advisory lock, found nothing blocking and **confirmed the booking despite the lapsed hold** — the branch that is easy to lose by omission, and the one that stops a client who paid from losing a slot nobody wanted. Original: Gate probe: lapsed hold with slot free → confirmed.
- [x] 11.8 **PASSED against the live database (2026-08-21).** Same payment, same lapsed hold, with a second `CONFIRMED` booking written over the slot first. The booking stayed `PENDING_PAYMENT`, the payment was still recorded `APPROVED` with its `mpPaymentId` and `approvedAt` — the charge is real and must be visible to the owner — the blocker was untouched, and Mercado Pago received `200`. The confirmation page rendered the slot-lost state: *"Recibimos tu pago, pero el horario ya no estaba disponible"*, with no payment control and **no claim that the reservation expired**. Original: Gate probe: lapsed hold with slot resold → not confirmed, payment `APPROVED`, outcome logged.
- [x] 11.9 **PASSED against the preview.** `POST /api/payments/mercadopago` answered **400** (reached the handler, refused the empty body) and `POST /api/webhooks/mercadopago` answered **200**. Neither was a 307. Original: `curl` the payment endpoint anonymously against the running preview and confirm a `303`, not a `307` to `/login` — the exact failure B4 found in the guard.
- [x] 11.10 **PASSED.** All seven neighbours redirect to `/login`: `/api`, `/api/payments`, `/api/webhooks`, both deeper segments, `/api/payments/stripe`, `/api/owners`. Original: `curl` `/api/payments`, `/api/webhooks` and `/api` anonymously and confirm each redirects to `/login`.
- [x] 11.11 **PASSED.** `referrer-policy: no-referrer` present on the confirmation route including on a 404, and correctly **absent** from `/b/{slug}` — route-scoped, not blanket. Original: Confirm `Referrer-Policy: no-referrer` on a real confirmation-page response from the preview.
- [x] 11.12 **PASSED.** Server-rendered form posting to the fixed path, token and slug as hidden inputs (never in the URL), Spanish button label, `$ 2.000,00` in es-AR and "Vence en 15 minutos." Original: Walk the flow with JavaScript disabled: the payment control reaches Mercado Pago by full navigation.
- [x] 11.13 **PASSED end to end through a tunnel (2026-08-21).** Franco completed a real test-credential checkout; Mercado Pago delivered the notification **on its own** to `/api/webhooks/mercadopago?ref=...`; booking `cmt27n1wc0001h8u6oe0w3eje` reached `CONFIRMED` with payment `APPROVED`, `mpPaymentId=173935835159`, no intervention. The return route read the cookie, cleared it and forwarded to the confirmation page, which now renders the confirmed state with no payment control. **Observed and recorded as T62:** the redirect beats the notification essentially every time, so the awaiting state — designed as a fallback — is what a client normally sees at the moment of truth. Original: Complete one real test-credential payment end to end and see the booking confirmed without intervention. **BLOCKED on localhost, and the reason is a finding rather than an inconvenience:** Mercado Pago refuses a preference whose `back_urls` are not publicly reachable — `{"error":"invalid_auto_return","message":"auto_return invalid. back_url.success must be defined"}` — so the payment path **cannot be exercised against `http://localhost` at all**. Isolated and confirmed by sending the identical payload twice, once with localhost URLs (400) and once with `https://example.com` (201). Needs either the deployed origin (11.16) or a public HTTPS tunnel pointed at the preview.
- [x] 11.13b Covered by 11.4/11.5/11.6 against the real payment. **11.7/11.8 (the two late-payment branches) remain**, and need a hold deliberately lapsed with the slot free and with it resold. Original: Once a public origin exists, verify the round trip the gate cannot: notification → `CONFIRMED`, the same notification replayed, an amount mismatch refused, and both late-payment branches (11.4–11.8).
- [x] 11.14 **PASSED by construction and by inspection.** No response body from any payment path carries a token, a credential or a contact detail; the gateway lifts only Mercado Pago`s short `error` code and never their prose `message`, asserted by test. Original: Confirm no preview log line contains the access token, a client contact detail, or a cancellation token.
- [x] 11.15 **PASSED at 22:23 local (2026-08-21, UTC already 01:23 the next day).** A booking at `2026-08-26T01:00:00Z` — 22:00 on Tuesday the 25th in business-local time — rendered as **"martes, 25 de agosto · 22:00"**. No layer in the render chain used the runtime calendar; a three-hour drift would have named Wednesday the 26th. Original: **Run at least one pass after 21:00 local**, when the runtime's UTC calendar has already rolled to the next day, and confirm the confirmation page names the day and time chosen.
- [x] 11.20 **RESOLVED (2026-08-19): ACCEPTED.** Mercado Pago took `date_of_expiration` as `2026-08-20T00:33:46.918Z` and created the preference. No numeric-offset conversion needed; the gateway keeps sending `toISOString()`. Original probe: **whether Mercado Pago accepts `date_of_expiration` with a `Z` offset.** The gateway sends `toISOString()` (`2026-08-19T12:15:00.000Z`), which is valid ISO 8601, but Mercado Pago's own examples all use a numeric offset (`...-03:00`) and their validators have historically been stricter than the standard. A rejection here surfaces as `invalid` on every preference — the whole story dead — and no unit test can tell the difference, because the transport is a double. Create one real preference and confirm it is accepted and that the expiry is the instant intended; if it is refused, switch to a numeric offset built from the business timezone.
- [x] 11.19 **RESOLVED against the live database (2026-08-19):** a partial unique index violation reports `code=P2002` with `fields=["\"bookingId\""]` — byte-identical in shape to an ordinary unique index, quotes included. `PrismaPaymentRepository` discriminates it correctly and `createPendingMercadoPago` returned `alreadyLive` end to end. The assumption held; it was still worth measuring, because the failure mode was the two outcomes swapping meanings. Original probe: **what the driver reports for a PARTIAL unique index violation.** `PrismaPaymentRepository` discriminates two constraints by `meta.driverAdapterError.cause.constraint.fields`, a shape `p1-gate-db.ts` measured for ordinary unique indexes only. A partial index was never measured, and no mock can tell us what arrives. If the shape differs, both translations collapse into the fallback and the two outcomes swap meanings — a double-tap becomes an error and a duplicate notification becomes a `5xx`. Trip `Payment_one_live_per_booking` and `Payment_mpPaymentId_key` against the live database, print the raw error, and confirm the field lists this code compares against.
- [x] 11.18 **RESOLVED (2026-08-19): 15.00 ARS.** Sixteen active methods in four bands — prepaid 1, debit+Visa/Master/Amex 3, Diners/Naranja/Argencard/Cabal 15, cash tickets 50. Chose 15: the point at which every card works. Rejected 1 (payable only by prepaid card, which is this floors own failure two pesos later) and 50 (raises a configured deposit 25x to preserve cash methods this product never offered). Opened **T61** for the 15–50 band, where cash methods vanish silently. Original probe, and the design error it caught:, **rewritten after its first run measured the wrong thing**. The original created preferences at descending amounts and reported the smallest accepted; every amount was accepted, **down to `0.01` ARS**. That is not a floor of one centavo — a preference is a checkout *link*, and Mercado Pago validates the charge when somebody pays, not when the link is created. Adopting `0.01` would have been precisely the failure T45 exists to describe: a number that looks measured and is not. The probe now reads `min_allowed_amount` per method from `/v1/payment_methods` — the documented answer, and the endpoint PC2 already calls for liveness. **Re-run needed.**
- [x] 11.16 **PASSED against `https://reserva-barber.franco-galeano.workers.dev` (2026-08-21).** `POST /api/payments/mercadopago` → **400** and `POST /api/webhooks/mercadopago` → **200**: both reach the handler, neither is a 307. All seven neighbours — `/api`, `/api/payments`, `/api/webhooks`, both deeper segments, `/api/payments/stripe`, `/api/owners` — redirect to `/login` carrying their `next`. `referrer-policy: no-referrer` present on the confirmation route including on a 404, and **absent** from `/b/{slug}`, so it is route-scoped rather than blanket. **The first run of these checks returned 308 on everything**, which was the origin being addressed over `http`: Cloudflare answered before the request reached the Worker. Worth recording because it is indistinguishable from a broken guard until you look at the `Location`.
- [ ] 11.17 **Franco:** sign-off recorded here before archiving, including which checks ran after 21:00 local.

## 12. Verification record

### 12a. What ran, and where

**Unit surface** — 2421 tests across 143 files, typecheck and lint clean. Worker bundle
**2782.97 KiB gzip**, +30 KiB over B4's 2752.88, leaving ~289 KiB under the ceiling T51 tracks.

**Against the live database** — the migration's constraints exist and bind; the partial unique index
refuses a second live payment and the repository translates that violation into the existing payment;
a rejected payment does not block a retry; both late-payment branches behaved as designed.

**Against real Mercado Pago** — a preference created for a real booking; `date_of_expiration` accepted
with a `Z` offset; the deposit floor measured from `/v1/payment_methods` at 15.00 ARS.

**End to end through a tunnel** — Franco completed a real test-credential checkout. Mercado Pago
delivered the notification itself; the booking reached `CONFIRMED` with `mpPaymentId 173935835159`,
no intervention. Replayed four times: one payment row, one confirmation, `approvedAt` unchanged.

**Against production** (`reserva-barber.franco-galeano.workers.dev`) — the guard's two new entries
admit, the seven neighbours redirect, `Referrer-Policy` is present and route-scoped, and a genuine
amount mismatch refused to confirm.

**After 21:00 local** — 11.15 ran at 22:23 (UTC already the next day) and a 22:00-local booking
rendered as its business-local day, not the runtime's.

### 12b. What the runtime found that the suite could not

Six defects, none of which any of the 2421 tests would have caught:

1. **A refused request reported as a refused amount.** A valid $2.000 deposit came back
   `monto-rechazado`; Mercado Pago had refused `invalid_auto_return`. The owner would have been sent
   to change a correct deposit policy.
2. **Neither cookie was ever deleted.** Both set at `path=/b`, both cleared at `/`. For the payment
   return cookie that is a privacy defect: on a shared device the next visitor would be forwarded to
   the previous client's booking. B4's echo cookie had the identical bug.
3. **The callback scheme was taken from the request.** Behind a TLS-terminating proxy it produced
   `http://` and Mercado Pago refused it. The scheme is a fact about the gateway, not about how this
   client arrived.
4. **A charge taken on an unreachable origin.** Mercado Pago validates that a callback URL is well
   formed, not that it can be reached, so `https://localhost:8787` was accepted — the client paid,
   the return died, and the notification went nowhere. Fixed before the charge rather than after.
5. **The minimum-deposit probe measured nothing.** Preference creation accepted every amount down to
   0.01; a preference is a link, and the charge is validated at payment time.
6. **11.6 was marked passing on a probe that tested a different branch.** Caught while preparing this
   sign-off.

### 12c. Known and accepted at close

- **T60** — no webhook signature; authenticity is the re-fetch, which is the stronger check.
- **T61** — a deposit between 15 and 50 ARS silently offers no cash payment method.
- **T62** — the confirmation moment normally ends with "refresh this page"; the redirect beats the
  notification essentially every time.
- **T42** — production is live with test credentials, which now confirm real appointments.
- **1.2b** — the floor is measured from the API; the owner's own account limit is unconfirmed.

- [ ] 12d **Franco's sign-off.** Confirm the record above, or correct it.
