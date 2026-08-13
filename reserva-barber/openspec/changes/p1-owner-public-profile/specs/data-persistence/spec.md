## ADDED Requirements

### Requirement: BusinessProfile model as single source of truth
The `BusinessProfile` entity SHALL be defined in `prisma/schema.prisma` with `id` (cuid primary key), `ownerId`, `businessName` (at most 120 characters), `bio` (nullable, at most 1000 characters), `photoUrl` (nullable), `coverUrl` (nullable), `publicSlug` (at most 60 characters), `createdAt` and `updatedAt`. It SHALL declare a unique constraint on `ownerId` and a unique constraint on `publicSlug`.

Ownership is stored, not derived: `ownerId` is a real column, so every read and write scopes on it directly.

Schema changes SHALL be applied through a migration; direct database edits are forbidden.

#### Scenario: Migration is additive
- **WHEN** the migration runs against a database holding existing owners, locations, barbers and services
- **THEN** no existing table is altered, no backfill occurs, and no existing row is modified

#### Scenario: The profile is optional at the schema level
- **WHEN** the schema is reviewed
- **THEN** the relation from `Owner` is nullable, because no profile exists until the owner first saves one

### Requirement: SocialLink model as single source of truth
The `SocialLink` entity SHALL be defined with `id` (cuid primary key), `businessProfileId`, `platform` (the `SocialPlatform` enum), `url` (at most 500 characters), `orderIndex`, and `createdAt`. It SHALL declare `onDelete: Cascade` on its foreign key, a unique constraint on `(businessProfileId, platform)`, and an index on `(businessProfileId, orderIndex)`.

It SHALL carry no `updatedAt`: the set is replaced wholesale rather than edited row by row, following the weekly-schedule precedent.

Cascade is declared for the same reason as on assignments: the row *is* the relationship and has no meaning without either endpoint. It is inert while the application has no hard-delete path, and is declared so it is already correct when one arrives.

#### Scenario: The enum is created by the migration
- **WHEN** the migration is applied
- **THEN** the `SocialPlatform` enum exists with exactly the platforms the data model names

#### Scenario: Deleting a profile removes its links
- **WHEN** the schema is reviewed
- **THEN** the foreign key declares cascade deletion

### Requirement: One profile per owner is enforced by the database
The unique constraint on `ownerId` SHALL be the authority on there being exactly one profile per owner. The application SHALL NOT rely on having read the absence of a profile before creating one.

The check and the write are two round trips against a transaction-mode pooler and may not share a connection, so a read-then-create is not a guarantee. Two concurrent first-ever saves both observe no profile.

#### Scenario: Concurrent first-ever saves
- **WHEN** two saves are submitted simultaneously and no profile exists
- **THEN** exactly one row exists afterwards and the losing write fails on the constraint rather than creating a second

### Requirement: Slug uniqueness is enforced by the database
The unique constraint on `publicSlug` SHALL be the authority on slug uniqueness. A read-then-write check SHALL NOT be treated as one, for the same connection reason.

Slugs SHALL be normalized before persistence, so the constraint compares already-canonical values. The index compares raw bytes; a case- or accent-insensitive column type SHALL NOT be introduced to compensate for values that should have arrived canonical.

#### Scenario: A taken slug
- **WHEN** a save submits a slug already stored on another profile
- **THEN** the database rejects it and the failure surfaces as a field-level message on the slug

#### Scenario: The stored value is canonical
- **WHEN** a slug is persisted
- **THEN** the stored value is its normalized form

### Requirement: Unique-violation translation discriminates the three constraints this change can raise
A unique violation SHALL be translated by inspecting which constraint was violated. `ownerId`, `publicSlug` and `(businessProfileId, platform)` SHALL each map to a distinct domain error; no blanket mapping of any unique violation to a single outcome is acceptable.

The translation SHALL happen in the repository, and what leaves the repository SHALL be a domain error. The driver's error structure SHALL NOT be read outside the infrastructure layer, per the boundary `docs/tech-debt.md` T15 defends.

An owner who double-clicked save and collided on `ownerId` must not be told their slug is taken. This extends the existing rule that unique-violation translation is bounded to one business constraint — here there are three, so the discrimination has to be explicit.

#### Scenario: The discriminator is proven against the real driver
- **WHEN** the constraint identity is read from a unique violation
- **THEN** it is read from the location this stack actually populates, proven by a gate against the real database rather than assumed from Prisma's documented shape

#### Scenario: A profile-uniqueness collision
- **WHEN** a write violates the `ownerId` constraint
- **THEN** the outcome is a retry-oriented message, not a slug error

#### Scenario: A slug collision
- **WHEN** a write violates the `publicSlug` constraint
- **THEN** the outcome is a field-level slug error

#### Scenario: A platform collision
- **WHEN** a write violates the `(businessProfileId, platform)` constraint
- **THEN** the outcome names the duplicated platform

#### Scenario: An unrecognized constraint
- **WHEN** a unique violation names a constraint outside these three
- **THEN** it is treated as an infrastructure failure and logged without submitted business data

### Requirement: The profile and its links are written in one transaction
A save SHALL create or update the profile and replace its social links inside a single transaction: the profile is written, existing links for that profile are deleted, and the submitted links are inserted.

The set is edited as a whole, so an additive write would double the links on a retry after a committed-but-timed-out save. Replacement inside one transaction makes the retry idempotent, which is the same reasoning the weekly schedule follows.

#### Scenario: A retried save after a timeout
- **WHEN** a save is retried after a commit whose acknowledgement was lost
- **THEN** the stored link set equals the submitted set, with no duplicates

#### Scenario: A failed link insert
- **WHEN** inserting the links fails
- **THEN** the profile write is rolled back with them, leaving the previously stored state intact

### Requirement: Profile reads are a single query free of N+1
The editor read SHALL fetch the profile and its social links in one query, ordered by `orderIndex`, carrying `ownerId` as a predicate. A foreign owner's identifier SHALL resolve as absent.

#### Scenario: The editor read
- **WHEN** the profile editor loads
- **THEN** the profile and its links are read in a single owner-scoped query

#### Scenario: A foreign owner
- **WHEN** a read carries an owner identifier that does not own the row
- **THEN** it resolves as absent rather than returning the row
