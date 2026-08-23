# B6 + D2 — Bank transfer deposit, receipt upload, and owner review

## Why

A shop that configured only a bank transfer destination (PC1) can already take bookings — `PaymentConfig.isBookable()` admits it and B4's write accepts it — but the hold confirmation page offers only Mercado Pago. **Those bookings are unpayable today**, and the client meets a dead end holding a slot nobody can confirm. B6 closes that gap, and it is the last payment path the MVP is missing.

It ships with **D2**, the owner's review, rather than after it. `PENDING_APPROVAL` blocks availability and `Booking.blocksAvailability` never expires it by time — deliberately, so a transfer the owner is about to approve is not sold underneath them. The consequence is that the state has no exit without a human. Shipping the upload alone would put real money and a permanently blocked calendar behind a reviewer that does not exist.

## What Changes

**The client's side (B6)**

- The hold confirmation page offers **the methods the shop actually configured**, instead of assuming Mercado Pago. A transfer-only shop stops being a dead end; a shop with both offers both.
- Choosing transfer is a **write, not a render**: it opens the `BANK_TRANSFER` payment and **extends the hold to `TRANSFER_HOLD_DURATION_MINUTES` (45)** before the destination is disclosed. Fifteen minutes covers finding a CBU, not opening a banking app, adding a destination, transferring, capturing and uploading — and a hold that lapses mid-transfer leaves the client with real money out and **no record anywhere that they paid**. The destination is never visible during a window that is about to lapse.
- The destination (CBU/CVU, alias, holder name), the exact snapshotted deposit and the deadline are rendered together, so the client copies the right figure to the right account.
- The client uploads a JPG, PNG or PDF proof. The server decides the type by **leading bytes**, stores it in a **private** bucket, and moves the booking to `PENDING_APPROVAL` — one transaction, under the per-barber advisory lock B4 established.
- **Method switching is bounded rather than forbidden**: transfer is refused while a Mercado Pago payment is live *and has a checkout*. A Mercado Pago attempt that never produced an `mpInitPoint` never charged anything, so it is rejected in the same transaction and the client is not trapped by a gateway outage.
- A receipt may be **replaced while it is still `PENDING`**, capped per booking. Rejection is destructive, so an accidental wrong photo must not be unrecoverable.

**The owner's side (D2)**

- A dashboard queue of pending receipts, showing the appointment, the client, **the expected amount**, and the file behind a short-lived signed URL served as an attachment.
- Approve → Payment `APPROVED`, Booking `CONFIRMED`, under the same lock. Reject → Payment `REJECTED`, Booking `CANCELLED`, slot released.

**The rule that closes the hole D2 does not**

- A booking left in `PENDING_APPROVAL` **whose `startTime` has passed** becomes sweepable. An owner on holiday blocks the calendar exactly as an absent D2 would; the appointment is unsellable by then regardless, so releasing it sells nothing twice.

**Specification corrections carried first** (`base-standards.md` §7)

- **BREAKING (documented model, not shipped data):** `TransferReceipt.fileUrl` → **`filePath`**, holding the **object key**. A private bucket has no resolvable URL, and a signed one expires. Nothing has written this table yet.
- `uploadedAt` / `reviewedAt` become `Timestamptz(3)`, the convention B3–B5 hold to and which §13 omits.
- Accepted types add `application/pdf`; SVG stays excluded.
- `PENDING_APPROVAL`'s permanence, and its one terminal path, become written rules rather than emergent behaviour.

## Capabilities

### New Capabilities

- `payment-bank-transfer`: the client-facing transfer deposit — method offer, hold extension, destination disclosure, receipt submission, and the transition to `PENDING_APPROVAL`.
- `receipt-storage`: the private bucket and the upload path for an **anonymous** writer — the first in this project. Separate from `image-storage`, whose requirements are explicitly about the owner's session and a public bucket, and would have to be contradicted rather than extended.
- `transfer-receipt-review`: the owner's queue, the signed read, and the two terminal transitions.

### Modified Capabilities

- `payment-mercado-pago`: the confirmation page's states gain a **method dimension** — "the held booking offers a payment" becomes an offer of the configured methods; "exactly one live payment exists per booking" gains the switching rule; the state table gains the transfer states and their precedence.
- `payment-transfer-details`: PC1's stored destination becomes **publicly readable** for the first time, through a projection that cannot carry `mpAccessToken`, and gains the rule that a destination without a holder name is not offered to a client.
- `booking-availability`: "a booking blocks only while its hold is live" gains the `PENDING_APPROVAL` terminal rule, and the per-barber lock gains a fourth and fifth caller (the transfer write and the approval).
- `booking-creation`: the hold duration stops being a single constant; the clamp at `startTime` now governs an **extension** as well as a creation.

## Impact

**Schema** — `ReceiptStatus` enum, `TransferReceipt` table, unique `paymentId`, `@@index([status])`. Migration `b6_transfer_receipt`.

**Infrastructure** — a private `transfer-receipts` bucket with a `SECURITY DEFINER` predicate that re-derives, in the database, what P1's `auth.uid()` comparison gave for free: an anonymous insert is admitted only at a path naming a real booking in a live hold under its real owner. Applied as a Supabase migration and committed as SQL, like P1's. **No new secret.**

**Public surface** — a third public write, `POST /api/payments/transfer`, needing its own exact entry in the deny-by-default guard (it inherits none), and the first multipart body in the project.

**Code** — a new storage interface and adapter, a receipt repository, transfer payment methods on `IPaymentRepository`, the confirmation page's composition root gaining a `PaymentConfig` read it was deliberately built without, and the dashboard's first review surface.

**Constraints to respect** — T51 (the Worker sat ~325 KiB under the free-plan ceiling after B4 and B5 never re-costed it), T47 (a second query on the confirmation page), T55 (a third endpoint on a per-isolate throttle, and the most expensive one), T15 (two new unique constraints whose violations must be qualified), T53 (a fourth guessed constant, which this change is named as the trigger to revisit).

**Deliberately unresolved** — a receipt image is not evidence and nothing verifies its amount; the owner must reconcile against their bank. D2 renders the expected amount beside the file so the comparison is possible, and the gap is recorded as debt rather than implied to be closed.
