# business-statistics Specification

## Purpose

The owner's measurement of their business over a period they choose: six figures, two charts, three breakdowns, and a closed set of preset ranges. Every figure but one is bounded by the same instant range on the appointment's own `startTime`, because the page divides one figure by another and a quotient whose numerator and denominator cover different populations means nothing. That is also why this capability's deposits figure and `dashboard-home`'s income will not agree, and why both are required to state their basis.

**The one deliberate exception is the cash-collected figure**, bounded on `Payment.approvedAt`, because an owner reconciling against a bank statement needs to know what *arrived* in the period rather than what the period's appointments were worth. It states its own basis and nothing divides by it.

The charts share the figures' basis and reconcile with them: the income series partitions the same range on the same column, so its buckets sum to the deposits figure, and the payment-method split sums to it too. They are **server-rendered SVG with no charting library**, because this page's no-client-JavaScript requirement is a tested guarantee and every browser-measuring chart library would break it.

The three breakdowns — which services were booked, which barbers worked them, and the hour of the day the appointments start — are three groupings of **one row set**, the confirmed appointments the figures already count. That is what makes each of them required to sum back to the confirmed figure, and the invariant is this capability's cheapest defence: a payment row multiplying a retried booking, a ranking losing the entries past its cap, a bucket dropped at a boundary and an owner predicate missing from one branch all produce believable integers, and none produces a row that looks wrong.

**The hour an appointment falls in is decided in the domain and never in SQL.** Truncating or extracting it in a statement resolves in the session's timezone, which is UTC on both the pooler and the Workers runtime, and would count every appointment from 21:00 local onward in the following day's hours — plausibly, silently, for three hours of every day.

Two labels on this page are read live and are therefore anachronistic by design: renaming a service relabels its history, and a barber who changes branch carries theirs to the new branch's name. Grouping is by identity, so nothing merges and nothing splits; only the name is the current one.

## Requirements

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

The selected period SHALL define a half-open instant range, and the five figures this capability introduced SHALL be computed over the set of that owner's bookings whose `startTime` falls inside it. None of them SHALL be bounded on `createdAt`, on `cancelledAt`, or on `Payment.approvedAt`.

**This is the requirement the rest of the capability depends on.** The average is deposits divided by appointments; if the numerator and the denominator were bounded on different columns, the quotient would be a ratio between two different populations and would mean nothing. The unique-client count and the cancellation rate the owner reads off the first two cards carry the same dependency.

The income-evolution chart SHALL share this basis. Its buckets partition the same instant range on the same column, so the sum of every bucket SHALL equal the deposits figure exactly.

**Exactly one figure in this capability is bounded differently, and it is required to be.** The cash-collected figure is keyed on `Payment.approvedAt` — see the requirement that introduces it — because it answers a question about money arriving rather than about appointments happening. It SHALL be the only such exception, it SHALL state its basis where it is rendered, and no derived value SHALL ever divide it by an appointment-keyed figure.

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

#### Scenario: The chart's buckets sum to the figure above them

- **WHEN** the income-evolution chart and the deposits figure are rendered for the same period
- **THEN** the sum of every bucket in the chart equals the deposits figure to the centavo

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

All figures, both charts and all three breakdowns SHALL be produced by **at most three statements**, and those statements SHALL be **independently issued and independently recoverable**.

**They SHALL NOT share a transaction, and the skew that admits is accepted deliberately.** The alternative was a repeatable-read transaction, which would guarantee the bars, the rankings and the figures beside them were read from one snapshot. Three things argue against it and one for it:

- An interactive transaction holds a connection open across round trips against a **transaction-mode pooler**, which every other repository in this project is careful not to do, on the pool the public booking flow shares.
- The grouped reads are the heavier of the three and the pooler is on record hanging rather than raising. Inside a transaction, that failure costs the owner the five figures **as well as** the charts and the breakdowns — a regression against what this page does today, for the sake of a rarer defect.
- Independent failure is the more valuable property precisely because the likelier failure is asymmetric.

What it costs: a booking confirming into the selected period **between** two reads — a window of roughly one pooler round trip — leaves the bars summing to one deposit less than the figure above them, and the breakdowns summing to one appointment less, until the next render. Rare, silent, and self-correcting.

**Reconciliation SHALL therefore be proven where it is decidable rather than assumed from a snapshot**: given one set of rows, the filled series SHALL sum to the same total the aggregate reports, and every breakdown SHALL sum to the count those same rows represent, tested in the domain with no database involved. That is the property a reader actually depends on, and a transaction never proved it — it only prevented one way of breaking it.

It is also a page reading a whole booking history against a connection pool the public booking flow shares, which is the second reason the statement count stays bounded. **The budget rose from two to three deliberately and once**; a fourth statement is a spec change, not a refactor.

Scope SHALL reach the owner through the booking's barber and that barber's location. A booking's location is deliberately not duplicated onto the row, so this is the only path, and there is no row-level security on these tables: **the join is the tenancy boundary**. Every sub-query, every common table expression, every branch of a union and every additional statement SHALL carry its own owner predicate rather than relying on correlation to an outer query alone. A breakdown SHALL NOT reach the owner through any second path — scoping a service ranking through the service's own owner column agrees with the booking's chain today and is one edit away from not agreeing.

Cross-owner isolation SHALL be proven by a two-owner fixture in both directions, never by inspection, for **every** read this capability issues. A leaked aggregate produces no row that can look wrong — only a plausible integer, a plausible bar, or a plausible ranking.

The statements SHALL narrow and SHALL NOT decide. They filter by owner, by status and by an instant range. They SHALL NOT restate the availability predicate: no figure, no chart and no breakdown here asks whether a hold is live, so no clause here reads the hold deadline.

Counts and bucket indexes SHALL be narrowed from the driver's wide integer type at the repository boundary; monetary values SHALL cross as canonical decimal strings. **No value SHALL cross this boundary in a type the driver has not been proven to deserialize on the Workers runtime** — a mocked repository test certifies a projection regardless of whether the adapter can read it.

#### Scenario: Another owner's figures are unreachable in both directions

- **WHEN** two owners each have locations, barbers, confirmed bookings and approved payments
- **THEN** each owner's page reports only their own figures
- **AND** the income figure excludes every payment belonging to the other owner
- **AND** every chart bucket and every method share excludes them too
- **AND** neither owner's service ranking, barber ranking or hour distribution contains anything belonging to the other

#### Scenario: The page costs no more than three round trips

- **WHEN** the page is rendered for a range with results
- **THEN** at most three queries reach the database for the figures, the charts and the breakdowns

#### Scenario: The series reconciles with the figure it sits beneath

- **WHEN** a set of grouped rows is filled into a series and totalled
- **THEN** the sum equals the deposits total those same rows represent, to the centavo
- **AND** this holds with no database involved

#### Scenario: The heavier read failing does not cost the figures

- **WHEN** the chart statement times out and the aggregate statement succeeds
- **THEN** the five figures are rendered with their real values
- **AND** neither read was issued inside a transaction shared with the other

#### Scenario: The breakdown read failing costs neither the figures nor the charts

- **WHEN** the breakdown statement raises and the other two succeed
- **THEN** the six figures and both charts are rendered with their real values
- **AND** no read was issued inside a transaction shared with another

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

### Requirement: The period's income is drawn as a series over time

The page SHALL render a chart of deposit income across the selected period, partitioned into contiguous buckets covering the whole range and rendered in calendar order.

Granularity SHALL be a property of the range rather than of the data: a single-day range SHALL be partitioned by hour, and a week or a month range SHALL be partitioned by day. A month SHALL carry as many buckets as that calendar month has days.

**A bucket with no income SHALL be rendered as zero, never omitted.** The read returns only buckets that have rows; the missing ones SHALL be filled before the series reaches the chart. A series that skips a quiet Tuesday shortens its own axis and states a trend that did not happen — the defect is invisible precisely because the remaining shape stays plausible.

The chart SHALL be labelled as deposits, not as turnover: this product never records the balance a client pays in the chair.

#### Scenario: A quiet day is drawn as zero rather than skipped

- **WHEN** the owner selects a week in which deposits arrived on Monday and Friday only
- **THEN** the chart shows seven buckets in calendar order
- **AND** the five days without income each read zero

#### Scenario: A single-day range is partitioned by hour

- **WHEN** the owner selects today or yesterday
- **THEN** the chart shows twenty-four hourly buckets covering that business day

#### Scenario: A short month carries a short axis

- **WHEN** the owner selects a month of twenty-eight days
- **THEN** the chart shows exactly twenty-eight buckets and no empty trailing days

### Requirement: The payment-method split reports amounts, and counts beside them

The page SHALL render the split of the period's deposits between Mercado Pago and bank transfer.

The split SHALL be computed **by amount**, with the number of payments shown beside each part. A shop whose transfers are three small deposits and whose Mercado Pago is one large one is described wrongly by either number alone, and which of the two an owner needs depends on whether they are thinking about fees or about clients.

Only `APPROVED` payments on `CONFIRMED` bookings SHALL be counted, the same join through the booking's status that the income figure uses: an approved payment on a booking that never confirmed is money the owner owes back, and it belongs to neither method's share of revenue.

The split SHALL sum to the deposits figure for the same period.

#### Scenario: A declined attempt does not become a payment

- **WHEN** a confirmed booking carries two rejected Mercado Pago attempts and one approved payment
- **THEN** Mercado Pago is credited with exactly one payment and one amount
- **AND** the split still sums to the deposits figure

#### Scenario: An approved payment on a non-confirmed booking is in neither part

- **WHEN** a payment was approved for a booking whose hold lapsed and which never confirmed
- **THEN** it appears in neither method's amount nor in either count

### Requirement: The period's cash collected is a figure of its own, with its own basis

The page SHALL report the deposits **approved** within the selected period, as a sixth figure, bounded on `Payment.approvedAt` over `APPROVED` payments on `CONFIRMED` bookings.

This is the figure the capability was missing. Every other figure here answers *"what happened to my appointments in this period"*; an owner reconciling against a bank statement needs *"how much money arrived in this period"*, and before this requirement that question had no answer on any surface — the dashboard home answers it only for the current month.

**Its copy SHALL state its basis and SHALL state that it will not equal the deposits figure beside it.** The two are both correct and will differ whenever a deposit is approved in one period for an appointment in another. Copy is the entire mitigation, which is why it is specified rather than left to the implementer.

It SHALL NOT be drawn as a second series on the income-evolution chart. Two series on one axis invite the reader to compare them point by point, and the distance between them at any single bucket means nothing.

No derived figure SHALL divide this by an appointment-keyed figure.

#### Scenario: A deposit approved in one period for an appointment in another

- **WHEN** a deposit is approved on 25 August for a confirmed appointment on 3 September
- **AND** the owner selects the range containing 25 August
- **THEN** the cash-collected figure includes it
- **AND** the deposits figure for that same range excludes it

#### Scenario: The two income figures name what separates them

- **WHEN** both income figures are rendered for the same period
- **THEN** each states the instant it is bounded on
- **AND** the cash-collected figure states that it will not match the other

### Requirement: Bucket boundaries are business-calendar instants computed outside SQL

Every bucket boundary SHALL be derived in the domain, from the same single clock read the page's range comes from, and SHALL reach the database as instants.

**No statement SHALL perform date arithmetic.** `date_trunc` and its relatives are refused twice over: their unit is an identifier position, which parameterisation does not cover, and they truncate in the **session's** timezone, which is UTC on this deployment's pooler and on the Workers runtime. A twenty-one-thirty appointment would land in the next day's bucket and a twenty-three-thirty appointment on the last of the month in the next month's — silently, plausibly, for three hours of every day.

Assigning a row to a bucket is narrowing and MAY happen in SQL; deciding where a bucket begins is a calendar rule and SHALL NOT.

Boundaries SHALL be computed from both endpoints rather than by adding a fixed duration, so a day that is not twenty-four hours long stays correct if this market ever observes daylight saving.

#### Scenario: A late-evening appointment lands in the business's day, not the runtime's

- **WHEN** the runtime clock is UTC, the business calendar is three hours behind it, and a confirmed appointment starts at 21:30 on the last day of a month
- **THEN** that appointment's deposit falls in the last bucket of that month
- **AND** it appears in neither the following month nor the following day

#### Scenario: No statement computes a date

- **WHEN** this capability's statements are inspected
- **THEN** none contains a truncation, an interval addition, or any other date arithmetic

### Requirement: Every chart has an equivalent that does not require seeing it

A chart is an image to a screen reader and to anyone who cannot resolve its colours. Every chart this capability renders SHALL be accompanied by the same numbers in text, in a tabular structure, carrying the identical values to the identical precision. Visually hidden is acceptable; absent is not.

Each chart SHALL carry an accessible name that summarises what it shows, not merely what it is.

**Colour SHALL NOT be the sole encoder of any distinction.** Each part of the method split SHALL carry a text label and its formatted amount.

Chart colours SHALL be legible in both themes and SHALL come from the project's design tokens.

#### Scenario: The numbers are reachable without the image

- **WHEN** the statistics page is read by a screen reader
- **THEN** every chart's values are available as text
- **AND** each chart announces a name describing what it shows

#### Scenario: The method split is readable without colour

- **WHEN** the payment-method chart is rendered in greyscale
- **THEN** each part is still identified by its label and its amount

### Requirement: A chart's empty, degenerate and failed states are distinct

The three states this capability already separates — a quiet period, a business nobody has ever booked with, and a read that failed — SHALL be separated for the charts too, and separately from the figures.

**A failed chart read SHALL NOT be drawn as a zero series.** A flat line at zero is a statement about the business and is indistinguishable from a period that earned nothing.

A period with confirmed appointments and no approved deposits SHALL draw a zero series and say so — appointments happened, they simply collected nothing. That is an answer, not an absence.

**Neither of the figures' empty states SHALL be accompanied by a chart**, and the two cases fail differently if it is. A business that has never had a booking gets noise — two empty axes where the existing single message is the whole truth. A period in which nothing happened gets something worse: the zero-series copy states that appointments occurred and collected nothing, directly beneath a message saying there were no appointments. One of those two sentences is false.

The condition deciding this SHALL have **one definition**, shared by whatever picks the figures' empty state and whatever decides to draw. They were two independent conditions when this defect was introduced, and the gap between them was the defect.

**The figures and the charts SHALL fail independently.** If one read succeeds and the other does not, what loaded SHALL be rendered with its real values and only what failed SHALL show a failure.

A period whose deposits all arrived by one method SHALL be reported as a labelled amount rather than as a share of a whole. A share chart of one part is not information, and it is the permanent state of every owner who configured only one payment method.

#### Scenario: The figures load and the charts do not

- **WHEN** the figures read succeeds and the chart read raises
- **THEN** every figure is shown with its real value
- **AND** each chart shows a failure message and no series
- **AND** the selected period remains marked in the control

#### Scenario: Appointments with no deposits are a zero series, not a failure

- **WHEN** the period has confirmed appointments and no approved deposits
- **THEN** the income chart draws a zero series and says the period collected nothing
- **AND** no failure state is shown

#### Scenario: A business with no history is shown no charts

- **WHEN** the owner has never had a booking in any status
- **THEN** the existing empty-business message is shown and neither chart is rendered

#### Scenario: A period with no appointments claims none

- **WHEN** the selected period has neither confirmed appointments nor cancellations
- **THEN** the empty-period message is shown and neither chart is rendered
- **AND** nothing on the page states that appointments happened

#### Scenario: A single payment method is stated rather than drawn as a whole

- **WHEN** every approved deposit in the period arrived by the same method
- **THEN** that method's amount and count are stated
- **AND** no share of a single part is drawn

### Requirement: The charts depend on no client JavaScript and add no charting library

Both charts SHALL be rendered on the server and SHALL be complete with scripting disabled. This extends the requirement the capability already carries for its figures and its period control, rather than narrowing it.

**No client-side charting or dashboard library SHALL be added for this capability.** A library whose layout depends on measuring the browser cannot render on the server, would produce different markup on hydration on a surface displaying money, and would require the non-visual equivalent above to be written anyway. The stack's named charting options remain available to the project and stop being the default for this page; the documents that name them SHALL be amended to record that and why.

All `Intl` formatting SHALL continue to happen on the server.

#### Scenario: The charts render with scripting disabled

- **WHEN** the statistics page is opened with JavaScript disabled
- **THEN** both charts are present with their values
- **AND** every period remains selectable

#### Scenario: No charting dependency enters the bundle

- **WHEN** the project's dependencies are inspected after this change
- **THEN** no client-side charting or dashboard library has been added
- **AND** the measured bundle growth attributable to the charts is reported

### Requirement: The charts are legible on a phone and the loading state is shaped like them

A chart SHALL scale to its container rather than overflow it, and the page SHALL NOT scroll horizontally at a narrow phone width. Bucket labels on the longest axis SHALL abbreviate, thin out or rotate rather than overlap or extend past the container.

The loading state SHALL reserve space shaped like the charts as well as like the figures, so the layout does not jump when the real markup arrives. The period control SHALL continue to render there, as it already does.

Narrow-width behaviour SHALL be measured rather than judged by eye.

#### Scenario: A month of buckets fits a narrow phone

- **WHEN** a thirty-one-day period is rendered at a narrow phone width
- **THEN** the chart fits its container, its labels remain legible, and the page does not scroll horizontally

#### Scenario: The layout does not jump when the charts arrive

- **WHEN** the page is loading
- **THEN** space is reserved for both charts and for the figures
- **AND** the period control is present throughout

### Requirement: The charts are proven against the live database and on both runtimes

A gate script SHALL run this change's real statements against the live database before the change is considered complete, for the reason the capability's existing gate records: a mocked raw query proves the call was made and never that the driver would accept its result types. Bucket assignment returns a wide integer type and a grouped aggregate returns a set, both of which are new shapes for this capability.

The gate SHALL cover, at minimum: cross-owner isolation in both directions for every new read, the money specifically; a booking with declined attempts contributing exactly one payment to exactly one method; an approved payment on a non-confirmed booking absent from every bucket and both method parts; buckets summing to the deposits figure; a period with an empty bucket in the middle of it; both half-open boundaries of the first and last bucket; and the cash-collected figure differing from the deposits figure over a deposit approved in one period for an appointment in another.

Each probe SHALL be able to fail for the reason it names. A probe whose assertion would hold equally if the mechanism it claims to test were absent SHALL be replaced by one that measures the counterfactual.

Every probe SHALL run under a client-side timeout: a hung read is not a caught read, and a probe that never returns leaves its fixture behind. A probe that cannot run SHALL be reported as not run, never as passed.

The gate SHALL capture the new statement's query plan, and any index SHALL be added only if that plan asks for one.

The charts SHALL then be verified at runtime on both the Node and the Workers runtimes, authenticated, against real rows, with any seeded fixture removed afterwards — including a check performed while the runtime's own calendar disagrees with the business's, over rows chosen so that a wrong answer differs by **which** rows it counts rather than by how many.

#### Scenario: The grouped statement is executed against the real database

- **WHEN** the gate runs
- **THEN** the statement executes through the driver adapter and every returned column is read into its domain type

#### Scenario: A probe measures the counterfactual it claims to test

- **WHEN** a gate probe asserts that a read is owner-scoped
- **THEN** it also measures the result with the owner predicate removed and the two differ

#### Scenario: The Workers runtime draws the same series as Node

- **WHEN** the page is rendered on both runtimes against the same rows
- **THEN** every bucket, every method part and every figure is identical

### Requirement: The period's confirmed appointments are ranked by service and by barber

The page SHALL report, for the selected period, which services were booked most and which barbers performed the most appointments.

Both rankings SHALL count **confirmed appointments whose start instant falls in the period**, over the same row set and the same clock as the confirmed-appointments figure. An `EXPIRED` booking SHALL NOT be counted as anything: it is how this product tells a lapsed deadline apart from a decision, and the sweep produces those rows continuously — counting them would rank abandoned checkouts as demand.

**No payment row SHALL be joined into either ranking.** A booking carries any number of rejected payment attempts by design, so the join multiplies a retried booking and inflates its service and its barber. The counts are counts of appointments.

A service that is no longer offered SHALL still appear when it has appointments in the period. It is history, and omitting it would break the reconciliation the ranking is required to satisfy.

#### Scenario: A client who retried a declined card does not inflate any ranking

- **WHEN** a confirmed booking in the period carries two rejected payments and one approved payment
- **THEN** the service ranking counts that booking exactly once
- **AND** the barber ranking counts it exactly once

#### Scenario: An abandoned checkout is not demand

- **WHEN** the period contains an expired booking for a service with no other appointments
- **THEN** that service does not appear in the ranking

#### Scenario: A service that is no longer offered still appears

- **WHEN** the period contains confirmed appointments for a service that has since been deactivated
- **THEN** that service appears in the ranking with its count

### Requirement: A ranking is ordered, capped and folded in the domain, and the fold preserves the total

Each ranking SHALL be ordered by count descending with an **explicit tie-break on the label, ascending**. Ordering SHALL NOT be left to the statement's row order: two renders of the same period would otherwise be free to disagree, and the owner would see a ranking change while nothing changed.

Each ranking SHALL show at most a fixed number of named entries, with **every remaining entry folded into a single aggregated entry whose count is their sum**. The fold SHALL happen in the domain, not as a `LIMIT` in the statement: a discarded remainder is invisible and breaks the reconciliation requirement below.

The aggregated entry SHALL NOT carry a service or barber name, and SHALL NOT be drawn as a bar — a bar whose height aggregates unlike things invites being read as one thing, and in a shop with a wide catalogue it is often the longest.

**It SHALL nevertheless be listed wherever the named entries are listed, and not only in the text equivalent.** What must not be drawn is its *length*, not its existence: a ranking whose visible shares sum to less than the period, with nothing on screen accounting for the rest, tells an owner that a number is missing. The named entries and the remainder are one list; only the geometry stops at the cap.

A percentage share MAY be shown beside a count. It is display-only: nothing SHALL reconstruct a count from a share, and no share SHALL be divided by another.

#### Scenario: A tie does not reorder between two identical renders

- **WHEN** three services each have exactly four confirmed appointments in the period
- **THEN** the three appear in the same order in two successive renders of the same period

#### Scenario: A catalogue larger than the ranking keeps its total

- **WHEN** the period contains confirmed appointments across twelve distinct services and the ranking shows eight
- **THEN** eight named services and one aggregated remainder entry are shown
- **AND** the sum of every rendered count equals the confirmed-appointments figure

### Requirement: Ranking labels are read live, and an ambiguous label is resolved by its location

Service names, barber display names and location names SHALL be read from their current rows. The booking record snapshots the price it was made at and does not snapshot any of these, so **renaming a service relabels its history and a barber who changes branch carries their history to the new branch's label**. Both are accepted and stated here so they are not later reported as defects; grouping is by identity, so nothing merges and nothing splits — only the label is anachronistic.

A barber's display name is unique within a location and **not** across the business, so two barbers of one owner may share one. The barber ranking SHALL therefore carry each barber's location and SHALL qualify a row with it **only when that display name appears more than once among the period's barbers**. Qualifying every row would be noise for the single-location shop that is the common case.

**The ambiguity is decided over the period, not over the rendered rows.** A barber whose same-named twin fell past the cap into the aggregated entry would otherwise lose the qualifier that says which one he is: unambiguous in the list, ambiguous in the business, and it is the business the owner is reading about.

#### Scenario: Two barbers sharing a display name are told apart

- **WHEN** two barbers with the same display name at two different locations of one owner each have confirmed appointments in the period
- **THEN** each of their rows is qualified by its location

#### Scenario: An unambiguous ranking carries no qualifier

- **WHEN** every barber in the rendered ranking has a distinct display name
- **THEN** no row is qualified by a location

#### Scenario: A qualifier survives its twin being folded away

- **WHEN** two barbers share a display name and one of them falls past the cap into the aggregated entry
- **THEN** the one still shown is qualified by its location

### Requirement: The period's appointments are distributed across the hours of the business's day

The page SHALL report how many confirmed appointments of the period start in each hour of the day, **summed across every day the period covers**.

The axis SHALL be the full twenty-four hours of the business's calendar, whatever the period contains, and SHALL NOT be trimmed to any barber's working hours — a schedule can be edited after an appointment is made, and a trimmed axis would silently drop it. An hour with no appointments SHALL be drawn as zero and SHALL NOT be skipped: a chart that omits a quiet hour draws a plausible shape on an axis that is too short, and nothing about it looks wrong.

The distribution SHALL be drawn for **every** range the page offers, including the single-day ranges, where it is one day's shape rather than a trend. The copy naming the period is what keeps the reading honest; suppressing the chart for two of six ranges would make the page's shape depend on the selection, which is the one thing an owner comparing periods needs to stay fixed.

#### Scenario: A quiet hour is drawn as zero rather than skipped

- **WHEN** the period contains confirmed appointments in three hours of the day
- **THEN** twenty-four buckets are rendered
- **AND** the twenty-one hours with no appointments are drawn at zero

#### Scenario: An appointment outside every working hour is still counted

- **WHEN** a confirmed appointment in the period starts outside the working hours currently configured for its barber
- **THEN** it is counted in the hour it starts in

### Requirement: An appointment's hour is a business-calendar fact computed outside SQL

The hour an appointment is counted in SHALL be decided by the business's calendar and never by the session's timezone, which is UTC in this deployment on both the pooler and the Workers runtime. A statement SHALL NOT truncate a timestamp, SHALL NOT extract an hour from one, and SHALL NOT name a timezone: it receives instants computed in the domain and only compares a row against them.

The bucket boundaries SHALL be derived from the same clock read and the same range as every figure on the page, so an appointment counted by a figure cannot be missing from the distribution.

#### Scenario: A late-evening appointment lands in the business's hour, not the runtime's

- **WHEN** a confirmed appointment starts at 21:30 in the business's calendar and the runtime's clock is UTC
- **THEN** it is counted in hour 21
- **AND** the same page rendered on the Workers runtime counts it in hour 21

#### Scenario: No statement computes an hour

- **WHEN** the breakdown statement is inspected
- **THEN** it contains no timestamp truncation, no hour extraction from a timestamp and no timezone name

### Requirement: Every breakdown reconciles with the confirmed-appointments figure

Given one set of rows, the service ranking, the barber ranking and the hour distribution SHALL each sum to the count of confirmed appointments those same rows represent. This SHALL be proven in the domain, with no database involved, and again against real rows.

It SHALL NOT be asserted across reads on the rendered page. The reads are independent by design, so a booking confirming between two of them leaves a breakdown one short until the next render; asserting the invariant there would turn an accepted, self-correcting skew into a rendered error.

#### Scenario: Three breakdowns and one figure agree

- **WHEN** a set of confirmed bookings is grouped, ranked, folded and filled
- **THEN** the service counts, the barber counts and the hourly counts each sum to the number of those bookings
- **AND** this holds with no database involved

#### Scenario: A bucket outside the period is dropped rather than moved

- **WHEN** a grouped row is assigned a bucket outside the span the period's edges cover
- **THEN** it is dropped rather than counted in the nearest hour

### Requirement: A breakdown's empty, degenerate and failed states are distinct

A failed breakdown read SHALL NOT render as an empty ranking or a flat distribution. Zero appointments in an hour is a statement about the business; a failed read is not, and the two SHALL NOT look alike.

**A period with cancellations and no confirmed appointments SHALL render no breakdown at all.** That period renders figures rather than the empty state — cancellations are something that happened — but every breakdown is confirmed-only, so three empty sections would appear beneath a populated figures block, explaining nothing. The condition that gates the breakdowns SHALL therefore be confirmed activity specifically, and SHALL be one named definition rather than a condition repeated per section.

A shop that has never had a booking, and a period with nothing to report, SHALL each render no breakdown, for the reason those states already suppress the charts.

A ranking of a **single** service or a **single** barber SHALL be stated in words rather than drawn: a ranking of one is not a ranking, and a hundred-percent share is not information. It is the treatment a single payment method already receives.

When the figures read has also failed, the breakdown failure SHALL say nothing about the figures. Copy that reassures the owner their other numbers are current is true when only one read failed and false when it is printed beneath a card apologising for those numbers.

#### Scenario: A period with cancellations and no confirmations shows no breakdown

- **WHEN** the selected period contains cancelled bookings and no confirmed bookings
- **THEN** the figures report the cancellations
- **AND** no service ranking, barber ranking or hour distribution is rendered

#### Scenario: A shop with one barber is told, not charted

- **WHEN** every confirmed appointment of the period belongs to the owner's only barber
- **THEN** the barber section states that barber and their count in words
- **AND** no ranking is drawn

#### Scenario: A failed breakdown read never renders as an empty ranking

- **WHEN** the breakdown statement raises and the figures succeed
- **THEN** the breakdown section states that it could not be loaded
- **AND** no ranking and no distribution is drawn at zero

#### Scenario: Every read failing produces one honest message

- **WHEN** all three reads raise
- **THEN** no section claims that any other section's numbers are current

### Requirement: The breakdowns depend on no client JavaScript and are readable without seeing them

Every breakdown SHALL be rendered on the server, SHALL add no charting dependency to the bundle, and SHALL format every value on the server — the page's no-client-JavaScript guarantee is tested and this capability does not weaken it.

Every drawn breakdown SHALL carry an equivalent that does not require seeing it: the counts SHALL be reachable as text, and a ranking SHALL be readable without colour.

**The equivalent SHALL be announced once.** Where the same values are also written beside the drawing for sighted readers, exactly one of the two SHALL reach assistive technology — visually hiding a text equivalent hides it from sight and not from a screen reader, so leaving both audible reads the whole ranking twice.

Any element identifier inside a drawn breakdown SHALL be unique across the whole page and SHALL be derived from a stable input. The page now carries several inline drawings; a shared identifier is a duplicate in the document, and one derived from a random value or a render counter is a hydration mismatch.

#### Scenario: A ranking is announced once rather than twice

- **WHEN** a ranking renders both its visible rows and its text equivalent
- **THEN** exactly one of the two is reachable by assistive technology

#### Scenario: The aggregated remainder is visible without the text equivalent

- **WHEN** a ranking folds entries past the cap into an aggregated entry
- **THEN** that entry is listed with the named rows and drawn as no bar

#### Scenario: The breakdowns render with scripting disabled

- **WHEN** the page is opened in a production build with JavaScript disabled
- **THEN** both rankings and the hour distribution are present in the served markup
- **AND** their text equivalents are present

#### Scenario: No charting dependency enters the bundle

- **WHEN** the client bundle for this route is measured against the previous release
- **THEN** it contains no charting library
- **AND** the increase is accounted for by markup and copy

### Requirement: The breakdowns are legible on a phone and name nothing personal

Every breakdown SHALL render inside its container at a narrow phone width without the page scrolling horizontally. A long service name or barber display name SHALL wrap or be truncated rather than overflow. Hour labels SHALL be thinned rather than allowed to overlap.

No breakdown SHALL carry a client's name, email address, telephone number, booking identifier or cancellation token, and no failure log SHALL carry a service name, a barber name or an amount.

#### Scenario: A long name does not break the layout

- **WHEN** a service with a long unbroken name appears in the ranking at a narrow phone width
- **THEN** the page does not scroll horizontally

#### Scenario: A failure log names nothing

- **WHEN** the breakdown read fails
- **THEN** the logged context carries no service name, no barber name and no amount

### Requirement: The breakdowns are proven against the live database and on both runtimes

The raw statement SHALL be executed against the real database, over real rows, in a gate that runs outside the unit suite. A mocked repository certifies a projection whether or not the driver can deserialize it on the Workers runtime, and this project has shipped that defect once already.

Every probe SHALL measure a **counterfactual**: an assertion that would hold equally with the mechanism it names removed is worse than no assertion. At minimum, removing the owner predicate SHALL change the totals, removing the confirmed predicate SHALL change the totals, and computing the hour from the runtime's clock SHALL disagree with computing it from the business's.

The page SHALL be rendered on both the Node and the Workers runtime and SHALL produce identical breakdowns.

#### Scenario: The raw statement is executed against the real database

- **WHEN** the gate runs
- **THEN** the breakdown statement is issued to the live database and its result is asserted against known rows

#### Scenario: A probe measures the counterfactual it claims to test

- **WHEN** a probe asserts that the owner predicate scopes the ranking
- **THEN** the same probe with that predicate removed produces a different total

#### Scenario: The Workers runtime produces the same breakdowns as Node

- **WHEN** the page is rendered on both runtimes against the same rows
- **THEN** every ranking row, every count and every hourly bucket is identical
