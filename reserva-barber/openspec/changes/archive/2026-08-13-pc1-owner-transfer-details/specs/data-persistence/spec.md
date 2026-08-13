## ADDED Requirements

### Requirement: PaymentConfig model as single source of truth
The `PaymentConfig` entity SHALL be defined in `prisma/schema.prisma` with `id` (cuid primary key), `ownerId` (unique), `mpAccessToken`, `mpPublicKey`, `transferCbuCvu` (at most 30 characters), `transferAlias` (at most 60 characters), `transferHolderName` (at most 120 characters), `depositType`, `depositValue`, `createdAt` and `updatedAt`. A `DepositType` enum with values `FIXED` and `PERCENT` SHALL be declared alongside it.

The migration SHALL create the whole table, including the columns PC2 and PC3 will use. A single-row entity introduced piecemeal across three migrations invites the three stories to disagree about its shape; the cost of the alternative is two unused nullable columns for a few days.

`depositValue` SHALL be nullable, overriding the earlier declaration in `data-model.md` §14. The row must exist as soon as transfer details are saved, and no deposit policy is chosen until PC3. `depositType` SHALL retain its `PERCENT` default.

`depositValue` SHALL declare explicit precision and scale (`Decimal(12, 2)`) and SHALL NOT rely on Prisma's default `Decimal(65,30)`, matching the convention `Service.price` established.

Schema changes SHALL be applied through a migration; direct database edits are forbidden.

#### Scenario: Migration creates the table and the enum
- **WHEN** the migration is applied
- **THEN** the table and the `DepositType` enum exist, and `depositValue` is nullable with explicit precision and scale

#### Scenario: Migration is additive
- **WHEN** the migration runs against a database holding an existing owner
- **THEN** no existing table is altered, no backfill occurs, and no existing row is modified

#### Scenario: No configuration row is created by the migration
- **WHEN** the migration completes
- **THEN** no `PaymentConfig` row exists, because the row is created by the owner's first save and never by a migration, a seed or a provisioning script

### Requirement: The configuration is one row per owner, created by upsert
`ownerId` SHALL be unique, and every write SHALL be a single `upsert` keyed on it. The first save creates the row; later saves update it. No write SHALL read the row first and branch on its existence.

A read-then-branch is two round trips against a transaction-mode pooler with no shared connection, so two concurrent first saves both take the create path. The unique key is also what makes a retry after a committed-but-timed-out save idempotent rather than a duplicate.

#### Scenario: The first save creates the row
- **WHEN** the owner saves while no configuration row exists
- **THEN** exactly one row is created for that owner

#### Scenario: A repeated identical save
- **WHEN** the same save is applied twice
- **THEN** the row's transfer columns are unchanged after the second application and no second row appears

### Requirement: A lost race on the singleton row is retried, not reported as a failure
When a write raises a unique-constraint violation on `ownerId`, the operation SHALL be retried exactly once. The retry takes the update path, because the competing write has by then created the row.

Two concurrent saves against a not-yet-existing row both attempt the create branch; the loser receives a constraint violation despite having done nothing wrong, and reporting it as an infrastructure failure tells the owner their save failed when the data is correct. The retry SHALL be bounded to a single attempt; a second violation is a genuine failure.

#### Scenario: Two concurrent first saves
- **WHEN** a write fails with a unique-constraint violation on the owner
- **THEN** the write is retried once, succeeds through the update path, and a single row exists

#### Scenario: A persistent violation
- **WHEN** the retried write also fails
- **THEN** the failure is surfaced rather than retried again

### Requirement: A partial configuration write touches only its own columns
The transfer write SHALL set `transferCbuCvu`, `transferAlias` and `transferHolderName` and SHALL NOT include any other column in its update. Its create branch SHALL supply only those columns plus the schema defaults.

Three stories write to one row. A write that supplies the whole entity would silently reset the Mercado Pago credentials or the deposit policy to whatever the transfer editor happened to hold, and the write would report success while doing it.

#### Scenario: Saving transfer details with Mercado Pago already configured
- **WHEN** the transfer write is applied to a row holding Mercado Pago credentials and a deposit policy
- **THEN** the credentials and the deposit policy are unchanged

#### Scenario: The create branch of the transfer write
- **WHEN** the row is created by a transfer save
- **THEN** `depositValue` is null and `depositType` holds its default

### Requirement: The public flow reads transfer details through a narrow projection
A read intended for the public booking flow SHALL use a projection selecting only `transferCbuCvu`, `transferAlias` and `transferHolderName`. The full entity SHALL NOT cross into the public surface.

`mpAccessToken` lives in the same row, and the security rule is that it never reaches the browser. A projection that does not carry it cannot leak it through a serialized prop, a logged object or an error payload — a stronger guarantee than every downstream consumer remembering to strip it.

#### Scenario: The booking flow reads the destination
- **WHEN** transfer details are read for the public flow
- **THEN** the returned object carries no Mercado Pago credential field

### Requirement: Configuration queries are owner-scoped and single-statement
Every read and write SHALL carry `ownerId` as a predicate. The editor read SHALL be one query, and the save SHALL be one statement; no transaction is required for a single-row write.

#### Scenario: A read for another owner
- **WHEN** a configuration is requested for an owner other than the authenticated one
- **THEN** no row is returned

### Requirement: Destinations are stored normalized, never as typed
`transferCbuCvu` SHALL be persisted as digits only and `transferAlias` in lowercase, both trimmed. Normalization SHALL occur before persistence, not at render time.

Two owners entering the same account with different spacing must not produce two different stored strings; any later comparison, deduplication or lookup would treat them as distinct accounts.

#### Scenario: A destination entered with separators
- **WHEN** a CBU containing spaces is saved and read back
- **THEN** the stored value contains digits only
