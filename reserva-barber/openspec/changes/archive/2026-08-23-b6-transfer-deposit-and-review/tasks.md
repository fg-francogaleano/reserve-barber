# Tasks — B6 + D2

TDD throughout: each implementation task starts from a failing test. One task at a time, verified before the next.

## 1. Documents before code

`base-standards.md` §7 — the spec is the source of truth and is corrected before any code.

- [x] 1.1 `data-model.md` §13: rename `fileUrl` → `filePath` holding the object key, with the reason (a private bucket has no resolvable URL and a signed one expires)
- [x] 1.2 `data-model.md` §13: `uploadedAt` and `reviewedAt` become `Timestamptz(3)`
- [x] 1.3 `data-model.md` §13: accepted types add `application/pdf`; SVG stays excluded; state that no filename is stored
- [x] 1.4 `data-model.md` §13: write the key composition rule, naming the Supabase auth user id (not `Owner.id`) as the leading segment
- [x] 1.5 `data-model.md` §13: write the replacement rule (update while `PENDING`, cap 3) and the review transitions
- [x] 1.6 `data-model.md` §11: `PENDING_APPROVAL` blocks while the appointment is in the future and becomes sweepable once `startTime` has passed
- [x] 1.7 `data-model.md` §11: the hold duration is no longer one constant — record `TRANSFER_HOLD_DURATION_MINUTES` and that every writer applies the same clamp
- [x] 1.8 `data-model.md` §12: the one-live-payment index bounds methods as well as attempts — record the `mpInitPoint` rule
- [x] 1.9 `backend-standards.md` rule 4: expand the transfer approval rule with the lock, the conditional update and the terminal path
- [x] 1.10 `backend-standards.md` security section: file uploads from an **anonymous** writer, and what authorizes them

## 2. Schema and migration

- [x] 2.1 `prisma/schema.prisma`: `ReceiptStatus` enum and `TransferReceipt` model — unique `paymentId` with `Restrict`, `Timestamptz(3)` timestamps, `@@index([status, uploadedAt])`
- [x] 2.2 Generate migration `b6_transfer_receipt` and read the SQL before applying — `20260822120000_b6_transfer_receipt`, additive only (one enum, one table, one unique index, one composite index, one `Restrict` foreign key)
- [x] 2.4 Generated client compiles; `migrate diff` against the live datasource shows `TransferReceipt` as the only difference, confirming the branch is not stale

## 3. Storage infrastructure

- [x] 3.1 Write `openspec/changes/b6-transfer-deposit-and-review/storage-policy.sql`: private bucket, size limit, MIME types, modelled on P1's file including its comment discipline
- [x] 3.2 Add the `SECURITY DEFINER` predicate `storage_can_accept_receipt(path)` with a pinned `search_path`, resolving path → booking → owner `authUserId`, requiring a live hold
- [x] 3.3 Add the three policies: `anon` insert through the predicate; `authenticated` select and delete confined to `auth.uid()`. Comment why the select policy is required for delete to work at all
- [x] 3.4 Comment the application columns the predicate reads, since Prisma never reports this file as drift

## 4. Domain layer

- [x] 4.1 `receiptFileType.ts` + test: leading-byte detection for JPEG, PNG and `%PDF-`; `MAX_RECEIPT_BYTES`; `extensionFor`. SVG absent by design
- [x] 4.2 `TransferReceipt.ts` + test: `ReceiptStatus`, `MAX_RECEIPT_UPLOADS_PER_BOOKING`, key composition from server-held values only
- [x] 4.3 `bookingHorizon.ts`: add `TRANSFER_HOLD_DURATION_MINUTES = 45` with the same honest disclosure the other three carry
- [x] 4.4 `Booking.ts` + test: extract the clamp so creation and extension call one function; add the extension helper
- [x] 4.5 `Booking.ts` + test: `PENDING_APPROVAL` past `startTime` becomes sweepable, without changing what it does while the appointment is ahead
- [x] 4.6 `IReceiptStorage.ts` and `ReceiptContentType` — a separate contract, not a widened `IImageStorage`
- [x] 4.7 `ITransferReceiptRepository.ts` with the outcome unions (created / replaced / capped / notPending / slotLost)

## 5. Persistence

- [x] 5.1 `PrismaPaymentRepository`: `createPendingBankTransfer`, translating the live-payment index violation **qualified on the constraint name** (T15)
- [x] 5.2 `PrismaPaymentRepository`: the `mpInitPoint` switching rule — block when a checkout exists, reject in-transaction when it does not
- [x] 5.3 `PrismaPaymentRepository`: the hold extension, applying the shared clamp
- [x] 5.4 `PrismaTransferReceiptRepository`: the accepting transaction — advisory lock via `$executeRaw`, `blocksAvailability` re-check, receipt insert, conditional booking update
- [x] 5.5 `PrismaTransferReceiptRepository`: replacement while `PENDING`, and the per-booking cap read
- [x] 5.6 `PrismaTransferReceiptRepository`: the owner's queue read, scoped by owner, oldest first, carrying the snapshotted amount
- [x] 5.7 `PrismaTransferReceiptRepository`: approve and reject transactions, both conditional, approval under the lock
- [x] 5.8 The public transfer projection — **already built by B4**. `findPaymentReadinessForPublic` derives `mpAccessToken IS NOT NULL` in SQL and already carries the three transfer columns, so B6 reuses it rather than adding a second projection. What was missing is the offerability rule: `isTransferOfferableToClient` (holder name required), added as a **separate** predicate so `isBookable` keeps the meaning B4 depends on.
- [x] 5.9 Tests for 5.1–5.8 — and no test that asserts a call on a mock where the real driver behaves differently (T58)

## 6. Storage adapter

- [x] 6.1 `anonClient.ts`: a sessionless server-only Supabase client, with a comment forbidding its use for anything the owner's session should authorize
- [x] 6.2 `SupabaseReceiptStorage` + test: upload with `upsert: false` and payload-error handling. **No delete** — see the design revision: the anonymous uploader must never hold a delete grant, so a superseded object is a bounded orphan.
- [x] 6.3 Signed-URL creation for the owner's read, short-lived and forced to download

## 7. The public write

- [x] 7.1 `routeGuard.ts`: `PUBLIC_TRANSFER_API` as an **exact** entry, with negative cases asserted for sibling paths
- [x] 7.2 `bookingOutcome.ts`: the new payment outcome codes and their parse
- [x] 7.3 `app/api/payments/transfer/route.ts`: the commitment intent — throttle, token in body, `303`
- [x] 7.4 Same route: the multipart intent — `Content-Length` refusal before reading, byte re-check after, magic-byte detection, upload before transaction
- [x] 7.5 `transferPaymentService.ts`: compose the two intents over the repositories; no user-facing string here
- [x] 7.6 Route tests: unknown/foreign/cancelled tokens answered identically; each refusal cause distinct; no contact detail or destination in any log

## 8. The confirmation page

- [x] 8.1 The `PaymentConfig` projection — **not in the composition root, and the plan was wrong to put it there.** A `PaymentConfig` read is keyed by `ownerId`, and B2 established that the owner id never reaches a page; composing a second repository here would have meant carrying one on the projection. It lives inside `PrismaBookingRepository.findByCancellationToken` instead: the three plaintext transfer columns joined in the same query, `mpAccessToken IS NOT NULL` derived by a parallel raw statement, and the destination nulled unless a transfer is committed. The composition root's doc comment is rewritten rather than left standing, since its claim that "no live payment configuration is consulted" stopped being true.
- [x] 8.2 `paymentPageState.ts` + test: the new states, the method dimension, and the precedence table — receipt-under-review above lapsed hold and above any code
- [x] 8.3 `offersPayment` splits into per-method predicates; a shop with no usable method renders the unavailable state
- [x] 8.4 `TransferDestination.tsx` + test: warning above the CBU, amount from the snapshot, selectable text, `break-words` at 360 px
- [x] 8.5 `ReceiptUploadForm.tsx` + test: native multipart form, works with JavaScript disabled, control absent rather than disabled in terminal states
- [x] 8.6 `page.tsx`: render the new states; destination withheld before commitment and after lapse
- [x] 8.7 `copy.ts`: every new string, Spanish (es-AR), including each distinguishable refusal cause

## 9. The owner's review (D2)

- [x] 9.1 `app/(dashboard)/comprobantes/page.tsx` + test: the queue, owner-scoped, oldest first, with the expected amount beside each entry
- [x] 9.2 Designed empty state
- [x] 9.3 `actions.ts` + test: approve and reject as Server Actions, owner-scoped, foreign and unknown ids answered identically
- [x] 9.4 Explicit confirmation before rejection, stating that the slot is released and that money is not returned by this system
- [x] 9.5 The signed link rendered at request time, short-lived, forced to download
- [x] 9.6 `loading.tsx`, following the dashboard pattern. **No `not-found.tsx`** — the route has no dynamic segment, so nothing in the path can fail to resolve; the file would be dead.
- [x] 9.7 Navigation entry, and copy in `copy.ts`
- [x] 9.8 Assert no text claims the transfer was verified by the system

## 10. Cross-cutting checks

- [x] 10.1 No user-facing Spanish string outside `copy.ts`
- [x] 10.2 No log carries a client name, email, phone, filename, CBU, alias or holder name
- [x] 10.3 No new `any`; every module boundary explicitly typed
- [x] 10.4 `lint`, `typecheck`, full `test` green; 90 % coverage on domain + application
- [x] 10.5 Review every new unique-violation handler for constraint qualification (T15)

## 11. Runtime verification

`scripts/b6-gate.ts` is **written** and covers 11.0–11.9 and 11.11. Franco runs it and the preview. It needs `scripts/.gate-credentials.json` (git-ignored, the path `p1-gate.ts` uses) or `OWNER_EMAIL` / `OWNER_PASSWORD` inline — never `.env`, which the application loads. It requires 2.3 and 3.5 to have been applied first.

- [x] 11.0 Gate: the table, its zone-aware instants, the `SECURITY DEFINER` predicate with a pinned `search_path`, and the bucket's privacy and size limit — written
- [x] 11.1 Gate: anon insert with a non-existent booking id → refused; **and** a legitimate one → admitted. Both, because a predicate that refuses *everything* would pass the negative probe alone and the story would be dead on arrival — written
- [x] 11.2 Gate: anon insert at another owner's prefix → refused; anon read, list, delete → all refused; owner signs their own prefix and not another's — written
- [x] 11.3 Gate: real JPEG and PNG bytes reach the bucket, proving the MIME allowlist agrees with the application's list — written
- [x] 11.4 Gate: a PDF declared as JPEG and a JPEG declared as PDF, both classified by bytes — written
- [x] 11.5 Gate: the bucket refuses a type outside its allowlist and a file past the ceiling. **The lying `Content-Length` is not here**: it is a property of the HTTP handler, unreachable from a Node script, and is covered by `route.test.ts` plus 11.10 — written
- [x] 11.6 Gate: the hold extension applied, not re-applied on a repeat tap, and clamped at `startTime` — written
- [x] 11.7 Gate: a replacement updates the same row, **leaves its predecessor in place** (the design revision — the anonymous uploader holds no delete grant), and the cap refuses the fourth submission — written
- [x] 11.8 Gate: `PENDING_APPROVAL` still blocks while the appointment is ahead, and stops once `startTime` has passed — written
- [x] 11.9 Gate: approval confirms and clears the deadline, rejection cancels and releases, a second decision changes nothing, and an unresolvable receipt answers `notFound` — written
- [x] 2.3 **Franco:** migration applied. Confirmed by 11.0a/11.0b: `TransferReceipt` carries all seven columns and both instants are `timestamp with time zone`.
- [x] 3.5 Storage migration applied as `b6_transfer_receipts_bucket_and_policies`. Verified before the gate ran: bucket private at 10485760 with the three MIME types, function `SECURITY DEFINER` with `search_path=public, pg_catalog`, three policies (`insert→anon`, `select→authenticated`, `delete→authenticated`), no `update` policy — and the predicate confirmed callable **as the `anon` role**, which was the open risk (a definer function whose owner lacks privileges on the Prisma tables creates fine and fails at call time).
- [x] 11.a Gate run. **Run 3: GATE PASSED**, 37 probes.
  - **Run 1 — infrastructure absent.** The Prisma migration had landed; the storage migration had not. It also exposed **two defects in the gate itself**. Six negative storage probes reported PASS against a missing bucket, because each asserts "the write was refused" and a missing bucket refuses everything — the T60 failure shape, in the script written to catch it. Fixed with `refusedByPolicy()`, a `skip()` reporter that counts as a failure, and a `storageReady` guard. Separately, every gate booking shared one start time on one barber, so the second overlapped the first and `attachReceipt` correctly answered `slotLost` — the product was right and the fixture was wrong. The `throw` that followed cost more than the fault: it aborted the script, so the approval probes never ran and nothing said they had been skipped.
  - **Run 2 — 36 of 37 probes passed.** The predicate confines an anonymous write (no such booking, foreign prefix, and a `CANCELLED` booking all refused with `new row violates row-level security policy`) **and admits a legitimate one**. `anon` cannot read, list or delete. The owner signs their own prefix and not another's. The bucket refuses `image/svg+xml` and an oversized file. The hold extends by exactly 30 minutes and clamps to `startTime` at the millisecond. The receipt write, the replacement, the cap, the rejection and the approval all ran under the real driver — **which is what proves B4's advisory lock executes on the new paths**.
  - **The one failure was a third gate defect, and the finding is worth keeping.** `11.2b` reported `Object not found` for an anonymous read, and `refusedByPolicy` counted any "not found" as infrastructure being absent. It is not: row-level security makes the row invisible, so the lookup finds nothing and Storage answers `404`. That is the **better** of the two possible answers — a `403` would confirm to a stranger that a given receipt exists. The helper now excludes only "bucket not found".
- [x] 11.10 Driven on the preview against the live database (2026-08-23). The database record shows the whole cycle: a booking committed to transfer and never uploaded (`PENDING_PAYMENT`), one with a receipt awaiting review (`PENDING_APPROVAL`), one **approved** (`CONFIRMED` + payment `APPROVED` + receipt `APPROVED`), one **rejected** (`CANCELLED`, payment `REJECTED`, slot released), and a Mercado Pago booking still confirming normally — so B6 did not disturb B5. Confirmed by hand: both controls render, **no CBU appears until transfer is chosen**, and the destination appears immediately after. The transfer-only shop was **not** exercised — it would mean deleting the Mercado Pago credentials, which are write-only and cannot be restored without re-entering the token; both sides are covered by unit tests.
- [x] 11.11 Gate: measures the confirmation page's composed read — written; the number is recorded when Franco runs it

## 12. Verification record

- [x] 12.1 Worker measured at **2924.08 KiB gzip**, ~148 KiB under the 3072 ceiling. **T51** re-costed: B5 never measured, so the +177.56 KiB over B4's figure covers both stories and is recorded as unsplittable rather than guessed. B4's prediction of "two more stories of room" has come true as **less than one**, and the entry now recommends taking Workers Paid **before N1** instead of discovering the ceiling as a failed deploy, the way B2 did.
- [x] 12.2 **T47** re-costed: a fourth public endpoint, and the first with **bandwidth** in the amplification rather than only database round trips. The gate's 1018 ms is recorded as an **upper bound and explicitly not the page's cost** — the script builds its adapter with `maxUses: 1`, so every query pays a fresh connection. The entry says it is still owed a preview measurement rather than adopting a number that overstates it.
- [x] 12.3 **T53** re-costed, and it states plainly that **B6 could not do what that entry asked of it**: the trigger named B6 as the story that could measure the hold duration, and it cannot — no real shop has used the product, so there was nothing to measure, and reporting a number would have repeated T45's failure. **T55** re-costed: a third throttled endpoint, the most expensive one, with `uploadCount` named as the bound that actually holds.
- [x] 12.4 **T63** — the storage policy depends on eight Prisma-owned columns that `migrate diff` is silent about; mitigated by the gate probing both directions, not removed
- [x] 12.5 **T64** — an unreviewed receipt blocks its slot until the appointment passes; D2 makes it rarer, not impossible
- [x] 12.6 **T65** — no retention rule, and two sources: every reviewed receipt, plus the bounded orphans a replacement leaves behind. Same family as T56
- [x] 12.7 **T66** — nothing verifies a transfer or its amount; inherent to the method, disclosed in the UI and enforced by two tests over the vocabulary
- [x] 12.8 `roadmap.md`: B6 and D2 rewritten with what the change carried, plus the four lines that referenced them — D1's counters (all three prerequisites have shipped), N1's dependency (with the T51 warning to check the ceiling before adding Resend), D5's income rule (**join through the booking status, never count approved payments** — both B5 and B6 produce an `APPROVED` payment whose booking is not `CONFIRMED`), and the B4 concurrency note (B7's sweeper is the one advisory-lock caller still outstanding).
- [x] 12.9 109 spec scenarios across seven capabilities, against **2644 passing tests** in 154 files — 11 of them new here — plus 37 gate probes against the live database and the real bucket. Coverage on domain + application is 97.4 % statements / 95.0 % branch, over a 90 % threshold the run enforces. The scenarios that no unit test can reach by construction (the `SECURITY DEFINER` predicate, the advisory lock under the real driver, the bucket's MIME and size limits) are the ones the gate covers, which is why it exists.
- [x] 12.10 Preview measurement recorded in T47: the page reads **~1.22 s** against a **~1.18 s** control on `/b/{slug}`, a route B6 never touched. The 38 ms gap sits inside both samples spread, so the parallel statement costs less than this measurement can resolve — and, decisively, does **not** add a second connection setup in series. The control also matched B2 August figure to within 10 ms, which is what made the comparison meaningful rather than a reading of the day.
