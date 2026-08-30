## ADDED Requirements

### Requirement: A booking records when its client was reminded, and unlike its neighbour that record IS the idempotency key

The `Booking` row SHALL carry a nullable, zone-aware instant recording that a reminder was claimed for it, declared with the explicit `Timestamptz` type the model's convention requires at creation rather than corrected later.

**Its semantics are the opposite of the column beside it, and the schema SHALL say so explicitly.** The confirmation-send column documents in its own comment that it is *not* an idempotency key and that nothing reads it before sending, because at-most-once delivery there is a property of a guarded status transition. The reminder has no such transition, so this column is the mechanism: it is read as part of the claim and it is what makes a second attempt match zero rows.

The comment SHALL name the neighbouring column and the difference, because a reader who generalises from whichever of the two they encounter first will be wrong about the other.

Its null on a `CONFIRMED` future booking SHALL mean "a reminder is still owed"; its presence SHALL mean "a reminder was claimed", which is deliberately not the same as "a reminder was delivered".

No backfill SHALL accompany the migration. Every existing booking gets null, which is correct in both directions: a future confirmed booking becomes a candidate, and a past one is excluded by the capability's own window rule.

#### Scenario: The column is declared zone-aware at creation
- **WHEN** the migration is reviewed
- **THEN** the column is a nullable timestamp with time zone, declared explicitly rather than inheriting the tool's zone-less default

#### Scenario: The schema distinguishes the two email columns
- **WHEN** the model is read
- **THEN** the reminder column's comment states that it is an idempotency key, names the confirmation column beside it, and states that the confirmation column is not one

#### Scenario: The migration changes no data
- **WHEN** the migration is applied to a database holding bookings in every status
- **THEN** no row's status, instant, snapshot or token changes, and every row's new column is null

---

### Requirement: The reminder claim is one guarded statement that writes one column

The claim SHALL be a single conditional update: it SHALL set the reminder instant only on rows whose reminder instant is currently null and whose status is `CONFIRMED`, and SHALL return the rows it matched.

It SHALL NOT run inside an explicit transaction. A single statement is already atomic, and wrapping it would hold a connection from a pool capped at five — shared with the owner's dashboard and the public booking write — across a decision made in application code. This is the reasoning the sweep's repository already records about itself.

It SHALL NOT acquire the per-barber advisory lock, which exists so that two writers cannot **place** a booking into one slot. This write places nothing.

It SHALL write the reminder instant and nothing else — never `status`, never `holdExpiresAt`, never a monetary snapshot, never the cancellation token. The framework's automatic `updatedAt` bump accompanies it, as it does every write through the client, and the contract SHALL state that rather than claiming a single-column write it cannot deliver.

#### Scenario: A booking that changed underneath the run matches zero rows
- **WHEN** a selected candidate is cancelled or expired before the claim statement executes
- **THEN** the statement matches zero rows and the booking's reminder instant stays null

#### Scenario: A second claim over the same rows matches nothing
- **WHEN** the claim runs twice over the same booking ids
- **THEN** the second execution returns no rows

#### Scenario: The claim disturbs nothing else
- **WHEN** a booking is claimed and its whole row is compared before and after
- **THEN** only the reminder instant and the automatic update timestamp differ

#### Scenario: No transaction and no lock
- **WHEN** the claim's data access is reviewed
- **THEN** it issues one statement, opens no transaction and acquires no advisory lock

---

### Requirement: The reminder candidate predicate is served by a partial index the schema tool cannot declare

The reminder candidate query SHALL be served by a partial index on the appointment instant, restricted to rows whose status is `CONFIRMED` and whose reminder instant is null.

The index SHALL be created in the migration as raw SQL, because the schema tool cannot express a partial index, and it SHALL be named in the model's existing comment block listing the indexes the schema file does not contain. A schema file mistaken for the whole truth is how an index silently stops existing — the treatment the sweep's two partial indexes already receive.

The predicate is what bounds the index: a booking leaves it permanently once reminded, so it holds only unreminded future appointments.

**The plan SHALL be confirmed against the live database rather than assumed.** The existing booking indexes cannot serve this query — the barber-and-instant index names a barber this query does not, and the sweep's two partial indexes are restricted to the provisional statuses.

#### Scenario: The index is created by the migration
- **WHEN** the migration is applied
- **THEN** the partial index exists with both predicate clauses

#### Scenario: The schema file names what it cannot declare
- **WHEN** the booking model is read
- **THEN** its comment block listing undeclarable indexes includes this one

#### Scenario: The plan is measured
- **WHEN** the candidate query is explained against the live database
- **THEN** the plan uses the partial index and the measurement is recorded with the change

---

### Requirement: The reminder message is composed from its own projection, read without an owner scope

The reminder SHALL be composed from an explicit named projection selecting only the fields the message renders, including the client's email address and the booking's cancellation token.

This is the second booking read in this product that deliberately selects the client's address, and **the first that does so without an owner scope**. The projection is therefore doing the bounding work the owner predicate does elsewhere: no field it does not select can reach a log line or a message.

It SHALL NOT select the client's phone number, the owner id, or any monetary or scheduling field the message does not render.

#### Scenario: The projection carries only what the message renders
- **WHEN** the reminder projection is reviewed
- **THEN** every field it selects appears in the composed message, and no other field is selected

#### Scenario: The read is deliberately unscoped and says so
- **WHEN** the port declaring this read is reviewed
- **THEN** it states that it is not owner-scoped and why a scheduled job cannot be

---

### Requirement: The reminder's persistence guarantees are proven against the live database

Because the guarantees are timing, idempotence and cross-owner isolation against real rows, they SHALL be verified by a gate script executed against the live database rather than by mocks alone.

The gate SHALL prove: that a confirmed booking whose appointment has passed is never selected, that a due booking is claimed exactly once, that a re-run claims nothing, that a status change between selection and claim makes the claim match zero rows, that a booking created inside the lead window is not selected, and that a second owner's rows are untouched.

Everything the gate creates SHALL be removed at the end, in foreign-key order.

#### Scenario: The gate passes against real rows
- **WHEN** the gate script runs against the live database
- **THEN** every probe passes and every row it created is removed

#### Scenario: The past is proven unreachable
- **WHEN** the gate plants a confirmed booking whose appointment has passed with a null reminder instant
- **THEN** no run selects or claims it
