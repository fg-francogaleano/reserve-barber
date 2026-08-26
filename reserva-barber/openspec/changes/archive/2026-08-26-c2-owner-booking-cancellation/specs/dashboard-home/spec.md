## MODIFIED Requirements

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
