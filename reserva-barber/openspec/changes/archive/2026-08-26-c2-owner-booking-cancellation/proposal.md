# C2 — Owner cancellation, and the client-facing state it exposes

## Why

The owner has no way to cancel a booking. A client who will not arrive, a barber who calls in sick, a slot booked by mistake — all of them stay on the calendar, keep blocking their time, and can only be resolved by the shop phoning the client and asking *them* to cancel, which C1 does not exist yet either.

**But this story is not really about adding a capability. It is about a state that already exists and currently lies.**

`CANCELLED` has been written since B6, by the receipt rejection. `resolvePaymentPageState` **has no branch for it** — grep the file: the word appears nowhere. A cancelled booking falls through every branch to `holdLapsed`, which tells its client:

> *"La reserva venció y el horario volvió a estar disponible."*

That is invisible today for one accidental reason: the only write that produces `CANCELLED` also sets `receiptStatus = REJECTED`, and *that* branch does exist and fires first. **C2 is the first writer of `CANCELLED` with no accompanying marker**, so the fall-through becomes reachable the moment this ships — and a client whose appointment the shop cancelled would be told their booking expired.

Two more things make now the moment:

- **D1's "Cancelaciones de hoy" counter structurally reads zero, and always has.** Its requirement filters on `status = CANCELLED` **and** bounds on `cancelledAt`, calling the two "redundant by construction". They are not: B6's rejection — the only writer of `CANCELLED` in the product — sets the status and **leaves `cancelledAt` null**. Verified against the live database: one cancelled row, zero with a timestamp, zero with a canceller. The counter cannot count, and no test caught it because every test that exercises the counter seeds `cancelledAt` itself.
- **C1 is next and shares this surface.** The client-facing cancelled state, the `cancelledBy` distinction and the copy are all needed by both. Building them once here, with the owner as the first writer, is cheaper than building them twice.

## What Changes

- **The owner can cancel a booking in `CONFIRMED`, `PENDING_PAYMENT` or `PENDING_APPROVAL`**, from the recent-bookings list D1 already renders. Terminal statuses offer no control at all — absent, never disabled, the rule the public flow already follows.
- **One transaction, conditional on the status it expects**, setting `status → CANCELLED`, `cancelledAt`, `cancelledBy → OWNER` and clearing `holdExpiresAt`. **No advisory lock**: this only releases a slot, and a release cannot double-book — the same reasoning B6's rejection records.
- **`cancelledBy` gets its first `OWNER` value.** The column has existed since B3 and nothing has ever written it; the receipt rejection writes `CANCELLED` while leaving `cancelledAt` and `cancelledBy` null. **That is a defect this story also fixes**, because a cancelled booking with no record of who cancelled it cannot be told apart from one cancelled by the client once C1 exists.
- **The client's page stops lying.** A new `cancelledByShop` state, and its precedence is the part that matters: it must outrank **`receiptRejected`**, not just `holdLapsed`. Setting the receipt to `REJECTED` alongside the cancellation (below) would otherwise make the page say *"La barbería no aprobó el comprobante"* to somebody whose comprobante was never looked at.
- **A pending receipt is resolved with the booking.** The queue already filters on `booking.status = 'PENDING_APPROVAL'`, so an orphan disappears from the owner's view on its own — but the row would sit `PENDING` forever, asserting that a human still owes an answer when nobody does, and D5's statistics will read it. The receipt moves to `REJECTED` in the same transaction, and **the `Payment` moves with it only if it is `PENDING`**.
- **An `APPROVED` payment is never touched.** It is a real charge and rewriting it would falsify the record. `EXPIRED` against `CANCELLED` remains how this product tells a deadline from a decision, and an approved deposit against a cancelled booking is a refund the owner owes — which this system does not perform and says so.
- **The client is told.** N1 built the port, the adapter, the composition roots and the copy namespace; this is a second message and one call site. **The alternative is that this product cancels a paid appointment in silence**, which is T72's asymmetry — email when nothing is wrong, silence when something is — except worse, because here the cause is a deliberate decision rather than a failure. The send is non-fatal exactly as N1's is: a provider outage cannot fail a cancellation.
- **The confirmation names what the system cannot do**, as B6's rejection confirmation does: the slot is released, the client's deposit is not returned by this system, and the action cannot be undone.
- **The success message never claims the client was notified** unless the send was recorded — the rule N1 established for the same reason.

> **Two decisions were mine rather than Franco's** and are cheap to reverse: that C2 notifies the client at all, and that a pending receipt is rejected alongside. Both are argued in `design.md` (D5, D6); either can be dropped without touching the rest.

## Capabilities

### New Capabilities

- `booking-cancellation`: who may cancel and in which statuses, the transactional write and what it must not touch, the resolution of a pending receipt, the client-facing state and its precedence over receipt rejection, **the cancellation notice**, and the authorization and idempotency rules.

> **The notice lives here rather than as a delta on `booking-confirmation-email`**, which N1 created and which is not in `openspec/specs/` until N1 archives. A delta against a capability that does not exist yet would couple this change's validity to another change's archive. It reuses N1's port and its non-fatal rule by reference instead.

### Modified Capabilities

- `payment-mercado-pago`: the confirmation page's state table gains `cancelledByShop` and a precedence rule placing it above both `holdLapsed` and `receiptRejected`. The existing requirement enumerates every state the page has and is therefore wrong until this is added.
- `transfer-receipt-review`: rejection is no longer the only writer of `CANCELLED`, and it gains the obligation to record `cancelledAt`/`cancelledBy` — which it has never done, leaving every booking it cancelled indistinguishable from one cancelled by anybody else.
- `dashboard-home`: the recent-bookings list gains a per-row control, and the cancellations counter's claim that its two conditions are "redundant by construction" is corrected — they were contradictory, and the counter read zero.
- `data-persistence`: `Booking.cancelledAt` and `cancelledBy` gain their first writers, and the projection feeding the public page gains `cancelledBy` so the client can be told who cancelled.

## Impact

**Schema** — none. `cancelledAt`, `cancelledBy` and the `CancelledBy` enum have existed since B3's migration and have never been written. **No migration**, which is unusual for a story that adds a state and is worth stating plainly so nobody goes looking for one.

**Code** — one domain predicate, one repository method, one application service, one server action, one control on D1's row, one new state in the page's table, one email builder, one copy block. Nothing existing is rewritten.

**The receipt-rejection correction is a behaviour change to a shipped path**, not new code: B6's `reject` starts writing `cancelledAt`/`cancelledBy = OWNER`. Existing cancelled rows keep their nulls; no backfill, because inventing a canceller for historical rows would be worse than a null that honestly says "unknown, written before C2".

**Verification** — a live gate (`scripts/c2-gate.ts`), because the properties that matter are the ones a mock certifies wrongly: the conditional update matching zero rows on a concurrent transition, the payment left untouched when `APPROVED`, cross-owner scoping through `barber → location → ownerId`, and the receipt resolution. N1's gate found a defect within minutes of existing; this story has the same shape.

**Constraints to respect** — **T69** applies to C1 and not here (there is a session; this is not a tokenized GET). **T72** is half-closed by this story and should be re-costed rather than left claiming nothing notifies anybody. **T65** (receipt retention) gains rows, since a cancelled booking's receipt file stays in the bucket. **T51** is closed and no longer constrains anything.

**Deliberately unresolved** — no refund is performed or recorded; no reason is captured for why a booking was cancelled; no bulk cancellation; and cancelling does not notify the barber, who has no login in this product by design.
