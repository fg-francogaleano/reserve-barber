## MODIFIED Requirements

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

### Requirement: Every figure comes from one owner-scoped round trip

All figures and both charts SHALL be produced by **at most two statements**, and those statements SHALL be **independently issued and independently recoverable**.

**They SHALL NOT share a transaction, and the skew that admits is accepted deliberately.** The alternative was a repeatable-read transaction, which would guarantee the bars and the figure beside them were read from one snapshot. Three things argue against it and one for it:

- An interactive transaction holds a connection open across round trips against a **transaction-mode pooler**, which every other repository in this project is careful not to do, on the pool the public booking flow shares.
- The grouped read is the heavier of the two and the pooler is on record hanging rather than raising. Inside a transaction, that failure costs the owner the five figures **as well as** the charts — a regression against what this page does today, for the sake of a rarer defect.
- Independent failure is the more valuable property precisely because the likelier failure is asymmetric.

What it costs: a booking confirming into the selected period **between** the two reads — a window of roughly one pooler round trip — leaves the bars summing to one deposit less than the figure above them, until the next render. Rare, silent, and self-correcting.

**Reconciliation SHALL therefore be proven where it is decidable rather than assumed from a snapshot**: given one set of rows, the filled series SHALL sum to the same total the aggregate reports, tested in the domain with no database involved. That is the property a reader actually depends on, and a transaction never proved it — it only prevented one way of breaking it.

It is also a page reading a whole booking history against a connection pool the public booking flow shares, which is the second reason the statement count stays bounded.

Scope SHALL reach the owner through the booking's barber and that barber's location. A booking's location is deliberately not duplicated onto the row, so this is the only path, and there is no row-level security on these tables: **the join is the tenancy boundary**. Every sub-query and every additional statement SHALL carry its own owner predicate rather than relying on correlation to an outer query alone.

Cross-owner isolation SHALL be proven by a two-owner fixture in both directions, never by inspection, for **every** read this capability issues. A leaked aggregate produces no row that can look wrong — only a plausible integer, or a plausible bar.

The statements SHALL narrow and SHALL NOT decide. They filter by owner, by status and by an instant range. They SHALL NOT restate the availability predicate: no figure and no chart here asks whether a hold is live, so no clause here reads the hold deadline.

Counts and bucket indexes SHALL be narrowed from the driver's wide integer type at the repository boundary; monetary values SHALL cross as canonical decimal strings.

#### Scenario: Another owner's figures are unreachable in both directions

- **WHEN** two owners each have locations, barbers, confirmed bookings and approved payments
- **THEN** each owner's page reports only their own figures
- **AND** the income figure excludes every payment belonging to the other owner
- **AND** every chart bucket and every method share excludes them too

#### Scenario: The page costs no more than two round trips

- **WHEN** the page is rendered for a range with results
- **THEN** at most two queries reach the database for the figures and the charts

#### Scenario: The series reconciles with the figure it sits beneath

- **WHEN** a set of grouped rows is filled into a series and totalled
- **THEN** the sum equals the deposits total those same rows represent, to the centavo
- **AND** this holds with no database involved

#### Scenario: The heavier read failing does not cost the figures

- **WHEN** the chart statement times out and the aggregate statement succeeds
- **THEN** the five figures are rendered with their real values
- **AND** neither read was issued inside a transaction shared with the other

#### Scenario: A shop with no barbers reports zeros, not a failure

- **WHEN** the owner has no locations, no barbers and no bookings
- **THEN** every figure reads zero, the average is absent, and no failure state is shown

## ADDED Requirements

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
