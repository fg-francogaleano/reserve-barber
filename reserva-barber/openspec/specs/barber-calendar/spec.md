# barber-calendar Specification

## Purpose
TBD - created by archiving change d3-barber-day-calendar. Update Purpose after archive.
## Requirements
### Requirement: One barber, one day, composed from three stored facts
The dashboard SHALL offer a read-only calendar showing a single barber on a single calendar day, composed of the barber's working windows for that weekday, the absences overlapping that day, and the bookings overlapping that day.

The day SHALL also present the **free time** left when absences and occupying appointments are subtracted from the working windows, computed with the same interval subtraction the availability rule uses rather than a second expression of it.

Free time is **time**, not slots. The calendar SHALL NOT render a slot grid or state that any time is bookable: a bookable slot depends on a chosen service's duration, and no service is chosen on this surface. Stating bookability from a duration this page does not have would be a claim the page cannot support.

#### Scenario: The day is drawn from all three inputs
- **WHEN** the owner opens a barber's calendar for a day on which the barber works, has an absence, and has an appointment
- **THEN** the working window, the absence and the appointment are all rendered
- **AND** the remaining time inside the window is presented as free

#### Scenario: Free time is derived, never asserted
- **WHEN** free time is computed for the day
- **THEN** it is the working windows minus the absences minus the occupying appointments
- **AND** no slot grid and no bookability claim is rendered anywhere on the page

### Requirement: The calendar's presence rule is distinct from the availability blocking rule
A booking's appearance on the calendar SHALL be decided by a dedicated total function over the booking status union, and SHALL NOT be decided by the availability blocking rule.

The two rules answer different questions. The blocking rule asks whether a time is still **on sale now**; the calendar asks what was **real on this day**. They diverge on past dates: a booking awaiting receipt approval stops blocking once its appointment has started, so reusing the blocking rule would draw a real past appointment as though it had never existed.

The presence rule SHALL classify every status:

- a confirmed booking is present as confirmed;
- a booking awaiting receipt approval is present as awaiting approval, **independently of the clock**, because an unanswered receipt is a fact about the shop's queue and not about the hour;
- a booking holding a slot is present as holding while its hold deadline is in the future, and as lapsed once that instant has passed, on the same half-open boundary every other interval in this product uses;
- a swept booking is present as lapsed;
- a cancelled booking is present as cancelled.

It SHALL be written as an exhaustive switch over the status union rather than a membership test, so that a sixth status forces a decision here instead of defaulting to invisible by silence. Its definition SHALL record why it is a second predicate and not a caller of the first.

#### Scenario: A past appointment awaiting approval is still shown as real
- **GIVEN** a booking awaiting receipt approval whose appointment started yesterday
- **WHEN** the owner opens that barber's calendar for yesterday
- **THEN** the appointment occupies the day and reads as awaiting approval

#### Scenario: A lapsed hold does not occupy its time
- **GIVEN** a booking holding a slot whose hold deadline has passed and which the sweep has not yet collected
- **WHEN** the owner opens that barber's calendar for that day
- **THEN** the time is presented as free
- **AND** the booking is recorded as lapsed rather than occupying

#### Scenario: The hold boundary is half-open
- **WHEN** the presence rule is evaluated at exactly the hold deadline instant
- **THEN** the booking is lapsed rather than holding

### Requirement: Occupying and recorded appointments are rendered apart
Appointments that occupy the day — confirmed, awaiting approval, or holding a live hold — SHALL be rendered in the day's timeline. Appointments that are cancelled or lapsed SHALL be rendered in a separate, secondary region below it, collapsed by default and carrying a count.

Two bookings on the same time is an ordinary consequence of a cancellation followed by a rebooking. Drawing both in the timeline would make the timeline state that the barber is in two places, so the separation is what keeps it true.

A cancelled appointment SHALL show **who** cancelled it when the booking records an actor, because a surface that cannot tell "I cancelled this" from "my client did" is not carrying the fact.

#### Scenario: A cancelled booking and its replacement share a time
- **GIVEN** a cancelled booking and a confirmed booking at the same time on the same day
- **WHEN** the owner opens that day
- **THEN** the timeline shows the confirmed appointment alone
- **AND** the cancelled one appears in the secondary region

#### Scenario: The canceller is named
- **WHEN** a cancelled appointment recording its canceller is rendered
- **THEN** the entry states whether the shop or the client cancelled it

#### Scenario: A booking cancelled before the actor column had a writer
- **WHEN** a cancelled appointment records no canceller
- **THEN** the entry states that it was cancelled without inventing an actor

### Requirement: An appointment outside its barber's current schedule is named
An occupying appointment that is not fully contained in the day's working windows, or that overlaps an absence, SHALL be rendered with a badge stating that it falls outside working hours.

Editing a schedule replaces the barber's week wholesale, so narrowing or removing a window strands the appointments already inside it. Until this calendar, nothing in the product compared a booking against the schedule it was made under, and a stranded appointment rendered as entirely ordinary. This page holds both operands from a single read, which makes the check free.

The badge SHALL be text rather than colour alone, and the appointment SHALL still be rendered rather than dropped for having no window to sit inside.

This requirement **reports** the condition. It SHALL NOT refuse, warn about, or otherwise alter any schedule edit; preventing the stranding remains unowned work.

#### Scenario: A schedule narrowed under an existing booking
- **GIVEN** a barber worked 09:00–18:00 on Tuesdays and has a confirmed booking next Tuesday at 17:30
- **AND** the Tuesday window is then narrowed to 09:00–17:00
- **WHEN** the owner opens that Tuesday
- **THEN** the 17:30 appointment is rendered and badged as outside working hours
- **AND** the free time ends at 17:00

#### Scenario: An appointment on a weekday the barber no longer works
- **GIVEN** a booking exists on a weekday for which the barber now has no working window
- **WHEN** the owner opens that day
- **THEN** the appointment is rendered and badged rather than omitted

#### Scenario: An appointment covered by an absence
- **GIVEN** an occupying appointment overlapping an absence on the same day
- **WHEN** the owner opens that day
- **THEN** the appointment is badged as outside working hours

### Requirement: The day parameter is bounded, matched and degraded, never fatal
The day SHALL be carried in the URL so that navigation, refresh, back/forward and sharing all work without client-side state.

The submitted value SHALL be length-bounded before it is parsed, and a value appearing more than once SHALL resolve to its first occurrence rather than being rejected, because a repeated parameter is something a browser or a link rewrite produces.

A value that is absent, malformed, or outside the permitted window SHALL degrade to the business's current day. It SHALL NOT produce a 404, an error page, or an empty result: the parameter is a convenience, and a stale or mangled link should still show the owner a calendar.

The permitted window SHALL extend into the past as well as the future — history that becomes unreachable is history destroyed — and SHALL be bounded in both directions, because an unbounded parameter is an unbounded parameter even behind a session.

The value SHALL NOT be interpolated into a query. It is resolved to a calendar day by the domain's own parser, and only the resulting day bounds reach the database.

#### Scenario: A malformed day
- **WHEN** the calendar is requested with a day parameter that does not parse
- **THEN** the business's current day is rendered
- **AND** no error state is shown

#### Scenario: A day beyond the permitted window
- **WHEN** the calendar is requested for a day years in the past or the future
- **THEN** the business's current day is rendered

#### Scenario: A repeated parameter
- **WHEN** the day parameter appears more than once
- **THEN** the first occurrence is used and the page renders normally

#### Scenario: An absurdly long value
- **WHEN** the day parameter exceeds the length bound
- **THEN** it is discarded before parsing and the current day is rendered

### Requirement: Today is the business's day, never the runtime's
Every calendar boundary on this page — the current day, the day's start and end instants, and the weekday whose schedule applies — SHALL be computed through the shared business-time module.

The deployment runtime is UTC and the business is at UTC−3, so for the last three hours of every local day the runtime's own calendar answers for tomorrow, and it answers with a plausible number rather than raising. The runtime's local calendar getters and any slicing of an ISO string down to a date SHALL NOT be used.

If the runtime cannot place an instant in the business's calendar, the page SHALL refuse rather than render a day computed some other way. A calendar that quietly shows the wrong date is worse than one that says it cannot.

#### Scenario: Late local evening on a UTC runtime
- **GIVEN** the runtime clock is UTC and the local business time is 21:30
- **WHEN** the owner opens the calendar with no day parameter
- **THEN** the day rendered is the business's current day, not the runtime's

#### Scenario: Timezone data unavailable
- **WHEN** the runtime cannot resolve the business timezone
- **THEN** the page refuses rather than rendering a day

### Requirement: The day is one owner-scoped read, and an unknown barber is indistinguishable from another owner's
The page's data SHALL be obtained through a dedicated read-only repository contract whose every method takes the session owner, so that an unscoped calendar query is inexpressible through it.

Scope SHALL reach the owner through the barber's location relation. A booking carries no location of its own, so that join **is** the tenancy boundary; there is no row-level security on these tables.

The read SHALL return the barber's identity together with the day's windows, absences and appointments in **one round trip**. Separate reads would cost several round trips through the connection pool the public booking flow shares, on a page the owner reloads freely.

A barber id that resolves to nothing within the session owner's scope SHALL produce the same not-found response as an id that exists nowhere, produced by the read returning nothing rather than by a branch in the page. A differential answer would tell any signed-in owner whether another shop's barber id exists.

The database statement MAY narrow by owner, by barber, by weekday and by instant range. It SHALL NOT re-express any status rule: the read returns every booking overlapping the range whatever its status, and the presence rule decides.

Cross-owner isolation SHALL be proven by a fixture containing two owners, never by inspection: a leaked calendar produces no row that looks wrong, only a plausible day.

#### Scenario: Another owner's barber
- **GIVEN** the session belongs to owner A and a barber belongs to owner B
- **WHEN** owner A requests that barber's calendar
- **THEN** the response is the not-found response
- **AND** it is indistinguishable from the response for a barber id that exists nowhere

#### Scenario: One round trip
- **WHEN** the calendar page renders
- **THEN** the barber, the windows, the absences and the appointments are obtained in a single database round trip

#### Scenario: Two owners, one fixture
- **WHEN** the read is exercised against a fixture holding two owners with barbers and bookings
- **THEN** each owner's calendar contains only their own barber's appointments

### Requirement: Ranges are matched by overlap at both ends
Appointments and absences SHALL be selected by overlap with the day's instant range, not by their start falling inside it.

An appointment that begins before midnight and ends after it belongs to both days, and a selection keyed on the start instant would erase it from the second. A multi-day absence carries the same defect in a worse form: it would vanish from every day between its first and last.

#### Scenario: An appointment crossing midnight
- **GIVEN** an appointment running from 23:30 on one day to 00:15 on the next
- **WHEN** the owner opens either day
- **THEN** the appointment is rendered on both

#### Scenario: A multi-day absence
- **GIVEN** an absence spanning three days
- **WHEN** the owner opens the middle day
- **THEN** the absence is rendered

### Requirement: An absence is described relative to the day, never as two bare instants
An absence that overlaps a day may begin before it, end after it, or both. What is rendered SHALL be a statement that is true of **this** day, and SHALL NOT be a pair of wall-clock times taken from instants belonging to other dates.

Formatting the stored start and end directly makes a three-day absence read as an eight-hour one: the times are real, the day they belong to is not the one being shown, and the resulting sentence is a false statement about the barber's availability.

The four ways an absence can meet a day SHALL therefore be distinguished, and the decision SHALL be made where the day's bounds are known rather than by a component holding two instants:

- an absence covering the day from end to end is stated as covering the whole day;
- one that began earlier is stated by **when it lifts**;
- one that continues afterwards is stated by **when it begins**;
- one contained in the day is stated as a range.

No instant rendered for an absence SHALL fall outside the day being shown. An absence beginning exactly at the day's first instant did not begin before it, and its time is shown.

#### Scenario: An absence spanning three days, on its middle day
- **GIVEN** an absence running from the previous day to the following one
- **WHEN** the owner opens the middle day
- **THEN** it is stated as covering the whole day
- **AND** no pair of wall-clock times is rendered for it

#### Scenario: An absence that began before this day
- **GIVEN** an absence that started yesterday and lifts at 12:00 today
- **WHEN** the owner opens today
- **THEN** it is stated by the time it lifts

#### Scenario: An absence that continues past this day
- **GIVEN** an absence that starts at 15:00 today and ends tomorrow
- **WHEN** the owner opens today
- **THEN** it is stated by the time it begins

#### Scenario: An absence contained in the day
- **GIVEN** an absence from 13:00 to 14:00 today
- **WHEN** the owner opens today
- **THEN** it is stated as that range

### Requirement: The projection carries no contact detail, no money, and no absence reason
The appointment projection SHALL carry only what the day is drawn from: the booking's identity, its start and end, its status, its hold deadline, its client's display name, its service's name, and its cancellation actor.

It SHALL NOT carry the client's email address or telephone number, nor any price or deposit amount. A field that is not selected cannot reach a log line or a serialized prop, and those facts belong to other capabilities.

Absences SHALL cross as plain intervals with **no reason**, which is a field confined structurally because it can hold medical information.

No log entry produced by this page SHALL contain a client name, a barber id, a booking id, or the submitted parameters. A failed read is logged with an operation name and an error name only.

#### Scenario: The projection is narrow
- **WHEN** the day read returns appointments
- **THEN** no client email address, telephone number, price or deposit amount is present in the result

#### Scenario: An absence reveals no reason
- **WHEN** an absence is rendered on the calendar
- **THEN** no reason text is present anywhere in the response

#### Scenario: A failure logs no personal data
- **WHEN** the day read fails and the failure is logged
- **THEN** the entry carries an operation name and an error name and no client, booking or parameter value

### Requirement: The page is guarded, uncached, unindexed, and free of client JavaScript
The page SHALL resolve the session owner in its own right, before any database read begins, rather than relying only on the middleware and the dashboard layout.

It SHALL be rendered dynamically per request and SHALL NOT be cached: it names clients, so a cached render would hand one owner's day to whoever asked next. It SHALL instruct search engines not to index or follow it.

It SHALL ship **no client JavaScript**. Every component is a server component, every date, time and label is formatted on the server, and the only interactions are links and a GET form that navigates. Formatting on both sides of the render boundary is how a hydration mismatch happens.

Day navigation links SHALL NOT be prefetched. A strip of day links with default prefetching turns a hover into one dynamic render — and one database round trip — per day, against a connection pool the public booking flow shares.

#### Scenario: A request without a session
- **WHEN** the calendar is requested without a session
- **THEN** no database read begins and the request is refused by the guard

#### Scenario: No client bundle
- **WHEN** the page renders
- **THEN** it contains no client component and no client-side date library

#### Scenario: Navigation does not prefetch
- **WHEN** the day navigation renders
- **THEN** its links are marked not to prefetch

### Requirement: Every state of the day is designed, and failure never looks like emptiness
The page SHALL define and render distinctly:

- **a barber who does not work that weekday**, with the route to their schedule editor;
- **a barber who works that day with nothing booked**, showing the whole window as free;
- **a day whose working time is entirely covered by an absence**;
- **a failed read**, as a message inside the page stating that the calendar could not be loaded;
- **a past day**, marked as past so history is not read as today's plan;
- **a loading state** shaped like the day, so the layout does not jump.

"Closed today" and "open and nothing booked" are opposite facts and SHALL NOT share an empty state.

A failed read SHALL NOT render an empty day, a zero, or any optimistic content, and SHALL NOT fall through to the route's error boundary — which would replace the page rather than report the failure in it.

The page is a snapshot of the instant it rendered. It SHALL NOT claim to be live, and SHALL NOT present relative freshness.

#### Scenario: The barber does not work that weekday
- **WHEN** the owner opens a day for which the barber has no working window
- **THEN** the page says so and offers the route to the schedule editor

#### Scenario: The barber works and nothing is booked
- **WHEN** the owner opens a day with working windows and no appointments
- **THEN** the page presents the window as free and does not reuse the no-schedule message

#### Scenario: An absence covers a day that has no appointments
- **GIVEN** a day with working windows, no appointments, and an absence covering it entirely
- **WHEN** the owner opens that day
- **THEN** the page states that the barber is away
- **AND** it does not also state that the schedule is free from end to end

#### Scenario: An absence partly reduces a day that has no appointments
- **GIVEN** a day with working windows, no appointments, and an absence covering part of it
- **WHEN** the owner opens that day
- **THEN** the page states that nothing is booked and claims nothing about how much of the day is free
- **AND** the free time it lists is what the absence leaves

#### Scenario: The read fails
- **GIVEN** the database is unreachable
- **WHEN** the owner opens a calendar
- **THEN** a failure message is rendered inside the page
- **AND** no windows, appointments or free time are drawn
- **AND** the route's error boundary is not reached

### Requirement: The calendar is legible on a phone, by keyboard, and without colour
The day SHALL be presented as an ordered list of time-bearing entries on small screens rather than as a positioned grid, because the owner opens this between clients.

Status, the outside-hours condition, and the cancellation actor SHALL each be conveyed by text, never by colour alone, and SHALL meet WCAG AA contrast.

Day navigation and the date form SHALL be fully operable by keyboard, and the secondary region for cancelled and lapsed appointments SHALL open without JavaScript.

A long unbroken client or service name SHALL wrap rather than overflow its container.

#### Scenario: A long unbroken name
- **WHEN** an appointment carries a client name of 120 characters with no spaces
- **THEN** the entry wraps and the page does not scroll horizontally

#### Scenario: Status without colour
- **WHEN** an appointment renders in any state
- **THEN** its state is stated in text

#### Scenario: The secondary region without scripting
- **WHEN** the cancelled-and-lapsed region is opened with scripting unavailable
- **THEN** its contents are revealed

### Requirement: Every user-facing string this capability introduces is Spanish and lives in the copy module
All copy this capability introduces SHALL be Spanish (es-AR) and SHALL live in the shared copy module under its own namespace, not inline in a component.

Dates, times and weekdays SHALL be formatted in the business timezone through the shared formatters rather than by a second formatting call written at the point of use.

#### Scenario: No inline strings
- **WHEN** the calendar's components render
- **THEN** every user-facing string they display is read from the copy module

#### Scenario: Times are the business's
- **WHEN** an appointment's time is rendered
- **THEN** it is formatted in the business timezone

### Requirement: The calendar is proven against the live database and on both runtimes
The behaviour of this capability SHALL be verified by a gate script executed against the live database, covering at least: cross-owner isolation on a two-owner fixture, an unknown and a foreign barber id both resolving to nothing, a day with more than one working window, an absence spanning several days, an appointment crossing midnight, a lapsed unswept hold, an appointment stranded by actually narrowing a schedule beneath it, and the round-trip count **measured** rather than asserted.

The page SHALL additionally be driven over HTTP on both the Node development runtime and the `workerd` runtime, including one run inside the late-evening local window in which the runtime's UTC calendar and the business's calendar disagree about the date.

A probe that cannot be executed SHALL be reported as not run. It SHALL NOT be reported as passing.

#### Scenario: The gate runs against real rows
- **WHEN** the gate executes against the live database
- **THEN** each listed condition is exercised against real rows and its outcome reported individually

#### Scenario: Both runtimes agree
- **WHEN** the same day is rendered on the Node runtime and on `workerd`
- **THEN** the two renders state the same day, the same appointments and the same free time

#### Scenario: An unrunnable probe
- **WHEN** a probe cannot complete in the environment the gate is run from
- **THEN** it is reported as not run rather than as passed

