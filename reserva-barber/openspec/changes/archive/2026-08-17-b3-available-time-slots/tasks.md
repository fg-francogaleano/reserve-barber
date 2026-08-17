## 1. Domain: bounds and the pure availability rule

- [x] 1.1 Add `src/server/domain/models/bookingHorizon.ts` with `MAX_BOOKING_HORIZON_DAYS` (60) and `MIN_BOOKING_LEAD_MINUTES` (60), each documented as a judgement to revisit, sibling to `slotGranularity.ts`
- [x] 1.2 Write failing tests for interval algebra in `src/server/domain/models/availability.test.ts`: half-open overlap, subtraction of one interval from another, subtraction that splits an interval in two, unioning overlapping absences, and an empty result
- [x] 1.3 Implement `Interval`, `overlaps` and `subtractAll` in `src/server/domain/models/availability.ts` — pure, no clock, no I/O
- [x] 1.4 Write failing tests for `generateSlots` covering: a free window tiled every 5 minutes; the last start that fits and the first that does not; re-anchoring after a booking; a split shift not selling the break; an appointment refused across two windows; a service longer than every gap; a weekday with no window
- [x] 1.5 Write failing boundary tests for `generateSlots`: appointment ending exactly at a window end, starting exactly at an absence end, ending exactly at an absence start, starting exactly at an absence start
- [x] 1.6 Write failing tests for the blocking predicate: `PENDING_PAYMENT` with a live hold blocks, with an expired hold does not, `PENDING_APPROVAL` blocks regardless of `holdExpiresAt`, `CONFIRMED` blocks, `CANCELLED` and `EXPIRED` do not
- [x] 1.7 Write failing tests for the lead-time filter and for a date outside the horizon producing no computation
- [x] 1.8 Implement `generateSlots` and the blocking predicate against those tests, taking the current instant as a parameter; document the predicate as the one B4's transaction must reuse
- [x] 1.9 Add a test asserting weekday and "today" resolution at 23:00 business local time, when the runtime's calendar has already rolled over
- [x] 1.10 Grep the new domain files for `getDay`, `getHours`, `getDate` and `toISOString` and assert none appear; route every conversion through `businessTime.ts`

## 2. Schema and migration

- [x] 2.1 Cut the branch from an updated `main` before touching Prisma — the database is shared and a stale branch makes `migrate dev` propose a `migrate reset`
- [x] 2.2 Add `BookingStatus` and `CancelledBy` enums and the `Client` and `Booking` models to `prisma/schema.prisma`, with the doc comments this project's models carry
- [x] 2.3 Declare `@db.Timestamptz(3)` on `startTime`, `endTime`, `holdExpiresAt`, `cancelledAt`; `@db.Decimal(12, 2)` on `priceAtBooking` and `depositAmount`; `onDelete: Restrict` on all four foreign keys; `@unique` on `cancellationToken`; `@@unique([ownerId, email])` on `Client`; `@@index([barberId, startTime])` on `Booking`
- [x] 2.4 Add the `bookings` and `clients` back-relations to `Barber`, `Service` and `Owner`
- [x] 2.5 Generate the migration and **read the SQL by hand** against 2.3 — a missing schema annotation is invisible in the Prisma file and explicit in the SQL
- [x] 2.6 Apply the migration and regenerate both Prisma clients (`workerd` and CLI)
- [x] 2.7 Confirm the migration altered no existing table and wrote no row

## 3. Persistence

- [x] 3.1 Add `src/server/domain/repositories/IBookingRepository.ts` with a read-only contract taking `ownerId` as a required parameter, documenting that this change writes nothing
- [x] 3.2 Extend the availability read into one owner-scoped repository method returning windows, absences (through the projection that omits `reason`) and blocking bookings for a barber over a half-open range, in a single round trip
- [x] 3.3 Implement it in `src/server/infrastructure/prisma/`, selecting explicit columns and scoping through `barber.location.ownerId`
- [x] 3.4 Write repository tests: the owner predicate is present, a foreign barber returns nothing, no absence `reason` is selected, a booking straddling the range boundary is returned, and the projection carries no client id, token, price or deposit

## 4. Application layer

- [x] 4.1 Add `PublicAvailabilityService` composing the repository read and the pure generator, with the current instant injected
- [x] 4.2 Extend `bookingSelectionParams.ts` with `fecha` and `hora`: length bounds before parsing, canonical `YYYY-MM-DD` only, a real calendar date inside the horizon, `hora` matched against the generated list and never trusted as a parsed time
- [x] 4.3 Extend the step model to `location | service | barber | date | slot | complete`, and make `bookingStepHref` drop downstream keys so changing the barber cannot emit a URL still naming a date
- [x] 4.4 Extend the discarded-selection cascade so a discarded branch, service or barber drops the date and time with it
- [x] 4.5 Write tests for 4.2–4.4: `2026-8-1` discarded, `2026-02-30` discarded, `2028-02-29` accepted, a past date discarded with upstream preserved, an unavailable `hora` and an absurd `hora` producing identical results, repeated parameters resolving deterministically

## 5. User interface

- [x] 5.1 Add the new Spanish copy under the existing `booking` key, including the four empty states, the discarded-selection notices, the daypart headings and the inert-confirmation disclosure
- [x] 5.2 Build `DateStep.tsx`: a bounded strip from today to the horizon, non-working days rendered unavailable and announced as such, the selected date exposed programmatically, every link through the shared no-prefetch component
- [x] 5.3 Build `SlotStep.tsx`: starts grouped by daypart with headings, rendered as a wrapping grid of time chips formatted server-side in es-AR, every link through the shared no-prefetch component
- [x] 5.4 Implement the four empty states as complete pages returning 200, each with the way back that fits it, none disclosing why a time is unavailable
- [x] 5.5 Update `BookingStepIndicator` and `BookingSelectionSummary` to compute the step count so B2's single-branch skip still yields a correct indicator
- [x] 5.6 Build the completed-selection view with a non-actionable call to action and its Spanish disclosure
- [x] 5.7 Write component tests: no unavailable time is rendered in any form, the copy makes no promise that a time is held, and the indicator reports five steps with a branch choice and four without

## 6. Route integration

- [x] 6.1 Wire the new steps into `app/b/[slug]/reservar/page.tsx`, keeping resolution order: slug first, then selection, then availability only on the steps that need it
- [x] 6.2 Assert `hasTimezoneSupport()` at the composition root and fail closed when it does not hold
- [x] 6.3 Confirm the composition root still constructs no Supabase client, no credential cipher and no `PaymentConfig` repository
- [x] 6.4 Make every availability failure render the client-toned Spanish error state with retry, never an optimistic list and never the dashboard boundary
- [x] 6.5 Confirm no `loading.tsx` and no Suspense boundary exists above the slug resolution, and that `useSearchParams` is not read in a Client Component above it
- [x] 6.6 Write route tests: the earlier steps issue no availability read, the date and slot steps issue exactly one more read, a failed bookings read renders the error state, and no response carries a stack trace, SQL, table name or English technical text

## 7. Verification against the live database

- [x] 7.1 Write `scripts/b3-gate.ts` following the existing gate pattern: seed a barber, a schedule, an absence and bookings in blocking and non-blocking states including an expired hold; assert which affect the offered times; clean up everything it created
- [x] 7.2 Run an instant round trip through the new columns and confirm no drift
- [x] 7.3 Drive the flow in the browser on the deployment runtime: date step, slot step, an empty day, a stale link carrying a past date, and a taken `hora`
- [x] 7.4 Run 7.3 once between 21:00 and 23:59 business local time, the window in which a UTC-based date calculation is wrong
- [x] 7.5 Check the slot step at 360 pixels with a minimum-duration service across a nine-hour window — the dense case, not a comfortable one
- [x] 7.6 Measure query count and response time for both new steps and record them in T47's table
- [x] 7.7 Measure the Worker bundle against the 3 MiB ceiling before deploying, and treat `--dry-run` as unable to prove a fit

## 8. Documentation and close-out

- [x] 8.1 Update `docs/tech-debt.md`: T27 (the generator no longer creates the defect; the editor still does), T28 (a third consumer of the 1440-minute assumption), T29 (retroactive schedule edits can now strand real bookings), T33 (its named trigger has arrived), T47 (re-cost with 7.6's numbers), T51 (headroom after two new models)
- [x] 8.2 Open a debt entry for the D8 gap — a day with a window but no availability renders selectable and then empty — so nobody later "fixes" it into sixty availability computations
- [x] 8.3 Run `npm run lint`, `npm run typecheck` and `npm test` clean
- [x] 8.4 Write the `docs/roadmap.md` B3 entry in the archive style the other entries use, naming the two owner decisions and their accepted costs
