# dashboard-home Specification

## Purpose

The owner's landing page: six figures summarising the business, and a recent-bookings list filterable by barber. Every counter is defined as a predicate over named columns rather than as a label, because "today's bookings" has several defensible readings that differ by more than a rounding error.
## Requirements
### Requirement: The dashboard home is the owner's summary, and every counter is defined as a predicate

The route `/` inside the dashboard SHALL render a summary of the owner's business consisting of six counters and a recent-bookings list. It SHALL replace the placeholder location list that has occupied this route since S0.

Each counter SHALL be defined as a predicate over named columns rather than as a noun. "Today's bookings" has several defensible readings and they differ by more than a rounding error; a counter whose definition lives only in its label is a number nobody can check.

The six counters are:

| Card                              | Predicate                                                                                                                                                                         |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Turnos de hoy                     | `status = 'CONFIRMED'` AND `startTime` inside the business-local day containing `now`                                                                                             |
| Reservas sin confirmar hoy        | `startTime` inside that same day AND the shared blocking predicate answers true AND `status <> 'CONFIRMED'`                                                                       |
| Cancelaciones de hoy              | `status = 'CANCELLED'` AND `cancelledAt` inside that same day                                                                                                                     |
| Turnos confirmados (histórico)    | `status = 'CONFIRMED'`, no date bound                                                                                                                                             |
| Comprobantes por revisar          | the pending-receipt predicate defined by the `transfer-receipt-review` capability                                                                                                 |
| Ingresos del mes (señas cobradas) | sum of `Payment.amount` where `Payment.status = 'APPROVED'` AND the payment's booking is `CONFIRMED` AND `Payment.approvedAt` is inside the business-local month containing `now` |

"Reservas sin confirmar hoy" SHALL be rendered as a subordinate line beneath "Turnos de hoy" and SHALL NOT be summed into it. The two answer different questions — who is being served today, and what is still in flight — and adding them produces a number that is neither.

`now` SHALL be injected rather than read from a global clock, so that every boundary in this capability is testable without waiting.

#### Scenario: The placeholder is gone

- **WHEN** the owner opens the dashboard home
- **THEN** the six counters and the recent-bookings list are rendered, and the location list that stood here since S0 is not

#### Scenario: Held bookings are not counted as confirmed ones

- **WHEN** the owner has one `CONFIRMED` booking today and two live `PENDING_PAYMENT` holds today
- **THEN** "Turnos de hoy" reads 1 and "Reservas sin confirmar hoy" reads 2

#### Scenario: A past confirmed appointment still counts in the historical total

- **WHEN** the owner has a `CONFIRMED` booking whose appointment was last month
- **THEN** it is counted by "Turnos confirmados (histórico)" and not by "Turnos de hoy"

### Requirement: Today and this month are the business's, never the runtime's

Every calendar boundary in this capability SHALL be computed through the project's business-time module. The deployment runtime is UTC and the business is at UTC−3, so the runtime's own calendar readers — the local getters for date, weekday and hour, and slicing an ISO string down to a date — answer for the following day between 21:00 and 23:59 local. They SHALL NOT be used here. They fail during closing hours, they return a plausible number rather than raising, and they self-heal by morning.

Day bounds SHALL come from the existing day-bounds function applied to the business's current calendar day.

Month bounds SHALL be produced by a **new domain function** that converts the first instant of the current business-local month and the first instant of the next one. It SHALL NOT be computed by constructing a UTC date from year and month components, which places the boundary three hours early and counts the last three hours of the previous month as this one. It SHALL NOT be computed by adding a fixed number of days.

#### Scenario: An evening appointment belongs to the day the shop is having

- **WHEN** the runtime clock reads `2026-09-02T01:30:00Z` and a `CONFIRMED` booking starts at `2026-09-01T23:00:00-03:00`
- **THEN** "Turnos de hoy" includes that booking

#### Scenario: The last evening of a month is not counted in the next one

- **WHEN** a payment is approved at `2026-08-31T23:30:00-03:00`
- **THEN** it is counted in August's income and not in September's

#### Scenario: The month boundary is built from two month firsts

- **WHEN** the month-bounds function is reviewed
- **THEN** it converts the first of this month and the first of next month through the business-time module, and adds no fixed number of days

### Requirement: An expired hold is never reported as a cancellation

The cancellations counter SHALL filter on status `CANCELLED` **and** SHALL bound on `cancelledAt`. Both conditions are required.

**The claim that the two are "redundant by construction" was wrong, and it made this counter read zero.** It rested on the sweep leaving `cancelledAt` null — which is true — while overlooking that the *only writer of `CANCELLED` in the product* left it null as well. The receipt rejection sets the status and records no instant, so every cancelled booking in existence fails the second condition and the counter has never been able to count anything. Verified against the live database: cancelled rows present, none carrying a timestamp.

The two conditions are therefore **independent**, and this requirement SHALL be read as demanding both because each guards a different failure: the status guard keeps swept holds out, and the instant guard is what the counter actually counts by. **Every writer of `CANCELLED` SHALL record `cancelledAt`**, and a writer that does not is a writer whose cancellations are invisible here.

A booking in status `EXPIRED` SHALL NOT be counted as a cancellation under any circumstance, including one that carries a non-null `cancelledAt` written by some future path. `EXPIRED` against `CANCELLED` is how this product distinguishes a deadline from a decision, and the scheduled sweep produces expired rows continuously. Counting them as cancellations tells the owner their clients are leaving.

**A test for this counter SHALL NOT seed `cancelledAt` itself without also asserting that a real cancellation path writes it.** That is exactly how the defect survived: every test that exercised the counter constructed the row it wanted, so the counter was correct about data no writer produced.

#### Scenario: Swept holds are not cancellations

- **WHEN** three of the owner's bookings were swept to `EXPIRED` today and exactly one was cancelled today
- **THEN** "Cancelaciones de hoy" reads 1

#### Scenario: The status guard holds independently of the timestamp

- **WHEN** an `EXPIRED` booking carries a non-null `cancelledAt` inside today
- **THEN** it is not counted

#### Scenario: A cancellation today for a past appointment counts today

- **WHEN** a booking whose appointment was last month is cancelled today
- **THEN** it is counted by "Cancelaciones de hoy" and appears in no other counter

#### Scenario: A real cancellation reaches the counter

- **WHEN** a booking is cancelled through a cancellation path the product actually offers
- **THEN** "Cancelaciones de hoy" increases by one

#### Scenario: A rejected receipt reaches it too

- **WHEN** the owner rejects a transfer receipt, cancelling its booking
- **THEN** that cancellation is counted, because the rejection now records its instant

---

### Requirement: The historical total counts confirmations, and its label says so

The all-time counter SHALL count bookings in status `CONFIRMED` only, and its label SHALL name what it counts.

Counting every booking row makes the dashboard's headline number a count of checkout _attempts_. Abandoned holds accumulate without bound relative to real business — the first production run of the sweep meets every abandoned hold ever created — so a shop whose checkout is broken would report a healthy business it has never had. `CANCELLED` is excluded for a different reason: a cancelled appointment is not one the shop served.

#### Scenario: Abandoned checkouts do not inflate the total

- **WHEN** the owner has 2 `CONFIRMED` bookings, 30 `EXPIRED` ones and 4 `CANCELLED` ones
- **THEN** the historical total reads 2

#### Scenario: The label and the predicate agree

- **WHEN** the historical counter is rendered
- **THEN** its label states that it counts confirmed appointments

### Requirement: Income joins through the booking, is bounded by approval, and is named as deposits

The income counter SHALL sum `Payment.amount` under three conditions, each independently required:

1. **The payment's booking SHALL be `CONFIRMED`.** A payment may be `APPROVED` while its booking is not: the late-confirmation path produces exactly that when a client pays for a slot that was already resold, and the sweep logs it as money owed back. Summing approved payments alone reports a refund the owner owes as revenue they earned.
2. **The month SHALL be bounded on `approvedAt`**, not on the payment's creation and not on the appointment's start. Income is when the money moved. Both writers set this column: the Mercado Pago confirmation and the owner's transfer approval.
3. **The figure SHALL be labelled as deposits collected**, not as income or turnover. This product never records the balance a client pays in the chair, so a label reading "Ingresos" is wrong by the whole service price. No string in this capability may imply that the figure is the shop's revenue.

The sum SHALL cross the repository boundary as a canonical decimal string and SHALL NOT be converted to a floating-point number at any point before formatting. A sum with no matching rows SHALL render as a formatted zero, never as an em-dash or a blank: no income is a fact, and a missing value is a different statement.

#### Scenario: An approved payment on an expired booking is excluded

- **WHEN** a payment of 3000.00 reached `APPROVED` this month and its booking was later swept to `EXPIRED`
- **THEN** the income counter does not include it

#### Scenario: An approved payment on a cancelled booking is excluded

- **WHEN** a payment reached `APPROVED` and the owner then rejected the receipt, cancelling the booking
- **THEN** the income counter does not include it

#### Scenario: The month follows the approval, not the appointment

- **WHEN** a deposit is approved on 31 August for an appointment on 3 September
- **THEN** it is counted in August's income

#### Scenario: A trailing zero survives the aggregate

- **WHEN** the only approved deposit this month on a confirmed booking is 2000.50
- **THEN** the counter renders two thousand pesos and fifty centavos, not two thousand pesos and five centavos

#### Scenario: A month with no income is zero, not unknown

- **WHEN** no deposit has been approved this month
- **THEN** the counter renders a formatted zero

#### Scenario: The label does not claim turnover

- **WHEN** the income card is rendered
- **THEN** it states that the figure is deposits collected

### Requirement: Every counter is scoped to the owner through the barber relation

Every predicate in this capability SHALL be scoped to the requesting owner by joining `barber → location → ownerId`. A booking's location is deliberately not duplicated onto the booking row, so this is the only path to an owner.

There is no row-level security on these tables; the join is the entire tenancy boundary. An aggregate is the worst place for that boundary to be forgotten, because a leaked aggregate has no row that can look wrong — only a plausible integer.

Cross-owner isolation SHALL be proven by test against a fixture containing two owners with data in every counted category.

#### Scenario: Another owner's confirmed bookings are invisible

- **WHEN** another owner has 40 `CONFIRMED` bookings and this owner has 2
- **THEN** the historical total reads 2

#### Scenario: Another owner's income is invisible

- **WHEN** another owner has 500000.00 of approved deposits this month and this owner has 6000.00
- **THEN** the income counter reads six thousand pesos

#### Scenario: Isolation is proven rather than assumed

- **WHEN** the aggregate repository's tests are reviewed
- **THEN** they run against a two-owner fixture and assert the other owner's rows are absent from every counter

### Requirement: The recent-bookings list shows every status, bounded and narrowly projected

The page SHALL render the most recent bookings ordered by creation time, newest first, bounded by a named constant.

The list SHALL include bookings in **every** status, each rendered with a distinguishable badge. `CANCELLED` and `EXPIRED` SHALL be visually distinct from one another: that distinction is the entire reason the product has two statuses, and this list is the first surface in the product where an owner can see that a checkout was abandoned at all.

Each row SHALL show the appointment date and time, the client's name, the service, the barber, the status and the deposit amount. The projection SHALL NOT carry the client's email or telephone number: a field that is not selected cannot reach a log line or a serialized prop, and contact details belong to the story that owns them.

**Each row SHALL offer a cancel control where, and only where, the booking is still cancellable.** A terminal booking SHALL render no control rather than a disabled one. The decision SHALL come from the shared eligibility predicate rather than from a status list written into the row, so the control cannot appear where the write would refuse.

Offering the control SHALL NOT widen the projection. It needs the booking's id and its status, both of which the row already carries.

The read SHALL be bounded by a limit. An unbounded list read on the most-visited authenticated page in the product is not acceptable.

#### Scenario: Abandoned and cancelled bookings are both visible and distinguishable

- **WHEN** the owner's recent bookings include one `CANCELLED` and one `EXPIRED`
- **THEN** both are listed, with badges that differ from each other

#### Scenario: The list is bounded

- **WHEN** the owner has several hundred bookings
- **THEN** the read requests at most the configured limit

#### Scenario: Contact details are not projected

- **WHEN** the recent-bookings projection is reviewed
- **THEN** it contains no client email and no client telephone field

#### Scenario: A cancellable row offers the control

- **WHEN** a row renders a `CONFIRMED`, `PENDING_PAYMENT` or `PENDING_APPROVAL` booking
- **THEN** a cancel control is present

#### Scenario: A terminal row offers nothing

- **WHEN** a row renders a `CANCELLED` or `EXPIRED` booking
- **THEN** no cancel control is present, disabled or otherwise

#### Scenario: The control adds no columns to the read

- **WHEN** the projection is compared before and after this change
- **THEN** it is unchanged

### Requirement: The barber filter lives in the URL, adds no client JavaScript, and is matched rather than parsed

The recent-bookings list SHALL be filterable by barber. The selected barber SHALL be carried in a query parameter so that back, forward, reload and a shared link all reproduce the same view.

The control SHALL be a GET form containing a **native** `<select>` and a submit control. It SHALL NOT use a Server Action, and it SHALL NOT use a portalled listbox component: such a component is not a form-associated control and submits nothing before hydration. The page SHALL therefore ship no client JavaScript.

**This capability makes no claim that the page works with JavaScript disabled.** It does not: the segment carries a `loading.tsx`, so the route is streamed and its markup is swapped in by inline scripts. That is T44's Cause 1, whose scope this change widened — it defeats a page of pure Server Components, not only client ones — and it is out of scope here. The requirement above is about what this control adds, not about what the dashboard already fails to provide.

The submitted value SHALL be resolved against the owner's own barber list, which is already loaded to populate the control. A value that matches no entry SHALL be discarded and the unfiltered list rendered — never passed to the query. An unvalidated read filter is a cross-tenant probe: a valid foreign identifier would return that barber's bookings and an invalid one would return nothing, which is an oracle.

The query SHALL remain owner-scoped in addition to any barber filter. What the browser renders is a convenience, not a boundary.

The control SHALL accept a repeated parameter without failing: the framework hands over an array when a parameter appears more than once.

The option list SHALL include barbers who are inactive but have bookings, so that a deactivated barber's history stays reachable.

#### Scenario: A foreign barber id is discarded

- **WHEN** the owner opens the page with a barber parameter naming another owner's barber
- **THEN** the unfiltered list renders, no booking of the other owner is shown, and the control shows no selection

#### Scenario: The filter survives navigation

- **WHEN** the owner filters by a barber and then navigates back
- **THEN** the previous view is reproduced from the URL

#### Scenario: The filter carries no client JavaScript

- **WHEN** the files this capability adds are reviewed
- **THEN** none declares a client boundary, and the control is a form-associated native element

#### Scenario: A repeated parameter does not break the page

- **WHEN** the barber parameter appears twice in the URL
- **THEN** the page renders without error

#### Scenario: A deactivated barber's history stays reachable

- **WHEN** a barber with bookings has been deactivated
- **THEN** they remain selectable in the filter

### Requirement: A counter that could not load is never rendered as a zero

The page SHALL distinguish three states per counter block: loaded, zero, and failed.

A read that fails SHALL render a state that says the figure could not be loaded. It SHALL NOT default to `0` or to a formatted zero. An income card silently reading zero is a false statement about money, and it is indistinguishable from a shop that earned nothing.

A failure in the counters SHALL NOT prevent the recent-bookings list from rendering, and a failure in the list SHALL NOT prevent the counters from rendering. A single failed read SHALL NOT replace the owner's landing page with the route error boundary.

Failures SHALL be logged through the project's structured error-context helper and SHALL NOT be rendered to the page.

#### Scenario: A failed counter block says so

- **WHEN** the aggregate read fails
- **THEN** the counter block states that the figures could not be loaded, no counter shows a zero, and the page does not fall through to the error boundary

#### Scenario: The two reads fail independently

- **WHEN** the recent-bookings read fails and the aggregate read succeeds
- **THEN** the counters render and the list region states that it could not be loaded

#### Scenario: A genuine zero is rendered as a zero

- **WHEN** the owner has no bookings at all
- **THEN** every counter renders zero and no failure state is shown

### Requirement: The page is uncached, unindexed, guarded, and free of client JavaScript

The page SHALL be rendered dynamically and SHALL NOT be statically cached: it reads a session, it names clients, and a cached render would carry one owner's figures to whoever asked next.

It SHALL declare that it must not be indexed, for the same reason the receipt queue does.

It SHALL resolve the owner in its own right and not rely solely on the layout or the middleware, because this page reads the database and that read must never begin for a request without a session. The resolution is request-cached and costs nothing.

It SHALL ship **no client JavaScript**: every component in this capability is a Server Component and no dependency is added. All locale formatting — currency, dates and times — SHALL happen on the server, because formatting the same value on both sides of the render boundary is how a hydration mismatch on a currency string occurs.

#### Scenario: The page is not cached

- **WHEN** two different owners request the page in succession
- **THEN** each receives their own figures

#### Scenario: No client component is introduced

- **WHEN** the files added by this capability are reviewed
- **THEN** none of them declares a client boundary

#### Scenario: The read does not begin without a session

- **WHEN** an unauthenticated request reaches the page
- **THEN** the owner resolution redirects before any database read is issued

### Requirement: The page costs four reads in two waves, and the booking figures share one snapshot

The **five booking-and-payment figures** SHALL be computed by one statement. The pending-receipt count, the recent-bookings list and the barber options are each one further read — four in total.

They SHALL be issued in **two waves, not one**. The barber options are read first and awaited, because the submitted filter is _matched_ against them and an unresolved value must never reach the list query; the remaining three are then issued concurrently. The page's wall-clock cost is therefore **two round trips**, not one.

The ordering is a correctness constraint rather than an optimisation: collapsing all four into a single concurrent batch would mean issuing the list read before the filter had been validated against the owner's own barbers.

Two reasons for the single statement, and the second is not a performance concern. A round trip to the pooler from this deployment has been measured at roughly a third of a second, so seven _serial_ reads would make the owner's landing page the slowest in the product. And separate counter queries would produce their figures from different instants, so a booking confirmed mid-render could be counted by one card and not another.

**The pending-receipt count is deliberately excluded from that statement.** Its predicate belongs to the `transfer-receipt-review` capability, which requires it to be expressed once and shared by the listing and the count. A reporting statement cannot share a query fragment with that repository, so folding the receipt count in would create a second copy of exactly the predicate this change exists to unify — and the next narrowing of the queue would silently desynchronise the counter again. **Sharing the predicate is worth more than saving a round trip**, and because it rides in the same wave as the other two it costs approximately nothing in wall-clock terms.

The cost SHALL be measured against the live database rather than assumed.

#### Scenario: The booking figures come from one statement

- **WHEN** the aggregate repository is reviewed
- **THEN** the five booking-and-payment figures are produced by a single statement

#### Scenario: The receipt count is not a second copy of the queue's predicate

- **WHEN** the aggregate statement is reviewed
- **THEN** it contains no predicate over transfer receipts, and the count is obtained from the receipt repository

#### Scenario: The filter options are resolved before the list is queried

- **WHEN** the page's reads are reviewed
- **THEN** the barber options are awaited first, and the remaining three reads are issued concurrently after the submitted filter has been matched against them

#### Scenario: The three remaining reads do not run in sequence

- **WHEN** the page's reads are reviewed
- **THEN** all four are issued concurrently

### Requirement: The dashboard home is reachable from the dashboard

The dashboard shell SHALL link to the home route. It currently links to seven pages and to none of them is the home, which leaves the owner's landing page unreachable from itself once they have navigated away.

#### Scenario: The shell links home

- **WHEN** the owner is on any dashboard page
- **THEN** a link to the dashboard home is present in the shell

### Requirement: Every user-facing string this capability introduces is Spanish and lives in the copy module

All copy introduced here SHALL be Spanish (es-AR) and SHALL live in the central copy module, not inline with logic. Identifiers, comments and log messages SHALL remain English.

Empty states SHALL be designed rather than blank. A shop with no bookings SHALL be told so and pointed at its public booking link; a filter that matches nothing SHALL say so **and offer a way to clear itself**, because a filtered-empty state that looks like a global-empty state reads as a broken dashboard.

Long unbroken values — a maximal display name or service name — SHALL NOT cause the page to scroll horizontally.

#### Scenario: A new shop is addressed, not left blank

- **WHEN** an owner with no bookings opens the page
- **THEN** the page states that no bookings have been received and points at the public booking link

#### Scenario: A filtered-empty list offers a way back

- **WHEN** the owner filters by a barber who has never been booked
- **THEN** the page says that barber has no bookings and offers a control to clear the filter

#### Scenario: A long name does not break the layout

- **WHEN** a booking's barber or service name is at its maximum length with no spaces
- **THEN** the page does not scroll horizontally

