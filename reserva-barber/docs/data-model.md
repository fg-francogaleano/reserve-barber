# Data Model Documentation

## Reserva Barber

> **Stack:** PostgreSQL (Supabase) + Prisma ORM. Field types below use Prisma/PostgreSQL
> conventions (`String`, `Int`, `DateTime`, `Decimal`, `Boolean`, plus native `enum`s).
> Files (profile/cover images, transfer receipts) are stored in **Supabase Storage**;
> the database persists only their URL/path.

---

## Document Purpose

This document describes the data model for the **Reserva Barber** application, including:

- Entity descriptions and field definitions
- Validation rules per entity
- Relationships between entities
- An entity-relationship (ER) diagram

**Identifier convention:** every entity uses a surrogate string primary key `id`
(`@id @default(cuid())`). This keeps public-facing identifiers (e.g., in URLs and the
cancellation link) non-sequential and non-guessable.

**Money convention:** all monetary values use `Decimal` (never floating point), in ARS.

---

## Model Descriptions

### 1. Owner

The single administrative user of the system — the business owner who manages every location, barber, service, and payment setting. There is no barber login and no multi-owner tenancy in this version. Authentication is handled by **Supabase Auth** (email/password, sign-ups disabled); the domain database never stores credentials.

**Fields:**

- `id`: Unique identifier (PK, cuid)
- `email`: Owner's login email (max 255, required, unique, stored lowercase) — a denormalized copy; Supabase Auth is the source of truth, refreshed by the provisioning script
- `authUserId`: Foreign key to the Supabase `auth.users.id` (unique, nullable until provisioned) — sessions resolve through this field, never through email
- `createdAt`: Account creation timestamp (auto-set)
- `updatedAt`: Last update timestamp (auto-updated)

**Validation Rules:**

- Email: required, unique system-wide, valid email format, normalized to lowercase
- Password: minimum 12 characters, enforced by Supabase Auth (Authentication → Policies). The domain database never stores it — this rule is configured in the provider, not in application code
- Exactly one `Owner` row may exist system-wide; only a database migration or the owner-provisioning script may create it — no application code path (page, server action, or seed) creates an `Owner`
- `authUserId` is set by the provisioning script (`scripts/provision-owner.ts`), never by application code
- `id` exception: the single Owner row is created by the A1 migration with the fixed literal `owner-root` rather than a generated cuid, so the migration can reference it deterministically when backfilling `Location.ownerId`. Every other entity follows the cuid convention above.

**Relationships:**

- `businessProfile`: One-to-one → BusinessProfile
- `paymentConfig`: One-to-one → PaymentConfig
- `locations`: One-to-many → Location
- `services`: One-to-many → Service

---

### 2. BusinessProfile

The public-facing profile shown to clients when they open the shared booking link. Belongs to the Owner (brand-level; the client picks a specific location inside the booking flow).

**Fields:**

- `id`: Unique identifier (PK, cuid)
- `ownerId`: Foreign key → Owner (required, unique — one profile per owner)
- `businessName`: Barbershop / brand name (max 120, required)
- `bio`: Public biography / description (max 1000, optional)
- `photoUrl`: URL of the profile photo in Supabase Storage (optional)
- `coverUrl`: URL of the cover image in Supabase Storage (optional)
- `publicSlug`: Unique slug used to build the public booking link (e.g., `/b/{publicSlug}`) (required, unique)
- `createdAt` / `updatedAt`: Timestamps

**Validation Rules:**

- `businessName`: required, 2–120 characters
- `publicSlug`: required, unique, URL-safe (lowercase, hyphens), 3–60 characters
- `photoUrl` / `coverUrl`: must point to an allowed image type (JPG, PNG, WEBP), max 5 MB, validated at upload

**Storage and normalization rules (P1):**

- `publicSlug` is **normalized before persistence** — diacritics stripped, lowercased, non-alphanumeric
  runs collapsed to single hyphens, leading and trailing hyphens trimmed. The unique index compares
  raw bytes, so the values it compares must already be canonical. This is the same rule
  `Location.name` follows, and it is why no case- or accent-insensitive column type is used.
- Uniqueness of `publicSlug` and of `ownerId` is enforced **by the database**, never by a
  read-then-write. The check and the write are two round trips against a transaction-mode pooler and
  may not share a connection.
- `photoUrl` / `coverUrl` point into a **public** Supabase Storage bucket: these images are rendered
  to unauthenticated clients, where signing a URL on every render would be the wrong mechanism. That
  reasoning does not extend to assets with a different audience — `TransferReceipt` uses a separate
  private bucket.
- The image type is determined by **inspecting the file's leading bytes**, not by its declared
  content type or extension, both of which are client-controlled. SVG is excluded deliberately: an
  SVG served from a public origin is a script-execution surface.
- The 5 MB ceiling is the **server-side** bound. The browser downscales and re-encodes each image to
  roughly 500 KB before upload, which is also what removes capture metadata (EXIF, including GPS
  coordinates) from anything published.

**Relationships:**

- `owner`: One-to-one → Owner
- `socialLinks`: One-to-many → SocialLink

---

### 3. SocialLink

A single social network / external link displayed on the public profile.

**Fields:**

- `id`: Unique identifier (PK, cuid)
- `businessProfileId`: Foreign key → BusinessProfile (required)
- `platform`: Social platform — enum `SocialPlatform` (`INSTAGRAM`, `FACEBOOK`, `TIKTOK`, `WHATSAPP`, `X`, `YOUTUBE`, `WEBSITE`) (required)
- `url`: Full URL to the profile/page (max 500, required)
- `orderIndex`: Display order on the profile (Int, required)
- `createdAt`: Timestamp. There is deliberately **no `updatedAt`**: the set is replaced as a whole,
  never edited row by row (the same write shape as `WorkingHours`).

**Validation Rules:**

- `url`: required, valid URL format
- `url`: **protocol restricted to `http:` and `https:`**, checked by parsing the URL rather than by
  pattern. These strings become `href` attributes on a page anonymous clients open, so a stored
  `javascript:` URL is stored XSS — this is a security control, not a formatting rule.
- `platform` + `businessProfileId`: unique together (one link per platform per profile)
- At most one link per platform means at most **seven** links per profile. Duplicate platforms are
  rejected during validation, before any write: reaching the database constraint aborts a
  transaction whose images have already been uploaded.

**Relationships:**

- `businessProfile`: Many-to-one → BusinessProfile

---

### 4. Location

A physical barbershop branch owned by the Owner. Each barber belongs to exactly one location.

**Fields:**

- `id`: Unique identifier (PK, cuid)
- `ownerId`: Foreign key → Owner (required)
- `name`: Location name (max 120, required)
- `address`: Street address (max 255, optional)
- `isActive`: Whether the location is active/bookable (Boolean, default: true)
- `createdAt` / `updatedAt`: Timestamps

**Validation Rules:**

- `name`: required, 2–120 characters after normalization, unique per owner
- **Name normalization (application layer):** before validation and persistence, `name` is trimmed, runs of internal whitespace are collapsed to a single space, and Unicode NFC normalization is applied. Without this, `Sucursal  Centro` (double space) and a decomposed-accent spelling of an existing name are byte-different and pixel-identical, and the uniqueness constraint would accept both.
- **Uniqueness is enforced by the database** via a composite unique constraint on `(ownerId, name)` — not by application checking alone. The application's case-insensitive pre-check exists only to produce a readable field error; it cannot be the guarantee, because the check and the write are separate round trips against a transaction-mode pooler. A constraint violation is translated into a domain error before it reaches the presentation layer.
- `address`: optional, max 255 characters; a blank submission is stored as `null`, never as an empty string

**Relationships:**

- `owner`: Many-to-one → Owner
- `barbers`: One-to-many → Barber

---

### 5. Barber

A barber who works at a single location and can be assigned to one or more services. Barbers are managed by the Owner; they are not system users.

**Fields:**

- `id`: Unique identifier (PK, cuid)
- `locationId`: Foreign key → Location (required)
- `displayName`: Barber's public name (max 120, required)
- `bio`: Short description (max 500, optional)
- `avatarUrl`: URL of the barber's photo in Supabase Storage (optional)
- `isActive`: Whether the barber is active/bookable (Boolean, default: true)
- `createdAt` / `updatedAt`: Timestamps

**Validation Rules:**

- `displayName`: required, 2–120 characters after normalization, unique per location
- **Name normalization (application layer):** `displayName` is normalized by the same shared rule as `Location.name` (see §4). The rule has one implementation; two entities constrained by uniqueness must not disagree about what "the same name" means.
- **Uniqueness is enforced by the database** via a composite unique constraint on `(locationId, displayName)`. It is scoped to the _location_, not the owner: the same person's name recurring across branches is legitimate, while two identically-named barbers at one branch cannot be told apart in the booking flow. As with `Location`, the application's case-insensitive pre-check exists only to produce a readable field error and cannot be the guarantee.
- `bio`: optional, max 500 characters; a blank submission is stored as `null`, never as an empty string
- **Ownership is derived, never stored.** A barber has no `ownerId`. It belongs to an owner solely through `location.ownerId`, and every read and write MUST carry the owner as a predicate over that relation. Denormalizing `ownerId` onto Barber is rejected: it duplicates a fact the foreign key already carries and can drift on reassignment, leaving a row whose two ownership answers disagree.
- A barber must belong to an existing, **active** location to be bookable. A barber sitting at a location that was deactivated _after_ the assignment is a legal state, not a broken one — so the application permits a barber to **remain** at an inactive location while refusing to **move** one there. The "remain" exemption is decided from the barber's stored `locationId`, never from a value supplied by a submission.
- `avatarUrl` is written only by story P1 (Supabase Storage). The column exists before then so the avatar feature needs no second migration on a populated table.
- Deleting a location that still has barbers is refused (`onDelete: Restrict`).

**Relationships:**

- `location`: Many-to-one → Location
- `services`: Many-to-many → Service (through BarberService)
- `workingHours`: One-to-many → WorkingHours
- `timeOffs`: One-to-many → TimeOff
- `bookings`: One-to-many → Booking

---

### 6. Service

A bookable service offered by the business (e.g., haircut, beard trim), with a price and a duration. A service can be created without any barber, but it only becomes available in the booking flow once at least one barber is assigned to it.

**Fields:**

- `id`: Unique identifier (PK, cuid)
- `ownerId`: Foreign key → Owner (required)
- `name`: Service name (max 120, required)
- `description`: Description (max 500, optional)
- `price`: Full service price (Decimal, required, ≥ 0)
- `durationMinutes`: Duration used to generate booking slots (Int, required, > 0)
- `isActive`: Whether the service is active (Boolean, default: true)
- `createdAt` / `updatedAt`: Timestamps

**Validation Rules:**

- `name`: required, 2–120 characters after normalization
- **Name normalization (application layer):** `name` is normalized by the same shared rule as `Location.name` and `Barber.displayName` (see §4). The rule has one implementation; three entities constrained by uniqueness must not disagree about what "the same name" means.
- **`name` is unique per owner**, enforced by a composite unique constraint on `(ownerId, name)`. Uniqueness is scoped to the owner rather than to a location because a service is offered by the business as a whole and `Service` has no location relation. As with `Location` and `Barber`, the database constraint is the authoritative guarantee; the application's case-insensitive pre-check exists only to produce a readable field error and cannot be the guarantee, because the check and the write are separate round trips against a transaction-mode pooler.
- `description`: optional, trimmed, max 500 characters; a blank submission is stored as `null`, never as an empty string
- `price`: required, non-negative, at most **2 decimal places**, and not greater than the documented application maximum (`9,999,999.99`). Persisted as `Decimal(12, 2)` — the column is deliberately wider than the rule so that a numeric overflow, which PostgreSQL raises as an untyped error, is unreachable by construction rather than by handling.
- **Price parsing (application layer):** the accepted decimal separator is `.` **or** `,`, because the platform and an es-AR keyboard disagree about which is correct. A value carrying a thousands separator (`4.500`, `4,500`) is **rejected as ambiguous** rather than interpreted — a wrong guess is a thousandfold pricing error. More than two decimal places is rejected, never silently rounded.
- `durationMinutes`: required positive integer, a multiple of the slot granularity (`SLOT_GRANULARITY_MINUTES` = 5), between 5 and 480. The granularity constant lives in the domain layer because slot generation and booking sizing consume the same definition; a second definition of the grid would surface as appointments that cannot be booked rather than as a failing test.
- **Availability rule (application layer):** a service is exposed in the public booking flow only while it is itself **active**, has at least one assigned barber via BarberService (§7), and at least one of those barbers is **active** _and_ works at an **active location** (§4). All four terms are load-bearing: a service that is inactive, unassigned, assigned exclusively to inactive barbers, or assigned exclusively to barbers at closed branches is not bookable. Checking only the assignment would report a deactivated service as bookable; omitting the location would report one as bookable that no client can reach, because the booking flow selects a location **first** and a closed branch is never offered.
- **The unit of bookability is the (service, location) pair.** Since the client picks a branch before a service, a service with active barbers at one branch and none at another is bookable at the first and dead at the second. B2 fixed this as the shape the public booking flow evaluates: the catalogue is keyed on the pair, so no client is ever offered a service at a branch where nobody performs it. The **dashboard** still reports a single global fact per service and therefore hides the second half — a gap in the owner's view, not the client's, tracked in `docs/tech-debt.md` T23.
- **Ownership is stored, not derived.** Unlike `Barber` (§5), `Service` carries a real `ownerId` column, so every read and write scopes on that column rather than through a relation join. The derived-ownership pattern answers a schema that lacks an owner column and must not be applied to one that has it.
- **Editing a price is not retroactive.** `Booking.priceAtBooking` (§11) is a deliberate historical snapshot; the live service price is never the source of truth for a past booking.

**Relationships:**

- `owner`: Many-to-one → Owner
- `barbers`: Many-to-many → Barber (through BarberService)
- `bookings`: One-to-many → Booking

---

### 7. BarberService

Join entity linking barbers to the services they can perform. Presence of a row is what makes a service bookable with a given barber — this table, not `Service`, is the gate to the public booking flow.

**Fields:**

- `id`: Unique identifier (PK, cuid)
- `barberId`: Foreign key → Barber (required)
- `serviceId`: Foreign key → Service (required)
- `createdAt`: Timestamp. There is deliberately no `updatedAt`: the row carries no mutable field, so an assignment is created or destroyed, never edited.

**Validation Rules:**

- `barberId` + `serviceId`: unique together, enforced by a composite unique constraint on `(barberId, serviceId)`. Unlike the name constraints of §4–§6, this one is **never surfaced to the owner as an error**: the write requests `skipDuplicates`, so a re-submitted assignment is absorbed rather than reported. A duplicate assignment is not a mistake anyone can be asked to correct — it is the same intent expressed twice.
- **The same-owner rule has no database backing and is an application invariant.** Both referenced rows must belong to the same owner, but `Barber` has no `ownerId` column (§5 — ownership is derived through `location`), so no composite foreign key, unique constraint or `CHECK` can express the comparison. It is enforced at write time in exactly one place, and that choke point _is_ the guarantee. Two consequences are binding: no code path may write this table except through that service, and the invariant is proven by an executable cross-owner test rather than asserted in a comment — a bulk insert bypasses relation validation entirely, so the foreign keys prove only that both ids exist, never that they agree about the owner.
- **Assignment is a set operation against a rendered baseline, not a blind replace.** The editor submits two parallel multi-value fields: the ids it rendered, and the subset of those that were checked. Additions are `checked − stored`; removals are `(rendered − checked) ∩ stored`. Diffing against `stored` alone is rejected: the rendered list is a snapshot, so a stale tab would silently delete an assignment created after its own page load — and the loss is a service that quietly stops being bookable, not a field that has to be retyped. A conflict over an id both tabs rendered remains last-write-wins (`tech-debt.md` T8); a conflict over an id only one of them ever saw is now unreachable by construction.
- **An empty selection is valid and means "this barber performs nothing".** With checkboxes, an all-unchecked form omits the key entirely, so an empty list is indistinguishable from a missing field unless the rendered-baseline field is read as the proof that a submission occurred. It must never be treated as a validation failure.
- **A service may be _added_ only while it is active, but an assignment already held over a service deactivated afterwards is a legal state, not a broken one.** The application therefore permits an inactive service to **remain** assigned while refusing to **add** one — the same shape as the barber/inactive-location exemption in §5, and decided from stored state rather than from the submission.
- **Cardinality:** assignments per barber are bounded by the per-owner service cap (`MAX_SERVICES_PER_OWNER` = 50, §6). The submitted list is deduplicated and rejected above that bound _before_ any database read, so a crafted submission cannot turn one save into an unbounded query.
- **Deleting either side removes the assignment (`onDelete: Cascade`).** A join row has no meaning without both endpoints. This differs deliberately from `Barber → Location` (`Restrict`, §5): there the child carries data of its own that must not vanish silently, here the row _is_ the relationship. The rule is inert today — the application has no hard-delete path, and M6 is deactivation — and exists so that whenever deletion does arrive it is already correct.

**Derived reads:**

- **Bookability of a service** is the conjunction of three facts, evaluated at read time and never cached in a column: the service is active, it has at least one BarberService row, and at least one of those barbers is active. Encoding only the middle term would report a deactivated service as bookable the moment M6 ships. A denormalized `Service.isBookable` flag is rejected — it would need invalidating on four distinct events (assign, unassign, barber deactivation, service deactivation) and is wrong the first time one is missed, whereas the count is a single indexed aggregate over a set bounded by the service cap.
- `@@index([serviceId])` exists for that read and for the booking flow's "which barbers perform X" query. The composite unique constraint only serves the `barberId`-leading direction.

**Relationships:**

- `barber`: Many-to-one → Barber
- `service`: Many-to-one → Service

---

### 8. WorkingHours

A recurring weekly working window for a barber, used to generate available slots.

**Fields:**

- `id`: Unique identifier (PK, cuid)
- `barberId`: Foreign key → Barber (required)
- `dayOfWeek`: Day of week (Int, 0 = Sunday … 6 = Saturday, required)
- `startMinute`: Start of the window, **minutes from midnight in business local time** (Int, required)
- `endMinute`: End of the window, same units (Int, required)
- `createdAt`: Timestamp. There is deliberately no `updatedAt` — the write replaces rows rather than editing them.

**Validation Rules:**

- `dayOfWeek`: an **integer** 0–6. A non-integer is rejected explicitly: `0.5` satisfies a naive range comparison and then matches no day, so the window it carries would be discarded while the save reported success.
- `endMinute` must be strictly greater than `startMinute`. A zero-length window is rejected — a window containing no time is not a working day, it is the absence of one.
- **A window must not cross midnight.** The owner confirmed no barber works past 23:00, so `endMinute ≤ 1439` and the wrap-around case is unrepresentable by construction rather than by handling.
- Both values must be multiples of `SLOT_GRANULARITY_MINUTES` (5) — the same constant service duration uses (§6). A window that does not tile the grid produces slot times no other part of the system expects.
- **A day with no window is a non-working day.** There is deliberately no "closed" flag: absence of a window _is_ the absence. A flag would create two representations of one fact, which can then disagree.
- **Times are stored as wall clock and never converted at rest.** A recurring schedule is a statement about a clock face ("we open at nine"), not about an instant. Storing an offset would mean a change in civil time silently reinterprets what the owner said. Conversion to an instant happens only when comparing a schedule against a booking, and lives in exactly one module.
- **One window per day in the product, several permitted by the schema.** The unique constraint is `(barberId, dayOfWeek, startMinute)`, not `(barberId, dayOfWeek)`. The editor currently offers a single continuous window per day; the wider constraint keeps a split shift (9–13, 16–20 — the common local pattern) representable without a migration over live data. Narrowing it would trade a free index column today for a migration later.
  - **Known consequence:** with one window, a barber working a split shift must enter 9–20, and slot generation will offer appointments during the midday break. That is a real booking defect, it belongs to the availability story, and it is recorded in `tech-debt.md` rather than left to be discovered.
- No overlap rule is enforced today because one window per day cannot overlap anything. It returns with the second window.

**Relationships:**

- `barber`: Many-to-one → Barber

---

### 9. TimeOff

A date or date range in which a barber is unavailable (day off, vacation, holiday), overriding the recurring WorkingHours.

**Fields:**

- `id`: Unique identifier (PK, cuid)
- `barberId`: Foreign key → Barber (required)
- `startsAt`: First unavailable instant, **UTC in `@db.Timestamptz`** (required)
- `endsAt`: First available instant after the absence, same type (required)
- `reason`: Optional note (max 255, optional)
- `createdAt`: Timestamp. No `updatedAt` — an absence is recorded or removed, never edited; changing one is a remove plus an add.

**Validation Rules:**

- **The range is half-open: `[startsAt, endsAt)`.** The start is inside the absence, the end is not. This matches `Booking`'s `[startTime, endTime)` (§11) on purpose — if the two disagreed, a booking beginning exactly when an absence ends would be blocked or allowed depending on which rule the availability code evaluated first, and that surfaces as a mysterious unbookable slot rather than as a failing test.
- **Instants, not dates.** The fields were previously described as "date/datetime"; those are different types and only one has a defined instant. An absence is a point in time and obeys the stored-time convention in _General Conventions_ — UTC in a zone-aware column, never the zone-less Prisma default.
- **A whole day is expressed in the same range, with no `isAllDay` flag.** A full day off is `[00:00 local, 00:00 next-day local)`. A flag would be a second way to state one fact, and two representations can disagree.
- **The form's "hasta" is inclusive for whole days and exclusive for a timed range.** With both times empty, "del 1 al 15" covers the 15th and therefore ends at the start of the 16th. With times given, the range ends at the instant named. Both readings are correct for their input; the conversion lives in exactly one function because an off-by-one here silently hands the barber back a day and nothing else in the system would notice.
- `endsAt` must be **strictly after** `startsAt`. A zero-length range blocks nothing and is a data-entry error wearing the shape of a record.
- **Bounded:** at most 365 days long, starting no more than 2 years ahead and no more than 1 year in the past. Without bounds a mistyped year is accepted and permanently disables a barber with no error anywhere. Past absences remain allowed because recording one after the fact is legitimate — which is also why the backward bound is tighter.
- **Overlaps between a barber's absences are allowed.** They union when availability is computed. Rejecting them would stop an owner who recorded a long holiday from recording a specific appointment inside it.
- **Identity is `(barberId, startsAt, endsAt)`**, enforced by a unique constraint, which is what makes a retried create idempotent. Two absences with identical boundaries are the same absence; a duplicate range carrying a different `reason` is not a second fact.
- **`reason` never leaves the dashboard.** It can hold medical information, so it must not reach any log entry or any read intended for a consumer other than the absences editor. Confinement is structural — a projection that omits the field — rather than a matter of remembering. A blank submission is stored as `null`, never as an empty string.
- Time-off ranges block slot generation for the affected barber.
- **Business-wide holidays are not modelled.** A national holiday needs one row per barber today; a `BusinessHoliday` entity is recorded as technical debt rather than assumed.

**Relationships:**

- `barber`: Many-to-one → Barber

---

### 10. Client

A guest customer who books an appointment. Clients do not have accounts; they are identified by their contact data and deduplicated by email per owner.

**Fields:**

- `id`: Unique identifier (PK, cuid)
- `ownerId`: Foreign key → Owner (required — clients belong to the business they booked with)
- `name`: Full name (max 120, required)
- `email`: Email address (max 255, required)
- `phone`: Phone number (max 30, required)
- `createdAt` / `updatedAt`: Timestamps

**Validation Rules:**

- `name`: required, 2–120 characters
- `email`: required, valid email format; unique per owner (`ownerId` + `email` unique together) to deduplicate returning clients
- **Email normalization (application layer):** `email` is trimmed and lowercased **before** the uniqueness check and the write. The `(ownerId, email)` unique index compares raw bytes, so `Ana@Mail.com` and `ana@mail.com ` would otherwise be two clients — the same reasoning `BusinessProfile.publicSlug` and `Location.name` follow. Deduplication is a single conflict-aware write (upsert) on the normalized value, never a read followed by a write: the check and the write are separate round trips against a transaction-mode pooler and may not share a connection.
- `phone`: required, valid phone format (AR). **Parsing is tolerant, storage is canonical (application layer):** accepted input includes a `+54` prefix, a leading `0`, a `15` mobile prefix, and spaces, dashes or parentheses as separators; the value is normalized to one canonical form before persistence and is rejected only when the resulting digits cannot form a valid Argentine number. A stored value that varies in punctuation costs the owner a retype before it is usable for a call or a WhatsApp link; a rejection at the last step of a checkout costs a booking — so the rule is tolerant on what it accepts and strict on what it stores.
- **A returning client's `name` and `phone` are overwritten, not preserved, on a repeat booking.** The dedup key is `(ownerId, email)`; when an existing client submits a different name or phone, the stored row is updated to the submitted values, because the owner needs the contact detail that answers today. **Named consequence:** `Booking` snapshots `priceAtBooking` and `depositAmount` (§11) but never the client's name or phone, so an overwrite retroactively changes what every historical booking for that client displays as its contact. This was decided rather than discovered — snapshotting contact details onto `Booking` was considered and declined while the table was still empty, and is tracked as technical debt for reconsideration before it is not.

**Relationships:**

- `owner`: Many-to-one → Owner
- `bookings`: One-to-many → Booking

---

### 11. Booking

A single appointment. This is the central entity of the system: it ties a client, a barber, and a service to a time slot, and tracks the booking lifecycle and its deposit.

**Fields:**

- `id`: Unique identifier (PK, cuid)
- `clientId`: Foreign key → Client (required)
- `barberId`: Foreign key → Barber (required)
- `serviceId`: Foreign key → Service (required)
- `startTime`: Appointment start (DateTime, required)
- `endTime`: Appointment end — derived from `startTime` + `service.durationMinutes` (DateTime, required)
- `status`: Lifecycle state — enum `BookingStatus` (see below) (required, default: `PENDING_PAYMENT`)
- `priceAtBooking`: Service price snapshot at booking time (Decimal, required)
- `depositAmount`: Deposit required/charged to confirm (Decimal, required)
- `cancellationToken`: Unguessable token used in the client cancellation link (required, unique)
- `holdExpiresAt`: When the provisional hold expires if not confirmed (DateTime, optional)
- `cancelledAt`: When the booking was cancelled (DateTime, optional)
- `cancelledBy`: Who cancelled — enum `CancelledBy` (`OWNER`, `CLIENT`) (optional)
- `createdAt` / `updatedAt`: Timestamps

**`BookingStatus` enum values:**

- `PENDING_PAYMENT` — slot held provisionally while the client completes payment (Mercado Pago not yet confirmed, or transfer receipt not yet uploaded)
- `PENDING_APPROVAL` — transfer receipt uploaded, awaiting owner approval (still a provisional hold, and **not one that time resolves** — see the blocking rule below)
- `CONFIRMED` — payment confirmed (Mercado Pago webhook) or transfer approved by owner
- `CANCELLED` — cancelled by owner or client
- `EXPIRED` — provisional hold expired without confirmation; slot released

**Validation Rules:**

- `startTime` must be within the barber's WorkingHours and not inside any TimeOff range
- **No-overlap rule:** for a given barber, no two bookings in a _blocking_ status (`PENDING_PAYMENT`, `PENDING_APPROVAL`, `CONFIRMED`) may overlap in `[startTime, endTime)`. This must be enforced transactionally (see `backend-standards.md`) to prevent double-booking under concurrency.
- The chosen service must be assigned to the chosen barber (a BarberService row must exist)
- `depositAmount` is derived from PaymentConfig by the `DepositPolicy` rule stated in §14 — the fixed value or the percentage of `priceAtBooking`, rounded half-up, capped at the price and floored at the minimum chargeable amount
- **`depositAmount` is a snapshot and is never recomputed.** It is calculated once, at booking creation, from the policy in force at that instant. A later change to the deposit policy does not alter this booking in any status, and validating a payment compares against the recorded amount, never against the live policy. Recomputing would reject a client who is paying a checkout created moments before the owner edited the policy — the payment would be correct and the system would call it wrong
- **`holdExpiresAt` is the creation instant plus `HOLD_DURATION_MINUTES` (15), clamped so it never exceeds `startTime`.** The duration is a judgement rather than a measurement — no real shop has used this product yet — comfortable for a Mercado Pago checkout and tight but workable for locating a bank transfer destination. **The clamp is correctness, not a preference.** An unclamped hold on a near-term appointment would lapse _after_ the appointment has already begun, and the job that sweeps expired holds would then expire a booking whose time has passed. The minimum booking lead time (`MIN_BOOKING_LEAD_MINUTES`, declared alongside `HOLD_DURATION_MINUTES` in `bookingHorizon.ts`) makes this case unreachable today only because that lead time is itself a guess likely to be lowered once a real shop asks for it — so the clamp is written into the rule rather than relied upon as an emergent property of another constant
- **The hold duration is no longer a single constant for a booking's lifetime.** Committing to a bank transfer extends `holdExpiresAt` to that instant plus `TRANSFER_HOLD_DURATION_MINUTES` (**45**), declared beside the creation constant and carrying the same disclosure that it is a judgement. Fifteen minutes was sized for a hosted checkout; forty-five is sized for authenticating into a banking app, registering a destination — which several banks gate behind their own confirmation step — transferring, capturing and uploading. A hold that lapses mid-transfer is the worst failure this product has: the client's money has moved and **no row here records that anyone paid**, because there is no gateway to ask. **Every write that sets or moves `holdExpiresAt` applies the same clamp, expressed once and called by each writer.** The extension being three times the creation duration brings the clamp materially closer to being reached, which is the second reason it is a shared function rather than a rule each writer restates
- **`PENDING_APPROVAL` blocks its slot and is never expired by `holdExpiresAt`.** That column is the deadline for _uploading_ a receipt, not for _answering_ one. Releasing the slot underneath a transfer the owner is about to approve would sell it twice. **The one exception is a `PENDING_APPROVAL` booking whose `startTime` has already passed**, which is eligible for expiry: its time cannot be sold to anyone any more, so releasing it sells nothing twice, and without it the status has no exit that does not depend on the owner being attentive. The review surface makes an unanswered receipt rarer, not impossible — an owner on holiday blocks the calendar exactly as an absent reviewer would
- **`EXPIRED` is written by exactly one thing: the scheduled sweep (B7).** It is the terminal record of an abandoned hold, and it is deliberately _not_ what releases the slot — availability has released it since B3 by evaluating `holdExpiresAt` at read time, so a swept row and an unswept lapsed row are indistinguishable to every read path in the product. What the sweep provides is a status that describes what happened, so that a reader who filters on status alone is correct rather than accidentally correct
- **A `PENDING_PAYMENT` booking becomes sweepable `EXPIRY_GRACE_MINUTES` (10) _after_ `holdExpiresAt`, not at it.** The grace is what preserves the late-payment guarantee: the Mercado Pago confirmation that rescues a paid booking whose slot nobody took is guarded on the booking still being `PENDING_PAYMENT`, so a sweep with no grace would turn every such payment into money taken for an appointment that no longer exists. Preference expiry stops an attempt _begun_ after the hold lapsed; it does nothing about one begun moments before it and approved moments after. The grace costs nothing, because the slot has been sellable throughout it. A fifth judgement constant of the same family as the four above, declared beside them in `bookingHorizon.ts`
- **A `PENDING_APPROVAL` booking becomes sweepable once its own `startTime` has passed, and the grace does not apply to it.** The grace protects an in-flight gateway confirmation and there is no gateway on this path — the only thing that could still confirm the booking is a human, whose answer the passing of the appointment has already made worthless
- **The sweep writes one column.** `Payment` rows are untouched, because a late notification must still be able to complete the payment's own history. `cancelledAt` and `cancelledBy` stay null: `CancelledBy` admits only `OWNER` and `CLIENT`, and `EXPIRED` against `CANCELLED` is precisely how this product tells a deadline apart from a decision. `holdExpiresAt` is **preserved** on an expired row — it is the evidence of why the row ended — deliberately unlike the confirmation and cancellation writes, which clear it because a booking they finish has no hold left to describe

**Relationships:**

- `client`: Many-to-one → Client
- `barber`: Many-to-one → Barber
- `service`: Many-to-one → Service
- `payments`: One-to-many → Payment

> **Note on location:** a booking's location is derived through its barber (`barber.locationId`); it is intentionally not duplicated on Booking to preserve normalization. Location-filtered statistics join through Barber.

---

### 12. Payment

A payment attempt/record associated with a booking's deposit. Supports both Mercado Pago and bank transfer.

**Fields:**

- `id`: Unique identifier (PK, cuid)
- `bookingId`: Foreign key → Booking (required)
- `method`: Payment method — enum `PaymentMethod` (`MERCADO_PAGO`, `BANK_TRANSFER`) (required)
- `amount`: Amount of the payment (**`Decimal(12,2)`, explicit precision and scale — never Prisma's default `Decimal(65,30)`**, per the convention `Service.price` established and `Booking` follows). Copied from `Booking.depositAmount` at creation; the webhook compares Mercado Pago's reported `transaction_amount` against **this** column
- `status`: Payment state — enum `PaymentStatus` (`PENDING`, `APPROVED`, `REJECTED`) (required, default: `PENDING`)
- `mpPaymentId`: External Mercado Pago payment id (optional, for MP method — **`@unique`**, see below)
- `mpPreferenceId`: External Mercado Pago preference id (optional, for MP method)
- `mpInitPoint`: Where the client is sent to pay — Mercado Pago's `init_point` (optional). **Stored rather than reconstructed**, because a repeat submission must answer with the _same_ checkout instead of creating a second preference: rebuilding the URL from `mpPreferenceId` relies on a redirect shape Mercado Pago does not document, and re-fetching the preference spends a round trip on an owner-facing path that can fail. It is null between the row's creation and the preference's, because the `notification_url` must carry this row's own id — so the payment is written first and the URL attached after. **A live payment with a null `mpInitPoint` is an unfinished preference creation and is retried, never treated as a block**
- `approvedAt`: When the payment was approved (**`Timestamptz(3)`**, optional — zone-aware, never the zone-less default)
- `createdAt` / `updatedAt`: Timestamps

> **`TransferReceipt` was not created alongside this table.** B5 created `Payment` and the two enums only; the receipt entity and `ReceiptStatus` arrived with B6. The `BANK_TRANSFER` method value existed from the start because an enum is cheaper to declare whole than to alter later — B5 wrote nothing with it, and B6 is its first writer.

**Validation Rules:**

- `amount`: required, > 0
- For `MERCADO_PAGO`: status transitions are driven by the MP webhook, keyed by `mpPaymentId`
- For `BANK_TRANSFER`: status transitions to `APPROVED`/`REJECTED` are driven by the owner reviewing the TransferReceipt
- **`mpPaymentId` is unique, and that constraint IS the webhook's idempotency guarantee.** Duplicate delivery is normal operation for this gateway — it retries, sends several topics per payment, and can deliver out of order. Idempotency therefore rests on the database refusing the second insert, never on a prior read, which two concurrent deliveries can both pass. The unique violation is translated as already-processed and that translation is **qualified on the violated constraint**: this codebase already carries a defect (T15) where an unqualified violation is reported as a duplicate name
- **At most one non-rejected payment per booking**, enforced by a partial unique index Prisma cannot declare:
  `CREATE UNIQUE INDEX "Payment_one_live_per_booking" ON "Payment" ("bookingId") WHERE status <> 'REJECTED';`
  Without it, two concurrent taps on the payment control each observe no existing payment and create two preferences for one slot. A `REJECTED` payment deliberately does not block a retry
- **The index bounds _methods_ as well as attempts, and `mpInitPoint` is where the boundary falls.** A client who taps Mercado Pago and then chooses bank transfer collides with this index, so the choice has to be decided rather than left to a constraint violation. A live `MERCADO_PAGO` payment **with** a stored `mpInitPoint` blocks a transfer commitment: a checkout exists, it can be paid at any moment, and making room for a second method risks charging the client twice. A live `MERCADO_PAGO` payment **without** one is set to `REJECTED` inside the committing transaction and the transfer proceeds — that state is an unfinished preference creation, already documented above as something to retry rather than treat as a block, and no checkout ever existed for anyone to pay. The strict alternative, first-method-wins, was rejected because it traps precisely the client B6 exists to serve: the one whose Mercado Pago attempt failed for the shop's reasons
- **The confirming transition is conditional, never assigned.** The update to `CONFIRMED` is guarded on the booking still being `PENDING_PAYMENT`, so a second delivery updates zero rows — which is a normal outcome, not an error. A handler that writes the last-seen status would let an out-of-order `pending` un-confirm a paid booking
- **A payment may be `APPROVED` while its booking is not `CONFIRMED`.** This is the late-payment case: the hold lapsed, the slot was resold, and the charge nonetheless happened. Recording it as `REJECTED` would hide real money from the owner's own accounting. Statistics and income counters must therefore join through the booking's status rather than counting approved payments alone. Such a payment is **money the owner owes back**, not money they earned, and the scheduled sweep logs it at error with its amount for exactly that reason
- **An income figure is bounded on `approvedAt`, never on `createdAt` and never on the appointment's `startTime`.** The three answer different questions and only one of them is income. `createdAt` is when the checkout opened, which may be a payment that never completed; `startTime` is when the haircut is, which is a different month for any deposit paid in advance. `approvedAt` is when the money moved, and it is the only one an owner can reconcile against a bank statement. **Both writers set it** — the Mercado Pago confirmation and the owner's transfer approval — so it is reliable on either path. A deposit approved on 31 August for a 3 September appointment is August income. (An accounting view bounded on the appointment instead is a legitimate second question and belongs to a story that offers a range filter, not to a single at-a-glance figure.)
- **A figure summed from this column is deposits, and must be labelled as deposits.** This product never records the balance a client pays in the chair, so a total presented as "income" or "turnover" is wrong by the whole service price minus the deposit. The same rule the transfer review follows: a surface must not imply a fact the system does not have

**Relationships:**

- `booking`: Many-to-one → Booking
- `transferReceipt`: One-to-one (optional) → TransferReceipt (only for bank transfers)

---

### 13. TransferReceipt

A proof-of-transfer file uploaded by the client for a bank-transfer payment, which the owner approves or rejects from the dashboard.

**Fields:**

- `id`: Unique identifier (PK, cuid)
- `paymentId`: Foreign key → Payment (required, unique — one receipt per transfer payment)
- `filePath`: **The object key** of the uploaded receipt in Supabase Storage (required)
- `status`: Review state — enum `ReceiptStatus` (`PENDING`, `APPROVED`, `REJECTED`) (required, default: `PENDING`)
- `uploadCount`: How many times this booking has submitted a receipt, including the first (Int, default 1). A column rather than a count of rows, because a replacement updates this row in place to keep `paymentId` unique — there is nothing to count
- `uploadedAt`: When the client uploaded the receipt (**`Timestamptz(3)`**, auto-set — zone-aware, never the zone-less default)
- `reviewedAt`: When the owner reviewed it (**`Timestamptz(3)`**, optional)

> **Why the column is a key and not a URL.** This bucket is **private**, so there is no URL that resolves without credentials, and a signed URL expires — persisting one would store a value that is wrong within the hour. The key is the stable identity of the object; the owner's review surface signs it at render time with the owner's own session. `IImageStorage.StoredImage.url` already declined to promise public readability for exactly this case.

**Validation Rules:**

- `filePath`: required; allowed types **JPG, PNG and PDF**; max 10 MB. **SVG is excluded**, for the reason `imageType.ts` records — it is a script-execution surface — and the exclusion holds even though this bucket is private, because the file is later opened in the owner's own browser
- **The type is determined by inspecting the file's leading bytes**, never by the declared content type or the extension. Both are client-controlled and prove nothing. The 10 MB ceiling is enforced three times: at the route before the body is read, again against the actual byte length because `Content-Length` is client-controlled, and by the bucket's own `file_size_limit`
- **No filename is stored, and none contributes to the key.** The key is `{ownerAuthUserId}/{bookingId}/{uploadedAtEpochMs}.{ext}`, composed entirely of server-held values, with the extension derived from the _detected_ type. Storage keys accept path separators, so a client-supplied filename reaching a key is a traversal primitive — and this private bucket is precisely what such a traversal would aim at. The leading segment is the **Supabase auth user id**, not `Owner.id`: they are distinct values (`Owner.authUserId` maps one to the other), and only the former is what a bucket policy can compare against a session
- **A receipt may be replaced while its status is `PENDING`.** A further submission updates this same row with a new `filePath` and `uploadedAt`; it never creates a second row, so the unique `paymentId` holds. **The superseded object is left in the bucket, as a bounded orphan** — deleting it would require granting the anonymous uploader a delete policy, and an anonymous caller who can delete can delete anybody's receipt. The displaced key is logged so a retention rule can find it later. Replacement exists because rejection is destructive — it cancels the booking — and without it an accidental wrong photo would cost the client their appointment. Submissions are capped at `MAX_RECEIPT_UPLOADS_PER_BOOKING` (3), checked against the database, which is the bound that actually holds: the per-origin throttle is per-isolate (`tech-debt.md` T55) and the token's holder is a legitimate client
- Approving a receipt sets the parent Payment to `APPROVED` and the Booking to `CONFIRMED`. Rejecting it sets the parent Payment to `REJECTED` and the Booking to `CANCELLED`, releasing the slot
- **Both transitions are conditional and both run under the per-barber advisory lock** the booking write takes (`backend-standards.md` rule 4). The booking update is guarded on the status it expects, so a concurrent transition matches zero rows instead of being reasserted — the same rule the Mercado Pago confirmation follows, and for the same reason
- **Nothing in this entity verifies that a transfer happened.** A receipt image is trivially fabricated and this product has no bank integration. The file is evidence for a human, and the review surface renders the booking's snapshotted deposit beside it so the comparison is possible at all. No column here should ever be read as proof of payment

**Relationships:**

- `payment`: One-to-one → Payment

---

### 14. PaymentConfig

The owner's shared payment configuration, applied across all locations: Mercado Pago credentials, bank-transfer destination, and deposit policy.

**Fields:**

- `id`: Unique identifier (PK, cuid)
- `ownerId`: Foreign key → Owner (required, unique — one config per owner)
- `mpAccessToken`: Mercado Pago Access Token (**stored as an encryption envelope, never plaintext**, optional until configured)
- `mpPublicKey`: Mercado Pago Public Key (stored as plaintext, optional until configured)
- `transferCbuCvu`: Bank transfer CBU/CVU (max 30, optional)
- `transferAlias`: Bank transfer alias (max 60, optional)
- `transferHolderName`: Account holder name shown to clients (max 120, optional)
- `depositType`: How the deposit is computed — enum `DepositType` (`FIXED`, `PERCENT`) (required, default: `PERCENT`)
- `depositValue`: Fixed amount (ARS) or whole percentage (1–100) depending on `depositType` (Decimal, **optional until the deposit policy is configured**)
- `createdAt` / `updatedAt`: Timestamps

> **Why `depositValue` is nullable.** The row is created by whichever payment story the owner completes first — saving a transfer destination creates it before any deposit policy has been chosen. A required column would force that first write to invent a percentage the owner never selected, and "not configured" would become indistinguishable from "configured to that value". A null means exactly what it says. The consequence is that the guarantee "this business can accept bookings" is no longer expressible as a column constraint; it is the application gate stated below.

> **How `mpAccessToken` is stored.** The column holds a versioned, self-describing envelope, not the token:
>
> ```
> v1.<base64url initialization vector>.<base64url ciphertext‖authentication tag>
> ```
>
> AES-256-GCM, a fresh random 96-bit initialization vector per write, and the `ownerId` plus a purpose identifier bound as additional authenticated data — so a ciphertext lifted from one row or one context cannot be decrypted in another. The column type is unchanged (`String?`); the envelope is text and needs no migration. The `v1` marker is present from the first stored value so a later key or algorithm change can identify what it is reading instead of inferring it. A value that does not parse as a recognized envelope is rejected as unreadable and is **never** interpreted as plaintext.
>
> **`mpPublicKey` is deliberately not encrypted.** It is disclosed to every client who reaches the payment step — encrypting it would add a decryption step to a public read path in exchange for nothing. `mpAccessToken` authorizes charges and is the opposite case.

**Validation Rules:**

- `mpAccessToken` must never be exposed to the client/browser; only `mpPublicKey` is safe to send to the frontend
- `mpAccessToken` and `mpPublicKey` are **both present or both absent**. This is enforced in the application layer, not by a column constraint, because each is nullable for the case where Mercado Pago is not configured at all. A public key alone cannot authorize a charge and an access token alone cannot initialize the client-side checkout, so half a pair is a payment method that fails at the moment a client tries to use it
- Reads serving the public booking flow must use a narrow projection selecting only the columns that read needs — the transfer fields, the public key, or the deposit policy. `mpAccessToken` lives in this row, and a projection that does not carry it cannot leak it
- **Bookability gate (application rule, not a column constraint):** before the public booking flow may accept a booking, the owner must have _both_ at least one fully configured payment method (MP credentials present, and/or transfer destination present) _and_ a non-null `depositValue`. Enforced at the entry to the booking flow; no database constraint can express it, because each half is written by a different story
- `depositValue`: when present, if `PERCENT` it must be a **whole number** between 1 and 100 inclusive; if `FIXED` it must be > 0 and at most `MAX_PRICE` (9,999,999.99). It is absent only while the deposit policy is unconfigured. `PERCENT 100` is permitted and means full prepayment
- `depositType` is **always submitted explicitly** by the deposit policy editor. The column default (`PERCENT`) exists so that a write belonging to another story can create the row without choosing a policy; it is never a fallback for a submission that omitted the type. A value meant as pesos and stored as a percentage charges a different order of magnitude, and neither half of that pair looks wrong on its own
- The `FIXED` ceiling is deliberately **tighter than the column**. Validating below `Decimal(12, 2)` is what makes a PostgreSQL numeric overflow — which is not a typed Prisma error and would surface as a generic infrastructure failure — unreachable by construction, the same technique `Service.price` uses
- **Deposit computation (the only definition).** For a booking of a service priced `P`, the deposit is computed in this order: (1) `raw` = the fixed value, or `P × percentage ÷ 100`; (2) rounded **half-up to two decimals** using integer-cent arithmetic, never a floating-point intermediate; (3) capped at `P`; (4) floored at `MIN_DEPOSIT_AMOUNT`, **except** where `P` is itself below that floor, in which case the deposit is `P`. Step 4 is guarded rather than a plain maximum because an unguarded floor would undo the cap of step 3 and charge more than the service costs. The rule lives in the `DepositPolicy` value object and is reused by the booking flow, the payment stories and the statistics module — it is never reimplemented per surface
- **The price cap is the protection; a save-time warning is not.** A fixed deposit larger than a service price is reported to the owner when they save, but that check is a snapshot of the catalogue: a cheaper service created later produces no second warning. Only the cap holds in every case
- `MIN_DEPOSIT_AMOUNT` exists because a computed deposit below a payment gateway's minimum produces a charge that cannot be created, failing inside a client's checkout rather than at configuration time. Its value is **`15.00` ARS, measured** in B5 (2026-08-19) from Mercado Pago's `/v1/payment_methods` against a real Argentine account. Sixteen active methods fall into four bands — prepaid cards accept from **1**, debit and Visa/Mastercard/Amex from **3**, Diners/Naranja/Argencard/Cabal from **15**, and the cash tickets (Rapipago, Pago Fácil) from **50**. **15 is the point at which every card method works**, and cards are what this product charges with. The literal floor of 1 was rejected because a two-peso deposit is payable only by prepaid card — a client with an ordinary Visa would reach the checkout and find nothing usable, which is the failure this floor exists to prevent. 50 was rejected as over-reach: it would raise a configured deposit twenty-five times over to preserve cash methods this product has never offered. **The remaining consequence is `T61`**: a deposit between 15 and 50 silently offers fewer payment methods than a larger one, and the deposit editor does not say so
- **The floor is Mercado Pago's, and it binds the transfer path too.** A bank transfer has no such minimum, but the deposit rule is shared and one floor is simpler than a per-method one. Accepted deliberately; at these amounts the difference is theoretical
- **Clearing the deposit policy** sets `depositValue` back to null and is an explicit action, never the consequence of submitting an empty field. It is permitted even when it leaves the business unable to accept bookings: an owner migrating between models must not be trapped, which is the same rule the transfer destination follows
- Transfer destination: `transferCbuCvu` is stored as digits only and must be exactly 22 digits with valid check digits; `transferAlias` is stored trimmed and lowercased. Either alone is sufficient; both may be present, in which case the CBU/CVU is the primary destination shown to clients
- `transferHolderName` is **required whenever `transferCbuCvu` or `transferAlias` is present**, and must be absent when both are. It is nullable at the column level only because the whole transfer destination is optional — a destination with no holder name is unusable, since the client cannot confirm from their bank's screen that they are paying the right business
- The three transfer fields are not secrets and are not encrypted: they are displayed verbatim to every client who chooses transfer. Only `mpAccessToken` is encrypted at rest
- A write configuring one payment method must not modify the columns belonging to another. Three stories share this row, and a whole-entity write would silently reset the other two while reporting success

**Relationships:**

- `owner`: One-to-one → Owner

---

## Entity Relationship Diagram

```mermaid
erDiagram
    Owner {
        String id PK
        String email UK
        String authUserId UK
        DateTime createdAt
        DateTime updatedAt
    }
    BusinessProfile {
        String id PK
        String ownerId FK
        String businessName
        String bio
        String photoUrl
        String coverUrl
        String publicSlug UK
    }
    SocialLink {
        String id PK
        String businessProfileId FK
        String platform
        String url
        Int orderIndex
    }
    PaymentConfig {
        String id PK
        String ownerId FK
        String mpAccessToken
        String mpPublicKey
        String transferCbuCvu
        String transferAlias
        String transferHolderName
        String depositType
        Decimal depositValue
    }
    Location {
        String id PK
        String ownerId FK
        String name
        String address
        Boolean isActive
    }
    Barber {
        String id PK
        String locationId FK
        String displayName
        String bio
        String avatarUrl
        Boolean isActive
    }
    Service {
        String id PK
        String ownerId FK
        String name
        String description
        Decimal price
        Int durationMinutes
        Boolean isActive
    }
    BarberService {
        String id PK
        String barberId FK
        String serviceId FK
    }
    WorkingHours {
        String id PK
        String barberId FK
        Int dayOfWeek
        Int startTime
        Int endTime
    }
    TimeOff {
        String id PK
        String barberId FK
        DateTime startDate
        DateTime endDate
        String reason
    }
    Client {
        String id PK
        String ownerId FK
        String name
        String email
        String phone
    }
    Booking {
        String id PK
        String clientId FK
        String barberId FK
        String serviceId FK
        DateTime startTime
        DateTime endTime
        String status
        Decimal priceAtBooking
        Decimal depositAmount
        String cancellationToken UK
        DateTime holdExpiresAt
        DateTime cancelledAt
        String cancelledBy
    }
    Payment {
        String id PK
        String bookingId FK
        String method
        Decimal amount
        String status
        String mpPaymentId
        String mpPreferenceId
        DateTime approvedAt
    }
    TransferReceipt {
        String id PK
        String paymentId FK
        String fileUrl
        String status
        DateTime uploadedAt
        DateTime reviewedAt
    }

    Owner ||--|| BusinessProfile : "has"
    Owner ||--|| PaymentConfig : "has"
    Owner ||--o{ Location : "owns"
    Owner ||--o{ Service : "offers"
    Owner ||--o{ Client : "serves"
    BusinessProfile ||--o{ SocialLink : "lists"
    Location ||--o{ Barber : "employs"
    Barber ||--o{ BarberService : "assigned"
    Service ||--o{ BarberService : "assigned"
    Barber ||--o{ WorkingHours : "works"
    Barber ||--o{ TimeOff : "off"
    Barber ||--o{ Booking : "attends"
    Service ||--o{ Booking : "booked_as"
    Client ||--o{ Booking : "makes"
    Booking ||--o{ Payment : "paid_by"
    Payment ||--o| TransferReceipt : "proven_by"
```

---

## Key Design Principles

1. **Referential Integrity** — All foreign key relationships are explicitly declared and enforced at the database level. Deletes use `RESTRICT` on entities with historical value (e.g., a Client with Bookings) and `CASCADE` only where a child cannot exist without its parent (e.g., SocialLink without BusinessProfile).

2. **Flexibility** — Availability is modeled as configurable data (WorkingHours + TimeOff + Service duration), not hardcoded logic. Slots are computed on demand, so schedule changes require no schema changes.

3. **Audit Trail** — Timestamp fields (`createdAt`, `updatedAt`, `uploadedAt`, `reviewedAt`, `approvedAt`, `cancelledAt`) provide a queryable timeline for bookings, payments, and receipt reviews — feeding the dashboard statistics.

4. **Extensibility** — The modular entity design allows new features (e.g., promotions, multi-service bookings, barber accounts) to be added without breaking existing relationships.

5. **Data Normalization** — The schema follows normalization (≥ 3NF): a booking's location and price-derived data are not duplicated but derived/snapshotted intentionally. `priceAtBooking` and `depositAmount` are deliberate snapshots (historical accuracy for income statistics), not denormalization of live values.

---

## General Conventions

- **Primary keys**: All entities use a string surrogate key `id` with `@default(cuid())` (Prisma) for non-guessable identifiers.
- **Foreign keys**: Declared explicitly with referential-integrity constraints; `onDelete` behavior chosen per relationship (RESTRICT vs CASCADE) as described above.
- **Unique constraints**: Applied to `Owner.email`, `BusinessProfile.publicSlug`, `Booking.cancellationToken`, `PaymentConfig.ownerId`, and composite uniques (`Location(ownerId, name)`, `Barber(locationId, displayName)`, `Service(ownerId, name)`, `Client(ownerId, email)`, `BarberService(barberId, serviceId)`, `SocialLink(businessProfileId, platform)`).
- **Optional fields**: Represented as nullable; required fields are non-nullable.
- **Enum / status fields**: Defined as native PostgreSQL enums via Prisma (`BookingStatus`, `PaymentMethod`, `PaymentStatus`, `ReceiptStatus`, `DepositType`, `SocialPlatform`, `CancelledBy`) and validated at the application layer.
- **Timestamps**: `createdAt` via `@default(now())`; `updatedAt` via `@updatedAt`.
- **Stored time — two kinds, never mixed.** The distinction is recorded here rather than left to be inferred from column types:
  - A **recurring schedule** (`WorkingHours`, §8) is stored as **wall-clock minutes from midnight in business local time**, with no offset applied at rest.
  - A **point in time** (`TimeOff` §9, `Booking.startTime`/`endTime`/`holdExpiresAt` §11, and every `createdAt`/`updatedAt`) is a **UTC instant** and must use a zone-aware column, `@db.Timestamptz`.

  Prisma's default for `DateTime` is a zone-**less** `TIMESTAMP`, which is harmless for `createdAt` and wrong for anything compared against a human's clock. `Booking.startTime` must therefore declare `@db.Timestamptz` explicitly when it is created; inheriting the default by omission is the failure mode this convention exists to prevent.

- **Business timezone**: `America/Argentina/Buenos_Aires`, a constant rather than a column — every branch is in Argentina. Conversion between local time and instants lives in exactly one domain module. The deployment runtime is UTC, so `getDay()`, `getHours()`, `getDate()` and `toISOString().slice(0, 10)` are **forbidden in scheduling code**: they return the UTC answer, which is wrong for the last three hours of every local day, and they return a plausible number rather than raising. Timezone data support on the runtime is proven by an executable check, because a runtime lacking it falls back to UTC silently.
- **Money**: All amounts use `Decimal` (Prisma `@db.Decimal`) to avoid floating-point rounding errors; currency is ARS.
- **Secrets**: `PaymentConfig.mpAccessToken` is encrypted at rest and never sent to the browser; only `mpPublicKey` is exposed to the frontend. The encryption key is the deployment secret **`PAYMENT_CREDENTIALS_KEY`** (32 bytes, base64-encoded), held as a Wrangler secret in production and in `.dev.vars` locally. It is validated at the composition root of the feature that uses it rather than at global startup, so a deploy missing it breaks that one feature instead of the whole dashboard. **Losing or rotating this key without re-encrypting makes every stored credential permanently unreadable**; the only recovery is the owner entering their credentials again, which is why an undecryptable value is surfaced as its own state in the dashboard rather than reported as an absent credential.
- **Concurrency**: The Booking no-overlap invariant is enforced inside a database transaction (see `backend-standards.md`), never by application-level read-then-write alone.
