# C2 — Design

## Context

Everything this story needs on the write side already exists and has never been used. `Booking.cancelledAt`, `Booking.cancelledBy` and the `CancelledBy` enum were created whole by B3's migration, following the precedent that an entity assembled across several migrations is several chances for those stories to disagree about its shape. Three stories later they are still null on every row — including the rows B6's receipt rejection cancelled, which write `status = CANCELLED` and leave the other two columns alone.

The read side is where the gap is. `resolvePaymentPageState` is a precedence table over twelve states and **`CANCELLED` is not one of them**. Its fall-through lands on `holdLapsed`. That has been harmless because the single writer of `CANCELLED` also sets `receiptStatus = REJECTED`, and the `receiptRejected` branch sits above the hold check — so the client of a rejected transfer gets a correct message by a route that has nothing to do with their booking's status.

Two constraints shape the rest:

- **The owner's surface is D1's recent-bookings list**, which is a Server Component rendering ten rows from an owner-scoped aggregate. It has no per-row action today.
- **N1 just built the notification path**, including the rule that a send failure can never fail its caller, and the rule that a success message may not claim a notification that did not happen.

## Goals / Non-Goals

**Goals:**

- The owner can release a slot without phoning anybody.
- A cancelled booking tells its client the truth, and tells them *who* cancelled.
- `cancelledBy` becomes meaningful, so C1 can distinguish itself from this story.
- A pending receipt does not outlive the booking it belongs to.
- D1's `cancelledToday` counts something real.

**Non-Goals:**

- Refunds, automated or recorded. The MVP scope excludes them and the copy says so.
- Client-initiated cancellation (**C1**), which shares this surface and is deliberately next.
- A cancellation reason. Considered and rejected below (D7).
- Notifying the barber. There is no barber login in this product by design.
- Undo. A released slot may be resold within seconds; the confirmation says the action is final.

## Decisions

### D1 — `cancelledByShop` sits **below** the receipt states — **corrected during implementation**

Ordering in `resolvePaymentPageState`:

```
confirmed                     (unchanged, still first)
receiptUnderReview
receiptRejected
cancelledByShop / cancelled   ← new
…
paidSlotLost
holdLapsed
```

> **The first version of this decision put the new state above `receiptRejected`**, reasoning that D6's receipt write would otherwise make the page accuse a client about a comprobante nobody opened. That reasoning was correct and the conclusion was not: reordering fixed the cancellation by breaking the receipt rejection, whose message is more specific and more useful where it applies. **The right fix was to stop writing the receipt** — see D6, which was reversed for this reason. With the receipt untouched the two cases are distinguishable by data, and no ordering has to arbitrate between them.

What the placement still has to clear is `paidSlotLost` and `holdLapsed`. "We received your payment but the time was gone" and "your reservation expired" are both wrong for somebody the shop cancelled on — the first invents a race that never happened, the second blames them for running out of time.

The state is driven by `cancelledBy === 'OWNER'`, not by `status === 'CANCELLED'`. Once C1 exists, a client who cancelled their own booking must not be shown a message about the shop cancelling it, and the status alone cannot tell them apart. **This is why the projection gains `cancelledBy` rather than the page inferring from status.**

### D2 — One transaction, conditional update, no advisory lock

```
UPDATE Booking  SET status=CANCELLED, cancelledAt, cancelledBy=OWNER, holdExpiresAt=NULL
  WHERE id = ? AND status IN (CONFIRMED, PENDING_PAYMENT, PENDING_APPROVAL)
```

Guarded, so a booking that moved underneath — confirmed by a notification, expired by the sweep — matches zero rows and reports what it actually found, rather than having `CANCELLED` stamped over it.

**No lock**, and this is the same argument B6's rejection makes: the per-barber advisory lock exists so two writers cannot *place* a booking into one slot. This only releases one, and a release cannot double-book.

### D3 — An `APPROVED` payment is never touched; a `PENDING` one is rejected

| payment state | what C2 does |
| --- | --- |
| `APPROVED` | **nothing** |
| `PENDING` | `REJECTED` |
| none | nothing |

An approved payment is a real charge that really happened, and rewriting it to make the booking's story tidier would falsify the only record this product has of money moving. It is also precisely the pair the payment domain already documents as legitimate: `APPROVED` does not imply `CONFIRMED`, and the late-payment case produces exactly that combination.

A `PENDING` payment is an attempt that will now never complete, and leaving it pending would keep it counted as in-flight by the one-live-payment index and by D5's future statistics.

### D4 — Eligibility is a domain predicate, not a list in the action

`isCancellableByOwner(status)` in `Booking.ts`, beside `blocksAvailability`. Three callers need the same answer — the row deciding whether to render a control, the service deciding whether to try, and the repository's `WHERE`. Three copies of a status list is three chances for the button to appear where the write refuses.

**A past appointment is still cancellable.** Considered forbidding it; rejected, because a no-show is exactly a past appointment the owner wants off the books, and D1's list is ordered by recency rather than by future-ness.

### D5 — The client is notified, and this was my call rather than Franco's

The story's ask is owner-facing and complete without it. I am including it anyway, and the reasoning is worth stating so it can be overruled cleanly:

- **The harm is caused by this story.** A client with a paid deposit whose appointment is cancelled and who is never told will arrive at a shop that is not expecting them. Nothing else in the product will reach them; the page only helps if they still have the link and think to open it.
- **The marginal cost is now small and will never be smaller.** N1 built the port, the adapter, the two composition roots, the non-fatal contract and the copy convention. This is a second builder function and one call site. Deferring it means reopening the flow later and running a second verification round.
- **It closes half of T72**, which records that this product emails when nothing is wrong and stays silent when something is.

**Non-fatal on the same terms as N1**: the send is awaited after the transaction commits, never inside it, and its failure changes nothing. Unlike N1, there is **no `sentAt` column** for this message and none is proposed — the "confirmed but never told" query exists because a confirmation is a promise the product made; a cancellation notice is a courtesy, and a second nullable column with no reader would be cargo-culting N1's shape rather than reusing its reasoning.

**To drop this:** remove the notification service from the composition root and the one call site. Nothing else changes.

### D6 — A pending receipt is left alone — **reversed during implementation**

> **This decision was made, implemented, and then reversed by a test that already existed.** The original text is kept below the reversal, because the reasoning that looked sound is the useful part.

**What ships: C2 does not touch the receipt.** A cancelled booking's `PENDING` receipt stays `PENDING`.

The reversal came from `paymentPageState.test.ts`, which has asserted since B6 that a booking with `CANCELLED` + receipt `REJECTED` renders `receiptRejected`. Writing the receipt in C2 turned that test red, and the failure was the point rather than an inconvenience:

| | status | receipt | `cancelledBy` |
| --- | --- | --- | --- |
| Receipt rejection (B6) | `CANCELLED` | `REJECTED` | `OWNER` |
| C2 cancelling a `PENDING_APPROVAL`, **as first designed** | `CANCELLED` | `REJECTED` | `OWNER` |

**Byte-identical.** The page has to choose between *"la barbería no aprobó tu comprobante"* and *"la barbería canceló tu turno"*, and with the same three values there is no basis to choose — whichever branch wins, the other case gets a wrong message. D1's original ordering "fixed" the cancellation by breaking the rejection, and the rejection's message is the **better** one where it applies: specific, and about the thing the client did.

Not writing the receipt separates them by construction. A rejection leaves `REJECTED` and keeps its own state; a cancellation leaves `PENDING` and falls to the cancelled state.

It is also the more honest record. `PENDING` means nobody answered, which is exactly true — the owner cancelled a booking, they did not review a document. `REJECTED` would have claimed a review that never happened, and the queue already hides the row anyway: its predicate filters on the booking's status, so a cancelled booking's receipt disappears from the owner's view with no write at all.

The residual cost is the one the original decision was trying to avoid — a `PENDING` row that will never be answered — and it is now judged smaller than a false message to a client. It joins **T65**'s retention question rather than being solved here.

<details>
<summary>The original decision, kept for the reasoning</summary>

**A pending receipt is resolved with the booking, and this was also my call.** The queue predicate already filters on `booking.status = 'PENDING_APPROVAL'`, so a cancelled booking's receipt vanishes from the owner's view with no work. The reason to write it anyway is that the row would keep asserting `PENDING` — "a human owes an answer" — when nobody does, and D5 will read receipt statuses to report on transfers.

`REJECTED` is an imperfect fit and is chosen deliberately over the alternative. It carries a hint of "the owner reviewed and refused this document", which is not what happened. But the alternative is `PENDING` forever, which claims something further from the truth, and `ReceiptStatus` has no third member for "moot". D1's precedence rule is what stops that semantic stretch reaching the client as a message about their comprobante.

</details>

### D7 — No cancellation reason

Considered a nullable `cancellationReason`. Rejected for the MVP: a free-text field the owner types in a hurry is either shown to the client — in which case it is a message and needs the care of one — or it is not, in which case it is a column nobody reads. If it comes back, it comes back with a decision about its audience.

### D8 — B6's rejection starts recording who cancelled

A one-line correction to shipped code: `PrismaTransferReceiptRepository.reject` sets `cancelledAt` and `cancelledBy = OWNER` alongside the status it already writes.

Left alone, C1 would arrive to find `CANCELLED` rows whose canceller is unknowable, and the page state in D1 — which keys on `cancelledBy` — would fall through to `holdLapsed` for every booking B6 ever rejected. **The fix is required by this story, not adjacent to it.**

Historical rows keep their nulls. No backfill: inventing `OWNER` for rows written before anybody recorded it would be a guess dressed as data, and a null that honestly means "written before C2" is better. The page treats a null `cancelledBy` on a `CANCELLED` booking as the generic cancelled state.

### D9 — The action is a Server Action on D1, not a Route Handler

The dashboard is authenticated and reloaded freely; every other write in it is a Server Action. The public-flow rule that mutations are Route Handlers exists because a guest mid-payment must never meet a stale build-time action id — which does not apply here. This matches `/comprobantes` exactly.

## Risks / Trade-offs

- **The receipt semantic stretch (D6)** is real. A `REJECTED` receipt now means either "the owner refused this document" or "the booking was cancelled underneath it", and only `cancelledBy` distinguishes them. Recorded rather than hidden.
- **No refund path, and this story makes it reachable on purpose.** B6's rejection could already cancel a booking with money moved, but only for a transfer the owner was actively refusing. C2 lets an owner cancel a Mercado Pago booking that is paid and confirmed, which is the cleanest possible case of "this product owes somebody money and cannot send it".
- **The email is unverified infrastructure.** N1's delivery has still not been proven against a real inbox. C2's message inherits that gap rather than adding to it — both are verified in the same session once a domain exists — but shipping C2 first means two unproven messages instead of one.
- **`cancelledToday` will jump** the first time this is used, and that is the counter working, not a defect. Worth knowing before somebody reads it as a spike in client behaviour.
- **A cancelled slot is immediately resellable**, so an owner who cancels by mistake may find the time gone before they can re-create the booking. There is no undo and the confirmation says so.

## Migration Plan

None. No schema change, no migration, no backfill. The columns exist; this story is their first writer.

Rollback is reverting the code: nothing structural changes, and rows written by this story remain readable by the previous version (which renders them as `holdLapsed`, i.e. the bug this story fixes).

## Open Questions

- **Should the client's notification carry the deposit amount?** Saying "tu seña de $2.000,50 no se devuelve por este sistema" is honest and actionable; saying nothing about money reads as evasive. Leaning toward including it, and it is a copy decision rather than a structural one.
- **Does an owner ever need to cancel a booking they have already cancelled?** No — but the guarded update's `notFound`/`notCancellable` outcome needs a message, and "esta reserva ya no se puede cancelar" covers both that and a booking the sweep expired first.
