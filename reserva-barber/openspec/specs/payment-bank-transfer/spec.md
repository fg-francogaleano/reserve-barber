# payment-bank-transfer Specification

## Purpose
TBD - created by archiving change b6-transfer-deposit-and-review. Update Purpose after archive.
## Requirements
### Requirement: A shop that configured only a transfer destination can be paid

The confirmation page SHALL offer bank transfer whenever the booking is `PENDING_PAYMENT`, its hold is live by `blocksAvailability`, and the owner has a **usable** transfer destination stored.

A destination is usable when a CBU/CVU or an alias is present **and** `transferHolderName` is present. A destination without a holder name SHALL NOT be offered: the client cannot confirm from their bank's screen that they are paying the right business, which is the reason the holder name is required alongside a destination in the first place.

When neither method is usable, the page SHALL state that the shop cannot take payments right now, phrased as the shop's situation and never as the client's failure.

#### Scenario: A transfer-only shop offers transfer
- **WHEN** the confirmation page renders for a live hold at a shop with a CBU and a holder name stored and no Mercado Pago credentials
- **THEN** a control that begins a bank transfer is present in the server-rendered HTML and no Mercado Pago control appears

#### Scenario: Both methods configured
- **WHEN** the shop has both a usable transfer destination and Mercado Pago credentials
- **THEN** both controls are present and either can be chosen

#### Scenario: A destination with no holder name is not a destination
- **WHEN** the shop has a CBU stored and no `transferHolderName`
- **THEN** no transfer control appears, and if Mercado Pago is also unconfigured the page states that the shop cannot take payments

### Requirement: Committing to transfer is a write that extends the hold before the destination is shown

Choosing bank transfer SHALL open a `BANK_TRANSFER` `Payment` in status `PENDING` and SHALL extend the booking's `holdExpiresAt` to the current instant plus `TRANSFER_HOLD_DURATION_MINUTES`, **clamped so it never exceeds `startTime`** by the same rule the original hold follows.

`TRANSFER_HOLD_DURATION_MINUTES` SHALL be **45**, declared beside the other booking-time bounds and documented as a judgement rather than a measurement.

The destination SHALL NOT be rendered before this write succeeds. A client who transfers money into a window that is about to lapse has no recourse — this system has no gateway to ask and holds no record that anyone paid — so the CBU is never visible during a window about to lapse.

#### Scenario: The hold is extended on commitment
- **WHEN** a client with a live 15-minute hold chooses bank transfer for an appointment two days away
- **THEN** a `BANK_TRANSFER` payment exists in status `PENDING` and `holdExpiresAt` is 45 minutes from that instant

#### Scenario: The extension is clamped at the appointment
- **WHEN** the extension would place `holdExpiresAt` after `startTime`
- **THEN** `holdExpiresAt` equals `startTime` and never exceeds it

#### Scenario: The destination is withheld until commitment
- **WHEN** the confirmation page renders for a live hold that has no `BANK_TRANSFER` payment
- **THEN** no CBU, alias or holder name appears anywhere in the response

#### Scenario: The destination is withheld after the hold lapses
- **WHEN** the confirmation page renders for a booking whose extended hold has passed and whose receipt was never uploaded
- **THEN** no CBU, alias or holder name appears anywhere in the response

### Requirement: The destination, the amount and the deadline are rendered together

Once transfer is committed, the page SHALL render the CBU/CVU and/or alias, the holder name, the deposit amount taken from the booking's snapshot, and the remaining time — in one block, so the client copies the right figure to the right account.

The amount SHALL be the snapshotted `depositAmount` and SHALL NEVER be recomputed from the live policy.

A warning that a transfer made after the deadline cannot be recovered from this page SHALL appear **above** the destination, not after it.

Remaining time SHALL be rendered by the server in whole minutes. No client-side countdown SHALL be introduced, because it would be a hydration mismatch on the page whose value is being truthful about time, and it would keep counting past a deadline the server already knows has passed.

#### Scenario: The figure shown is the snapshot
- **WHEN** the owner changes the deposit policy after the booking was created and the client opens the destination
- **THEN** the amount rendered is the booking's snapshotted `depositAmount`

#### Scenario: The warning precedes the account number
- **WHEN** the destination block renders
- **THEN** the deadline warning appears before the CBU in document order

#### Scenario: Long values stay readable
- **WHEN** the destination block renders at a 360-pixel viewport with a 22-digit CBU, an alias and a long holder name
- **THEN** no value overflows its container and the page does not scroll horizontally

### Requirement: The transfer flow works without JavaScript

Both the commitment control and the receipt submission SHALL be submits inside native forms — the second with `enctype="multipart/form-data"` — posting to a fixed URL, and both SHALL be answered with a `303` so a reload or a back-navigation issues a `GET`.

A copy-to-clipboard control on the CBU SHALL be progressive enhancement over selectable text, never the only way to obtain the number.

In every state where the client has nothing left to do, the control SHALL be **absent** from the document rather than rendered disabled.

#### Scenario: Committing without JavaScript
- **WHEN** the transfer control is submitted with JavaScript disabled
- **THEN** the hold is extended, the payment is created, and the browser follows a `303` back to the confirmation page showing the destination

#### Scenario: Uploading without JavaScript
- **WHEN** the receipt form is submitted with JavaScript disabled
- **THEN** the file is processed and the browser follows a `303` back to the confirmation page

#### Scenario: The CBU is obtainable without script
- **WHEN** the page renders with JavaScript disabled
- **THEN** the CBU is present as selectable text

### Requirement: The receipt submission is a public write on a fixed path with the token in the body

The receipt endpoint SHALL be a Route Handler at a path carrying **no identifier**, added to the deny-by-default guard's public set as an **exact** entry. It SHALL NOT inherit the entry of any other public endpoint, and no `/api` prefix SHALL be admitted.

The cancellation token SHALL travel in the request body, never in a path or query string, so a live credential does not reach access logs or a `Referer` header.

A token that resolves to nothing, a token for a booking in a non-payable status, and a token belonging to another shop SHALL be answered **identically**, and the answer SHALL disclose nothing about which case occurred.

#### Scenario: The endpoint is reachable without a session
- **WHEN** an anonymous client posts to the receipt endpoint
- **THEN** the request reaches the handler and is not redirected to `/login`

#### Scenario: No sibling path is admitted
- **WHEN** the guard evaluates a path that shares a prefix with the receipt endpoint but is not exactly it
- **THEN** the request is treated as protected

#### Scenario: Unknown and foreign tokens are indistinguishable
- **WHEN** a receipt is submitted with a token that never existed, and separately with a token belonging to another owner's booking
- **THEN** both responses are byte-identical

### Requirement: The file is accepted by its content and bounded three times

The submission SHALL be refused before the body is read when `Content-Length` exceeds the ceiling, and the actual byte length SHALL be re-checked after reading, because the header is client-controlled.

The file type SHALL be determined by inspecting the file's **leading bytes**. The declared content type and the filename SHALL NOT be consulted for this decision, and the filename SHALL NOT contribute any part of the stored object key.

Accepted types SHALL be JPEG, PNG and PDF. SVG SHALL be excluded.

The ceiling SHALL be 10 MB, enforced at the route, at the byte re-check, and by the bucket's own size limit.

#### Scenario: A file whose declared type disagrees with its bytes
- **WHEN** a file named `comprobante.jpg` declared as `image/jpeg` has leading bytes `%PDF-`
- **THEN** it is treated as a PDF, and stored with a `.pdf` extension derived from the detection

#### Scenario: An unrecognized type is refused
- **WHEN** a file whose leading bytes match none of the accepted signatures is submitted
- **THEN** the submission is refused, no object is written, no row is created, and the message names the accepted types in Spanish

#### Scenario: An oversized body is refused before it is read
- **WHEN** a request arrives with a `Content-Length` above the ceiling
- **THEN** the body is not read into memory and the submission is refused

#### Scenario: A lying Content-Length is caught after the fact
- **WHEN** a request declares a small `Content-Length` and delivers more bytes
- **THEN** the byte re-check refuses it and no object is written

### Requirement: An accepted receipt moves the booking to PENDING_APPROVAL in one transaction under the per-barber lock

The object SHALL be uploaded **before** the transaction opens. The transaction SHALL take the same per-barber advisory lock the booking write takes, re-apply the shared blocking predicate, create the `TransferReceipt` in status `PENDING`, and update the booking to `PENDING_APPROVAL`.

The booking update SHALL be **conditional** on the booking still being `PENDING_PAYMENT`, so a concurrent transition matches zero rows rather than being overwritten.

The advisory lock SHALL be acquired with a statement executed for its effect and not with a query that reads a column back: `pg_advisory_xact_lock` returns `void`, which the driver adapter cannot deserialize.

An upload that succeeds followed by a transaction that fails SHALL leave an orphaned object, which SHALL be logged and SHALL NOT be fatal. The reverse order SHALL NOT be used.

#### Scenario: A receipt is accepted
- **WHEN** a valid file is submitted for a booking with a live extended hold and a `PENDING` `BANK_TRANSFER` payment
- **THEN** the object exists in the private bucket, one `TransferReceipt` exists in status `PENDING`, and the booking is `PENDING_APPROVAL`

#### Scenario: The slot was taken while the client was at their bank
- **WHEN** the receipt arrives after the extended hold lapsed and the slot has been taken by another booking
- **THEN** no `TransferReceipt` is created, the booking is not moved to `PENDING_APPROVAL`, and the client is told plainly that the turn was lost and that a completed transfer must be resolved with the shop

#### Scenario: Two submissions race
- **WHEN** two valid uploads for the same booking are processed concurrently
- **THEN** exactly one `TransferReceipt` exists for that payment, the booking is `PENDING_APPROVAL` exactly once, and the second submission is reported as the same receipt rather than as an error

#### Scenario: A submission over an already confirmed booking
- **WHEN** a receipt is submitted for a booking that Mercado Pago already confirmed
- **THEN** no `BANK_TRANSFER` payment is created, the booking stays `CONFIRMED`, and the page reports the booking as already confirmed

### Requirement: A receipt may be replaced while it is pending, and submissions are capped per booking

While the receipt's status is `PENDING`, a further submission SHALL update the same row with the new `filePath` and `uploadedAt`. It SHALL NOT create a second row.

Submissions SHALL be capped at `MAX_RECEIPT_UPLOADS_PER_BOOKING` (3), checked against the database. The per-origin throttle SHALL also apply, and SHALL be documented as the weaker of the two because it is per-isolate.

**The cap SHALL be consulted before any object is written, and again inside the transaction.** A cap checked only where the row is recorded bounds rows and leaves object storage unbounded — the refusal arrives after the bytes are already stored, so a caller can keep writing files while being told every time that they cannot. The pre-check bounds the ordinary case; the transactional check settles the race two concurrent submissions create, which a read cannot.

**The superseded object SHALL be left in place, as a bounded orphan.** Deleting it would require granting the anonymous role a delete policy on the bucket, and an anonymous caller who can delete can delete *anybody's* receipt — a strictly worse bargain than leaving an object behind. The uploader has no session, so no owner-scoped credential exists at that moment to do it instead. The cap bounds the consequence at two orphans per booking, and the displaced key SHALL be logged so a retention rule can find them later.

#### Scenario: A wrong photo is replaceable
- **WHEN** a client who uploaded the wrong image submits a correct one while the receipt is still `PENDING`
- **THEN** one `TransferReceipt` exists and its `filePath` points at the new object

#### Scenario: The superseded object is left behind and named in the log
- **WHEN** a receipt is replaced
- **THEN** the previous object remains in the bucket, the displaced key is logged, and the client's submission succeeds

#### Scenario: The cap holds across addresses
- **WHEN** a booking that has already reached the submission cap receives another valid file from a different IP address
- **THEN** the submission is refused and no object is written

#### Scenario: A capped submission never reaches storage
- **WHEN** a booking whose `uploadCount` has reached the cap submits another valid file
- **THEN** the cap is detected before the upload, nothing is written to the bucket, and no transaction is opened

#### Scenario: A decided receipt cannot be reopened by a new file
- **WHEN** a receipt that is already `APPROVED` or `REJECTED` receives a further submission
- **THEN** it is refused and the stored `filePath` is unchanged

### Requirement: A Mercado Pago attempt that never produced a checkout does not trap the client

A transfer commitment SHALL be refused while a live `MERCADO_PAGO` payment exists **and** that payment has a stored checkout URL.

A live `MERCADO_PAGO` payment with **no** stored checkout URL SHALL be set to `REJECTED` inside the transfer's own transaction, and the transfer SHALL proceed. Such a payment is an unfinished preference creation: no checkout ever existed, so nothing could have been charged.

The refusal SHALL have its own rendered state telling the client a Mercado Pago payment is already in progress, and SHALL NOT be reported as a generic failure.

#### Scenario: A live checkout blocks the switch
- **WHEN** a client with a `PENDING` Mercado Pago payment holding a checkout URL chooses bank transfer
- **THEN** no `BANK_TRANSFER` payment is created and the page states that a Mercado Pago payment is already in progress

#### Scenario: A gateway outage does not trap the client
- **WHEN** a client whose Mercado Pago attempt failed before a preference was created chooses bank transfer
- **THEN** the Mercado Pago payment is set to `REJECTED`, a `BANK_TRANSFER` payment is created, and the hold is extended

#### Scenario: A rejected payment never blocks a retry
- **WHEN** a booking has a `REJECTED` payment of either method
- **THEN** a new transfer commitment is permitted

### Requirement: Every user-facing string this capability introduces is Spanish and lives with the flow's copy

All client-facing text — the method labels, the destination block, the deadline warning, every refusal cause, and every new page state — SHALL be Spanish (es-AR) and SHALL live in the copy module rather than inline in components.

Refusal causes the client can act on SHALL be distinguishable from one another: wrong type, too large, too many attempts, method already in progress, hold lapsed.

#### Scenario: No inline user-facing text
- **WHEN** the new components and route are reviewed
- **THEN** no Spanish string literal appears outside the copy module

#### Scenario: Each actionable refusal reads differently
- **WHEN** a submission is refused for an unaccepted type and, separately, for exceeding the size ceiling
- **THEN** the two messages differ and each names what the client can do

### Requirement: Transfer logs identify the decision and never the person or the destination

Every refusal and every state transition SHALL be logged with the booking id and the cause. Logs SHALL NOT contain the client's name, email or phone, the uploaded filename, or the CBU/alias/holder name.

#### Scenario: A refusal is diagnosable without exposing anyone
- **WHEN** an upload is refused for an unaccepted type
- **THEN** the log records the operation, the booking id and the cause, and contains no contact detail, no filename and no destination

### Requirement: The transfer path is proven against the deployed runtime before the story closes

A gate script SHALL exercise this capability against the live database on the deployment runtime, covering at minimum: an upload of each accepted type, a file whose declared type disagrees with its bytes in both directions, an oversized file, a replacement that removes its predecessor, the hold extension and its clamp, and a fresh availability read confirming the `PENDING_APPROVAL` slot is not offered.

#### Scenario: The gate runs against real infrastructure
- **WHEN** the gate script is run on the deployment runtime against the live database
- **THEN** every listed case behaves as specified and the results are recorded before the change is archived
