# N1 — Design

## Context

A booking reaches `CONFIRMED` by exactly two writes today, and both are already the right shape for this story. `PrismaPaymentRepository.confirmIfSlotFree` and `PrismaTransferReceiptRepository.approve` each run one transaction under the per-barber advisory lock and each update the booking **conditionally on the status it expects**, so a concurrent transition matches zero rows rather than being reasserted. That property, built for double-booking safety, is what gives this story at-most-once email delivery for free: exactly one caller per booking ever observes the confirming outcome.

What is missing is everything downstream of it. No email has ever been sent from this product. There is no port, no adapter, no provider account wired, and no column recording that a client was told. `src/lib/copy.ts:430` has nonetheless promised one since B4 — *"Te mandamos la confirmación acá."* — printed under the email field at the moment the client hands over their address.

Three existing decisions shape this change more than the notification domain does:

- **`MercadoPagoGateway` already solved "call a third party from this Worker".** Injected transport, bounded abort, credential in a header, no response body ever logged, and **no vendor SDK** — that last one for T51. The email adapter is the same adapter with a different URL, and inventing a second style here would be the mistake.
- **T51 is the binding constraint, not a footnote.** The Worker measured 2924.08 KiB gzip after B6 against a 3072 KiB ceiling, and B2 proved Cloudflare's server-side measurement is stricter than the figure wrangler prints. T51's standing recommendation is to take Workers Paid *before* this story.
- **T62 was deferred here by decision.** B5 measured that the awaiting-confirmation state is the normal path, not the fallback: the browser redirect beats the server-to-server notification essentially every time. The two halves of "how does this product tell somebody their turn is real" get decided together or they get decided twice.

## Goals / Non-Goals

**Goals:**

- A client learns their appointment is real, by a channel that survives closing the tab — which is the only channel the transfer path has ever had.
- A mail provider cannot fail a payment confirmation, cannot alter an HTTP response, and cannot roll back a row.
- "Confirmed but never told" becomes a queryable set rather than a log line.
- The confirmation moment stops ending in "please refresh", with no JavaScript added to the public flow.
- C1 is unblocked, and the URL it will need is the one this story emails.

**Non-Goals:**

- The cancellation action itself. C1 owns it, and this story deliberately emails a link to a page that already exists rather than one C1 has not built.
- Reminder emails (N2), owner-facing notifications, a retry queue, or a resend control.
- Notifying a client whose payment was approved after the slot was lost. Named in the proposal, not built.
- Verifying the client's email address at booking time. B4 takes it unverified and this story does not change that; the consequence is stated under Risks.
- Guest-data deletion (T56), which this change makes slightly worse and does not address.

## Decisions

### D1 — The trigger is the outcome of the guarded write, never the observed status

`PaymentConfirmationService.confirm` returns `'confirmed'` from exactly one branch — the one where `confirmIfSlotFree` reported `confirmed` — and `ReceiptReviewService.approve` returns `'applied'` from exactly one. The send hangs off those two values.

**The alternative is the security defect of this story.** `POST /api/webhooks/mercadopago` is public, unauthenticated by nature, and replayable by design: Mercado Pago redelivers, and the endpoint answers `200` to every handled outcome precisely so that redelivery is cheap. A send keyed on "the booking is `CONFIRMED`" would let anyone who has ever seen a `ref` send unlimited mail to one real person, and burn the provider quota doing it. The status is a state anyone can re-reach; the outcome is an event exactly one caller can observe.

This also removes the need for a `sentAt` check before sending, which matters — see D4.

### D2 — One application service, injected into both composition roots

`BookingConfirmationNotificationService` takes `IBookingRepository`, `IEmailSender`, `IClock` and `ILogger`, and exposes one method: `notifyConfirmed(bookingId)`. It reads the projection, builds the message, sends it, records the instant, and logs. It returns `void` and throws nothing.

Both callers invoke it after their transaction has committed and ignore the result. The webhook's `confirm()` returns `{ outcome: 'confirmed' }` exactly as it does today; the receipt action's `ReviewResult` is unchanged.

**Rejected: putting the send inside `PaymentConfirmationService` and `ReceiptReviewService` directly.** Two copies of "read, build, send, record, log" is two chances for one of them to log an address or forget the `try`.

### D3 — `IEmailSender` reports failure as a value and never throws

```ts
type EmailSendOutcome = 'sent' | 'rejected' | 'throttled' | 'retry';
```

The port returns `Promise<{ outcome: EmailSendOutcome }>`. The adapter catches its own transport errors and its own abort, and maps them.

This is not a style preference. A `throw` from a mail provider on the notification path would propagate into the route's `catch`, which answers **`503`** — asking Mercado Pago to retry a confirmation that already succeeded. That retry finds the booking `CONFIRMED`, returns `alreadyProcessed`, and by D1 sends nothing. **The failure would erase its own evidence and cost an outbound call per delivery attempt.** Making the failure a value makes that shape unreachable rather than merely avoided by a `try` somebody could remove.

`throttled` is split from `rejected` because they lead to different operator action: one is a wrong request, the other is a shop that has stopped notifying its clients on its busiest day.

### D4 — `confirmationEmailSentAt` exists for the question, not for the guarantee

One nullable `Timestamptz(3)` column on `Booking`, written after the provider accepts.

**It is not an idempotency key and nothing reads it before sending.** D1 already gives at-most-once. A second mechanism claiming the same guarantee would be a second thing to get wrong — and worse, a read-then-send would introduce the race that the guarded update was written to avoid.

What it buys is the answer to a question the product cannot currently ask: *which confirmed bookings have a client who does not know?* `WHERE status = 'CONFIRMED' AND "confirmationEmailSentAt" IS NULL`. That is this codebase's own standard for this failure class, stated in `publicOrigin.ts` about a payment that moved with nothing knowing.

**No index.** Nothing queries it yet. The story that gives that set a surface is the story that should measure the predicate, the way D1's dashboard aggregates were indexed by measurement rather than assumption.

Written outside the transaction, guarded to one column, and its own failure logged and swallowed: a booking must not become unconfirmed because a bookkeeping write failed.

### D5 — Resend over `fetch`, no SDK, inheriting `MercadoPagoGateway` line for line

`POST https://api.resend.com/emails`, `Authorization: Bearer`, injected `transport: typeof fetch = fetch`, `AbortSignal.timeout`, and **nothing from the response body escaping the module**.

The last property is inherited for a reason that transfers exactly: Mercado Pago's rejection payloads echo the credential they rejected, and a provider's `422` echoes the submitted `to`, `subject` and `html` — which is the recipient address and the cancellation token. A body that reaches a log is a leaked credential either way.

`npm i resend` is the obvious first move and it is the wrong one. T51 measured that B6 left ~148 KiB of headroom against a stricter-than-reported ceiling; one endpoint does not justify spending it, and `MercadoPagoGateway`'s own comment already records this decision for two endpoints.

**Timeout: 5 s**, matching `PAYMENT_TIMEOUT_MS` rather than the 8 s preference bound. The reasoning is the same one that file gives: nobody is watching. The webhook's caller is Mercado Pago and the approval's caller is an owner who wants their queue back.

### D6 — The message is built by a pure domain function, and the copy lives with the flow's copy

`src/server/domain/models/bookingConfirmationEmail.ts` takes the projection plus a resolved origin and returns `{ subject, text, html }`. No clock, no network, no environment. Every rule worth testing — the timezone, the money, the escaping, the missing-origin branch — is testable without a transport double.

Escaping lives here rather than in the adapter, because the adapter is where somebody later adds a second message type and forgets.

Spanish strings go in `copy.ts` under a new `email` namespace, per the frontend copy convention every other user-facing string follows. The email is user-facing copy that happens not to be rendered by React.

**Both a `text` and an `html` part.** The plain-text part is not a courtesy: it is where a button-only link disappears, and a forwarded or degraded rendering is exactly the case where the client needs the URL most. The full URL therefore appears as readable text in both parts.

### D7 — The link is `/b/{slug}/reserva/{token}`, the page that already exists

C1 will add the cancel control to that same page. N1 emails no `/cancelar` route.

**An email cannot be redeployed.** A URL that 404s today because C1 ships next week is a 404 in somebody's inbox forever, and the client whose booking it is has no other way to reach it. The page already renders the confirmed state, already carries `Referrer-Policy: no-referrer`, is already `noindex` and `force-dynamic`, and is already addressed by this exact token — B4's own requirement text calls the token "the same credential the confirmation email will carry".

### D8 — A missing origin degrades the message; it does not cancel it

`resolveOrigin({ configured: process.env.APP_ORIGIN })` through the existing `publicOrigin` module, which already refuses loopback and private hosts for a reason measured in B5.

When it yields nothing: **send anyway, without the link, and log `error` with `reason: 'originMissing'`.**

Rejected: refusing to send. The confirmation is the primary value and the link is the secondary one; a client who paid and hears nothing is worse off than a client who is told their turn is confirmed and has to find the shop another way.

Rejected: falling back to a request header. `publicProfilePage` already refuses that for the OpenGraph case (design D3 — a forged `Host` rewrites a shop's tags to point elsewhere). Here a forged `Host` would put an attacker's domain in front of a real client with a real token in the path, which is materially worse than a bad preview.

### D9 — T62: a bounded `<meta http-equiv="refresh">` with the counter in the URL

Three attempts, ~5 s apart, on the `awaitingConfirmation` state only:

| URL | rendered |
| --- | --- |
| `?estado=pago-pendiente` | spinner + `<meta … url=…&intento=2>` |
| `…&intento=2` | spinner + `<meta … url=…&intento=3>` |
| `…&intento=3` | no meta, no spinner, the existing manual sentence |

The parse and clamp live in their own pure module (`confirmationRefresh.ts`) with a case table, for the same reason `resolvePaymentPageState` exists as a table: **the bound is the part that is easy to get wrong**, and an unclamped counter is a refresh loop on a public page. Absent, malformed, negative, or beyond the bound all render the terminal form.

Roughly ten seconds covers the ordinary notification delay without hammering a page when a notification is never coming — and when one is never coming, the terminal form is exactly today's behaviour, unchanged.

**The spinner is added here and only here.** The current spec forbids it, and that prohibition was explicitly conditional: *"SHALL NOT display a progress indicator that implies polling the page does not perform."* The page now performs it. The prohibition survives in its true form on the terminal state, where nothing further will happen.

Rejected, as T62 recorded: client-side polling (needs JavaScript this flow does not assume) and holding the response until the notification lands (Mercado Pago's timing is not ours to wait on, and it pins a Worker request on a third party).

### D10 — The page reports the email honestly, in three variants

Driven by `confirmationEmailSentAt` on the projection the page already reads:

- **recorded** → *"Te mandamos la confirmación a tu email."*
- **null, confirmed less than a minute ago** → the send is likely still in flight; say nothing about the email.
- **null, older** → *"No pudimos mandarte el mail. Guardá este link — es tu única copia."*

The third variant is why the column is on the projection at all. Claiming an email that failed would remove the client's reason to save the link, at exactly the moment the link became their only record.

### D11 — Awaiting the send inline, not `waitUntil`

The send is awaited in the request, after the transaction, bounded at 5 s.

`waitUntil` is the textbook answer and is rejected on evidence. This codebase uses it nowhere; `worker/sweep.ts` explicitly chose to await instead. OpenNext's generated worker is regenerated on every build and its request-context surface is not something this story should be the first to depend on — B7 already discovered, expensively, that assumptions about that generated entrypoint do not hold.

The budget is acceptable: MP re-fetch (≤5 s) + transaction + email (≤5 s), against Mercado Pago's own delivery timeout of ~22 s. For the owner's approval the cost is up to 5 s of a form submission, which is why the submit control needs its pending state (D12).

**If measurement later shows this hurting, `waitUntil` is the fix and this decision is where to start.** Recording it as a considered trade-off rather than an oversight.

### D12 — The owner's success message never claims the client was notified

`/comprobantes` approval already returns a form state. It gains no field: the message stays "Comprobante aprobado" and never becomes "le avisamos al cliente".

Telling an owner a client has been informed when they have not is worse than silence — it removes the owner's reason to phone them, which is the only recovery this product offers for a failed send. The submit control gains a pending state, because the action now carries up to 5 s of third-party latency and a queue that appears frozen invites a second click.

### D13 — Logs carry the booking id and the outcome, and nothing else

`operation: 'email.bookingConfirmation'`, plus `bookingId` and `outcome`. **Never** the recipient address, the client's name, the token, the composed link, the message body, or the key.

The precedent is `ReceiptReviewService.logDecision`, which logs a receipt id and a decision and explicitly not the person. The addition here is that the *link itself* is now a credential in string form, so the usual instinct to log "what we sent" is precisely the thing to refuse.

## Risks / Trade-offs

- **The recipient address is guest-supplied and has never been verified.** B4 takes an email in a form; nothing confirms it belongs to the person typing. This story turns that unverified string into the destination for a live cancellation credential — a typo sends a stranger a working link to someone else's appointment. There is no clean fix inside N1 (verification-before-payment would gate the deposit on a round trip through a mailbox). **What it does mandate is a constraint on C1: cancel must be a POST behind an explicit confirmation, never a GET**, so that a mail scanner, a link-preview bot, or a mistaken recipient cannot cancel by fetching a URL. Recorded as debt with that trigger named.
- **The token now lives in a third place.** Database, address bar, and now a mailbox plus the provider's outbound record. Forwarding the email is handing over control of the booking. Mitigated only by D13 and by the page's existing `no-referrer`; not eliminated.
- **A leaked `RESEND_API_KEY` sends DKIM-signed mail from the shop's own domain** — phishing with perfect authentication. The key is scoped to sending, set on the application Worker only, and never logged; the residual risk is real.
- **Quota exhaustion is shaped exactly like success.** Crossing the provider's daily limit means every subsequent client pays and hears nothing, with a `429` in a log nobody watches. `throttled` is a distinct outcome (D3) so the line is findable; nothing alerts on it. This is the most likely production failure of this story.
- **A `200` is not delivery.** Sender-authentication records absent or wrong means spam, which is indistinguishable from not sending. This is why verification is defined as a real inbox and why the DNS prerequisite is stated as a blocker rather than follow-up.
- **A failed send has no recovery path in the product.** After approval the receipt leaves the queue; there is no resend control. The owner's only recovery is a phone call they have no reason to make unless D12 holds.
- **T51 may reject this at deploy time.** The adapter is small and dependency-free, but the surface is not: a port, a builder, a service, a projection, a copy namespace, page changes. B6 was expected to be cheap and cost +177 KiB in surface area alone. Measure before and after; take the paid plan first.
- **This change puts guest personal data in a third place (T56) and still offers no deletion path.** Worse by one location, unaddressed.

## Migration Plan

One additive migration, `n1_booking_confirmation_email_sent_at`: a single nullable `TIMESTAMPTZ(3)` column, no backfill, no altered column, no index. Every pre-existing booking reads as "never told", which is what is true of them.

The shared database means branching from an updated `main` before generating it, or Prisma proposes a reset (recorded in the S0 stack notes and re-learned in B4).

Rollback is dropping the column; nothing reads it except the page's projection, and nothing decides anything from it.

## Open Questions

- **Does the sending domain exist?** Franco owns this and it is DNS, not code. Until a domain is verified in Resend, the shared onboarding sender delivers only to the account owner's own address, and runtime verification against a test client address is impossible. Implementation is not blocked; the story's closing step is.
- **Free tier or paid, on Resend?** The free tier's daily cap is plausibly reachable by one busy shop, and D3's `throttled` outcome exists to make that visible rather than to solve it.
- **Should the `confirmed`-and-recent window in D10 be a constant or a guess?** It is a guess. If it lands, it joins T53's register of guessed constants rather than pretending to be measured.
