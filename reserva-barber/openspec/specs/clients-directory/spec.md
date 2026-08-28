# clients-directory Specification

## Purpose
TBD - created by archiving change d4-clients-directory. Update Purpose after archive.
## Requirements
### Requirement: The owner sees every client who has ever reached their shop
The dashboard SHALL offer a read-only table listing the clients belonging to the session owner, showing each client's name, telephone number, email address, and how many bookings they represent.

The table SHALL be reachable from the dashboard navigation.

A client belongs to exactly one owner: the same person booking at two unrelated barbershops is two client records, because neither owner may see the other's customer list.

#### Scenario: The table lists this owner's clients
- **WHEN** the owner opens the clients table
- **THEN** each of their clients is listed with name, telephone, email and a booking count

#### Scenario: The table is reachable
- **WHEN** the owner is anywhere in the dashboard
- **THEN** the navigation offers a route to the clients table

### Requirement: The headline count is confirmed bookings, and a second count resolves what it cannot say
The primary number against each client SHALL be their count of `CONFIRMED` bookings, for all time. It SHALL NOT be a count of booking rows.

A count of rows is a count of **checkout attempts**: abandoned holds accumulate without bound relative to real business, so a client who never completed a payment would rank alongside one who has been served ten times.

That number alone cannot distinguish two opposite kinds of client, both of whom read as zero: somebody whose checkout created a client record and never became a booking, and somebody who booked repeatedly and cancelled every time. A **secondary count of cancelled and expired bookings** SHALL therefore be shown whenever it is non-zero, and SHALL be visibly subordinate to the primary one.

The secondary count exists to remove that ambiguity. It is not a statistic, and no further breakdown belongs on this surface.

#### Scenario: A client who has been served
- **GIVEN** a client with three confirmed bookings and none in any other status
- **WHEN** the owner opens the clients table
- **THEN** the client's headline count reads three
- **AND** no secondary count is shown

#### Scenario: A client who cancels everything
- **GIVEN** a client whose only three bookings are cancelled
- **WHEN** the owner opens the clients table
- **THEN** the headline count reads zero
- **AND** a secondary count states that three bookings were cancelled or expired

#### Scenario: Abandoned checkouts are not counted as business
- **GIVEN** a client with one confirmed booking and four expired holds
- **WHEN** the owner opens the clients table
- **THEN** the headline count reads one

### Requirement: A client with no bookings at all is shown as such and never as a customer
A client record can exist with no booking of any kind, and the table SHALL render it with a headline count of zero and no secondary count, distinguishable at a glance from a client with cancelled bookings.

This is not a hypothetical state. The booking flow creates the client record **before** it writes the booking and outside any shared transaction, so a submission refused by the live-hold cap — or one whose slot is taken in the interval — leaves a client record behind with nothing attached to it. Such a row is a failed checkout, not a customer, and a table that presented it as a customer would overstate the size of the business.

The table SHALL NOT hide such rows: the contact details are real, the person did reach the shop, and an owner may legitimately want to call them.

#### Scenario: A checkout that never became a booking
- **GIVEN** a client record created by a submission that was then refused
- **WHEN** the owner opens the clients table
- **THEN** the client is listed with a headline count of zero and no secondary count
- **AND** the row is distinguishable from a client whose bookings were cancelled

### Requirement: The ordering is total, and the tiebreaker is what makes paging correct
Clients SHALL be ordered by their confirmed-booking count descending, and ties SHALL be broken by a value unique to each client.

The tiebreaker is not presentational. Most clients will have exactly one confirmed booking, so ties are the ordinary case rather than the rare one; an ordering that leaves tied rows in an undefined sequence lets a paged read return the same client on two pages and omit another entirely, with nothing on the page to indicate it happened.

#### Scenario: Many clients with the same count
- **GIVEN** twenty clients each with exactly one confirmed booking
- **AND** a page size of ten
- **WHEN** the owner reads the first page and then the second
- **THEN** the twenty rows are distinct
- **AND** no client appears on both pages

#### Scenario: The most valuable clients come first
- **GIVEN** clients with three, one and zero confirmed bookings
- **WHEN** the owner opens the clients table
- **THEN** they are listed in that order

### Requirement: The table is bounded, paged, and its page parameter degrades rather than fails
The number of rows read and rendered per request SHALL be bounded by a named constant. An unbounded read would grow with the shop's entire history on a page the owner opens casually.

The page SHALL be carried in the URL so that navigation, refresh and back/forward reproduce the same view without client-side state.

The submitted page value SHALL be length-bounded before it is parsed, and a value appearing more than once SHALL resolve to its first occurrence. A value that is absent, malformed, or below the first page SHALL degrade to the first page; a value beyond the last page SHALL degrade to the last page. None of these SHALL produce a 404, an exception, or an empty table.

A submitted page value SHALL be clamped against a **fixed ceiling** before it can become a database offset, so that no parameter can produce an arbitrarily large one: an unbounded offset makes the database walk and discard rows on a request somebody typed.

That ceiling is the only bound available before the read, because the real total is not known until the read returns. A page **within** the ceiling but past the end therefore does reach the database once, returns nothing, and is resolved against the real total by a second read. That extra read is the accepted cost of keeping the ordinary case at a single statement, and it SHALL be the only case that costs two.

#### Scenario: A malformed page
- **WHEN** the clients table is requested with a page parameter that does not parse
- **THEN** the first page is rendered and no error state is shown

#### Scenario: A page beyond the last
- **GIVEN** a shop whose clients fit on two pages
- **WHEN** the clients table is requested for page nine hundred
- **THEN** the last page is rendered with its rows
- **AND** the request costs exactly one read more than a page that exists

#### Scenario: A page number far beyond the ceiling
- **WHEN** the clients table is requested for page nine hundred million
- **THEN** the offset that reaches the database is the ceiling's, not the submitted number's
- **AND** the last page is still rendered

#### Scenario: A repeated parameter
- **WHEN** the page parameter appears more than once
- **THEN** the first occurrence is used and the page renders normally

### Requirement: The page and its counts come from one owner-scoped round trip
The table's data SHALL be obtained through a dedicated read-only repository contract whose every method takes the session owner, so that an unscoped client query is inexpressible through it.

Scope SHALL be the client's own owner column. There is no row-level security on this table: the predicate **is** the tenancy boundary, and it is a single condition — which makes it easier to omit without any row looking wrong.

The rows for a page and the total used to clamp paging SHALL be obtained in **one round trip**. The per-client booking counts SHALL be produced by a single aggregate over the page, never by a query per row: this page renders a whole customer base, against a connection pool shared with the public booking flow.

Cross-owner isolation SHALL be proven by a fixture containing two owners, in both directions, never by inspection.

#### Scenario: Another owner's clients
- **GIVEN** owner A and owner B each have clients with bookings
- **WHEN** owner A opens the clients table
- **THEN** only owner A's clients are listed
- **AND** the total used for paging counts only owner A's clients

#### Scenario: One round trip, one aggregate
- **WHEN** a page of clients is read
- **THEN** the rows, their counts and the total are obtained in a single database round trip
- **AND** no query is issued per client

### Requirement: This surface renders other people's personal data, and treats it accordingly
This is the first surface in the product to display a guest's email address and telephone number, and the constraints below are what make that acceptable rather than incidental.

The page SHALL resolve the session owner in its own right before any read begins. It SHALL be rendered dynamically per request and SHALL NOT be cached — a cached render hands one shop's customer database to whoever asks next. It SHALL instruct search engines not to index or follow it.

No personal data SHALL appear in a URL. This is why the table offers no search: an email address in a query string reaches browser history, referrer headers, and every access log on the path.

No log entry produced by this page SHALL contain a client's name, email address or telephone number, nor the submitted page parameter.

A failed read is logged through the **shared error-context helper**, and what that helper actually produces SHALL be stated rather than assumed: an operation name, the driver's error code where there is one, and — for codes it does not recognise as value-bearing — the error's **message**. It strips the message only for the constraint-violation codes whose text embeds submitted values, because it was written for the write paths where those occur.

That is sufficient here and the reason is specific to a read: this page's statement is parameterised, so its parameters are an owner id and two integers, and a failure occurs before any client row is materialised. What must not happen is this page constructing a **richer** context than the helper's, so the logged context SHALL carry no key beyond the helper's own, and a test SHALL pin that set rather than merely checking that today's values are absent.

#### Scenario: The logged context carries nothing of its own
- **WHEN** the clients read fails and the failure is logged
- **THEN** the context contains only the keys the shared helper produces
- **AND** none of them holds a client name, email address, telephone number or the page parameter

The projection SHALL carry what the table renders and nothing further: no booking identifiers, no monetary values, no timestamps.

#### Scenario: A request without a session
- **WHEN** the clients table is requested without a session
- **THEN** no database read begins and the request is refused by the guard

#### Scenario: A failure records no contact details
- **WHEN** the clients read fails and the failure is logged
- **THEN** the entry carries an operation name and an error name
- **AND** it contains no client name, email address, telephone number or page parameter

#### Scenario: Nothing personal travels in the URL
- **WHEN** the clients table renders any state
- **THEN** the only parameter it uses or produces is the page number

### Requirement: Contact details are actionable from the table
A client's telephone number SHALL be offered as a telephone link and their email address as a mail link.

Finding a client is not the owner's goal; contacting them is. A number that must be transcribed by hand from a phone screen is the failure mode this table exists to remove.

#### Scenario: Reaching a client
- **WHEN** a client row renders
- **THEN** its telephone number is a telephone link and its email address is a mail link

### Requirement: An empty table, an over-run page, and a failed read are three different states
The page SHALL define and render distinctly:

- **a shop with no clients yet**, named as such and offering the route to the public profile, because a shop that has never been booked is the ordinary first state of this page;
- **a page beyond the last**, which resolves to the last page rather than rendering an empty table;
- **a failed read**, as a message inside the page stating that the clients could not be loaded;
- **a loading state** shaped like the table, so the layout does not jump.

A failed read SHALL NOT render an empty table, a zero count, or any optimistic content, and SHALL NOT fall through to the route's error boundary — which would replace the page rather than report the failure in it. Zero and failure never render alike.

#### Scenario: A shop that has never been booked
- **WHEN** the owner opens the clients table with no clients stored
- **THEN** the page says so and offers the route to the public profile

#### Scenario: The read fails
- **GIVEN** the database is unreachable
- **WHEN** the owner opens the clients table
- **THEN** a failure message is rendered inside the page
- **AND** no table and no "no clients yet" message is shown
- **AND** the route's error boundary is not reached

### Requirement: The table is legible on a phone and operable without a mouse
Below the small breakpoint the clients SHALL be presented as a list of per-client blocks rather than as a horizontally scrolling table: four columns of contact data do not fit a phone, and this is a surface the owner opens between clients.

At larger sizes it SHALL be a real table with column headers associated to their columns, fully operable by keyboard.

A name, email address or telephone number at its stored maximum length SHALL wrap rather than overflow, and the page body SHALL NOT scroll horizontally.

Each count SHALL be rendered with a label rather than as a bare number, so that the primary and secondary counts cannot be confused for one another.

#### Scenario: A maximum-length name
- **WHEN** a client's stored name is at its maximum length with no spaces
- **THEN** the row wraps and the page does not scroll horizontally

#### Scenario: On a phone
- **WHEN** the table renders below the small breakpoint
- **THEN** each client is a block rather than a row in a horizontally scrolling table

### Requirement: Every user-facing string this capability introduces is Spanish and lives in the copy module
All copy this capability introduces SHALL be Spanish (es-AR) and SHALL live in the shared copy module under its own namespace, not inline in a component.

#### Scenario: No inline strings
- **WHEN** the clients table renders
- **THEN** every user-facing string it displays is read from the copy module

### Requirement: The directory is proven against the live database and on both runtimes
The behaviour of this capability SHALL be verified by a gate script executed against the live database, covering at least: cross-owner isolation in both directions on a two-owner fixture, a client with only cancelled bookings, a client with no bookings at all, the tie ordering stable across two consecutive pages, the counts matching real rows, and the round-trip count measured rather than asserted.

The page SHALL additionally be driven over HTTP, authenticated, on both the Node development runtime and the `workerd` runtime.

A probe that cannot be executed SHALL be reported as **not run**. It SHALL NOT be reported as passing.

#### Scenario: The gate runs against real rows
- **WHEN** the gate executes against the live database
- **THEN** each listed condition is exercised against real rows and its outcome reported individually

#### Scenario: A probe that cannot complete
- **WHEN** a probe cannot complete in the environment the gate is run from
- **THEN** it is reported as not run rather than as passed

