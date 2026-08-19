# booking-availability Specification

## Purpose
The date and the time a client picks after choosing a barber, and the rule that decides which start times exist: the barber's working hours for that weekday, minus every absence, minus every booking whose hold is live, with each candidate sized by the service duration. The grid is five minutes and every candidate is anchored at the start of a free interval, so a cancellation reopens every position it freed. Created by archiving change b3-available-time-slots.

## Requirements

### Requirement: Available start times are working hours minus absences minus blocking bookings

For a chosen `(barber, service, business-local date)`, the system SHALL compute available start times as: the barber's working windows for that weekday, minus every absence, minus every blocking booking. A start SHALL be offered only when `[start, start + service.durationMinutes)` lies entirely inside **one** working window and overlaps no absence and no blocking booking.

Candidate starts SHALL be emitted every `SLOT_GRANULARITY_MINUTES` from the beginning of **each free interval**, not from the beginning of the working window. Re-anchoring is what makes a cancellation reopen every position it freed rather than only those on the original grid.

The rule SHALL be a pure function taking the current instant as an argument. It MUST NOT read a clock, issue a query, or reach a repository.

#### Scenario: A free day is tiled from the window start
- **WHEN** a barber works 09:00–10:00 with nothing booked and the service lasts 30 minutes
- **THEN** the offered starts are 09:00, 09:05, 09:10, 09:15, 09:20, 09:25 and 09:30
- **THEN** 09:35 is not offered, because it would end after the window

#### Scenario: The grid re-anchors after a booking
- **WHEN** a booking occupies 10:00–10:30 inside a 09:00–12:00 window and the service lasts 30 minutes
- **THEN** starts resume at 10:30, 10:35, 10:40 and so on
- **THEN** no start between 09:35 and 10:00 is offered, since each would overlap the booking

#### Scenario: A service longer than every gap
- **WHEN** the barber's only free intervals are 45 minutes and the service lasts 60 minutes
- **THEN** no start is offered for that date

#### Scenario: The generator performs no input or output
- **WHEN** the slot generation module is reviewed
- **THEN** it imports no repository, reads no clock, and receives the current instant as a parameter

### Requirement: A day may have several working windows and a service must fit inside one

Slot generation SHALL accept a **list** of working windows for the weekday and evaluate each independently. A start whose appointment would span the gap between two windows MUST NOT be offered.

`docs/tech-debt.md` T27 names this story: "B3 must not ship assuming a single window is sufficient." The schema's unique key is `(barberId, dayOfWeek, startMinute)` precisely so a split shift is a UI change and not a migration. The generator therefore MUST NOT assume the one-window-per-day shape the editor currently writes.

#### Scenario: A split shift does not sell the break
- **WHEN** a barber has windows 09:00–13:00 and 16:00–20:00 stored for the weekday and the service lasts 30 minutes
- **THEN** no start is offered between 12:35 and 15:55
- **THEN** 12:30 is offered, since it ends exactly at 13:00
- **THEN** 16:00 is offered

#### Scenario: An appointment may not span two windows
- **WHEN** windows 09:00–13:00 and 16:00–20:00 are stored and a 60-minute service is requested
- **THEN** no start between 12:01 and 15:59 is offered, regardless of the gap's length

#### Scenario: A weekday with no window
- **WHEN** the barber has no stored window for the weekday of the chosen date
- **THEN** no start is offered and the date's empty state renders

### Requirement: Intervals are half-open and their boundaries are exact

Every interval in availability — a working window, an absence, a booking, and a candidate appointment — SHALL be treated as half-open: the start is inside, the end is not. Overlap SHALL be defined once, as `aStart < bEnd && aEnd > bStart`, and every consumer SHALL use that definition.

`docs/data-model.md` §9 records the reason: if absences and bookings disagreed on their end boundary, an appointment beginning exactly when an absence ends would be blocked or allowed depending on which rule ran first, and that surfaces as a mysterious unbookable slot rather than as a failing test.

#### Scenario: An appointment ending exactly at a window's end
- **WHEN** a 30-minute service is evaluated at 17:30 against a window ending at 18:00
- **THEN** the start is offered

#### Scenario: An appointment starting exactly when an absence ends
- **WHEN** an absence ends at 16:00 and a start at 16:00 is evaluated
- **THEN** the start is offered, since the end instant is outside the absence

#### Scenario: An appointment ending exactly when an absence starts
- **WHEN** an absence starts at 13:00 and a 30-minute service is evaluated at 12:30
- **THEN** the start is offered

#### Scenario: An appointment starting exactly when an absence starts
- **WHEN** an absence starts at 13:00 and a start at 13:00 is evaluated
- **THEN** the start is not offered, since the start instant is inside the absence

#### Scenario: Overlapping absences union
- **WHEN** a barber has an absence for a whole week and a second absence for one afternoon inside it
- **THEN** availability is computed as though the two were one region, with no double subtraction and no negative interval

### Requirement: A booking blocks only while its hold is live

A booking SHALL block a slot when its status is `PENDING_APPROVAL` or `CONFIRMED`, or when its status is `PENDING_PAYMENT` **and** its `holdExpiresAt` has not passed. A `PENDING_PAYMENT` booking whose `holdExpiresAt` is in the past SHALL NOT block. `CANCELLED` and `EXPIRED` bookings SHALL NOT block.

B7 — the scheduled job that expires abandoned holds — ships three stories later. A status-only filter would let every abandoned checkout remove a slot from sale permanently, with no surface anywhere in the product that would show the owner why.

`PENDING_APPROVAL` is never treated as expired: a receipt has been uploaded and a human owes an answer.

This predicate SHALL be defined in one place, and **the booking write SHALL apply that same definition**. It is no longer documented as a rule a future story must share — the second caller now exists, and a disagreement between the two would offer a client a slot and then reject them while they pay.

#### Scenario: An abandoned checkout releases its slot
- **WHEN** a booking at 15:00 is `PENDING_PAYMENT` with a `holdExpiresAt` one hour in the past and no job has expired it
- **THEN** 15:00 is offered

#### Scenario: A live hold blocks
- **WHEN** a booking at 15:00 is `PENDING_PAYMENT` with a `holdExpiresAt` ten minutes in the future
- **THEN** 15:00 is not offered

#### Scenario: An uploaded receipt blocks regardless of age
- **WHEN** a booking at 15:00 is `PENDING_APPROVAL` and its `holdExpiresAt` is in the past
- **THEN** 15:00 is not offered

#### Scenario: A cancelled booking frees its slot
- **WHEN** a booking at 15:00 is `CANCELLED`
- **THEN** 15:00 is offered

#### Scenario: The predicate has one home
- **WHEN** the availability code and the booking write are reviewed
- **THEN** the blocking rule is expressed once and both the read and the write call it

#### Scenario: The read and the write agree
- **WHEN** a slot is offered by the availability read and submitted immediately
- **THEN** the write does not refuse it on blocking grounds

### Requirement: How soon and how far ahead a client may book is bounded

A start earlier than `now + MIN_BOOKING_LEAD_MINUTES` SHALL NOT be offered. A date beyond `today_local + MAX_BOOKING_HORIZON_DAYS`, or earlier than today in business local time, SHALL NOT be selectable and SHALL NOT reach an availability computation.

Both constants SHALL live in one domain module beside the slot granularity.

Without a lead time a client books a slot two minutes out and the barber learns of it by email. Without a horizon, `?fecha` is an unbounded parameter space on a route that has neither a cache nor a rate limit (`docs/tech-debt.md` T47), where each distinct value costs a full availability read against a pool shared with the owner's dashboard.

#### Scenario: A start inside the lead time
- **WHEN** the current instant is 14:30 local, the lead time is 60 minutes, and the barber is free from 14:00
- **THEN** 15:00 is not offered and 15:30 is offered

#### Scenario: Today is over
- **WHEN** every remaining start for today falls inside the lead-time buffer
- **THEN** the slot step renders a Spanish empty state saying no times remain today, rather than an unexplained empty list

#### Scenario: A date beyond the horizon
- **WHEN** a request carries a date more than `MAX_BOOKING_HORIZON_DAYS` ahead
- **THEN** no availability query is issued for that date

#### Scenario: The bounds have one home
- **WHEN** the domain layer is reviewed
- **THEN** both constants are declared once, beside `SLOT_GRANULARITY_MINUTES`, and no literal duplicates either value

### Requirement: Business local time is the only calendar this feature uses

Every weekday resolution, calendar-date derivation, wall-clock conversion and horizon calculation SHALL go through the shared business-time module. `getDay()`, `getHours()`, `getDate()` and `toISOString().slice(0, 10)` MUST NOT appear anywhere in this feature.

The deployment runtime is UTC and the business is at UTC−3, so those calls return an answer that is wrong for the last three hours of every local day — and they return a plausible number rather than raising, so nothing surfaces it.

The route SHALL assert `hasTimezoneSupport()` at its composition root and fail closed when it does not hold. A runtime without timezone data does not throw; it silently reports UTC, which would shift every offered time by three hours with nothing to notice.

#### Scenario: The weekday is the business's, not the runtime's
- **WHEN** the runtime clock reads 02:00 UTC on a Monday, which is 23:00 Sunday in business local time
- **THEN** "today" is the Sunday date and Sunday's windows are the ones used

#### Scenario: The default date at the end of a local day
- **WHEN** the date step renders at 23:30 business local time
- **THEN** the first selectable day is that local date, not the runtime's already-rolled-over calendar day

#### Scenario: Forbidden calls are absent
- **WHEN** the availability feature is reviewed
- **THEN** no `getDay`, `getHours`, `getDate` or `toISOString().slice(0, 10)` call appears in it

#### Scenario: A runtime without timezone data
- **WHEN** the timezone probe fails at the composition root
- **THEN** the route fails closed rather than serving times computed in UTC

### Requirement: The date step offers a bounded strip and marks non-working days

When no date is selected, the flow SHALL render a date step listing every day from today to the horizon in business local time. A day for which the barber has **no working window** SHALL be presented as unavailable rather than omitted, so the client sees that the barber does not work Sundays instead of wondering why a date is missing.

A day that has a window but is entirely absent or entirely booked SHALL still render as selectable and resolve to the slot step's empty state. Computing true availability for every day in the horizon would be one full availability computation per day on the busiest public route in the product, which has neither a cache nor a rate limit.

This gap SHALL be stated in the implementation rather than left to be rediscovered.

#### Scenario: A non-working weekday is visibly unavailable
- **WHEN** the barber has no window stored for Sunday
- **THEN** every Sunday in the strip renders as unavailable and cannot be selected

#### Scenario: A fully booked day is selectable and then empty
- **WHEN** a day has a working window and every start on it is blocked
- **THEN** the day is selectable, and choosing it renders the slot step's empty state

#### Scenario: The strip is bounded
- **WHEN** the date step renders
- **THEN** it lists exactly the days from today to the horizon, and no control navigates beyond it

### Requirement: The date and the time are stranger-supplied and are bounded before use

`?fecha` SHALL be accepted only as a canonical `YYYY-MM-DD` naming a real calendar date within `[today_local, today_local + MAX_BOOKING_HORIZON_DAYS]`. A non-canonical spelling, an impossible date, or a value outside the range SHALL be discarded. Length SHALL be bounded before parsing.

`?hora` SHALL never be parsed into a time and trusted. It SHALL be matched against the list of starts generated for that date, and accepted only if it is a member. Length SHALL be bounded before use.

A repeated parameter SHALL resolve deterministically to its first occurrence, as the existing selection parameters do.

#### Scenario: A non-canonical date spelling
- **WHEN** `?fecha=2026-8-1` is requested
- **THEN** it is discarded and the date step renders

#### Scenario: An impossible date
- **WHEN** `?fecha=2026-02-30` is requested
- **THEN** it is discarded before any availability query is issued

#### Scenario: A leap day is real
- **WHEN** `?fecha=2028-02-29` is requested and falls inside the horizon
- **THEN** it is accepted as a valid date

#### Scenario: An overlong parameter
- **WHEN** `fecha` or `hora` carries several thousand characters
- **THEN** it is rejected before any query is issued and no driver error reaches the response

#### Scenario: A repeated parameter
- **WHEN** `?fecha` appears twice in the query string
- **THEN** the request resolves deterministically and no driver error reaches the response

### Requirement: An unavailable time is absent, and no response says why

The slot step SHALL render only available starts. It MUST NOT render unavailable times in any form — not greyed out, not struck through, not labelled "ocupado" — and no response SHALL distinguish a time blocked by a booking from one blocked by an absence or one outside working hours.

Rendering unavailable times publishes a private person's agenda density and the shape of their absences to any anonymous visitor holding the link. The absence `reason` is confined structurally for the same class of reason, and the client cannot act on the difference.

A time that was booked moments ago and a time that never existed SHALL produce identical responses — same step, same status, same visible copy.

#### Scenario: Only available times render
- **WHEN** the slot step renders for a partially booked day
- **THEN** the response contains the available starts and no representation of the unavailable ones

#### Scenario: A taken time and an absurd time are indistinguishable
- **WHEN** one request carries an `hora` that another client just booked and another carries a syntactically absurd `hora`
- **THEN** both render the slot step with the same status and the same visible copy

#### Scenario: The cause is never disclosed
- **WHEN** any empty or partial slot list renders
- **THEN** the copy does not reveal whether an absence, a booking or a closed window is responsible

### Requirement: The availability inputs are one composed read that omits the absence reason

The barber's working windows, absences overlapping the chosen date, and blocking bookings overlapping it SHALL be obtained in a **single database round trip**, through an owner-scoped repository method with an explicit projection.

B2 measured ~0.35–0.40 s per round trip on this runtime; issuing these three sequentially after the existing slug and catalogue reads would make the slot step five round trips on the route that earns the business money.

The absence projection MUST NOT carry `reason`. M5b confined that field structurally because it can hold medical information, and a public availability read is exactly the consumer it was confined against.

Every method SHALL take the owner as a required parameter, so an unscoped availability query is inexpressible through the contract.

#### Scenario: One round trip
- **WHEN** the slot step renders
- **THEN** the availability inputs are obtained in a single database round trip

#### Scenario: The reason is not readable here
- **WHEN** the availability read executes
- **THEN** no absence reason is selected, returned, rendered, logged or serialized

#### Scenario: The read is owner-scoped
- **WHEN** the availability repository contract is reviewed
- **THEN** the owner is a required parameter and an unscoped query cannot be expressed

#### Scenario: The cost is measured
- **WHEN** the change is complete
- **THEN** the query count and response time of the slot step are measured on the deployment runtime against the live database and recorded

### Requirement: A failed availability read never renders an optimistic list

If any part of the availability read fails, the flow SHALL render the client-toned Spanish error state with a retry control. It MUST NOT render a slot list computed from a partial result, and specifically MUST NOT treat a failed bookings read as an absence of bookings.

Offering a time that is already taken sells an appointment that does not exist and takes a deposit for it. An error is the better outcome.

No response on any failure path SHALL contain a stack trace, connection string, SQL, table or column name, or English technical text.

#### Scenario: The bookings read fails
- **WHEN** the query for blocking bookings fails
- **THEN** the client-facing Spanish error state renders with a retry control
- **THEN** no slot list is rendered

#### Scenario: No internal detail escapes
- **WHEN** any failure path renders
- **THEN** the response body carries no stack trace, connection string, SQL, schema name or English technical text

### Requirement: Every empty state in the new steps is designed and reversible

The flow SHALL define distinct Spanish states for: a date whose every start is blocked, a date whose weekday has no working window, a barber with no availability anywhere in the horizon, and a today whose remaining starts all fall inside the lead-time buffer.

Each SHALL render a complete page with HTTP 200, never an empty region, and each SHALL offer the way back that fits it — another day for a full day, another barber for an empty horizon.

#### Scenario: A barber with no availability in the whole horizon
- **WHEN** the barber has no working window on any weekday
- **THEN** a Spanish empty state explains that the barber has no times available and offers a route back to the barber step

#### Scenario: A full day
- **WHEN** every start on the chosen date is blocked
- **THEN** a Spanish empty state renders with status 200 and offers a route back to the date step

#### Scenario: Empty states are pages
- **WHEN** any of these states renders
- **THEN** it is a complete page rather than an empty list inside an otherwise normal step

### Requirement: The slot list stays scannable and usable at the dense case

The slot step SHALL group starts by daypart, with headings, rendering each group as a wrapping grid of time chips. Grouping is presentation: it SHALL NOT change which starts are generated, and its boundaries SHALL live in the copy module rather than in the availability rule.

The 5-minute grid makes a 9:00–18:00 day with a 30-minute service produce 103 starts. That is the ordinary case, not the stress case, and a flat column of 103 entries is a scroll with no landmarks.

The step SHALL render without horizontal overflow at a 360-pixel viewport at its densest: a service of the minimum duration across a nine-hour window. Times SHALL render in es-AR through the shared time formatter.

#### Scenario: The dense case holds
- **WHEN** the slot step renders a minimum-duration service across a nine-hour window at 360 pixels wide
- **THEN** the page does not scroll horizontally, every chip remains reachable, and the daypart headings remain visible landmarks

#### Scenario: Grouping does not change generation
- **WHEN** the availability rule is reviewed
- **THEN** it produces starts with no knowledge of dayparts

### Requirement: The new steps work before hydration and add no client-side date machinery

The date step and the slot step SHALL be server-rendered, and navigation SHALL be a link to the next URL. Both SHALL be completable with client-side JavaScript disabled. No date-picker component, calendar widget or date library SHALL be introduced.

`useSearchParams` MUST NOT be read in a Client Component above the resolution, and this change SHALL NOT introduce a `loading.tsx` or any Suspense boundary above the slug resolution — B1 measured that a boundary degrades `notFound()` to a soft 404 and `permanentRedirect()` to a meta refresh on this runtime, which the product's distribution channel does not follow.

Every link the new steps render SHALL disable router prefetch, through the existing shared navigation component rather than at each call site. On this route each prefetch is a full availability computation, and the slot step can render on the order of a hundred links.

#### Scenario: Selection before hydration
- **WHEN** a date and then a time are chosen before the page has hydrated
- **THEN** both steps advance

#### Scenario: No prefetch storm
- **WHEN** the slot step renders a hundred starts
- **THEN** exactly one server request is issued and no prefetch request is made for any start

#### Scenario: No new dependency
- **WHEN** the change is complete
- **THEN** no date library or picker component has been added, and the Worker size is measured against the ceiling before deploying

#### Scenario: Configuration review
- **WHEN** the change is complete
- **THEN** no `loading.tsx` and no Suspense boundary exists above the slug resolution on this route

### Requirement: Choosing a time reserves nothing

The flow SHALL present the slot list as a snapshot. No copy on the date step or the time step SHALL state or imply that the chosen time is held, reserved, or guaranteed. Selecting a time SHALL write nothing: the selection lives in the query string, and a query string is not a claim.

Two clients can be looking at the same start. The truth is the booking transaction, which re-validates availability rather than trusting the selection carried in the URL — and which may legitimately refuse a time this list offered a moment earlier.

**A time becomes held only when the client submits their details and the transaction accepts the write.** The prohibition on writing a `Booking` or `Client` row from any route or action applied to B3, whose scope was the read side; it does not extend to the booking write, which is the one writer this capability's blocking rule was designed around. Nothing on the date or time step, however, SHALL create or reserve anything.

#### Scenario: The copy makes no promise
- **WHEN** a time is selected
- **THEN** no Spanish string on the date or time step states that the time is reserved or held

#### Scenario: Selecting writes nothing
- **WHEN** a client moves through the date and time steps, including selecting a time
- **THEN** no `Booking` and no `Client` row is created

#### Scenario: The offered list is not a guarantee
- **WHEN** a client submits a time that this list offered and another booking took it in between
- **THEN** the write is refused, confirming that the list was a snapshot rather than a hold

### Requirement: The new copy is Spanish and lives with the flow's copy

All user-facing strings introduced by this change SHALL live under the existing `booking` key in the copy module and SHALL be written in es-AR. No user-facing literal SHALL appear outside it, and no dashboard string SHALL be reused.

Dates and times SHALL be formatted on the server through the shared es-AR helpers, so the build's locale data and the browser's cannot disagree.

#### Scenario: Copy location
- **WHEN** the new steps render
- **THEN** every user-facing string originates in the copy module under the `booking` key

#### Scenario: Server-side formatting
- **WHEN** a date or a time renders
- **THEN** it is formatted on the server through the shared es-AR helper

### Requirement: The new steps are operable without a mouse and announced correctly

The date strip and the slot list SHALL each be a semantic list of controls with full keyboard navigation and a visible focus indicator. The selected date SHALL be exposed programmatically, not by styling alone. An unavailable day SHALL be announced as unavailable rather than merely rendered differently. Contrast SHALL meet WCAG AA and no state SHALL be conveyed by colour alone.

#### Scenario: Keyboard traversal
- **WHEN** the date step and the slot step are operated with the keyboard only
- **THEN** every selectable day, every start and the back control are reachable with focus visible throughout

#### Scenario: Unavailable days are announced
- **WHEN** a non-working day renders in the strip
- **THEN** assistive technology reports it as unavailable rather than as an ordinary option

#### Scenario: The selected date is programmatic
- **WHEN** a date is selected
- **THEN** its selected state is exposed to assistive technology rather than indicated by styling alone
