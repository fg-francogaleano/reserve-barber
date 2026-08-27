## 1. Pure rules — tests first, no I/O

- [x] 1.1 Write failing tests for `calendarPresence` in `src/server/domain/models/Booking.test.ts`: all five statuses; a booking awaiting approval whose appointment started **yesterday** still `awaitingApproval`; the hold boundary evaluated exactly at `holdExpiresAt` resolving to `lapsed` (half-open); a null `holdExpiresAt` on a holding booking.
- [x] 1.2 Implement `CalendarPresence` and `calendarPresence(booking, now)` in `src/server/domain/models/Booking.ts` as an exhaustive `switch` over `BookingStatus`, with the doc comment stating why it is a second predicate and not a caller of `blocksAvailability` (design D3).
- [x] 1.3 Write failing tests for `src/server/domain/models/barberCalendarDay.test.ts`: free-time subtraction over one window, over a split shift, with an absence covering a whole window, with an absence partially overlapping, and with two occupying appointments.
- [x] 1.4 Implement the day composition in `src/server/domain/models/barberCalendarDay.ts` — lane assignment from `calendarPresence`, free time via `subtractAll` over `workingIntervalsFor`, and the ordering of both lanes by start instant. Do **not** call `generateSlots` (design D5).
- [x] 1.5 Write failing tests for the stranded rule: an appointment inside its window is not stranded; one ending after the window is; one on a weekday with no windows is; one overlapping an absence is; boundary cases exactly at a window edge follow the half-open convention.
- [x] 1.6 Implement the stranded containment test in `barberCalendarDay.ts` (design D10), taking windows and absences already in hand and issuing no query.
- [x] 1.7 Write failing tests for `src/server/application/dashboard/barberCalendarParams.test.ts`: absent, malformed, array-valued, over-length, out of range in both directions, and a valid value — every failing case degrading to today, never throwing.
- [x] 1.8 Implement `resolveCalendarDay` and the `dia` parameter name in `src/server/application/dashboard/barberCalendarParams.ts`, with the named past-window constant, following `recentBookingsParams.ts` (design D8).

## 2. The read

- [x] 2.1 Define `IBarberCalendarRepository` in `src/server/domain/repositories/IBarberCalendarRepository.ts` with `BarberCalendarAppointment`, `BarberCalendarDay` and `findDay`, plus the header stating the four invariants: owner scope through `barber → location → ownerId`, one round trip, overlap at both ends, and SQL narrows but never decides a status (design D6, D7).
- [x] 2.2 Write failing tests in `src/server/infrastructure/prisma/PrismaBarberCalendarRepository.test.ts` against a mocked client: the owner predicate is present; the appointment and absence filters use overlap at both ends; the projection carries no email, telephone, price, deposit or absence reason; a non-matching barber resolves to `null`.
- [x] 2.3 Implement `PrismaBarberCalendarRepository` as a single `barber.findFirst` with the owner predicate and three nested selections, mapping to the domain types.
- [x] 2.4 Write failing tests for `src/server/application/services/BarberCalendarService.test.ts`: it composes the read with the pure rules, refuses when `hasTimezoneSupport()` is false, and returns a distinguishable not-found result.
- [x] 2.5 Implement `BarberCalendarService` in `src/server/application/services/BarberCalendarService.ts`, taking the repository and an `IClock`, computing the day bounds and weekday through `bookingCalendar`, and holding the timezone invariant for any caller (design D9).

## 3. The page

- [x] 3.1 Create `app/(dashboard)/barberos/[id]/calendario/barberCalendarService.ts` — the composition root: Prisma client, `systemClock`, `logger`, and nothing else. Assert `hasTimezoneSupport()` here before building a repository.
- [x] 3.2 Add a test asserting the composition root's dependencies, so the "no cipher, no storage client, no session client" claim cannot drift from the code (design D15).
- [x] 3.3 Add the `barberCalendar` namespace to `src/lib/copy.ts` with every string the spec requires, including the two distinct empty states, the outside-hours badge, the five presence labels, the cancellation actors, the failure message and the past-day marker.
- [x] 3.4 Build `app/(dashboard)/barberos/[id]/calendario/DayNavigation.tsx` as a Server Component: previous/next/today links with `prefetch={false}`, plus a native `<input type="date" name="fecha">` in a `method="get"` form (design D11, D12).
- [x] 3.5 Build `app/(dashboard)/barberos/[id]/calendario/page.tsx`: `requireOwner()` first, `dynamic = 'force-dynamic'`, `robots: { index: false, follow: false }`, `notFound()` on a null read, the timeline lane, the `<details>` secondary lane with its count, the free-time regions, and the outside-hours badges. No client component.
- [x] 3.6 Implement the failure card and both empty states in the page — closed-that-weekday (with the route to `/barberos/[id]/horarios`) and open-and-nothing-booked — never sharing copy, never rendering an empty day on a failed read (design D13, D14).
- [x] 3.7 Add `app/(dashboard)/barberos/[id]/calendario/loading.tsx`, shaped like the day so the layout does not jump.
- [x] 3.8 Write `app/(dashboard)/barberos/[id]/calendario/page.test.tsx` covering: both empty states, the failure card, the secondary region and its count, the outside-hours badge, the named canceller, a cancelled booking absent from the timeline, and a 120-character unbroken client name.

## 4. The entry point

- [x] 4.1 Add the calendar link to each card in `app/(dashboard)/barberos/page.tsx`, with an `aria-label` naming the barber, adding no query to `fetchPageData`.
- [x] 4.2 Extend `app/(dashboard)/barberos/page.test.tsx` to assert the route renders per barber, that its accessible name identifies the barber, and that the page's query count is unchanged.

## 5. Verification against the live database

- [x] 5.1 Confirm the network path before writing the gate: run the documented `repeat('x', 1400)` one-liner from T68 and record whether this machine's path is affected.
- [x] 5.2 Write `scripts/d3-gate.ts` with a two-owner fixture: cross-owner isolation both directions; unknown id and foreign id both `null`; a split shift; a three-day absence present on its middle day; an appointment crossing midnight present on both days; a lapsed unswept hold not occupying; an appointment stranded by actually narrowing a schedule beneath it; and the round-trip count **measured**.
- [x] 5.3 Run the gate, remove its fixture afterwards, and record the result — reporting any probe that could not run as **not run**, never as passed.
- [x] 5.4 Drive the page over HTTP on `next dev` and on `wrangler dev` against the live database: the guard, the 404 for a foreign id, both empty states, the badge, the two lanes, and the failure card.
- [x] 5.5 Force the runtime/business calendar disagreement and confirm the day rendered is the business's. Done on Node by running the server in a timezone already on the next date (`TZ=Pacific/Kiritimati`, UTC+14) rather than by waiting for the 21:00–00:00 ART window — what the check needs is the disagreement, not the hour.
- [ ] 5.6 Confirm the same on `workerd` inside the real 21:00–00:00 ART window. Its clock is UTC and ignores `TZ`, so only the real hour produces the disagreement there. The rest of the timezone path is already proven on that runtime — it renders ART-local times from stored instants — so this closes the date-boundary sliver and nothing else.

## 6. Quality gates and documentation

- [x] 6.1 Run the full suite, `npm run lint` and `tsc --noEmit`; no test skipped, no implicit `any`.
- [x] 6.2 Measure the Worker's gzip size and record it against the 3131.48 KiB baseline.
- [x] 6.3 Correct the project-structure sketch in `docs/frontend-standards.md` (the `calendario/page.tsx` this change deliberately does not build), and record the `react-day-picker` deviation with its reason.
- [x] 6.4 Update `docs/tech-debt.md`: re-cost T29 with its D3 trigger marked answered-in-part (surfaced, not prevented), note that T64 has its first surface, re-confirm T68 against this gate, and open a note that the dashboard has no authenticated rate limit.
- [x] 6.5 Write the D3 entry in `docs/roadmap.md` and check the story off.
- [x] 6.6 Run `openspec validate d3-barber-day-calendar --strict` and resolve anything it reports.
