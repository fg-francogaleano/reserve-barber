## Context

B5 shipped the Mercado Pago path and, with it, the shape every payment story now follows: a `Payment` row bounded by the partial unique index `Payment_one_live_per_booking`, a confirmation page addressed by `cancellationToken` whose state comes from a pure resolver, and a public write on a fixed path admitted by exact match in a deny-by-default guard.

B6 is the same skeleton with three properties none of the previous stories had.

**The writer is anonymous.** Every write in this project so far has been authorized by a session — the owner's, through Supabase RLS — or by a token the application resolves itself. P1's storage guarantee is stated as a property of the database: *"a write outside the owner's own prefix is refused by the database, not by this class"*, because `SupabaseImageStorage` is handed the owner's own session client and the bucket policy compares `(storage.foldername(name))[1]` against `auth.uid()`. A booking guest has no `auth.uid()`. `storage-policy.sql` promised B6 "the same policy shape"; that promise cannot be kept literally, and the question this design has to answer is what replaces the guarantee, not how to move the bytes.

**There is no gateway.** Mercado Pago told B5 whether money moved, and the re-fetch made that answer authoritative. A bank transfer is invisible to this application. The only record is an image the client uploads, which is trivially fabricated, and a human comparing it against a bank statement. Nothing here can verify a payment; the system's job is to hold the slot honestly while a person decides.

**The state it creates has no exit.** `Booking.blocksAvailability` returns `true` for `PENDING_APPROVAL` unconditionally, with the reason written into the code: *"releasing the slot underneath a transfer that the owner is about to approve would sell it twice"*. That is correct and it means time cannot resolve the state. B7 sweeps `PENDING_PAYMENT` only.

Constraints in force: T51 (the Worker measured ~325 KiB under the free plan's 3072 KiB ceiling after B4; B5 did not re-cost it, and wrangler's figure is a lower bound rather than a gate), T47 (no cache and no rate limit on the public surface; ~0.35–0.40 s per Supavisor round trip), T55 (the throttle is per-isolate), T53 (`HOLD_DURATION_MINUTES` is a guess, and names this change as its trigger), T15 (an unqualified `P2002` is already a defect here).

## Goals / Non-Goals

**Goals:**

- A shop with only a transfer destination can take and confirm bookings end to end.
- An anonymous upload is confined by the **database**, not only by application code — P1's property, re-derived by other means.
- A client is never left having transferred real money into a hold that has already lapsed.
- `PENDING_APPROVAL` has a written terminal path that does not depend on the owner being attentive.
- The encrypted `mpAccessToken` stays out of the public render, on a page that must now read the row it lives in.

**Non-Goals:**

- Verifying that a transfer actually happened. Impossible without a bank integration, and out of the MVP.
- Reading the receipt's contents — no OCR, no amount extraction, no matching against a statement.
- Notifying the owner that a receipt is waiting. N1 (Resend) and D1's counter are separate stories; until they land, the queue is the only surface.
- Refunds. Explicitly out of scope per `base-standards.md` §4.
- Per-shop configuration of the transfer hold duration. It joins the T53 family as a fourth product-wide constant.

## Decisions

### D1 — The anonymous insert is admitted by a database predicate, not by a bare grant

The bucket is private. The insert policy targets the `anon` role and calls a `SECURITY DEFINER` function that resolves the path against the booking tables:

```sql
create policy transfer_receipt_anon_insert on storage.objects
  for insert to anon
  with check (
    bucket_id = 'transfer-receipts'
    and public.storage_can_accept_receipt(name)
  );
```

`storage_can_accept_receipt(path)` — `SECURITY DEFINER`, `search_path` pinned — requires that `(storage.foldername(path))[2]` is a real `Booking`, that its hold is live, and that `(storage.foldername(path))[1]` equals that booking's owner's `authUserId`. `SECURITY DEFINER` is what lets the check read Prisma-owned tables without granting `anon` any `SELECT` on them.

**Alternatives considered.**

- *A bare `anon` insert grant.* Smallest and simplest, and the only guarantee would be our own route. `SUPABASE_ANON_KEY` is server-only here today, but that key is **designed** to be published — the first story that adds a browser-side Supabase client exposes it correctly, and silently makes the bucket world-writable. This codebase already rejected `validateSignature()` for reading as protection while protecting nothing (B5 D1); an unconditional `anon` policy is the same figure.
- *A dedicated Supabase auth user with a stored password.* A real secret instead of a conventionally-public key, and a precise policy. But it adds a secret with all the byte hygiene `wrangler.jsonc` warns about, requires caching and refreshing a JWT inside a Worker, and **still confines nothing** — that user could write anywhere in the bucket. Better credential, same absent guarantee.
- *No file at all: a typed transfer reference.* Deletes this entire decision, and a reference string is arguably more useful for reconciliation than an image. Rejected because sending the comprobante is the expected gesture for this payment method in this market, but recorded as the fallback if the predicate proves unworkable.
- *Bytes in Postgres as `bytea`.* Removes the authorization problem entirely by routing the write through Prisma like every other write. Rejected on capacity: at 10 MB per receipt this consumes the database's budget in dozens of bookings, and drags backups with it.

**The cost, stated rather than discovered:** this couples the `storage` schema to Prisma-owned tables. A column rename in `Booking` breaks a policy Prisma **does not report as drift** — the same blind spot `storage-policy.sql` already documents about itself. Mitigated in D9.

### D2 — Bytes travel through the Worker, and the type is decided by leading bytes

The client posts multipart to the Route Handler, which validates and then uploads. A browser-direct signed upload URL would keep megabytes out of the isolate, but the bytes would then never pass a server-side check, and the bucket's `allowed_mime_types` tests the **declared** type only — which is client-controlled and proves nothing. `imageType.ts` established that rule for a public bucket; a private one holding files the owner will open in their own browser has the same need.

`Content-Length` is refused before the body is read, and the actual byte length is re-checked after, because the header is client-controlled. Three layers, as `MAX_IMAGE_BYTES` documents: the route, the re-check, and the bucket's own `file_size_limit`.

### D3 — Committing to transfer is a write, and it extends the hold

`TRANSFER_HOLD_DURATION_MINUTES = 45`, applied at commitment, reusing `holdExpiresAtFor`'s clamp against `startTime`.

Fifteen minutes was chosen as *"tight but workable for locating a bank transfer destination"* — locating it, not authenticating into a banking app, adding a destination to an agenda (which several banks gate behind their own confirmation step), transferring, capturing and uploading. The failure it produces is the worst in the product: the client has transferred real money and **no row in this system records that anyone paid**. B5's `paidSlotLost` at least knows a charge exists.

**45 rather than 60** because `MIN_BOOKING_LEAD_MINUTES` is 60, so a 60-minute hold sits exactly on the clamp for the nearest bookable appointment — and T53 warns that the lead time is the first constant a real shop will ask to lower, at which point the clamp stops being theoretical.

**Why it is a write and not a render:** because it is a write, the destination can be withheld until after it. That yields the rule that actually prevents the failure — **the CBU is never visible during a window that is about to lapse** — which a pure render could not offer.

*Alternative considered:* moving the method choice into the wizard so B4's write sets the right duration in one shot. Cleaner in principle, but it reopens the project's concurrency-critical story, adds a sixth step to a flow T47 measured at ~1 s per navigation, and forces the choice before the client sees the destination they are choosing.

### D4 — Method switching is bounded by whether a checkout ever existed

Transfer is refused while a live `MERCADO_PAGO` payment has an `mpInitPoint`. A live MP payment **without** one is rejected inside the transfer's own transaction, and the transfer proceeds.

`mpInitPoint` is the exact boundary: `IPaymentRepository` already documents that it is null between the row's creation and the preference's, and that *"a live payment with a null `mpInitPoint` is an unfinished preference creation and is retried, never treated as a block"*. No preference means no checkout URL, means nothing the client could have paid. Rejecting it charges nobody.

The stricter rule — first method wins, always — was the original recommendation and is rejected here because it traps the client whose Mercado Pago attempt failed for the shop's reasons (an unreachable gateway, an unreadable credential), which are precisely the clients B6 exists to serve. The looser rule — reject any live MP payment to make room — is rejected because it races a notification that may already be approved, and a double charge is worse than either.

### D5 — The receipt is replaceable while it is `PENDING`, and capped

A replacement updates the same row (new `filePath`, new `uploadedAt`), capped at `MAX_RECEIPT_UPLOADS_PER_BOOKING = 3` through an `uploadCount` column — a column rather than a row count, because the update keeps `paymentId` unique and leaves nothing to count.

**The cap is checked twice, and the adversarial review is why.** As first built it lived only inside `attachReceipt` — which runs *after* the upload, so it bounded rows and left object storage unbounded: a token holder could push 10 MB per request for as long as their booking sat in `PENDING_APPROVAL`, each request answered "too many attempts" while the file was quietly kept. The service now reads `uploadCount` **before** writing anything and refuses early. The transactional check stays, because a read cannot settle the race two concurrent submissions create; the pre-check bounds the ordinary case, the transaction bounds the concurrent one.

**Revised during implementation: the superseded object is not deleted.** The plan said "best-effort-deletes the previous object", and that collides with D1. The uploader is anonymous and holds no delete grant; granting the `anon` role one would let anybody delete anybody's receipt, which is strictly worse than leaving an object behind, and no owner-scoped credential exists at that moment to do it instead. So the object stays as a **bounded orphan** — at most two per booking, given the cap — and the displaced key is logged so a retention rule can sweep it. Recorded as debt rather than quietly dropped.

Rejection is destructive: Payment `REJECTED`, Booking `CANCELLED`, slot gone. Without replacement, a wrong photo is unrecoverable through a path that costs the client their appointment. The unique `paymentId` is preserved — this is an update, not a second row. The cap is the bound that actually holds against storage abuse, since the throttle is per-isolate (T55) and the token's holder is a legitimate client.

Delete-then-insert rather than an `update` policy, so `anon` never holds one.

### D6 — A separate storage interface, not a widened one

`IReceiptStorage` and `ReceiptContentType` (`image/jpeg | image/png | application/pdf`) alongside the existing pair. Widening `ImageContentType` would let a WebP reach the receipt bucket and a PDF reach the public profile bucket, both silently, and `image-storage`'s requirements — the owner's session, the public bucket, the browser downscale — are specific enough that B6 would have to contradict them rather than extend them.

`IImageStorage` anticipated exactly this: *"the private-bucket implementation B6 needs is an addition rather than a rewrite"*, and `StoredImage.url` already declines to promise public readability.

### D7 — The stored value is the object key, and the confirmation page reads a projection that cannot carry the token

**`filePath`, not `fileUrl`.** A private object has no resolvable URL; a signed one expires. D2 signs the key at render time with the owner's session client, forcing `Content-Disposition: attachment` so a PDF with active content is never rendered inline on the Supabase origin.

The key is `{ownerAuthUserId}/{bookingId}/{uploadedAtEpochMs}.{ext}`, composed entirely of server-held values, the extension derived from the **detected** type. The leading segment is the **Supabase auth user id**, not `Owner.id` — the distinction P1's SQL calls out, and the only one `auth.uid()` can be compared against.

The confirmation page's composition root was built with *"no Supabase client, no cipher, no payment repository"* precisely so `mpAccessToken` could not leak into a public render, and B6 must now render a CBU from that same row. Resolved the way B4 resolved it: a projection selecting the three transfer columns plus `mpAccessToken IS NOT NULL AS hasMercadoPago` **in SQL**, returning a type with no field the credential could occupy. An absent dependency protects until someone adds it; a type that cannot carry a value protects afterwards.

A destination missing `transferHolderName` is **not offered** — `data-model.md` §14 requires it whenever a destination exists, because without it the client cannot confirm from their bank's screen that they are paying the right business.

### D8 — `PENDING_APPROVAL` gains one terminal path, and both new transitions take the lock

A booking in `PENDING_APPROVAL` whose `startTime` has passed becomes sweepable. This does not weaken `blocksAvailability`'s reasoning — nothing is sold twice, because the appointment is already over.

It exists because **D2 does not close this hole**: an owner on holiday blocks the calendar exactly as an absent reviewer would. Shipping D2 makes the case rarer, not impossible.

The transfer write and the approval both take the same per-barber advisory lock B4 established, applying `blocksAvailability` — the function, never a SQL copy. `booking-availability` already records the approval as a required caller; this change makes it one and adds the transfer write beside it. B4's warning stands: an advisory lock binds only the code that takes it.

`$executeRaw`, never `$queryRaw` — `pg_advisory_xact_lock` returns `void`, and B4 found that the pg adapter cannot deserialize a void column, which failed **every** booking write while a mocked test asserted the call had been made.

### D9 — The policy's coupling is verified at runtime, not trusted

`scripts/b6-gate.ts` inserts into the bucket **as the `anon` role** with a `bookingId` that does not exist, and requires the rejection. It also asserts that `anon` cannot read, list or delete, and that an owner's signed URL cannot reach another owner's prefix.

This is the mitigation for D1's coupling: the day a rename breaks the predicate, the gate says so rather than an incident. It follows P1's precedent, whose probe F caught that Supabase looks an object up before deleting it — so a missing `select` policy makes every delete a silent no-op that reports success.

## Risks / Trade-offs

- **A `storage` policy depends on Prisma-owned tables, and Prisma never reports it as drift** → D9's gate probe, plus a comment in the SQL naming the columns it reads.
- **A client can block a slot by uploading a blank image** → bounded by `MAX_LIVE_HOLDS_PER_CLIENT`, by the per-booking upload cap, and terminated by D8. Not eliminated: an unreviewed receipt for an appointment three weeks out blocks it for three weeks. Recorded as debt.
- **A receipt image is not evidence and nothing verifies its amount** → D2 renders the expected amount beside the file so the comparison is possible at all. The owner must reconcile against their bank. Recorded as debt rather than implied to be solved.
- **The client transfers after the extended hold lapses** → the destination is withheld before commitment and hidden after lapse, and the warning sits above the CBU rather than after it. The residual case is real and unrecoverable by this system; the copy says so instead of pretending otherwise.
- **A 10 MB multipart body in a 128 MB isolate, concurrent with a Prisma transaction** → refuse on `Content-Length` first, re-check after, and upload before the transaction opens.
- **Worker size against T51's ceiling** → `@supabase/supabase-js` is already a dependency, so the marginal cost should be small, but this is the largest story since B4 and wrangler's figure is a lower bound. Measure before deploying; price Workers Paid into the plan rather than discovering a rejection as B2 did.
- **Bank documents accumulate with no retention rule** → out of scope, recorded as debt alongside T56.
- **HEIC is the iOS camera default and is not accepted** → likely the most frequent rejection in production. The copy names the accepted types explicitly rather than letting the rejection be a surprise.
- **A second query on the confirmation page** → ~0.35–0.40 s per round trip; re-cost T47 with the measurement.

## Migration Plan

1. Correct `data-model.md` §13 and `backend-standards.md` rule 4 **before any code** — `base-standards.md` §7.
2. Prisma migration `b6_transfer_receipt` (enum, table, unique FK, status index). Additive; no existing row is touched, because nothing has ever written this table.
3. Supabase migration for the bucket, the `SECURITY DEFINER` function and the three policies, committed as `storage-policy.sql` beside P1's.
4. Deploy behind no flag: the client-facing offer appears only where a transfer destination is configured, so a shop without one sees no change.
5. **Rollback** — the storage policy and the Prisma migration are independent of the running application. Reverting the deploy removes the offer; the table and bucket can remain, since nothing else reads them.

## Open Questions

- **The 45-minute duration is a judgement, and T53 named this change as the story that could measure it.** No real shop has used the product, so what B6 can deliver is the constant, its home beside the other three in `bookingHorizon.ts`, and enough logging to answer the question later.
- **Whether the receipt should also accept HEIC.** Deferred to the first support complaint rather than guessed at now; the decision is a magic-byte signature, a bucket MIME type and a viewer the owner can open.
