## Context

C2 built the cancellation: one guarded transaction, no advisory lock, an approved payment left
untouched, a pending one refused, a receipt left as the honest record of a document nobody reviewed,
and a client-facing state on the confirmation page. It left the second actor unbuilt.

What C1 adds is small in code and awkward in exactly one place: this is the **first write in the
product authorized by a token rather than by a session**, it is destructive, and its credential lives
in a mailbox nobody verified (T69).

Constraints that already exist and are not renegotiated here:

- **Public-flow mutations are Route Handlers, never Server Actions** (`backend-standards.md`).
- **The guard is deny-by-default and matches public API paths by `===`**, so a public endpoint may
  carry no identifier in its path.
- **The public flow assumes no JavaScript.** Every state is server-rendered; every control is a form.
- **A terminal status is written together with the columns that describe it**
  (`backend-standards.md` rule 5, added by C2 after D1's cancellation counter read zero).
- **Exactly two surfaces in the public flow may decrypt the owner's Mercado Pago access token** (B5).
  That count does not change here.

## Goals / Non-Goals

**Goals:**

- A client holding their link can release their slot themselves, in two deliberate steps, with no
  JavaScript.
- The cancellation is attributed to `CLIENT`, so the page stops telling a client who cancelled that
  the appointment was cancelled by nobody in particular.
- The slot returns to the availability read immediately, proven against the live database.
- Money this system cannot return is named **before** the client commits, not after.
- The owner can tell a client's cancellation from their own, on the only surface they have.

**Non-Goals:** no refund and no record of one (T74); no email to owner or client; no minimum-notice
policy; no closing of the Mercado Pago checkout; no address verification; no schema change.

## Decisions

### D1 — A Route Handler at a fixed path, with the token in the body

`POST /api/bookings/cancel`, added to the guard's public set as **one more exact entry**.

The path carries no identifier, for the reason `PUBLIC_PAYMENT_API` and `PUBLIC_TRANSFER_API` each
record: an identifier could only be admitted by teaching a deny-by-default guard to match patterns,
in the one place where a loose match is most expensive. The token travels in the form body, which
also keeps a live credential out of access logs and `Referer` headers.

*Rejected:* a Server Action. Forbidden by the standard, and worse in kind here — an action id is a
build-time key, and this is the one control whose failure means a client cannot give back a slot they
are certain they cannot use.

*Rejected:* hanging a second intent off `PUBLIC_TRANSFER_API`. That endpoint's two intents are two
steps of one payment flow; a destructive non-payment write would inherit the throttle, the body-size
ceiling and the error vocabulary of a file-upload endpoint.

### D2 — Two steps: a safe `GET` that renders a confirmation, and the `POST` that acts

- Step one is a link to `?cancelar=1`. A `GET`. It renders a panel and **writes nothing** — a
  scanner, a preview bot, a security gateway, or Next's own prefetching produces a render and no
  change.
- Step two is a form `POST` from that panel.

The parameter is parsed **strictly**: the single string `'1'`, never an array, never any truthy
value. T62 shipped a defect precisely because a repeated `?intento=2&intento=2` was flattened before
the rule meant to judge it, so the raw value reaches the parser here.

The panel renders **only when `isCancellableByClient` is true**. A confirm button that then refuses
the write is the "control that cannot succeed" B5 and C2 both forbid.

*Rejected:* a one-click `POST`. It satisfies T69's letter and fails its spirit — the client gets no
statement about the deposit before the irreversible step, on the one surface where the decision is
still theirs to reverse.

*Rejected:* a JavaScript confirmation dialog. The public flow has none, and a `confirm()` that never
runs would silently reduce this to one click.

### D3 — Client eligibility is `blocksAvailability` plus two bounds, in one predicate

```
isCancellableByClient(booking, now) =
      booking.status !== 'PENDING_APPROVAL'
   && blocksAvailability(booking, now)
   && booking.startTime > now
```

**Built on `blocksAvailability`** because that predicate already answers this story's question: *is
this booking still holding its time?* A client cancels to give time back, so a booking holding none
has nothing to release. It falls out for free that a `paidSlotLost` booking — `PENDING_PAYMENT`, hold
lapsed, payment `APPROVED` — offers no control: the slot is already gone, and cancelling would
convert bad luck into the client's own recorded decision.

**The `startTime` bound is the deliberate asymmetry with `isCancellableByOwner`**, which takes no
instant on purpose (a no-show is precisely the past appointment an owner wants off the books). A past
slot cannot be released; cancelling one would only record an appointment that happened as cancelled,
which D1 counts and D5 will report as churn.

**One definition, three callers** — the control that renders, the service that attempts, the guard
that writes.

### D4 — A receipt under review is not the client's to cancel

`PENDING_APPROVAL` is excluded, and this is the one rule stricter than C2's.

In that state the client has **already transferred real money** and uploaded proof, and a human owes
them an answer. The owner's review queue filters on the **booking's status**, so a client cancellation
would make that receipt vanish from the only surface anyone would look at it on — leaving money in
the shop's account with no row in this product asserting it arrived. C2 left a pending receipt
`PENDING` precisely because it is the honest record; letting a client hide it undoes that in the one
case where the stakes are cash.

That state instead tells the client to write to the shop, and the owner cancels with the comprobante
in front of them.

- **Lift when T74 is fixed.** A payment marked refund-owed and listed on the dashboard is exactly the
  record whose absence makes this unsafe.

### D5 — No minimum-notice window

Whether a client may cancel ten minutes before their turn is a **shop policy**, and no owner can
express one in this product. Picking a number here turns a guess into a rule every shop inherits.
Cancellation is admitted up to `startTime`; recorded as debt with the first real shop as its trigger.

### D6 — `cancelByToken`, a second repository method, not a widened first one

Same interior as `cancelByOwner`: one transaction, **no advisory lock** (a release cannot
double-book), the booking update **conditional on the status it read**, an `APPROVED` payment
protected by a `where` clause rather than by a branch, a `PENDING` payment set to `REJECTED`, and
**no write to any receipt**.

The two methods are not merged because they **resolve the booking through different credentials** — a
session joined through `barber.location.ownerId`, versus a unique token — and one method taking "one
or the other" is one edit away from accepting neither.

**The eligibility predicate runs in the application; the transaction guards on status alone.**
Re-expressing "the hold is still live" in SQL is the drift `createProvisional` forbids by name. Status
is also the only one of the three inputs that races: the sweeper writes `EXPIRED` and a notification
writes `CONFIRMED`, while `startTime` never moves and `holdExpiresAt` only ever moves *later* — the
transfer commit extends it, which can make a hold more live but never less.

It returns the shop's **slug** on every outcome that has one, so the route redirects using the
projection rather than a slug the form submitted.

### D7 — Nobody is emailed, and each silence has its own reason

- **The client is not emailed.** They pressed the button and are looking at the page that reports the
  result. C2's notice exists because the *shop* decided and the client had no other channel.
- **The owner is not emailed.** D1's counter counts this the moment it is written — C2 made sure of
  it by writing `cancelledAt`, which is what that counter counts by. Introducing the owner as a
  recipient means a projection, a builder, a configuration question and a share of T71's quota, for a
  fact the dashboard already carries.

Because that decision makes the dashboard the **only** channel, D15 is part of this story rather than
a later refinement.

### D8 — Two refusal codes, and success needs none

The success path needs **no code**: the page reads live state and renders the cancelled state on its
own. Inventing one would add a URL parameter that can only agree with the database or be ignored.

Two refusals, because they are two different facts the client acts on differently:

| code | meaning |
|---|---|
| `turno-empezado` | the appointment had already started — nothing to release, contact the shop |
| `cancelacion-no-posible` | the booking moved underneath the attempt — confirmed, expired, or otherwise no longer cancellable |

They join `PAYMENT_OUTCOMES`, whose comment claims it holds "the payment round trip's own outcome
codes". That stopped being true when B6 added the transfer codes; the real invariant — which B6
stated in the same breath — is *these are the codes the confirmation page reads*. **Correct the
comment, keep the name**: renaming touches six files to rename a true thing.

### D9 — A service of its own, wired at the route

`ClientBookingCancellationService`, with its composition root beside the route following
`transferPaymentService.ts`. **No optional constructor arguments** (T57): B4's runtime found a
repository wired into one composer and not another because an argument was optional, and an omitted
optional argument compiles, typechecks and passes every unit test that constructs the service
directly.

Separate from `BookingCancellationService` for the reason N1's two notification services are
separate: they share a port and a rule and nothing else. This one has no owner, a different outcome
vocabulary, and returns a slug.

### D10 — A token matching nothing is answered exactly as one that never existed

`404`, no redirect — there is no slug to redirect to, and inventing one would disclose whether the
token resolved. Logged at information level, never as an error: from outside, a forged token and a
deleted booking are the same fact and neither is a fault.

### D11 — The throttle is the weak bound, and the token is the real one

`BookingThrottle` per-origin, with the honesty its own module insists on: per-isolate, defeats one
script in a loop, not a distributed attempt. **And here there is no second, database-checked bound**
— B4 had `MAX_LIVE_HOLDS_PER_CLIENT`; this endpoint has the credential instead.
`generateCancellationToken` is 256 random bits from `crypto.getRandomValues`, generated and never
derived, so guessing is not the threat model. **The threat model is the mailbox it was delivered
to** — T69, mitigated by D2 and not solved.

### D12 — No CSRF token, deliberately

A cross-site `POST` must carry the cancellation token in its body, and anybody holding that token can
cancel by design — that is what the credential is for. A CSRF token protects a session-derived
authority this endpoint does not have. The actor worth defending against is the *credential-free*
one, and it is defeated by the request being a `POST` at all.

Clickjacking is the same argument: framing the page requires knowing its URL, and knowing its URL is
already sufficient to cancel.

### D13 — `cancelledByClient` sits with the other cancelled states, chosen by the canceller

The state table gains a third cancelled member. **Precedence does not move**: all three sit below the
receipt states and above `paidSlotLost` and `holdLapsed`, exactly where C2 put them. The choice among
them is `cancelledBy`: `OWNER → cancelledByShop`, `CLIENT → cancelledByClient`, `null → cancelled`.

C2 wrote the page's `isCancelled` predicate with a comment predicting this edit ("C1 adds a third
member to this set"). It gains one member and every caller follows.

The deposit note stays guarded on `paymentStatus === 'APPROVED'` rather than on the state, so a
cancellation with nothing charged raises no refund the client never paid.

### D14 — A stale contract is corrected in passing

`cancelByOwner`'s doc comment states that a `PENDING` receipt "becomes `REJECTED` with a
`reviewedAt`". That is the behaviour C2 implemented and then **reversed** when an existing B6 test
went red; the implementation, the spec and C2's design all record the reversal and this comment does
not. C1 touches this port, so it fixes the claim — the same class of false claim N1's and C2's
reviews each caught once.

---

The five decisions below exist because of the edge-case pass. Each is a defect this design would
otherwise have shipped.

### D15 — The dashboard names the canceller, because it is the owner's only channel

`RecentBooking` gains `cancelledBy`, and a cancelled row says whether the client or the shop ended
it. Today the list shows a status and D1's counter sums both kinds together, so an owner reading
"Cancelaciones de hoy: 3" cannot tell how many were theirs.

**This is D7's other half.** Deciding not to email the owner is defensible only if the surface that
replaces the email actually carries the fact. A `null` canceller renders nothing rather than
attributing the decision to anyone — every pre-C2 row is one.

*Rejected:* a separate "client cancellations" counter. The counter answers "how much churn today";
the actor belongs on the row, where the owner is already looking to find out which appointment it
was.

### D16 — The self-refresh carries an allowlist, and never interrupts the panel

Two changes, and both are needed:

1. **`resolveConfirmationRefresh` rebuilds its URL from an allowlist** (`estado`, `intento`) rather
   than from every parameter it was routed with. The current behaviour copies **anything**, so
   `?cancelar=1` rides along and a refresh can re-enter the confirmation panel indefinitely.
2. **No refresh is emitted while the panel renders.** The client is reading an irreversible warning;
   a timed navigation must not move the page underneath them. When they leave the panel by its own
   back link, the refresh resumes.

*Rejected:* dropping `cancelar` from the allowlist alone. The refresh would then navigate away from
the panel after three seconds, which is the same interruption with a tidier URL.

### D17 — A late approval may overwrite the payment this story rejected, and that is intended

`confirmIfSlotFree` guards its approval on `where: { id, mpPaymentId: null }` — **not** on
`status: 'PENDING'`. A payment C1 sets to `REJECTED` still has a null gateway id, so a notification
arriving afterwards moves it to `APPROVED` with an approval instant.

**Kept, and specified rather than left to whichever guard happens to fire first.** The money really
did move. Forcing the row to stay `REJECTED` would make the client's own page silent about cash that
left their account, because the deposit note is guarded on `paymentStatus === 'APPROVED'` — the one
sentence that tells them a refund has to be arranged with the shop. The booking stays `CANCELLED`
(its own guard refuses), and B5's `notPending` branch already logs it at `error` as "a payment
approved for a booking that no longer exists".

The ordering must be exercised by test in **both** directions, because today it is an accident of
which column a guard names.

### D18 — The open checkout is warned about, not closed

Cancelling does not invalidate `mpInitPoint`. The client can complete a checkout they left open and
capture money for an appointment that no longer exists; B5 anticipated exactly this and its error log
is the whole record.

**Closing it is rejected**: it needs an authenticated call to Mercado Pago with the owner's access
token, which would make the public cancel path a **third** decryptor of that credential against B5's
fixed count of two — on a path whose failure must not undo a cancellation that has already committed.

So the confirmation panel says it: if you already started a payment, do not finish it. The residual
is recorded as debt, alongside the transfer variant — a client who saw the CBU, sent the money and
cancelled without uploading a receipt leaves no row asserting the money arrived.

### D19 — A refusal notice is gated on the resulting state, not on the code being present

With no JavaScript there is no disabled button, so a double tap is two `POST`s. The same shape is
produced by a lost response after a commit, and by a browser retry.

**If the page's resolved state is a cancelled one, no failure notice is rendered** — whatever the
code says. The client wanted the booking cancelled and it is; telling them "no pudimos cancelar" on a
page headed *"Cancelaste tu turno"* is the product contradicting itself in two adjacent sentences.
The same rule covers losing the race to the owner: the cancelled-by-shop state renders, and the
client's own attempt is not reported as a failure at something that already happened.

### D20 — The log cardinality an anonymous caller can drive is pinned by test

Every `POST` with a forged token is a database lookup and a log line on an unauthenticated, unmetered
endpoint. **This is the defect N1's adversarial pass found one story ago** — a per-request line on a
public endpoint, beside a comment asserting the opposite. The gate measures it: *N* forged posts
produce the number of entries the spec names, and that number is not *N* multiplied by anything.

## Risks / Trade-offs

**[A stranger who received the confirmation email by mistake can now destroy an appointment]** →
Unchanged in kind — they could already read it — but newly destructive. Mitigated exactly as T69
requires. Not solved: a human who received the mail and chooses to cancel succeeds. The real fix is
address verification, a product decision nobody has made. **C1 does not close T69.**

**[Money captured against a cancelled booking]** → D18. Warned, logged at `error` by B5's existing
branch, recorded nowhere queryable. T74 re-cost rather than pretended away.

**[A client who committed to transfer, saw the CBU, sent the money and cancelled without uploading]**
→ Reachable, and worse than the `PENDING_APPROVAL` case D4 excludes, because there at least a receipt
exists. Mitigated by wording only.

**[The owner does not find out until they look]** → Accepted (D7), and the looking is made
informative (D15). Recorded as debt with its trigger.

**[`blocksAvailability` gains a fourth caller, so a future refinement of it silently changes who may
cancel]** → Accepted, and it is the point: the reading side, the booking write, the sweeper and this
all agree on what "still holding its time" means. A change that surprised this caller would surprise
availability first, where it is tested hardest.

**[The confirmation step adds a URL state]** → It renders and writes nothing, and the panel is gated
on the same predicate the write is, so the worst a hand-edited URL achieves is a page it was already
entitled to see.

## Migration Plan

**No migration.** `cancelledAt`, `cancelledBy` and the `CancelledBy` enum have existed since B3; C2
was their first writer and C1 is their second.

Deploy is the ordinary `opennextjs-cloudflare` one. C2 measured 3073.75 KiB gzip — above the free
plan's 3072 ceiling, on Workers Paid since N1. C1 adds a route, a service and a predicate; the number
is measured at close, as every story since B2 has.

Rollback is a redeploy of the previous version. Rows written meanwhile are `CANCELLED` with
`cancelledBy: 'CLIENT'`, which the previous page renders as the unattributed cancelled state — the
safe direction C2 shipped deliberately.

## Open Questions

None blocking. Three decisions are deferred **with triggers** rather than left open: the
minimum-notice policy (D5), the owner's notification channel (D7), and closing the gateway checkout
(D18). All three are recorded in `tech-debt.md` as part of this story.
