# N1 — Booking confirmation email, and the confirmation moment it completes

## Why

**This story does not add a promise. It keeps one.** `src/lib/copy.ts` has told every client since B4 that *"Te mandamos la confirmación acá."* — printed under the email field, at the moment they hand over their contact details. That sentence has been false for four stories. Nothing in this product has ever sent an email.

What sits behind it is the same gap seen from the other side. A booking can now reach `CONFIRMED` by two paths, and **neither of them tells the person whose appointment it is.** A Mercado Pago client is redirected back to a page that says *"actualizá esta página en unos segundos"* and, if they close it, keeps no record that anything happened. A transfer client uploaded a receipt, was told a human would look at it, and then — whenever the owner gets to it, minutes or hours later, with the tab long since closed — is told nothing at all. **The transfer path is the worse of the two and it is invisible**: the confirmation happens while the client is not looking, so the page that would have told them is a page nobody is on.

Three things make now the moment rather than later:

- **C1 is blocked on this and only this.** The cancellation link travels in the confirmation email; the cancel endpoint itself needs nothing but the token B4 already generates. Client cancellation cannot ship until email sending works.
- **T62 was deferred here by decision, not by drift.** B5 closed with the awaiting-confirmation state ending in "please refresh", having measured that this is the *normal* path and not the fallback: the browser redirect beats Mercado Pago's server-to-server notification essentially every time. Franco deferred it to N1 on 2026-08-22 so that **how this product announces a confirmed booking gets decided once rather than twice**, in two stories with two different answers. This is that decision.
- **`cancellationToken`'s own doc comment has named this story since B4** — "the URL segment authorizing the hold-confirmation page, and later the cancellation link N1 emails". The credential was designed for an email that did not exist yet.

## What Changes

- **A confirmation email is sent on the transition into `CONFIRMED`, from both paths** — the Mercado Pago notification and the owner's approval of a transfer receipt. It carries the appointment, the branch, the barber, the service, the deposit paid, the balance due at the shop, and the link to the client's own booking page.
- **The send hangs off the winning transition, never off the status.** Both paths are already status-guarded conditional updates, so exactly one caller per booking ever sees `confirmed` / `applied`. Keying the send on "the booking is `CONFIRMED`" instead would turn a **public, replayable endpoint into a mail cannon aimed at a real person**, since every duplicate Mercado Pago delivery reaches that state. The distinction is the whole security story of this change.
- **A failed send never changes an outcome.** The webhook still answers `200`; the owner's approval still succeeds; the booking stays `CONFIRMED`. A mail provider must not be able to fail a payment confirmation, and a `503` asking Mercado Pago to retry would be worse than useless — the retry finds the booking already confirmed, returns `alreadyProcessed`, and by design never resends the email that failed. **The failure would conceal itself.**
- **`Booking` gains `confirmationEmailSentAt`.** Idempotency does not need it — the guarded update already provides at-most-once. It exists so that *"the booking is confirmed and the client was never told"* is a `WHERE` clause rather than a log line nobody reads. That is this codebase's own standard for this failure shape, stated in `publicOrigin.ts`: the money moved and nothing in the product knew.
- **Resend is called over the platform `fetch`, with no SDK.** `MercadoPagoGateway` established the pattern and the reason (design D6): T51. One endpoint does not justify spending the bundle's remaining headroom on a vendor package, and every property that adapter has is inherited — injected transport, bounded timeout, key in a header and never a URL, and **no response body ever reaching a log**.
- **T62 closes: the awaiting state stops asking for a manual refresh.** A bounded server-side `<meta http-equiv="refresh">` carries an attempt counter in the URL, refreshes at most twice, then renders the existing manual sentence as the terminal state. No JavaScript, because the public flow does not assume any. The counter is parsed and **clamped** server-side — an unclamped one is a self-inflicted refresh loop on a public page. Once the refresh is real, the progress indicator the current rule forbids becomes honest and ships with it.
- **The confirmation page tells the truth about the email.** The `confirmed` state renders one of three variants driven by `confirmationEmailSentAt`: sent, not yet, or could-not-send. **It must never claim an email that failed** — and in the could-not-send case the on-screen link stops being a convenience and becomes the client's only copy.
- **`APP_ORIGIN` becomes load-bearing.** Its absence degrades OpenGraph tags silently today. Here it removes the point of the email. When no usable origin resolves, the email is still sent — a client who paid deserves to know — **without the link block**, and the service logs an error. It never emits a relative URL or a loopback address into somebody's inbox, where a mistake cannot be redeployed away.
- **The email links to the page that already exists**, `/b/{slug}/reserva/{token}`, which already renders the confirmed state. **N1 does not email a `/cancelar` URL that C1 has not built yet.** An email is permanent; a 404 in an inbox is forever.
- **The webhook's composition root loses a property it currently asserts in writing.** `webhookService.ts` states that no booking repository is wired because "the notification never reads a booking except through the payment's own projection, which carries no client contact detail and no cancellation token". N1 makes that false. The comment is **rewritten to state the new shape and why**, the way B6 rewrote `bookingConfirmationService.ts`'s — never quietly left standing.
- **Nothing is sent for `slotLost` or `bookingUnavailable`.** A client who paid and lost the slot receives total silence while an error goes to a log only the owner might read. This change does not fix that, and says so rather than letting it be discovered.

## Capabilities

### New Capabilities

- `booking-confirmation-email`: when the email is sent and what triggers it, what it carries, the failure semantics that keep it non-fatal, the origin dependency and its degraded form, the record of having sent it, the adapter's bounded contract, the escaping and header rules for guest-supplied strings, the observability contract, and the deliverability prerequisite that no code can satisfy.

### Modified Capabilities

- `payment-mercado-pago`: the confirmation path gains a downstream notification whose failure changes nothing; the composition root specified as the only one in the public flow that may decrypt the access token now also reads a booking projection carrying contact detail and the token, which is a stated property being deliberately revised; and **the awaiting-confirmation state's prohibition on a progress indicator is replaced** — it was conditional on the page not refreshing, and the page now refreshes.
- `transfer-receipt-review`: the owner's approval gains the same notification, on the path where it matters most because the client is not watching; the action's success message SHALL NOT claim the client was notified unless they were.
- `data-persistence`: `Booking` gains `confirmationEmailSentAt`, and a new explicit projection for composing the email — the first booking read in this product that deliberately selects the client's email address.
- `cloudflare-deployment`: one new secret (`RESEND_API_KEY`, validated at this feature's composition root and never in a global startup check) and one new non-secret var (`EMAIL_FROM`, in `wrangler.jsonc` for the same reason `APP_ORIGIN` is); plus the statement that `APP_ORIGIN`'s absence is no longer only cosmetic.

## Impact

**Schema** — one nullable column, one migration. `Booking.confirmationEmailSentAt DateTime? @db.Timestamptz(3)`, declared zone-aware at creation per the convention the model already states at `startTime`. No enum members, no tables, no indexes (nothing queries it yet; the story that surfaces "confirmed but never told" is the one that should index it).

**Code** — a new domain port (`IEmailSender`), a pure email builder in the domain, one infrastructure adapter, one application service used by both callers, one repository projection plus one write, two composition roots re-wired, one pure clamp module for T62, and one copy namespace. Nothing existing is rewritten.

**Dependencies** — **none added to `package.json`.** That is a deliberate consequence of T51 and the point at which this change is most likely to go wrong: `npm i resend` is the obvious first move and it is the wrong one.

**Configuration** — `RESEND_API_KEY` as a Wrangler secret on the application Worker (not the cron Worker; the sweep sends nothing) and in `.dev.vars`. `EMAIL_FROM` in `wrangler.jsonc`. Uploaded as **exact bytes**, per the byte-hygiene rule `wrangler.jsonc` already carries and B7 re-learned the hard way twice.

**Verification** — this story cannot be verified by a green test suite. `wrangler dev` sends real mail or no mail. Verification means **a message that arrived in a real inbox**, from both paths, never "the provider returned 200" — a `200` means accepted for delivery, and SPF/DKIM/DMARC misconfiguration is indistinguishable from not sending at all.

**Prerequisite Franco owns, and it is DNS rather than code** — a verified sending domain in Resend. Until one exists, `onboarding@resend.dev` delivers only to the account owner's own address, which makes end-to-end verification against a test client address impossible. This blocks the runtime step, not the implementation.

**Constraints to respect** — **T51** above all: the Worker measured 2924.08 KiB gzip after B6 against a 3072 KiB ceiling, ~148 KiB of headroom, and B2 proved Cloudflare's own measurement is stricter than the figure wrangler prints. T51's standing recommendation is to **take Workers Paid before starting this story** rather than discover the ceiling as a failed deploy for a second time. Also **T62** (closes here), **T56** (this change puts guest personal data in a third place and still offers no deletion path), and **T55/T47** (the notification endpoint stays unmetered).

**Deliberately unresolved** — nothing lets an owner resend a confirmation, and after approval the receipt leaves the queue, so a failed send has no recovery path inside the product. Nothing notifies a client whose payment was approved after their slot was lost. Neither is in scope, and both are recorded rather than discovered.
