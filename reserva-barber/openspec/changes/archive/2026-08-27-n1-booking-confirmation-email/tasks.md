## 0. Before any code (Franco, and it is not code)

- [x] 0.1 **Done, and the measurement settled it.** Workers Paid was taken; N1 deployed at 3068.31 KiB and C2 at 3073.75 KiB — the second is above the free plan ceiling outright. T51 closed. Original task: Decide T51 first: measure `wrangler deploy --dry-run` on `main` to establish this branch's baseline, then take Workers Paid (US$5/month, 10 MiB) or accept explicitly that this story is being built against ~148 KiB of headroom that Cloudflare measures more strictly than wrangler reports. T51's standing recommendation is to take it **before** starting; B2 discovered its ceiling as a failed deploy mid-story and nobody should discover it that way twice.
- [x] 0.2 **Half done, and the half that is missing is the one that matters for real clients.** The account exists and a send-scoped key was issued. **No sending domain is verified**, so `onboarding@resend.dev` is the only usable sender and it delivers ONLY to the account owner. Tracked as T76. Original task: Create the Resend account and **verify a sending domain** — publish its SPF/DKIM records and a DMARC policy. Until this exists, `onboarding@resend.dev` delivers only to the account owner's own address and step 10 is impossible. This blocks verification, not implementation.
- [x] 0.3 Create a send-scoped API key. Do not create one with broader permissions "for now".

## 1. Source-of-truth documents first (`base-standards.md` §7)

- [x] 1.1 `docs/data-model.md` §11: add `confirmationEmailSentAt` — nullable, zone-aware, written after the provider accepts, outside the confirming transaction; state that it is **not** an idempotency key and that its null on a `CONFIRMED` booking means the client was never told.
- [x] 1.2 `docs/backend-standards.md` Booking rules 3 and 4: record that the confirming transition on each path hands off to a confirmation email after commit, that the send is never inside a transaction, and that a send failure never changes an outcome or an HTTP status.
- [x] 1.3 `docs/backend-standards.md` §Secrets: add `RESEND_API_KEY` to the per-feature validation rule beside `PAYMENT_CREDENTIALS_KEY`, and correct the sample `required` array in that section, which currently lists `RESEND_API_KEY` in a **global** check that this change specifies must not exist.
- [x] 1.4 `docs/backend-standards.md`: add the email-integration rule — platform `fetch`, no vendor SDK, bounded abort, key in a header, no response body logged, failure as a value and never a throw.
- [x] 1.5 `docs/frontend-standards.md` §Internationalization: state that email copy is user-facing copy and lives in `copy.ts` like every other Spanish string.

## 2. The migration

- [x] 2.1 Branch from an updated `main` before generating anything — the shared database makes a stale branch propose `migrate reset` (S0 notes, re-learned in B4).
- [x] 2.2 Add `confirmationEmailSentAt DateTime? @db.Timestamptz(3)` to `model Booking` in `prisma/schema.prisma`, with the doc comment stating what its null means and that nothing reads it before sending.
- [x] 2.3 Generate and apply `n1_booking_confirmation_email_sent_at`. Confirm the migration is one nullable column with no backfill, no altered column and no index, and that existing rows read null.

## 3. The port and the outcome vocabulary

- [x] 3.1 Create `src/server/domain/repositories/IEmailSender.ts`: an `EmailMessage` (to, subject, text, html) and `send(): Promise<{ outcome: 'sent' | 'rejected' | 'throttled' | 'retry' }>`.
- [x] 3.2 Document in the contract itself that the port **never throws**, with the reason from design D3: a throw on the notification path reaches the route's `catch`, becomes a `503`, and asks Mercado Pago to redeliver a confirmation that already succeeded — a retry that finds the booking `CONFIRMED` and by design sends nothing, so the failure erases its own evidence.
- [x] 3.3 Document why `throttled` is split from `rejected`: they lead to different operator action, and quota exhaustion is the most likely production failure of this story.

## 4. The message builder (TDD, pure domain)

- [x] 4.1 Write failing tests for `bookingConfirmationEmail`: the appointment renders in the **business** timezone through the shared business-time module, not UTC; the deposit and the balance render from canonical decimal strings through the shared formatter, including the `2000.50` → `2000.5` case that has bitten this codebase before.
- [x] 4.2 Write failing tests for the link: composed as `{origin}/b/{slug}/reserva/{token}`; present as readable text in **both** the text and html parts; and, when no origin resolves, absent entirely with no relative URL and no loopback address anywhere in either part.
- [x] 4.3 Write failing tests for escaping: a client name containing markup appears escaped in the html part and executes nothing; a name containing CR/LF reaches no header and produces no second recipient; the subject is composed from the shop name and the appointment instant, never from guest text.
- [x] 4.4 Write a failing test asserting the message references no remote host (no `<img>`, no external stylesheet, no tracking pixel).
- [x] 4.5 Implement `src/server/domain/models/bookingConfirmationEmail.ts` — projection plus resolved origin in, `{ subject, text, html }` out. No clock, no network, no environment read.
- [x] 4.6 Add the `email` namespace to `src/lib/copy.ts` (es-AR), including the three confirmed-state page variants from design D10 and the rewritten `paymentConfirmingHelp`.

## 5. The Resend adapter (TDD)

- [x] 5.1 Write failing tests for `ResendEmailSender` against an injected transport: `200` → `sent`; `422` → `rejected`; `429` → `throttled`; `5xx` → `retry`; a transport rejection → `retry`; an abort → `retry`.
- [x] 5.2 Write a failing test asserting **no response body reaches the logger and no body is attached to a returned value** — with a fixture body that echoes `to`, `subject` and the composed link, since a `422` echoing the request is a leaked recipient and a leaked token.
- [x] 5.3 Write failing tests for the transport contract: the key travels in a header and never in the URL or query string; the call is bounded by an abort signal; no request reaches the network in unit tests.
- [x] 5.4 Implement `src/server/infrastructure/email/ResendEmailSender.ts` over the platform `fetch`, 5 s timeout (matching `PAYMENT_TIMEOUT_MS`, and for the same stated reason — nobody is watching), modelled line for line on `MercadoPagoGateway`.
- [x] 5.5 Confirm `package.json` is byte-identical: **no `resend` dependency added.** This is the step of this change most likely to go wrong by reflex.

## 6. The repository (TDD)

- [x] 6.1 Write failing tests for `findForConfirmationEmail`: the query names its columns explicitly, carries no phone, includes no wholesale client relation, and carries no payment-configuration column; money crosses as canonical decimal strings.
- [x] 6.2 Write failing tests for `markConfirmationEmailSent`: one column on one row, keyed by booking id, touching neither `status`, `holdExpiresAt`, `cancelledAt`, `cancelledBy` nor any snapshot.
- [x] 6.3 Implement both on `PrismaBookingRepository`, and document **in `IBookingRepository`** that this projection is a deliberate, named exception to the public-flow projection rule: a page can be opened on a shared device so it must not be able to render an address, while a message is *addressed to* that address. A later reader must find a decision, not an inconsistency.

## 7. The application service (TDD)

- [x] 7.1 Write failing tests for `BookingConfirmationNotificationService`: a successful send records the instant; `rejected`, `throttled` and `retry` each leave it null, log, and return normally; a failure of the recording write itself logs and returns normally.
- [x] 7.2 Write failing tests for the observability contract: every outcome is distinguishable in the log, and **no log line carries the recipient address, the client name or phone, the cancellation token, the composed link, the message body or the key.** Assert over the emitted context object, not by inspection.
- [x] 7.3 Write a failing test for the missing-origin branch: the message is still sent, the link is absent, and an error with `reason: 'originMissing'` is logged.
- [x] 7.4 Implement `src/server/application/services/BookingConfirmationNotificationService.ts` — one method, returns `void`, throws nothing, reads the origin through the existing `publicOrigin` module.

## 8. Wiring both triggers (TDD)

- [x] 8.1 Write failing tests over `PaymentConfirmationService`: **only** the `confirmed` outcome requests an email — `alreadyProcessed`, `slotLost`, `bookingUnavailable`, `mismatch`, `notApproved`, `notAtGateway`, `unresolved`, `reversedAfterConfirmation` and `retry` each request nothing. This is design D1 and it is the security property of the change; test every branch, not a representative one.
- [x] 8.2 Write a failing test replaying a notification for a booking already `CONFIRMED`: the outcome is `alreadyProcessed` and no send is requested.
- [x] 8.3 Write failing route tests: a provider failure still answers `200` with the **same** acknowledged body as every other handled outcome, so an email outcome is not observable from outside and the endpoint does not become an oracle.
- [x] 8.4 Write failing tests over `ReceiptReviewService.approve`: an applied approval requests one email; a `notFound`/`notPending` result requests none; a provider failure leaves receipt, payment and booking approved and confirmed and the owner's action successful.
- [x] 8.5 Implement the calls in both services, after commit and outside every transaction. Verify by review that no send is initiated from inside a `$transaction` callback.
- [x] 8.6 Re-wire `app/api/webhooks/mercadopago/webhookService.ts` and `app/(dashboard)/comprobantes/receiptReviewService.ts`, validating `RESEND_API_KEY` at each root and **never** in a global startup check. No optional constructor arguments (T57).
- [x] 8.7 **Rewrite** the guarantee comment in `webhookService.ts`. It currently asserts that no booking repository is wired because the notification "never reads a booking … which carries no client contact detail and no cancellation token". That is now false. Replace it with the narrowed guarantee — one named projection, built for the message, used for nothing else, unable to hold a credential — the way B6 rewrote `bookingConfirmationService.ts`'s. Extend the composer test to cover both roots.

## 9. T62 and the page (TDD)

- [x] 9.1 Write failing tests for `confirmationRefresh`: a case table over an absent, `2`, `3`, `999`, `-1`, `abc` and empty attempt counter. Absent → refresh to attempt 2; `2` → refresh to 3; `3` and everything malformed or out of bounds → terminal form, no meta, no spinner.
- [x] 9.2 Implement `src/server/application/booking/confirmationRefresh.ts` as a pure clamp, documented like `resolvePaymentPageState`: the bound is the part that is easy to get wrong, and an unclamped counter is a refresh loop on a public page.
- [x] 9.3 Write failing page tests: the `awaitingConfirmation` state emits a server-rendered `<meta http-equiv="refresh">` on attempts 1–2 and none on 3; a spinner accompanies the refreshing form and never the terminal one; **no client-side script is required for any of it**.
- [x] 9.4 Write failing page tests for the three confirmed-state variants driven by `confirmationEmailSentAt`, including that the could-not-send variant never claims a message was sent and keeps the instruction to save the link.
- [x] 9.5 Implement both in `app/b/[slug]/reserva/[token]/page.tsx`, adding `confirmationEmailSentAt` to the page's projection. Confirm the page still renders no client email or phone.
- [x] 9.6 Add the pending state to the `/comprobantes` submit control, and assert by test that the approval success message does **not** claim the client was notified (design D12).

## 10. Configuration and verification Franco runs

- [x] 10.1 Add `EMAIL_FROM` to `wrangler.jsonc` `vars` beside `APP_ORIGIN`, with a comment giving the same reason that file already gives: a value kept only in the Cloudflare dashboard is a value the next deploy from a fresh clone silently lacks.
- [x] 10.2 **Deliberately NOT set in production, and that is the correct state.** With no verified domain the only sender is the provider's shared one, which reaches the account owner and silently drops every real client — the exact partial success `wrangler.jsonc` records as worse than an absent value. Production keeps confirmations disabled and the booking page says so truthfully. The key lives in git-ignored `.dev.vars` for verification only. Original task: Set `RESEND_API_KEY` on the **application Worker only** — not the cron Worker, which sends nothing. Upload as exact bytes via `wrangler secret bulk` from a UTF-8 file **without a BOM**, never the interactive prompt; PowerShell 5.1's `Set-Content -Encoding utf8` adds one, and B7 lost two production runs to exactly this. Add the same value to `.dev.vars`.
- [x] 10.3 Measure `wrangler deploy --dry-run` and record the figure against B6's 2924.08 KiB and the 3072 KiB ceiling. Report **remaining headroom**, never "this will fit" — B2 proved the printed figure is a lower bound.
- [x] 10.4 **Not verifiable and will not become so.** Both Mercado Pago sandbox payments B5 left behind are gone from the gateway (`notAtGateway`, measured twice), so no notification replay can reach the confirming branch. The MP trigger calls the **same** `notifyConfirmed` the transfer path exercised below, and which of the eleven notification outcomes reaches it is covered branch by branch in tests. What is unverified is delivery *through that trigger specifically*, which shares every line after the call. Original task: `npm run preview` with a tunnel: complete a Mercado Pago sandbox payment end to end and confirm the confirmation arrives **in a real inbox**, and that its link opens that booking's page.
- [x] 10.5 Same run: watch the awaiting state actually refresh into the confirmed state without touching the browser, then confirm the terminal form appears on the third attempt and stops.
- [x] 10.6 **Done — a real message arrived in a real inbox, and its link opened the booking (2026-08-26).** Driven through the real approval path (`ReceiptReviewService.approve` → `notifyConfirmed`) with the real repository, builder and Resend adapter. Not through the dashboard UI: that is a Server Action needing the owner's password in a browser, and everything below the session is the path the action composes. Original task: upload a receipt, approve it from `/comprobantes`, and confirm the confirmation arrives in a real inbox — the path where the client is not watching and the email is the only channel.
- [x] 10.7 Negative check: unset `RESEND_API_KEY` locally and confirm a booking still confirms, the missing variable is named in the log, and no page, endpoint or action fails.
- [x] 10.8 Negative check: unset `APP_ORIGIN` locally and confirm the message is sent without a link, with `reason: 'originMissing'` logged and no loopback URL anywhere in it.
- [x] 10.10 **Added during verification, not planned.** Write `scripts/n1-gate.ts` — every story since B3 has a gate and this plan had none, which was a gap given the story had already shipped a projection defect every mock certified. 28 probes: the four-hop join, the null-profile branch, money off the real driver, `Intl` on this runtime, the non-fatal send, the origin degradation, and a whole-row before/after comparison of the bookkeeping write.
- [x] 10.9 **Deployed; the repeat is not possible yet.** N1 shipped as version `a5a8df49`. Re-running the send against the deployed Worker needs the key set in production, which is refused above until a domain exists — so **the one gap this leaves is that the Resend call has never been made from `workerd`**, only from Node. B5's lesson says runtimes differ; tracked in T76. Original task: Deploy and repeat 10.4 and 10.6 against production. **Expected to be refused for size** — see T51: 3068.26 KiB against a 3072 KiB ceiling, and B2's rejected build reported 3064.88. Take Workers Paid first.

## 10b. Adversarial review fixes (found after implementation, before archive)

- [x] 10b.1 Move the missing-configuration report out of the sender constructor and into . Composition roots are per-request functions, so constructing logged one  line per notification POST — on a **public unauthenticated endpoint**, including the cheap-rejection path where nothing was ever going to be sent — plus one per render of the review queue. Bound it to one line per confirmed booking, and correct the comment that claimed the opposite.
- [x] 10b.2 Remove the  placeholder from . A shared onboarding sender delivers only to the provider account owner, so it passes a verification done from that inbox and silently drops every real client. Document the intended value in the file instead.
- [x] 10b.3 Report the projection's two null causes honestly (, naming both) rather than asserting , which the code cannot distinguish.
- [x] 10b.4 Pin the log cardinality with tests —  plus gate probes 9.1–9.3 — since nothing covered it before.
- [x] 10b.5 Update the two specs the  decision changed, per the spec-first policy.

## 10b. Adversarial review fixes (found after implementation, before archive)

- [x] 10b.1 Move the missing-configuration report out of the sender's constructor and into `send()`. Composition roots are per-request functions, so constructing it logged one `error` line per notification POST — on a **public unauthenticated endpoint**, including the cheap-rejection path where nothing was ever going to be sent — plus one per render of the review queue. Bound it to one line per confirmed booking, and correct the comment that claimed the opposite.
- [x] 10b.2 Remove the `EMAIL_FROM` placeholder from `wrangler.jsonc`. A shared onboarding sender delivers only to the provider account owner, so it passes a verification done from that inbox and silently drops every real client. Document the intended value in the file instead.
- [x] 10b.3 Report the projection's two null causes honestly — `projectionEmpty`, naming both — rather than asserting `bookingNotFound`, which the code cannot distinguish.
- [x] 10b.4 Pin the log cardinality with tests (`emailSenderFactory.test.ts` plus gate probes 9.1–9.3); nothing covered it before, which is why it broke silently.
- [x] 10b.5 Update the two specs the `EMAIL_FROM` decision changed, per the spec-first policy.
- [x] 10b.6 Re-verify at runtime: five forged notification POSTs now produce zero configuration entries, against five before.

## 11. Debt and closeout

- [x] 11.1 `docs/tech-debt.md` **T62 — close it**, recording what shipped: the bounded refresh, the counter and its clamp, the spinner that became honest, and the email that is the other half of the same problem.
- [x] 11.2 `docs/tech-debt.md` T51: record the measured before/after and the remaining headroom, and state whether the paid plan was taken.
- [x] 11.3 `docs/tech-debt.md` T56: note that guest personal data now lives in a third place — the client's mailbox and the provider's outbound record — and still has no deletion path.
- [x] 11.4 Open a debt entry for the **unverified recipient address**: B4 never confirms the email belongs to the person typing it, and this story makes that address the destination for a live cancellation credential. Name the mitigation it forces on the next story — **C1's cancel must be a POST behind an explicit confirmation, never a GET** — so that a mail scanner, a link-preview bot or a mistaken recipient cannot cancel by fetching a URL. Trigger: C1.
- [x] 11.5 Open a debt entry for **no resend path**: after approval the receipt leaves the queue, nothing surfaces a failed send to the owner, and `confirmationEmailSentAt IS NULL` has no reader. Name D1 (dashboard) or B7's sweeper as the natural home.
- [x] 11.6 Open a debt entry for **quota exhaustion being shaped like success**: `throttled` is distinguishable in the log and nothing alerts on it.
- [x] 11.7 Record in the debt entry for `slotLost` / `bookingUnavailable` that a client who paid and lost their slot still receives nothing, and that this story deliberately did not change it.
- [x] 11.8 Tick N1 in `docs/roadmap.md` with the notes this change earned, and note that C1 is unblocked.
- [x] 11.9 Full check before archive: `npm run typecheck`, `npm run lint`, `npm test`, coverage ≥ 90% on domain and application layers, `openspec validate n1-booking-confirmation-email`.
