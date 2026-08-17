## ADDED Requirements

### Requirement: Client model as single source of truth
The `Client` entity SHALL be defined in `prisma/schema.prisma` with `id` (cuid primary key), `ownerId`, `name` (at most 120 characters), `email` (at most 255), `phone` (at most 30), `createdAt` and `updatedAt`. It SHALL declare `onDelete: Restrict` on its owner foreign key and a unique constraint on `(ownerId, email)`.

The entity is created by this change and **written by none of it**. `Booking.clientId` is a required foreign key, so the table is not optional scope — it arrives with the booking table or the booking table cannot exist. The deduplication the unique constraint enables belongs to B4.

`Restrict` rather than `Cascade`: a client row is the identity behind real appointments and real money, and it must not disappear because a parent row was removed.

Schema changes SHALL be applied through a migration; direct database edits are forbidden.

#### Scenario: Migration creates the table
- **WHEN** the migration is applied
- **THEN** the `Client` table exists with the unique constraint on owner and email

#### Scenario: Migration is additive
- **WHEN** the migration runs against a database holding existing owners and barbers
- **THEN** no existing table is altered, no backfill occurs, and no existing row is modified

#### Scenario: No application code writes a client
- **WHEN** the change is reviewed
- **THEN** no route, action or repository method in it inserts, updates or deletes a client row

### Requirement: Booking model as single source of truth
The `Booking` entity SHALL be defined in `prisma/schema.prisma` with `id` (cuid primary key), `clientId`, `barberId`, `serviceId`, `startTime`, `endTime`, `status`, `priceAtBooking`, `depositAmount`, `cancellationToken`, `holdExpiresAt`, `cancelledAt`, `cancelledBy`, `createdAt` and `updatedAt`, exactly as `docs/data-model.md` §11 defines them. `BookingStatus` and `CancelledBy` SHALL be native PostgreSQL enums.

Four declarations are load-bearing and SHALL be made in this migration rather than corrected later:

- `startTime`, `endTime`, `holdExpiresAt` and `cancelledAt` SHALL be zone-aware columns (`@db.Timestamptz`). Prisma's default for `DateTime` is a zone-less `TIMESTAMP`, and `docs/data-model.md` names inheriting it by omission as the failure mode the convention exists to prevent.
- `priceAtBooking` and `depositAmount` SHALL declare `@db.Decimal(12, 2)`, never Prisma's `Decimal(65,30)` default — the same declaration `Service.price` carries, deliberately wider than the application maximum so a numeric overflow is unreachable by construction.
- All four foreign keys — `Booking` to client, barber and service, and `Client` to owner — SHALL declare `onDelete: Restrict`. A booking carries data of its own, including money and a cancellation token that has travelled by email, and must not vanish silently with a parent.
- `cancellationToken` SHALL be unique, and the table SHALL carry an index on `(barberId, startTime)`.

The table is created here and written by none of this change. Creating it in one migration rather than assembling it across stories follows the precedent `PaymentConfig` set: an entity assembled across several migrations is several chances for those stories to disagree about its shape.

#### Scenario: Migration creates the table with zone-aware instants
- **WHEN** the migration is applied
- **THEN** all four instant columns are zone-aware, not the zone-less default

#### Scenario: Monetary columns declare their precision
- **WHEN** the schema is reviewed
- **THEN** both monetary columns declare an explicit precision and scale rather than inheriting Prisma's default

#### Scenario: Migration is additive
- **WHEN** the migration runs against the shared database
- **THEN** two tables and two enums are created, no existing column is altered, no backfill occurs, and no existing row is modified

#### Scenario: Foreign keys restrict rather than cascade
- **WHEN** the schema is reviewed
- **THEN** every booking foreign key declares restrict, and the reason is recorded alongside it

#### Scenario: No application code writes a booking
- **WHEN** the change is reviewed
- **THEN** no route, action or repository method in it inserts, updates or deletes a booking row

### Requirement: An appointment instant survives storage without drifting
Writing an appointment instant and reading it back SHALL return the same instant, confirmed against the real database rather than assumed.

`TimeOff` established this check for the first zone-aware columns in the schema. It is repeated here because a silent three-hour drift on a booking looks exactly like correct data, and because these are the columns an appointment time is compared against.

#### Scenario: Round trip through the database
- **WHEN** a known appointment instant is stored and read back
- **THEN** it equals the instant that was written

### Requirement: Blocking bookings are read by barber and range, indexed and owner-scoped
The repository SHALL expose a read returning the bookings that may block availability for one barber over a half-open instant range, carrying only `startTime`, `endTime`, `status` and `holdExpiresAt`.

The read SHALL take the owner as a required parameter and scope through `barber.location.ownerId`, so an unscoped booking query is inexpressible through the contract — the same property every other repository in this project holds. It SHALL be a single query served by the `(barberId, startTime)` index, and SHALL return a projection rather than persisted rows.

The range predicate SHALL be the half-open overlap `startTime < rangeEnd AND endTime > rangeStart`, matching the interval convention `TimeOff` and `Booking` share.

#### Scenario: One indexed, scoped query
- **WHEN** availability is computed for a barber and a date
- **THEN** the blocking bookings are read in a single query carrying the owner predicate and served by the barber-and-start-time index

#### Scenario: A foreign barber's bookings cannot be read
- **WHEN** the read is attempted for a barber belonging to a different owner
- **THEN** no rows are returned

#### Scenario: The read is a projection
- **WHEN** the read executes
- **THEN** it selects only the four columns availability needs, and carries no client identifier, token, price or deposit

#### Scenario: An appointment straddling the range boundary is returned
- **WHEN** a booking starts before the range and ends inside it
- **THEN** it is returned, because it overlaps the range under the half-open rule

### Requirement: Monetary columns cross the repository boundary as canonical strings
Should any read in this change or later surface `priceAtBooking` or `depositAmount`, the value SHALL cross the repository boundary as a canonical two-decimal string through the shared helper, never as a number and never as a driver decimal.

PC3 measured against the live database that the driver returns a stored `2000.50` as `2000.5`, and integer-cent arithmetic then read the lone `5` as five centavos. M3 had documented the same failure for `Service.price`. The helper exists and is shared; these two columns are the next place the same defect would land.

#### Scenario: The convention is declared with the columns
- **WHEN** the booking repository is reviewed
- **THEN** the monetary conversion rule is stated and no monetary value crosses a layer as a driver type

### Requirement: The booking tables are verified against the live database by a seeded gate
This change SHALL include a verification script following the existing per-story gate pattern, which seeds bookings directly — including a `PENDING_PAYMENT` booking whose hold has expired — exercises the availability read against the live database, and removes what it created.

No user interface can produce a booking until B4, so without a seeded gate the booking subtraction would be the one part of this change that nothing verifies against real data. This project's runtime verification has caught a defect no unit test did on more than one story.

#### Scenario: The gate seeds what no interface can
- **WHEN** the gate runs
- **THEN** it creates bookings in blocking and non-blocking states, including an expired hold, and asserts which of them affect the offered times

#### Scenario: The gate cleans up
- **WHEN** the gate finishes
- **THEN** every row it created has been removed
