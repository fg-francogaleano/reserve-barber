## ADDED Requirements

### Requirement: The owner measures a chosen period, and five figures describe it

The dashboard SHALL provide a statistics page reachable from the navigation, showing five figures for a period the owner selects: confirmed appointments, deposits belonging to them, cancellations, the average deposit per appointment, and how many distinct clients those appointments represent.

The page SHALL be reachable at a stable path and SHALL require a session in its own right, not only through the middleware and the layout: the read must never start for a request without one.

The page SHALL NOT be cached and SHALL NOT be indexed. A cached render hands one shop's revenue to whoever asks next, and these figures are commercially sensitive even though they carry no personal data.

**The page SHALL depend on no client JavaScript for anything it does.** Every interaction SHALL be an ordinary navigation, and every figure SHALL be present and every period selectable with scripting disabled.

Stated as a behaviour rather than as "ships no client JavaScript", which would be false in the letter: the framework's link component is a Client Component and its runtime is on the page. What matters is that nothing here *needs* it — the claim a reader can check, and the one the scenario below tests.

Every `Intl` formatting SHALL happen on the server: formatting a currency value on both sides of the render boundary is how a hydration mismatch on money happens.

#### Scenario: The page requires a session of its own

- **WHEN** an unauthenticated request reaches the statistics path
- **THEN** it is redirected to the login page and no aggregate query is issued

#### Scenario: The page is neither cached nor indexed

- **WHEN** the statistics page is rendered
- **THEN** the route is dynamic and its metadata declares `noindex, nofollow`

#### Scenario: The page carries no client bundle for its own behaviour

- **WHEN** the statistics page is rendered with JavaScript disabled
- **THEN** every figure is present and every range remains selectable

### Requirement: All five figures are keyed on the appointment's start instant

The selected period SHALL define a half-open instant range, and every figure SHALL be computed over the set of that owner's bookings whose `startTime` falls inside it. No figure SHALL be bounded on `createdAt`, on `cancelledAt`, or on `Payment.approvedAt`.

**This is the requirement the rest of the capability depends on.** The average is deposits divided by appointments; if the numerator and the denominator were bounded on different columns, the quotient would be a ratio between two different populations and would mean nothing. The unique-client count and the cancellation rate the owner reads off the first two cards carry the same dependency.

The dashboard home's own income counter is bounded on `Payment.approvedAt` and remains so. The two figures answer different questions, will not agree, and each SHALL state its basis where it is rendered.

#### Scenario: A deposit approved before the period counts in the period of its appointment

- **WHEN** a deposit is approved on 25 August for a confirmed appointment on 3 September
- **AND** the owner selects the range containing 3 September
- **THEN** the deposit is included in that range's figure
- **AND** it is not included in the range containing 25 August

#### Scenario: A transfer approved long after the appointment still counts with the appointment

- **WHEN** the owner approves a transfer receipt three days after the appointment took place
- **THEN** the deposit counts in the range containing the appointment, not the range containing the approval

#### Scenario: Range boundaries are half-open

- **WHEN** one confirmed booking starts exactly at the range's first instant and another starts exactly at the range's last instant
- **THEN** the first is counted in every figure and the second is counted in none

### Requirement: Every count is confirmations, never rows

The appointment count SHALL count bookings whose status is `CONFIRMED`. The unique-client count SHALL count distinct clients across those same confirmed bookings. Neither SHALL count a booking row in any other status.

A count of every booking is a count of **checkout attempts**. Abandoned holds accumulate without bound relative to real business, so a period in which nobody completed a payment would report the same figure as a period in which everybody did.

A client with several confirmed bookings inside the range SHALL count exactly once in the unique-client figure.

#### Scenario: A live hold is not an appointment

- **WHEN** the range contains a `PENDING_PAYMENT` booking whose hold has not lapsed
- **THEN** it is counted in neither the appointment count nor the unique-client count

#### Scenario: An expired hold is not an appointment

- **WHEN** the range contains an `EXPIRED` booking
- **THEN** it is counted in neither the appointment count nor the unique-client count nor the cancellation count

#### Scenario: A returning client counts once

- **WHEN** one client has three confirmed bookings inside the range
- **THEN** the appointment count includes three and the unique-client count includes one

### Requirement: Income joins through the booking's status and is named as deposits

The income figure SHALL sum `Payment.amount` under conditions that are each independently required:

1. **The payment's status SHALL be `APPROVED`.**
2. **The payment's booking status SHALL be `CONFIRMED`.** A payment may be `APPROVED` while its booking is not: the late-payment path produces exactly that when a client pays for a slot that was already resold. Summing approved payments alone reports a refund the owner owes as revenue they earned.
3. **The booking's `startTime` SHALL fall inside the selected range**, per the clock requirement above.
4. **The figure SHALL be labelled as deposits**, never as income, revenue or turnover. This product never records the balance a client pays in the chair, so a label claiming turnover is wrong by the whole service price. No string in this capability may imply otherwise.
5. **The label SHALL state its basis** — deposits belonging to the period's appointments — because a second income figure exists on the dashboard home under a different clock.

The sum SHALL cross the repository boundary as a canonical decimal string and SHALL NOT be converted to a floating-point number at any point before formatting. A period with no matching payments SHALL render a formatted zero, never a blank or a dash: no income is a fact, and a missing value is a different statement.

#### Scenario: An approved payment on an expired booking is excluded

- **WHEN** a payment of 3000.00 reached `APPROVED` and its booking was later swept to `EXPIRED`
- **AND** that booking's appointment falls inside the selected range
- **THEN** the income figure does not include it

#### Scenario: An approved payment on a cancelled booking is excluded

- **WHEN** a payment reached `APPROVED` and the owner then rejected the receipt, cancelling the booking
- **THEN** the income figure does not include it

#### Scenario: A trailing zero survives the aggregate

- **WHEN** the only approved deposit in range on a confirmed booking is 2000.50
- **THEN** the figure renders two thousand pesos and fifty centavos, not two thousand pesos and five centavos

#### Scenario: The label does not claim turnover and does state its basis

- **WHEN** the income card is rendered
- **THEN** it states that the figure is deposits, and that they belong to the period's appointments

### Requirement: A booking with several payment rows is counted exactly once everywhere

A booking MAY carry many `Payment` rows: the live-payment uniqueness constraint admits any number of `REJECTED` attempts alongside one live payment, deliberately, so that a declined card does not block the retry.

The statement SHALL therefore NOT join `Payment` into the row set the counting figures are computed over. Income SHALL be obtained through a sub-query. A booking whose client was declined twice before paying SHALL contribute one to the appointment count, one to its client's uniqueness, and its single approved amount to income.

**This is the change's most likely silent defect.** Row multiplication inflates the counts while the distinct-client figure absorbs it, so the result reads as a small inconsistency rather than as a join error.

#### Scenario: Declined attempts do not multiply a booking

- **WHEN** a confirmed booking inside the range has two `REJECTED` payments and one `APPROVED` payment
- **THEN** the appointment count includes it once
- **AND** the unique-client count includes its client once
- **AND** the income figure includes the approved amount once

### Requirement: Cancellations are cancellations, never expiries, and they say who decided

The cancellation figure SHALL count bookings whose status is `CANCELLED` and whose appointment falls inside the range. It SHALL NOT count `EXPIRED` bookings under any circumstance.

`EXPIRED` against `CANCELLED` is how this product tells a deadline apart from a decision, and the scheduled sweep produces expired rows continuously. Counting them as cancellations would report abandoned checkouts as clients walking away.

The figure SHALL be accompanied by a breakdown of who cancelled — the owner or the client — derived from the booking's `cancelledBy`. Each part SHALL be shown only when it is non-zero. Bookings written before that column had a writer carry no value and SHALL be counted in the total and in neither part.

#### Scenario: An expired hold is not a cancellation

- **WHEN** the range contains an `EXPIRED` booking and no cancelled ones
- **THEN** the cancellation figure reads zero

#### Scenario: The breakdown separates two opposite facts

- **WHEN** the range contains one booking cancelled by the owner and two cancelled by clients
- **THEN** the cancellation figure reads three
- **AND** the breakdown reports one by the owner and two by clients

#### Scenario: A cancellation with no recorded actor still counts

- **WHEN** the range contains a `CANCELLED` booking whose `cancelledBy` is absent
- **THEN** the cancellation figure counts it
- **AND** neither part of the breakdown counts it

### Requirement: The average is derived over integer cents and is absent rather than zero

The average deposit per appointment SHALL be the income figure divided by the appointment count, computed in the domain over integer cents and rounded half-up to two decimals. It SHALL NOT be computed by dividing inside the SQL statement, and no floating-point intermediate SHALL exist at any point.

**When the appointment count is zero the average SHALL be absent**, represented by a value the rendering layer cannot mistake for money, and rendered as a dash with its explanation. A currency zero here would be a false statement about the business and would be indistinguishable from a period in which appointments happened and earned nothing.

The label SHALL name the figure as an average **deposit**, for the same reason the income label must.

#### Scenario: A period with no appointments has no average

- **WHEN** the selected range contains no confirmed bookings
- **THEN** the average is absent and renders as a dash with an explanation
- **AND** it does not render a formatted zero

#### Scenario: The average is exact at a half centavo

- **WHEN** the income figure and the appointment count produce a quotient of exactly half a centavo
- **THEN** the average rounds up

#### Scenario: A period with appointments and no approved deposits has an average of zero

- **WHEN** the range contains confirmed bookings and none of them has an approved payment
- **THEN** the average renders a formatted zero rather than a dash

### Requirement: The range vocabulary is a closed set resolved from the query string

The page SHALL offer exactly six ranges: today, yesterday, this week, last week, this month, and last month. Each SHALL be identified by a Spanish slug carried in a query parameter, matching the Spanish routes.

**Today SHALL be the canonical unparameterised view.** The link to it SHALL carry no parameter, so that one view does not have two URLs.

An arbitrary or caller-supplied date range SHALL NOT be accepted. Each accepted value is an aggregate over the shop's whole booking history, and an open range is an unbounded family of them.

The submitted value SHALL be resolved by matching against the closed set — never parsed, never interpolated, never used to build a query fragment. A value that is unknown, empty, over a length ceiling, or otherwise unusable SHALL degrade to today. It SHALL NOT produce a 404 and SHALL NOT raise: a range is a convenience, and losing the page over a mangled link trades a small wrong answer for no answer. A parameter appearing more than once SHALL resolve to its first occurrence, because the framework surfaces repeats as an array and a page that raised on one would break on a URL a rewrite produced.

#### Scenario: An unknown range degrades to today

- **WHEN** the range parameter carries a value outside the closed set
- **THEN** the page renders today's figures with today marked as current
- **AND** no error is shown and no 404 is returned

#### Scenario: An oversized parameter is refused before it is examined

- **WHEN** the range parameter carries a value longer than the ceiling
- **THEN** the page renders today's figures

#### Scenario: A repeated parameter takes its first value

- **WHEN** the range parameter appears twice, first as this month and then as today
- **THEN** the page renders this month's figures

#### Scenario: No part of a submitted value reaches the statement

- **WHEN** the range parameter carries a value containing SQL syntax
- **THEN** the page renders today's figures
- **AND** the issued statement's parameters are two instants and an owner identifier, and nothing derived from the submitted text

### Requirement: Every range boundary is a business-calendar instant

Each range SHALL be converted into a half-open instant interval using the business timezone, through the project's single conversion module. The runtime's own calendar readers SHALL NOT be used, and no date arithmetic SHALL be performed inside the SQL statement.

`date_trunc` and equivalents are refused for two independent reasons: a unit derived from a submitted parameter is a caller-influenced identifier reaching SQL, and the function truncates in the session's timezone — which is UTC in this deployment — so a late-evening appointment would land in the following day and a month-end one in the following month.

The week SHALL begin on Monday. Ranges SHALL be computed from both boundaries rather than from one boundary plus a fixed duration, so that a day or a month which is not a whole number of twenty-four-hour periods stays correct if the country restores daylight saving.

The whole page SHALL be derived from a single instant read once, so the heading and the figures cannot describe different days.

#### Scenario: The business day decides the range, not the runtime day

- **WHEN** the server's own calendar has already rolled to the next date
- **AND** a confirmed booking exists at 21:30 in the business timezone on the business's today
- **THEN** the unparameterised page names the business's today
- **AND** the appointment count includes that booking

#### Scenario: The week starts on Monday

- **WHEN** the business's today is a Sunday and the owner selects this week
- **THEN** the range begins at the preceding Monday's midnight in the business timezone

#### Scenario: The previous month is a calendar month, not thirty days

- **WHEN** the business's today is in January and the owner selects last month
- **THEN** the range covers the whole of the preceding December in the business timezone

#### Scenario: One instant governs the whole render

- **WHEN** the page is rendered
- **THEN** the heading's period and the queried interval derive from the same read of the clock

### Requirement: Every figure comes from one owner-scoped round trip

All figures SHALL be produced by **one statement** issued in **one round trip**.

One rather than several, and the second reason is not about speed: separate queries answer from separate instants, so a booking confirmed mid-render would be counted by one figure and not another, and the owner would be shown two numbers that cannot both be true. It is also a page reading a whole booking history against a connection pool the public booking flow shares.

Scope SHALL reach the owner through the booking's barber and that barber's location. A booking's location is deliberately not duplicated onto the row, so this is the only path, and there is no row-level security on these tables: **the join is the tenancy boundary**. The income sub-query SHALL carry its own owner predicate rather than relying on correlation to the outer query alone.

Cross-owner isolation SHALL be proven by a two-owner fixture in both directions, never by inspection. A leaked aggregate produces no row that can look wrong — only a plausible integer.

The statement SHALL narrow and SHALL NOT decide. It filters by owner, by status and by an instant range. It SHALL NOT restate the availability predicate: no figure here asks whether a hold is live, so no clause here reads the hold deadline.

Counts SHALL be narrowed from the driver's wide integer type at the repository boundary; monetary values SHALL cross as canonical decimal strings.

#### Scenario: Another owner's figures are unreachable in both directions

- **WHEN** two owners each have locations, barbers, confirmed bookings and approved payments
- **THEN** each owner's page reports only their own figures
- **AND** the income figure excludes every payment belonging to the other owner

#### Scenario: The page costs one round trip

- **WHEN** the page is rendered for a range with results
- **THEN** exactly one query reaches the database for the figures

#### Scenario: A shop with no barbers reports zeros, not a failure

- **WHEN** the owner has no locations, no barbers and no bookings
- **THEN** every figure reads zero, the average is absent, and no failure state is shown

### Requirement: An empty period, an empty business, and a failed read are three different states

A period containing **neither confirmed bookings nor cancellations** SHALL render an empty state that names the selected period, and SHALL offer a wider period — except where the wider period is the one already selected, in which case no link is offered rather than one leading back to the current page.

**A period with cancellations and no confirmed bookings SHALL render the figures, not the empty state.** Something happened in that period, and it is the thing an owner most wants to see. It is also the only combination in which the absent average is observable beside real figures — the requirement above would otherwise be unreachable, since an empty state renders no average at all.

A shop that has never had a booking at all SHALL render a different empty state, offering the path that produces one.

A read that fails SHALL render a failure state for the whole figure region — not five failed cards — and SHALL NOT default any figure to zero. An income card silently reading a formatted zero is a false statement about money and is indistinguishable from a period that earned nothing.

A cancellation count of zero is a real and welcome figure and SHALL render as zero. The asymmetry with the average is deliberate: one is an answer, the other is the absence of one.

#### Scenario: A quiet period is not an empty business

- **WHEN** the owner has bookings in other periods but neither confirmed bookings nor cancellations in the selected range
- **THEN** the empty state names the selected range and offers a wider one
- **AND** it differs from the state shown to a shop with no bookings at all

#### Scenario: A period with only cancellations still reports figures

- **WHEN** the selected range contains cancellations and no confirmed bookings
- **THEN** the figures are rendered rather than the empty state
- **AND** the average is absent while the income figure reads a formatted zero

#### Scenario: The wider period is not offered when it is already selected

- **WHEN** the empty state is rendered for the month
- **THEN** no link to the month is offered

#### Scenario: A failed read never renders as zero

- **WHEN** the statistics read raises an error
- **THEN** a failure state replaces the figures
- **AND** no figure renders a zero or a formatted zero

#### Scenario: No cancellations is a good number, not a missing one

- **WHEN** the range contains confirmed bookings and no cancelled ones
- **THEN** the cancellation figure renders zero and the breakdown is not shown

### Requirement: The range control survives the loading state

The range control SHALL remain rendered, with the selected range marked, while the figures below it are loading.

A loading placeholder cannot know which range was selected, so a control placed inside the suspended region disappears and returns differently highlighted on every selection — several times per session, on the one page whose purpose is comparing periods.

The selected range SHALL be marked for assistive technology as the current item, and the control SHALL carry an accessible name.

#### Scenario: The control does not disappear between periods

- **WHEN** the owner selects a different range and the figures are still loading
- **THEN** the six range options remain visible

#### Scenario: The current range is announced

- **WHEN** a range is selected
- **THEN** its control is marked as the current item

### Requirement: The page is legible on a phone and states nothing personal

The figures SHALL be marked up as a description list. The range control SHALL wrap rather than scroll horizontally. A monetary figure SHALL wrap rather than overflow its card: a period's sum can be far larger than any single price the product otherwise formats.

This capability's projection SHALL carry no client name, email address, telephone number, booking identifier or cancellation token — none of them is rendered, and a field that is not selected cannot reach a log line or a serialized prop.

A failed read SHALL be logged with an operation name and the shared error context, and SHALL NOT log any monetary value.

#### Scenario: A large sum does not break the layout

- **WHEN** the income figure exceeds seven digits
- **THEN** it wraps within its card and the page does not scroll horizontally

#### Scenario: A failure log carries no money

- **WHEN** the statistics read fails
- **THEN** the logged context carries an operation name and no monetary value

### Requirement: Every user-facing string this capability introduces is Spanish and lives in the copy module

All user-facing text SHALL be Spanish as spoken in Argentina and SHALL be declared in the shared copy module, never inline in a component. Code, comments, identifiers and log messages SHALL remain English.

#### Scenario: No user-facing string is inline

- **WHEN** this capability's components are rendered
- **THEN** every visible string resolves through the copy module

### Requirement: The statistics are proven against the live database and on both runtimes

A gate script SHALL run the real statement against the live database before this capability is considered complete, because a mocked raw query proves the call was made and never that the driver would accept its result types. Aggregate return types are the documented failure mode this project has already been broken by once.

The gate SHALL cover, at minimum: cross-owner isolation in both directions including the income sum specifically; an approved payment on a non-confirmed booking excluded; a booking with declined attempts counted once; an expired hold counted nowhere; the cancellation breakdown including a booking with no recorded actor; a returning client counted once; both half-open boundaries; the trailing-zero decimal; the absent average; and the round-trip count measured rather than claimed.

The gate SHALL capture the statement's query plan, and any index SHALL be added only if that plan asks for one.

A probe that cannot run SHALL be reported as not run, never as passed.

The capability SHALL then be verified at runtime on both the Node and the Workers runtimes, authenticated, against real rows, with any seeded fixture removed afterwards — and SHALL include a check performed while the runtime's own calendar disagrees with the business's.

#### Scenario: The raw statement is executed against the real database

- **WHEN** the gate runs
- **THEN** the statement executes through the driver adapter and every returned column is read into its domain type

#### Scenario: An unrunnable probe is reported as unrunnable

- **WHEN** a gate probe cannot complete
- **THEN** it is reported as not run and the gate does not report success for it

#### Scenario: The Workers runtime renders the same figures as Node

- **WHEN** the page is rendered on both runtimes against the same rows
- **THEN** every figure is identical
