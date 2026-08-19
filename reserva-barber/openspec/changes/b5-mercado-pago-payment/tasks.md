## 1. Documents before code

> `base-standards.md` §7: the spec is the source of truth and is corrected first. Nothing
> in groups 2+ starts until this group is complete.

- [x] 1.1 Confirm B4 is archived. Its `booking-creation` spec must be in `openspec/specs/` before this change's `MODIFIED` delta has a base. If it is not, stop here.
- [ ] 1.2 Establish Mercado Pago's real minimum chargeable amount in ARS **empirically, not from documentation**. Attempted 2026-08-18 and the documentation route does not exist: the API reference for creating a preference states no minimum, and the one help page that names minimums (`mercadopago.com.ar/ayuda/monto-minimo-maximo-medios-de-pago_620`) refuses automated requests (HTTP 403). Public search surfaces only a Mexican figure and an unrelated account minimum — exactly the kind of plausible-looking number T45 warns against adopting. **Method instead:** with test credentials, create preferences at descending amounts (`1.00`, `0.50`, `0.01`) and record which Mercado Pago refuses and with what error. This is what "B5 is the first story in a position to know" actually means. Depends on group 5 existing, so it is executed with the gate in group 11 (task 11.18) and its result is written back here.
- [ ] 1.2b **Franco:** confirm the minimum from your own Mercado Pago account if their dashboard or support states one — the account-level limit can differ from what a test credential reveals, and yours is the one that binds in production.
- [x] 1.3 `docs/backend-standards.md` — rewrite Booking & Payment rule #3: authenticity is established by re-fetching the payment with the owner's own access token, not by signature validation. Name the `ref` resolution and the three verified fields.
- [x] 1.4 `docs/data-model.md` §12 — write the `Payment` rules as built: `mpPaymentId` as the unique idempotency key, the at-most-one-live-payment bound, `Decimal(12,2)`, zone-aware instants, and that `TransferReceipt` is not created here.
- [ ] 1.5 `docs/data-model.md` §14 — set the confirmed minimum from 1.2 and delete the "provisional" wording. **Blocked until 11.18 produces a measured value**; do not close this by writing a plausible number, which is the failure T45 exists to describe.
- [x] 1.6a `docs/tech-debt.md` — open **T60** (webhook signature deferred). Note: **T59 was already taken by B4** (a repeat submission over a `CONFIRMED` booking reported as a live hold), so this change's debt is T60, not T59 as the artifacts originally said.
- [ ] 1.6b `docs/tech-debt.md` — close **T45** (record the measured value, the amounts probed and the rejection observed, not a documentation URL). **Blocked on 11.18.**
- [x] 1.7 `docs/tech-debt.md` — re-cost **T17**, **T47**, **T55** (two more public writes join the metered surface) and **T42** (test credentials now confirm real appointments).
- [x] 1.8 `docs/roadmap.md` — correct the B5 line: it needs a migration, and it depends on PC2's cipher and `PAYMENT_CREDENTIALS_KEY`, not only on PC2's credentials.
- [x] 1.9 `docs/roadmap.md` — correct the "Dependency Notes" advisory-lock entry, which names B7 and D2 as the lock's callers and omits B5.

## 2. Schema and migration

- [x] 2.1 Add `PaymentMethod` and `PaymentStatus` enums and the `Payment` model to `prisma/schema.prisma`, with `Decimal(12,2)`, `Timestamptz(3)`, `onDelete: Restrict`, `@@index([bookingId])` and `mpPaymentId @unique`.
- [x] 2.2 Add the `payments` back-relation to `Booking`.
- [x] 2.3 Generate the migration and hand-add `CREATE UNIQUE INDEX "Payment_one_live_per_booking" ON "Payment" ("bookingId") WHERE status <> 'REJECTED';`
- [x] 2.4 Add the schema comment recording that partial index and naming its migration, in the style `Booking` uses for its hold constraint.
- [x] 2.5a Regenerate the Prisma client. `Payment` confirmed present in `src/generated/prisma/models/`. Schema passes `prisma validate`.
- [ ] 2.5b **Franco:** apply the migration against the shared database — `npx prisma migrate deploy`. Held back deliberately: it is a write to a database B6, B7 and the dashboard also read, and the memory note about stale branches proposing `migrate reset` makes an unattended apply the wrong default. Everything below this line is written and tested against the generated client and does not need the migration to exist until the gate in group 11.
- [ ] 2.6 Write the failing test asserting `MIN_DEPOSIT_AMOUNT` equals the value confirmed in 1.2, then update `src/server/domain/models/depositPolicy.ts` and remove its "provisional" comment.

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

- [ ] 6.1 Failing tests for `PaymentInitiationService`: booking not found, wrong status, hold lapsed, no MP credentials, undecryptable credential, existing live payment returned, happy path.
- [ ] 6.2 Implement `PaymentInitiationService`. The amount comes from `booking.depositAmount`; `DepositPolicy` is not imported (D5) — assert that by test.
- [ ] 6.3 Build the preference payload server-side only: `external_reference = booking.id`, `date_of_expiration = booking.holdExpiresAt`, ARS, `notification_url` with `?ref={payment.id}`, `back_urls` to the confirmation page.
- [ ] 6.4 Failing test asserting the cancellation token appears in no field of the preference payload (D3).
- [ ] 6.5 Create `app/api/payments/mercadopago/paymentInitiationService.ts` — the one composition root in the public flow that constructs `ICredentialCipher`. **No optional constructor arguments on this path** (T57).
- [ ] 6.6 Test over the composer's *source* asserting every dependency is wired, in the shape B4 added after its runtime defect.
- [ ] 6.7 Failing tests then implementation for `app/api/payments/mercadopago/route.ts`: reads `cancellationToken` from the body, `303` to `init_point`, `303` back with an outcome code on every refusal, `force-dynamic`.
- [ ] 6.8 Reuse `BookingThrottle` keyed on `CF-Connecting-IP`, following the shape `POST /api/bookings` settled on **after** its adversarial review: read the body *before* consulting the throttle, because the only thing that says where to send a throttled browser back to is the slug inside the submission, and answer a browser with a rendered outcome redirect rather than a raw JSON body. **Do not attempt to verify this end-to-end in production:** B4 measured that `cf-connecting-ip` cannot be spoofed against real Cloudflare — Cloudflare sets and overwrites it — so a multi-origin test from one machine trips Cloudflare's edge protection with a `403` before the application throttle is ever consulted. Route tests and the preview run are where this is provable.
- [ ] 6.9 Failing test asserting `bookingCreationService()` still constructs no cipher and `PublicPaymentReadiness` still has no field able to hold a token (D4).

## 7. Webhook confirmation

- [ ] 7.1 Zod schema for the notification body in `mercadoPagoWebhookSchema.ts`, with failing tests for garbage, missing `data.id`, and unknown topics.
- [ ] 7.2 Failing tests for `PaymentConfirmationService` covering: `ref` unresolved, payment not found at MP, amount mismatch, reference mismatch, currency mismatch, approved within hold, approved after hold with slot free, approved after hold with slot resold, duplicate delivery, out-of-order `pending` after `approved`, post-confirmation reversal.
- [ ] 7.3 Implement the resolution order: parse → resolve `ref` to a `Payment` (one indexed read) → **only then** call Mercado Pago. Assert by test that an unresolvable `ref` spends no outbound call.
- [ ] 7.4 Implement the three verification comparisons from 3.4 before any transition.
- [ ] 7.5 Implement the in-hold confirmation path through the conditional transaction from 4.3.
- [ ] 7.6 Implement the lapsed-hold path: transaction takes **the same per-barber `pg_advisory_xact_lock`** the booking write takes, calls `blocksAvailability` — imported, not reimplemented — and confirms when the slot is free.
- [ ] 7.7 Implement the slot-lost path: no confirmation, `Payment` recorded `APPROVED`, outcome logged and made renderable.
- [ ] 7.8 Implement the post-confirmation reversal rule: no row changes, `200`, one `warn` with booking id, payment id and reported status (D8).
- [ ] 7.9 Implement the response policy: `200` for handled/ignored/refused/unresolvable, `503` only for transient, `400` only for an unparseable body.
- [ ] 7.10 Failing test asserting responses are byte-identical across ref-not-found, already-processed and verification-refused (no enumeration oracle).
- [ ] 7.11 Implement `app/api/webhooks/mercadopago/route.ts` with `force-dynamic`.
- [ ] 7.12 Failing test asserting no log line on any webhook path carries client contact details, the cancellation token or credential material.
- [ ] 7.13 Failing test asserting each of the seven outcomes logs a distinguishable cause.

## 8. Route guard

- [ ] 8.1 Failing tests first: anonymous `POST` to each new path continues; `/api/payments`, `/api/webhooks`, `/api`, a deeper segment, and an unrelated `/api/*` each redirect to `/login`.
- [ ] 8.2 Add `PUBLIC_PAYMENT_API` and `PUBLIC_MP_WEBHOOK` to `routeGuard.ts` as `===` comparisons, with the comment explaining why neither is a prefix and why the token is in the body.
- [ ] 8.3 Update the `decideGuardAction` doc comment: the public set now holds five entries, not three.
- [ ] 8.4 Failing test asserting `Referrer-Policy: no-referrer` on the confirmation route — the regression guard B4's header now needs, since removing it would break nothing visible.

## 9. Confirmation page and copy

- [ ] 9.1 Extend `bookingConfirmationService.ts`'s projection with payment status and approval instant. Still no client email or phone.
- [ ] 9.2 Failing tests for the page's eight states: hold live unpaid · payment in flight · awaiting confirmation · confirmed · rejected with time left · hold lapsed · paid but slot lost · payments impossible.
- [ ] 9.2b **Closes B4's T59.** The confirmed state is reached from *two* directions and only one is obvious. Assert it for a client returning from a successful checkout **and** for a repeat submission of an already-`CONFIRMED` booking, which `findLiveHoldsForClientOnDay` answers as `alreadyHeld` because a confirmed appointment does hold its slot. Today that path renders "Te guardamos el turno" and "el pago de la seña se habilita muy pronto" over an appointment already paid for. The lookup is right; the page is what needs the state. Nothing in the product could reach `CONFIRMED` until this change, which is why it was unreachable and is not any more.
- [ ] 9.3 Add every new string to `src/lib/copy.ts` in es-AR. Nothing inline.
- [ ] 9.4 Add the new outcome codes to `bookingOutcome.ts`.
- [ ] 9.5 Implement `PayDepositButton.tsx` as a native `<form method="post">` submit, following `BookingSubmitButton`'s disable-on-submit pattern.
- [ ] 9.6 Replace the "payment is not available yet" block with the state machine. Failing test asserting that copy no longer renders for a live hold at a configured shop.
- [ ] 9.7 Failing test asserting the control is **absent from the document** — not disabled — when the hold has lapsed.
- [ ] 9.8 Failing test asserting a forged `?estado=` success code renders no confirmed state (D10).
- [ ] 9.9 Failing test asserting the awaiting-confirmation state renders no progress indicator implying polling.
- [ ] 9.10 Failing test asserting owner-side failures never phrase the error as the client's payment having failed.
- [ ] 9.11 Confirm the countdown stays server-rendered minutes and no client-side timer is introduced.

## 10. Cross-cutting checks

- [ ] 10.1 `npm run typecheck` and lint clean.
- [ ] 10.2 Full suite green.
- [ ] 10.3 Grep the diff for `mercadopago` in `package.json` — it must not appear (T51).
- [ ] 10.4 Grep the diff for `DepositPolicy` imports under the payment paths — none (D5).
- [ ] 10.5 List the callers of `ICredentialCipher`; exactly one belongs to the public booking flow (D4).
- [ ] 10.6 Build and check the Worker bundle size. **Baseline measured by B4's final deploy: 2752.88 KiB gzip, ~319 KiB under the ceiling T51 tracks.** Record this change's number and the delta here. Two `fetch` calls should cost single-digit KiB; anything larger means a dependency crept in (10.3).

## 11. Runtime verification

> B4 found two defects in the first ten minutes of this group against 2061 green tests.
> Both were invisible to the suite by construction. This group is not optional.

- [ ] 11.1 `scripts/b5-gate.ts`: probe that `Payment`, both enums, the unique `mpPaymentId` and the partial index exist in the live database.
- [ ] 11.2 Gate probe: a second non-rejected payment for one booking is refused by the database.
- [ ] 11.3 Gate probe: preference created for a real booking, with the amount matching the snapshot.
- [ ] 11.4 Gate probe: notification round-trip confirms the booking.
- [ ] 11.5 Gate probe: same notification replayed three times → one `CONFIRMED`, one `APPROVED`, three `200`s.
- [ ] 11.6 Gate probe: amount mismatch refused, booking untouched.
- [ ] 11.7 Gate probe: lapsed hold with slot free → confirmed.
- [ ] 11.8 Gate probe: lapsed hold with slot resold → not confirmed, payment `APPROVED`, outcome logged.
- [ ] 11.9 `curl` the payment endpoint anonymously against the running preview and confirm a `303`, not a `307` to `/login` — the exact failure B4 found in the guard.
- [ ] 11.10 `curl` `/api/payments`, `/api/webhooks` and `/api` anonymously and confirm each redirects to `/login`.
- [ ] 11.11 Confirm `Referrer-Policy: no-referrer` on a real confirmation-page response from the preview.
- [ ] 11.12 Walk the flow with JavaScript disabled: the payment control reaches Mercado Pago by full navigation.
- [ ] 11.13 Complete one real test-credential payment end to end and see the booking confirmed without intervention.
- [ ] 11.14 Confirm no preview log line contains the access token, a client contact detail, or a cancellation token.
- [ ] 11.15 **Run at least one pass after 21:00 local**, when the runtime's UTC calendar has already rolled to the next day, and confirm the confirmation page names the day and time chosen.
- [ ] 11.20 Gate probe: **whether Mercado Pago accepts `date_of_expiration` with a `Z` offset.** The gateway sends `toISOString()` (`2026-08-19T12:15:00.000Z`), which is valid ISO 8601, but Mercado Pago's own examples all use a numeric offset (`...-03:00`) and their validators have historically been stricter than the standard. A rejection here surfaces as `invalid` on every preference — the whole story dead — and no unit test can tell the difference, because the transport is a double. Create one real preference and confirm it is accepted and that the expiry is the instant intended; if it is refused, switch to a numeric offset built from the business timezone.
- [ ] 11.19 Gate probe: **what the driver reports for a PARTIAL unique index violation.** `PrismaPaymentRepository` discriminates two constraints by `meta.driverAdapterError.cause.constraint.fields`, a shape `p1-gate-db.ts` measured for ordinary unique indexes only. A partial index was never measured, and no mock can tell us what arrives. If the shape differs, both translations collapse into the fallback and the two outcomes swap meanings — a double-tap becomes an error and a duplicate notification becomes a `5xx`. Trip `Payment_one_live_per_booking` and `Payment_mpPaymentId_key` against the live database, print the raw error, and confirm the field lists this code compares against.
- [ ] 11.18 Gate probe for **T45**: create preferences at `1.00`, `0.50` and `0.01` ARS with test credentials, record which are refused and the exact error, and write the measured minimum back into task 1.2. Then complete 1.5 and 1.6, which are blocked on this number.
- [ ] 11.16 **Franco:** `npm run deploy`, then repeat 11.9, 11.10 and 11.11 against the deployed origin — the guard and the header are configuration, and configuration is what differs between preview and production.
- [ ] 11.17 **Franco:** sign-off recorded here before archiving, including which checks ran after 21:00 local.
