> Tests first, in every group. A task that writes production code before the test that fails without
> it has skipped its own verification step.

## 1. Domain: who may cancel

- [x] 1.1 Write failing tests for `isCancellableByClient` over every status × (future / already started / starting exactly now) × (hold live / lapsed / null), including the paid-slot-lost shape and the `PENDING_APPROVAL` exclusion
- [x] 1.2 Implement `isCancellableByClient` in `src/server/domain/models/Booking.ts`, built on `blocksAvailability` plus the two bounds, with the asymmetry against `isCancellableByOwner` recorded in its doc comment
- [x] 1.3 Assert by test that the predicate is the single definition — the page, the service and the repository's rejection all reach the same function

## 2. The page's state table

- [x] 2.1 Write failing tests for `cancelledByClient`: `CLIENT` resolves to it, `OWNER` and `null` are unchanged, and precedence against the receipt states, `paidSlotLost` and `holdLapsed` still holds
- [x] 2.2 Add `cancelledByClient` to `PaymentPageState` and to the resolver's cancelled branch
- [x] 2.3 Extend the page's `isCancelled` predicate to its third member and confirm every caller follows

## 3. Outcome codes and the self-refresh

- [x] 3.1 Write failing tests for the two refusal codes (`turno-empezado`, `cancelacion-no-posible`) and for the absence of any success code
- [x] 3.2 Add both codes to the confirmation page's outcome union and correct the union's doc comment to say what it actually holds
- [x] 3.3 Write a failing test proving the refresh URL drops a parameter this page does not own
- [x] 3.4 Rebuild `resolveConfirmationRefresh`'s URL from an allowlist (`estado`, `intento`) instead of from every routed parameter
- [x] 3.5 Write a failing test proving no refresh is emitted while the cancellation confirmation renders, then suppress it

## 4. The confirmation step

- [x] 4.1 Write failing tests for the strict parse of the confirmation parameter: absent, expected value, `'0'`, `'true'`, empty, repeated as an array, oversized
- [x] 4.2 Implement the parser, passing the raw framework value through so the array case is decided where the rule lives
- [x] 4.3 Write failing tests that the panel renders only when `isCancellableByClient` is true
- [x] 4.4 Render the panel: the appointment, the released slot, the finality, the deposit sentence guarded on an approved payment, the open-checkout warning guarded on a live attempt, and a plain way back

## 5. Persistence

- [x] 5.1 Add `cancelByToken` and its result type to `IBookingRepository`, documenting the guards, the absent lock and the returned slug
- [x] 5.2 Fix `cancelByOwner`'s stale doc comment, which still claims a `PENDING` receipt becomes `REJECTED` with a `reviewedAt`
- [x] 5.3 Write failing repository tests: the guarded update matching zero rows on a concurrent transition, an `APPROVED` payment untouched, a `PENDING` payment reaching `REJECTED`, no receipt written, `cancelledBy` landing as `CLIENT`
- [x] 5.4 Implement `cancelByToken` in `PrismaBookingRepository`, reusing the transaction-slice type that makes "this takes no lock" a compile-time guarantee
- [x] 5.5 Write a failing test for the cancel-then-notify ordering, proving the payment ends `APPROVED` and the booking stays `CANCELLED`, and the reverse ordering too
- [x] 5.6 Confirm by test that no migration is added and the Prisma schema is unchanged

## 6. The service

- [x] 6.1 Write failing tests for `ClientBookingCancellationService`: each outcome maps to the right result and the right log line, and no log line can carry a token, name, email or telephone
- [x] 6.2 Implement the service, with the eligibility answer coming from the shared predicate and never from a status list of its own
- [x] 6.3 Write a failing test pinning the log cardinality for tokens that resolve nothing, then satisfy it

## 7. The endpoint

- [x] 7.1 Write failing guard tests: the new path is admitted anonymously by exact equality, and a neighbouring unlisted path beneath the same segment is still protected
- [x] 7.2 Add the exact path constant to `routeGuard.ts` and its public set
- [x] 7.3 Write failing route tests: `303` on success with no code, `303` with each refusal code, `404` for an unknown token, `429` when throttled, `400` for a malformed body, and no rethrow into a route error boundary
- [x] 7.4 Implement `app/api/bookings/cancel/route.ts`, reading the token from the body, reusing `BookingThrottle`, and redirecting with the slug the service returned
- [x] 7.5 Write the composition root beside the route with no optional constructor arguments, and a test asserting that claim against the file's own source

## 8. The page and its copy

- [x] 8.1 Write failing tests that the cancel control is absent in every ineligible state and present in the eligible ones
- [x] 8.2 Write failing tests for the refusal notice: suppressed whenever the resolved state is a cancelled one, distinct wording for a started appointment, and `aria-live` on the notice
- [x] 8.3 Render the control, the panel and the notice on `app/b/[slug]/reserva/[token]/page.tsx`
- [x] 8.4 Add the client-cancelled heading and intro, worded as a receipt of the client's own action rather than as an apology
- [x] 8.5 Add the sentence the `PENDING_APPROVAL` state needs, telling the client to contact the shop
- [x] 8.6 Add every new string to `src/lib/copy.ts` and assert by test that none is written inline

## 9. The owner's only channel

- [x] 9.1 Write a failing test that a cancelled row names its canceller and that a null canceller names nobody
- [x] 9.2 Add `cancelledBy` to `RecentBooking`, to its repository projection and to the row, and assert the projection grew by exactly one field

## 10. The confirmation email

- [x] 10.1 Write a failing test that the link's description names cancelling, and that no URL in the message performs one
- [x] 10.2 Update the link copy, leaving the no-origin fallback unchanged

## 11. Verification

- [x] 11.1 Run the whole suite and `tsc`; fix anything the type checker finds that the mocks certified
- [x] 11.2 Write `scripts/c1-gate.ts` covering: a forged token, the zero-row guard, an approved payment compared whole-row before and after, `cancelledBy` reached through a real path, the released slot in a real availability read, a started appointment refused, a `PENDING_APPROVAL` booking refused, a repeated submission, and the anonymous log cardinality
- [x] 11.3 Run the gate against the live database and record what it refutes as well as what it confirms
- [x] 11.4 Drive the flow over HTTP on Node and on `workerd`: both steps, the cancelled state, the released slot, and zero occurrences of "venció" on any cancelled page
- [x] 11.5 Drive the negative paths by hand: a `GET` of every URL on the page changing nothing, a double submission, and a hand-edited confirmation parameter
- [x] 11.6 Measure the gzip bundle size and record it against C2's 3073.75 KiB

## 12. Documentation and close-out

- [x] 12.1 Update `docs/tech-debt.md`: re-cost T69 (mitigated, not closed) and T74 (one more door), and open the new entries — the owner learning only by looking, the absent minimum-notice policy, and the open checkout plus its transfer variant
- [x] 12.2 Update `docs/data-model.md` where it records that `CLIENT` has no writer
- [x] 12.3 Update `docs/roadmap.md`: check C1 and write its close-out record, including anything the gate refuted
- [x] 12.4 Run an adversarial pass over the finished diff before archive, looking first for claims the code contradicts
- [x] 12.5 Deployed to production (version `2644547f`) and smoke-tested end to end, fixture removed
