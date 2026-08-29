## MODIFIED Requirements

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

## ADDED Requirements

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

A barber's display name is unique within a location and **not** across the business, so two barbers of one owner may share one. The barber ranking SHALL therefore carry each barber's location and SHALL qualify a row with it **only when that display name appears more than once in the rendered ranking**. Qualifying every row would be noise for the single-location shop that is the common case.

#### Scenario: Two barbers sharing a display name are told apart

- **WHEN** two barbers with the same display name at two different locations of one owner each have confirmed appointments in the period
- **THEN** each of their rows is qualified by its location

#### Scenario: An unambiguous ranking carries no qualifier

- **WHEN** every barber in the rendered ranking has a distinct display name
- **THEN** no row is qualified by a location

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

Any element identifier inside a drawn breakdown SHALL be unique across the whole page and SHALL be derived from a stable input. The page now carries several inline drawings; a shared identifier is a duplicate in the document, and one derived from a random value or a render counter is a hydration mismatch.

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
