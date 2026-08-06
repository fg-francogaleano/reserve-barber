## ADDED Requirements

### Requirement: Owner model linked to Supabase Auth
`prisma/schema.prisma` SHALL define the `Owner` model per `docs/data-model.md` §1 (as updated by this change): `id` (cuid PK), `email` (VarChar 255, unique, required, stored lowercase), `authUserId` (unique, nullable until provisioned — maps to the Supabase `auth.users.id`), `createdAt`, `updatedAt`, with a one-to-many relation to `Location`. Credentials (passwords, tokens) MUST NOT be stored in the domain database; authentication state lives entirely in Supabase Auth.

#### Scenario: Owner table created
- **WHEN** the A1 migration runs
- **THEN** the `Owner` table exists with the columns, uniqueness constraints, and defaults above

#### Scenario: No credential material in domain tables
- **WHEN** the domain schema is inspected
- **THEN** no column stores passwords, hashes, or session tokens

### Requirement: FK backfill migration is safe and single-step
A single migration SHALL (1) create the `Owner` table, (2) insert the owner row with a fixed known id and update every `Location` row holding the `SEED_OWNER_ID` placeholder to reference it, and (3) add the `Location.ownerId → Owner.id` foreign key constraint. If any location still references an unknown owner when the constraint is added, the migration MUST fail loudly rather than leave partial state.

#### Scenario: Placeholder rows backfilled
- **WHEN** the migration runs against the S0 database
- **THEN** every location previously holding `SEED_OWNER_ID` references the real owner row and the FK constraint is active

#### Scenario: Unbackfilled data fails the migration
- **WHEN** a location references an owner id that does not exist at constraint-creation time
- **THEN** the migration fails and no FK constraint is left partially applied

### Requirement: Owner provisioning is idempotent and separate from seed
A provisioning script (`scripts/provision-owner.ts`) SHALL create the Supabase auth user for the owner's email (using the service-role key, never bundled into the app) and write the resulting `authUserId` onto the `Owner` row. The script MUST be idempotent (lookup by email before create) and re-runnable after partial failure. `prisma db seed` SHALL seed domain data only, remain idempotent, reference the fixed owner id, and MUST NOT require the service-role key. The `SEED_OWNER_ID` placeholder constant SHALL be removed.

#### Scenario: Provisioning runs twice
- **WHEN** the provisioning script is executed twice
- **THEN** exactly one auth user exists for the owner email and the `Owner.authUserId` is set to it

#### Scenario: Seed after provisioning
- **WHEN** `prisma db seed` runs repeatedly after the migration
- **THEN** exactly one owner and the same two locations exist, all locations referencing the owner

### Requirement: Exactly one Owner
The system SHALL contain exactly one `Owner` row. No application code path (page, server action, or seed) SHALL create an `Owner`; only the migration and the provisioning script may write it. The provisioning script SHALL refuse to run if an `Owner` row with a different email already exists.

#### Scenario: Second owner rejected
- **WHEN** the provisioning script runs with an email different from the existing `Owner`
- **THEN** it exits with an English error and creates neither an auth user nor an `Owner` row

#### Scenario: No application path creates owners
- **WHEN** the application code is inspected
- **THEN** no page, server action, or seed statement performs an `Owner` create

### Requirement: Owner repository maps rows to domain entities
`PrismaOwnerRepository` SHALL implement `IOwnerRepository` (`findByAuthUserId`, `findByEmail`) and map rows to the domain `Owner` entity via a `toDomain` mapper. The domain entity MUST NOT expose Prisma types.

#### Scenario: Lookup by authUserId
- **WHEN** `findByAuthUserId` runs against a mocked Prisma client
- **THEN** the matching row is returned as a domain `Owner` instance, or `null` when absent
