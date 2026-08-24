## ADDED Requirements

### Requirement: The sweep's two predicates are each served by a partial index

`Booking` SHALL carry a partial index on `holdExpiresAt` restricted to `PENDING_PAYMENT` rows, and a partial index on `startTime` restricted to `PENDING_APPROVAL` rows.

The existing `(barberId, startTime)` index serves the availability read and the no-overlap check, both of which name a barber. The sweep names no barber — it is a maintenance query over every shop — so neither of its predicates can use that index, and without these two it walks the table every five minutes against a pooler shared with the owner's dashboard and the public booking write.

They are **partial**, not full: the eligible statuses are a small and shrinking minority of a table that grows with every appointment ever made, and a full index would carry every confirmed booking in the product's history for a query that can never match one.

The schema file previously recorded that a partial index on the blocking statuses was rejected as premature because it would optimize a predicate this capability might still refine. That predicate is now written and the indexes match it.

Both SHALL be declared in raw SQL in a migration, because the schema language cannot express a partial index, and their existence SHALL be recorded in the schema file so a future reader does not mistake it for the whole truth — the convention the hold constraint and the one-live-payment index already follow.

#### Scenario: The lapsed-hold sweep is indexed
- **WHEN** the sweep selects `PENDING_PAYMENT` candidates by `holdExpiresAt`
- **THEN** the query is served by the partial index rather than by a sequential scan

#### Scenario: The unanswered-receipt sweep is indexed
- **WHEN** the sweep selects `PENDING_APPROVAL` candidates by `startTime`
- **THEN** the query is served by the partial index rather than by a sequential scan

#### Scenario: History is not carried by the indexes
- **WHEN** a booking is confirmed, cancelled or expired
- **THEN** it leaves both partial indexes

#### Scenario: The indexes are discoverable from the schema file
- **WHEN** `prisma/schema.prisma` is read
- **THEN** both indexes are named there with the reason they cannot be declared in the schema language

---

### Requirement: The migration adds indexes and touches no data

The migration introducing the sweep's indexes SHALL create indexes only. It SHALL NOT alter a column, add a constraint, backfill a value, or modify any existing row.

Every booking that would be eligible on the day this ships has been eligible for as long as it has existed, and availability has already been treating it as such. There is nothing to correct, and a data-modifying migration over a table this central would be a risk taken for no gain — the scheduled job reaches every one of those rows on its own, in bounded batches, under the same guards it uses forever after.

#### Scenario: The migration is index-only
- **WHEN** the migration runs against the shared database
- **THEN** two indexes are created, no column is altered, no constraint is added, and no row is modified

#### Scenario: The backlog is handled by the job, not the migration
- **WHEN** the first scheduled run executes after the migration
- **THEN** the historical backlog is swept in bounded batches across as many runs as it takes
