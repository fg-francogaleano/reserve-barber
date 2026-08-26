## 1. Source-of-truth documents first (`base-standards.md` §7)

- [x] 1.1 `docs/data-model.md` §11: record that `cancelledAt`/`cancelledBy` gain their first writers, that `OWNER` covers both owner cancellation and receipt rejection, that a cancellation clears `holdExpiresAt` (unlike an expiry, which preserves it), and that historical rows keep their nulls with no backfill.
- [x] 1.2 `docs/backend-standards.md` Booking rule 4: record that rejection is no longer the only writer of `CANCELLED`, and that the rules it holds — conditional update, no advisory lock because a release cannot double-book, `APPROVED` payment untouched — are shared rather than particular to it.
- [x] 1.3 `docs/backend-standards.md`: add the rule that **every writer of a terminal status writes the columns that describe it**, with this defect as the worked example — the status alone was written for three stories and made a dashboard counter structurally unable to count.

## 2. The domain predicate

- [x] 2.1 Write failing tests for `isCancellableByOwner`: true for `CONFIRMED`, `PENDING_PAYMENT`, `PENDING_APPROVAL`; false for `CANCELLED` and `EXPIRED`; a past `startTime` does not change the answer.
- [x] 2.2 Implement it in `src/server/domain/models/Booking.ts` beside `blocksAvailability`, documenting that three callers consult it and why three copies of a status list is three chances for a control to appear where the write refuses.

## 3. The repository (TDD)

- [x] 3.1 Write failing tests for `cancelByOwner`: the booking update is conditional on the admitted statuses; it sets status, `cancelledAt`, `cancelledBy` and clears `holdExpiresAt`; it touches no snapshot, no token and no foreign key.
- [x] 3.2 Write failing tests for the payment rule: a `PENDING` payment is refused; the update is **conditional on `PENDING`** so an `APPROVED` one matches zero rows; nothing rewrites an approval instant.
- [x] 3.3 Write failing tests for the receipt rule: **revised — the receipt is left untouched entirely** (design D6, reversed during implementation), so the assertion is that no receipt write is issued at all.
- [x] 3.4 Write failing tests for scoping and idempotency: a booking outside the owner's scope and one that does not exist answer identically; a second cancellation matches zero rows and reports the status it found.
- [x] 3.5 Write a failing test asserting **no advisory lock is taken** — the transaction stub exposes no `$executeRaw`, so taking one fails as "not a function". (B4's lesson: a mock that merely records the call certifies the wrong one.)
- [x] 3.6 Implement `cancelByOwner` on `PrismaBookingRepository`, in one transaction, with each write conditional on the status it expects.

## 4. B6's rejection starts recording who cancelled

- [x] 4.1 Write a failing test asserting `PrismaTransferReceiptRepository.reject` writes `cancelledAt` and `cancelledBy: 'OWNER'` alongside the status.
- [x] 4.2 Add the two fields to that update. **One line, and it is required by this story rather than adjacent to it**: without it every booking B6 ever rejected falls through the new page state, and the dashboard counter stays at zero.
- [x] 4.3 Extend the D1 counter tests to cover a cancellation produced by a real path rather than a hand-seeded `cancelledAt` — the shape that hid this defect.

## 5. The application service (TDD)

- [x] 5.1 Write failing tests for `BookingCancellationService`: an applied cancellation reports `applied` and carries the booking id; a guarded miss reports the status it found; a scope miss reports `notFound` and is logged at `info`, not as an error.
- [x] 5.2 Write failing tests for the observability contract: no log line carries the client's name, email, phone or the cancellation token.
- [x] 5.3 Implement `src/server/application/services/BookingCancellationService.ts`.

## 6. The client's page (TDD)

- [x] 6.1 Write failing tests for `resolvePaymentPageState`: a booking cancelled by the owner renders `cancelledByShop`; it outranks `holdLapsed` and `paidSlotLost`; a null canceller renders the generic cancelled form; a `CONFIRMED` booking still outranks everything. **Revised twice**: first from "outranks `receiptRejected`" (design D1/D6), then again when the runtime showed that state is unreachable from the projection altogether (T73).
- [x] 6.2 Add `cancelledBy` to `BookingByToken` and to the repository projection; assert the projection gains nothing else.
- [x] 6.3 Add the copy: the shop cancelled, the time was released, and — where the deposit was approved — that it is not returned by this system. es-AR, in `copy.ts`.
- [x] 6.4 Write failing page tests: the cancelled state renders, no payment or receipt control survives it, and the page still renders no client email or phone.
- [x] 6.5 Implement the state and its precedence.

## 7. The owner's surface (TDD)

- [x] 7.1 Write failing tests for the server action: it re-checks the session, resolves within the owner's scope, revalidates the dashboard, and reports a guarded miss as a plain message rather than a failure.
- [x] 7.2 Write a failing test asserting the success message **does not claim the client was notified** — the rule N1 established, asserted over the copy string as well as over one call.
- [x] 7.3 Implement the action and the row control, with a pending state on the submit and the control **absent** on terminal rows.
- [x] 7.4 Write the confirmation copy: the slot is released immediately and may be taken, the action cannot be undone, and any deposit paid is not returned by this system.

## 8. The cancellation notice (TDD)

> Decided in design D5 rather than by Franco. To drop it, delete this group, the notification service from the composition root, and the one call site — nothing else changes.

- [x] 8.1 Write failing tests for `buildBookingCancellationEmail`: the appointment renders business-local; where the deposit was approved it states the money is not returned here; it offers no way to pay; guest-supplied values are escaped and never reach a header.
- [x] 8.2 Write failing tests for the trigger: the notice is requested **only** when the cancellation applied, never on a guarded miss or a scope miss.
- [x] 8.3 Write a failing test asserting a provider failure leaves the booking `CANCELLED`, the slot released, and the owner's action successful.
- [x] 8.4 Implement the builder and the call site, reusing `IEmailSender` and its non-fatal contract. **No `sentAt` column and none proposed** — design D5 records why.

## 9. The live gate

- [x] 9.1 Write `scripts/c2-gate.ts` following the `n1-gate.ts` shape: `__c2_gate__` prefix, cleanup in foreign-key order, and a header stating what only the live database can prove.
- [x] 9.2 Probes for the guard: a booking whose status changed between read and write matches zero rows; a second cancellation changes nothing.
- [x] 9.3 Probes for the money and the receipt: an `APPROVED` payment survives with its approval instant intact; a `PENDING` payment is refused; and — **revised from the original plan, see design D6** — a `PENDING` receipt is left `PENDING`, because that is the honest record of a document nobody reviewed.
- [x] 9.4 Probes for the columns: `cancelledAt` and `cancelledBy` actually land, and a whole-row before/after comparison shows nothing else moved but the ORM's `updatedAt`.
- [x] 9.5 Probe for cross-owner isolation with a **two-owner fixture** — the join is the tenancy boundary and nothing in the type system holds it.
- [x] 9.6 Probe that the rejection path also records its canceller now.
- [x] 9.7 Run it against the live database until it passes, and record the run.

## 10. Runtime verification — Claude runs these

> The N1 split, confirmed again here: **Claude drives both runtimes, the gates and any migration**; Franco keeps the production deploy, external accounts and DNS. 10.5 waits on his go-ahead.

- [x] 10.1 `npm run dev`: cancel a booking from the dashboard, confirm the slot reappears in a fresh availability read, and confirm the client's page names the shop rather than saying the booking expired.
- [x] 10.2 Same run: cancel a `PENDING_APPROVAL` booking and confirm the receipt leaves the queue **and** the client's page names the cancellation rather than the comprobante — the precedence rule, observed rather than asserted.
- [x] 10.3 Confirm "Cancelaciones de hoy" moves, which it has never done.
- [x] 10.4 Repeat the page checks on `wrangler dev`, since the states are server-rendered and B5's lesson is that a runtime can differ.
- [x] 10.5 Deploy and re-check the public page. **No longer size-blocked** — T51 closed with N1 at ~30% of the paid ceiling.

## 10c. Verification-pass fixes (found before archive)

- [x] 10c.1 Render the deposit note on the cancelled state when a payment is `APPROVED`. The copy existed and nothing rendered it, so the page — the surface a client is most likely to be looking at — stayed silent about the only thing that costs them anything, while the owner's confirmation and the email both said it. Seven page tests, including that a pending or absent payment says nothing about money, and that the note is independent of whether the canceller was recorded.
- [x] 10c.2 Write `bookingCancellationService.test.ts` over the root's source. The root asserted in its own doc comment that its arguments were "asserted by a test over this file's source" and **no such test existed** — the same class of false claim the N1 review had flagged one story earlier. Eight assertions: four collaborators by name, one shared repository instance, no cipher, no storage, no direct read of the confirmation projection, and the provider key reached only through the feature factory.

## 11. Debt and closeout

- [x] 11.1 `docs/tech-debt.md` **T72**: re-cost. Half of it closes here — a cancellation now notifies — and the other half (a client whose payment was approved after their slot was lost) is untouched. Do not leave it claiming nothing notifies anybody.
- [x] 11.2 `docs/tech-debt.md` **T65**: note that cancelled bookings' receipt files now accumulate in the bucket by a second route.
- [x] 11.3 Open a debt entry for **no refund path and no refund record**: this story makes it routine for an owner to cancel a paid, confirmed appointment, and the product neither returns the money nor records that it is owed.
- [x] 11.4 **Obsolete as written** — design D6 was reversed, so no semantic stretch exists: the receipt is left `PENDING`. What replaced it is **T73** (the rejected-receipt page state is unreachable, found in runtime verification) plus the T65 re-cost above, which names a receipt with no terminal status as a third route into the retention pile.
- [x] 11.5 Record the D1 counter defect in the changelog for D1 as well as here, so the story that shipped it carries its own correction.
- [x] 11.6 Tick C2 in `docs/roadmap.md` with the notes this change earned, and note what it unblocks for C1 (the cancelled state, the copy and `cancelledBy` are already built).
- [x] 11.7 Full check before archive: `npm run typecheck`, `npm run lint`, `npm test`, coverage ≥ 90% on domain and application layers, `openspec validate c2-owner-booking-cancellation`.
