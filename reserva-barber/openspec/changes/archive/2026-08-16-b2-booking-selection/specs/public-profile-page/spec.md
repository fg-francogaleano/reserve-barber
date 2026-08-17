## MODIFIED Requirements

### Requirement: The profile is resolved by slug through a read that carries no owner
The public read SHALL resolve a profile by `publicSlug` alone. It SHALL be one of exactly **two** methods on `IBusinessProfileRepository` that are not owner-scoped, and the contract's documentation SHALL name both as deliberate exceptions with their reasons: on the public surface the slug *is* the key, because no session exists to scope by.

The read SHALL return a narrow projection — business name, bio, image URLs, slug and ordered social links — built with an explicit `select`. It SHALL NOT return the persisted row, and no internal identifier or timestamp SHALL reach the rendered page.

That the domain model happens not to carry `ownerId` today is not the protection. It carries `id`, and the next field added to it would ship to every anonymous visitor with nothing to catch it. The projection makes structural what is currently a coincidence.

**The read also yields the owner id, in a field beside the projection and never inside it.** B2's bookability gate needs the owner, and resolving it through a second method would read the same row twice by the same unique key — on the busiest public page in the product, which has neither a cache nor a rate limit. Widening the projection to carry it was rejected outright: that would undo the guarantee above for every caller. The application layer SHALL strip the owner before returning a resolution to any caller that only renders, and the owner SHALL be used as a query predicate only.

#### Scenario: The rendered page carries no internal identifiers
- **WHEN** an anonymous client requests a stored slug
- **THEN** the response body contains no owner identifier, no profile row id and no timestamps

#### Scenario: The query is a projection, not a row read
- **WHEN** the public read executes
- **THEN** it issues an explicit column selection rather than reading the whole record

#### Scenario: Social links arrive in the owner's order
- **WHEN** a profile with several social links is read
- **THEN** they are returned ordered by `orderIndex`, in the same single query as the profile

#### Scenario: The owner travels beside the projection, never inside it
- **WHEN** the read resolves a stored slug
- **THEN** the projection carries no owner identifier and the owner is returned as a separate field

#### Scenario: A render-only caller never receives the owner
- **WHEN** the profile is resolved for rendering alone
- **THEN** the resolution carries no owner identifier

### Requirement: Slug matching is canonical, and other spellings redirect to the canonical URL
`publicSlug` is stored already normalized, so lookup SHALL first attempt an exact match. When no exact match exists, the requested value SHALL be normalized by the same `slugify` used at write time; if the normalized form differs from what was requested and matches a stored slug, the response SHALL be a **308** redirect to the canonical URL. Otherwise the request SHALL produce a not-found response.

**Canonicalization applies to the whole namespace below the slug, not only to the profile page.** A non-canonical spelling of any path under `/b/{slug}` SHALL redirect to the same path under the canonical slug, **preserving the query string unchanged**. B1 shipped this for `/b/{slug}` alone, at a time when nothing existed below it; `/b/{SLUG}/reservar` answered at every spelling, which is a second address for the one page that leads to a payment.

Preserving the query string is not cosmetic once a path below the slug carries state: dropping it would discard a client's selection during a redirect they never asked for, and the page would appear to lose their input.

One address, not several. A shop whose page answers at more than one URL splits its link previews, its analytics and — if the page is indexed — its search results. This is the same rule P1 applied to the editor field, which shows the value that was persisted rather than the text the owner typed, moved up to the URL.

#### Scenario: An exact match
- **WHEN** `/b/barberia-don-juan` is requested and that slug is stored
- **THEN** the profile renders directly, with no redirect

#### Scenario: A non-canonical spelling of a live slug
- **WHEN** `/b/BARBERIA-DON-JUAN` is requested with query parameters appended by a social network
- **THEN** the response is a 308 redirect to `/b/barberia-don-juan`

#### Scenario: A value that normalizes to nothing stored
- **WHEN** the requested value matches no stored slug in either its raw or its normalized form
- **THEN** the request produces a not-found response rather than a redirect loop

#### Scenario: A non-canonical spelling on a path below the slug
- **WHEN** `/b/BARBERIA-DON-JUAN/reservar` is requested and `barberia-don-juan` is stored
- **THEN** the response is a 308 redirect to `/b/barberia-don-juan/reservar`

#### Scenario: A redirect carrying a selection
- **WHEN** a non-canonical spelling is requested with a query string
- **THEN** every parameter and value survives the redirect unchanged

## REMOVED Requirements

### Requirement: The booking call to action is present, primary and deliberately inert
**Reason**: The requirement's own justification was that `/b/{slug}/reservar` does not exist until B2. It exists as of this change, so a control that discloses booking as unavailable would now be false on every shop that can actually take a booking.

The requirement also stated that the control's presence "SHALL NOT depend on whether the business is actually bookable", and that "the bookability gate belongs to B2". That gate is now implemented, so the independence it asserted is deliberately reversed rather than dropped.

**Migration**: Replaced by "The call to action on the profile page is gated on the catalogue" in the `booking-selection` capability. The disabled-with-disclosure treatment is retained verbatim for the case where nothing is bookable, so the state B1 designed still ships — it is now the exception rather than the rule. The prohibition on reading `PaymentConfig` from this page survives intact and is restated in the new requirement.
