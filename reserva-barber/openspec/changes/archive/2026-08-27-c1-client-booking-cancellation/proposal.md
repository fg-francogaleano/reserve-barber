## Why

**This story keeps two promises the product has already made in writing.** The confirmed page has
told every client since B5 *"Guardá este link por si necesitás cancelar"*, and N1's email carries a
token the schema itself calls `cancellationToken`. Nothing in this product lets a client cancel
anything. The link renders; it does not act.

Until now that was a copy defect with a workaround — the client writes to the shop, the owner cancels
from the dashboard (C2). What it costs is the thing C2 measured from the other side: **the slot stays
sold until a human reads a message and acts.** A client who cannot come at 09:00 on a Saturday has no
way to give that time back.

C2 left exactly one thing unbuilt: the second actor. `CancelledBy.CLIENT` exists in the Prisma enum,
in `Booking.ts`, in the page's state table and in three doc comments, and **nothing writes it**. C1 is
its first writer, and the last Must-Have story of Phase 1.

**It is also the first write in this product authorized by a token rather than by a session.** Every
other public write either creates a row from nothing (B4) or moves a payment forward (B5, B6). This
one destroys a confirmed appointment, and its credential lives in a mailbox nobody ever verified
(T69). That is what gives the story its shape.

## What Changes

### The capability

- **A public cancellation endpoint**, `POST /api/bookings/cancel`, identified by the cancellation
  token in the **request body**. A Route Handler, not a Server Action — `backend-standards.md` makes
  that a hard rule for the public flow, and it is also what keeps the path a fixed string the
  deny-by-default guard can admit by `===`.
- **The `POST` sits behind an explicit, server-rendered confirmation step** reached by a **safe
  `GET`** (`?cancelar=1`) that writes nothing. This is **T69's requirement on this story, not a
  suggestion**: a mail scanner, a link-preview bot, a corporate security gateway — or Next's own link
  prefetching — must not be able to cancel an appointment by fetching a URL. No JavaScript at any
  point.
- **`CancelledBy.CLIENT` gets its first writer**, and the page gains a third cancelled state,
  `cancelledByClient`, that reads as a receipt of the client's own action rather than as an apology
  from the shop.
- **A new repository write, `cancelByToken`**, mirroring `cancelByOwner`: one transaction, every
  write conditional on the status it expects, no advisory lock, an `APPROVED` payment left untouched,
  a `PENDING` payment refused, no receipt written.
- **Client eligibility is `blocksAvailability` plus two bounds** — the appointment must not have
  started, and a booking whose transfer receipt is under review is not the client's to cancel.

### What the edge-case pass forced into scope

These are not polish. Each one is a defect the design would have shipped:

- **A cancelled booking can still be paid.** Cancelling does not close the Mercado Pago checkout, so
  the client can complete a payment for an appointment that no longer exists. B5 already anticipated
  this and logs it at `error`; that log line is the *entire* record. C1 does not close the checkout
  (that would make the public cancel path a third decryptor of the owner's access token) — it warns
  on the confirmation step and re-costs the debt.
- **A late approval overwrites the payment C1 rejected.** `confirmIfSlotFree` guards its approval on
  `mpPaymentId: null`, **not** on `status`, so a payment this story sets to `REJECTED` can be moved
  to `APPROVED` afterwards. That behaviour is **kept and specified as intended** — the money really
  did move, and forcing the row to stay `REJECTED` would make the client's own page silent about
  cash that left their account.
- **The T62 self-refresh carries `?cancelar=1` with it**, because the refresh URL is rebuilt from
  *every* query parameter. Left alone, a client reading an irreversible warning gets the page
  reloaded underneath them on a timer.
- **A double submission renders the cancelled page and a failure notice at once.** With no
  JavaScript there is no disabled button, and the same contradiction is produced by a lost response
  or a browser retry.
- **A refusal has more than one reason**, and "your appointment already started" is not the same fact
  as "this booking moved underneath you".
- **The owner cannot tell a client's cancellation from their own.** Having decided not to email them,
  the dashboard is the *only* channel — and today it shows a status, not an actor.
- **An anonymous caller can drive the log volume** on an unauthenticated endpoint. This is the exact
  defect N1's adversarial pass caught one story ago, so its cardinality is pinned by test.

### What this story deliberately does not do

| Excluded | Reason |
|---|---|
| Any refund, or any record that one is owed | T74 stands as C2 left it. C1 enters it by one more door and re-costs it. |
| An email to the owner | The dashboard is the surface — D1 counts the cancellation the moment it is written. No owner has ever been sent a message by this product, and that recipient class brings a projection, a builder, a configuration question and a share of T71's quota, for a fact the dashboard already carries. Opened as debt. |
| An email to the client | They pressed the button and are looking at the page that reports the result. |
| A minimum-notice policy | A shop policy no owner can express in this product. Guessing a number makes it a rule every shop inherits. Deferred with a trigger. |
| Closing the Mercado Pago checkout on cancellation | It would make the public cancel path a **third** surface permitted to decrypt the access token; B5 fixed that count at two. |
| Address verification | T69's real fix is a product decision nobody has made. C1 implements the mitigation T69 names and nothing more. |
| Any schema change | The columns have existed since B3. **No migration.** |

## Capabilities

### New Capabilities

None. C1 is a second actor inside an existing capability, not a new one — the transaction, the
released slot, the money rules and the client-facing state all belong to `booking-cancellation`, and
splitting the client's half into its own spec would leave two documents free to disagree about what a
cancellation does.

### Modified Capabilities

- `booking-cancellation`: the client becomes a second canceller. Token-scoped eligibility with its
  time bound and its `PENDING_APPROVAL` exclusion, the two-step confirmation the `POST` sits behind,
  the `CLIENT` attribution, the client-cancelled page state, what the confirmation must say before
  the irreversible click, the refusal vocabulary, the log-cardinality bound, and the gate that proves
  it against the live database.
- `owner-authentication`: the deny-by-default public set gains **one** entry, matched by exact string
  equality and never by prefix.
- `payment-mercado-pago`: the confirmation page's state enumeration — which lives in this
  capability — gains the client-cancelled state and the confirmation step; the self-refresh gains a
  parameter allowlist and a rule about not interrupting a deliberate action; and the late-notification
  interaction with a cancellation is specified rather than left to whichever guard happens to fire.
- `data-persistence`: the token-scoped cancellation write, its guards, and `CLIENT` becoming a value
  the database actually holds.
- `dashboard-home`: the recent-bookings list names who cancelled, because it is now the owner's only
  channel for learning that a client did.
- `booking-confirmation-email`: the link's stated purpose. The message offers the page as somewhere
  to *see* the appointment, which is about to be an understatement.

## Impact

**New:**
- `app/api/bookings/cancel/route.ts` + its composition root.
- `src/server/application/services/ClientBookingCancellationService.ts`.
- `scripts/c1-gate.ts`.

**Modified:**
- `src/server/domain/models/Booking.ts` — `isCancellableByClient`.
- `src/server/domain/repositories/IBookingRepository.ts` — `cancelByToken`, **and a stale claim
  fixed in passing**: `cancelByOwner`'s comment still says a `PENDING` receipt "becomes `REJECTED`
  with a `reviewedAt`", the behaviour C2 implemented and then reversed.
- `src/server/infrastructure/prisma/PrismaBookingRepository.ts` — the write.
- `src/server/application/booking/paymentPageState.ts` — `cancelledByClient`.
- `src/server/application/booking/confirmationRefresh.ts` + `app/b/[slug]/reserva/[token]/page.tsx` —
  the refresh allowlist, the confirmation panel, the cancel control, `isCancelled`'s third member.
- `src/server/application/booking/bookingOutcome.ts` — two refusal codes, one corrected comment.
- `src/server/application/auth/routeGuard.ts` — one exact public path.
- `src/server/domain/models/dashboardSummary.ts` + its repository and row — the canceller.
- `src/lib/copy.ts` — the Spanish strings.
- `docs/roadmap.md`, `docs/tech-debt.md`, `docs/data-model.md`.

**Dependencies:** none added. No package, no provider, no environment variable. **C1 makes no
external call at all** — no gateway, no mail provider — so there is no third-party outage to design
around; the only failure surface is the database.

**Verification:** `scripts/c1-gate.ts` against the live database, and a runtime pass on both Node and
`workerd`, the shape every story since B5 has closed on.
