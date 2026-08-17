# booking-selection Specification

## Purpose
The three-step selection a client makes after opening a barbershop's public link: a branch, then a service offered at that branch, then a barber who performs it there. Every list is filtered by real bookability rather than existence, and the unit of that bookability is the (service, location) pair — a service with active barbers at one branch and none at another is offered at the first and absent at the second. The first route in this project whose inputs are supplied entirely by a stranger, and the last one before a booking creates a row. Created by archiving change b2-booking-selection.

## Requirements

### Requirement: The shop is resolved before the selection is read
`/b/{slug}/reservar` SHALL resolve the slug through the same three-way decision the profile page uses — render, 308 to the canonical spelling, or 404 — **before** any query parameter is parsed and before any catalogue read is issued.

Resolution SHALL reuse the existing slug decision rather than reimplement it. A second implementation of percent-decoding, bounding and canonicalization would be a second set of answers to questions B1 measured on the deployment runtime, and the two would drift.

An unresolvable slug SHALL produce the same Spanish not-found page the namespace already shares, with the same non-disclosure: nothing distinguishes "never existed" from "the owner changed it".

#### Scenario: An unknown slug on the booking route
- **WHEN** `/b/{unknown}/reservar` is requested
- **THEN** the response status is 404 and the shared Spanish not-found page renders
- **THEN** no catalogue query is issued

#### Scenario: A hostile slug reaches the booking route
- **WHEN** the slug segment is overlong, carries a null byte, traversal segments or a malformed percent sequence
- **THEN** it resolves to not-found without issuing a database query and without a driver error reaching the response

#### Scenario: The selection is not parsed before the shop is known
- **WHEN** a request carries query parameters and a slug that does not resolve
- **THEN** the not-found response is produced and the parameters are never used in a lookup

### Requirement: Canonicalization covers the query string
When the slug is a non-canonical spelling of a stored slug, the response SHALL be a **308** to `/b/{canonical}/reservar` carrying the **query string unchanged**.

Dropping the query would silently discard the client's selection and return them to step one, which reads as the page losing their input. The status is 308 rather than 302 because it is method-preserving: B4 posts to this path, and a redirect that downgraded the method would turn a booking into a navigation.

#### Scenario: A non-canonical spelling mid-selection
- **WHEN** `/b/BARBERIA-DON-JUAN/reservar?local={locationId}&servicio={serviceId}` is requested and `barberia-don-juan` is stored
- **THEN** the response is a 308 to `/b/barberia-don-juan/reservar?local={locationId}&servicio={serviceId}`
- **THEN** every parameter and its value survive the redirect

#### Scenario: A canonical spelling
- **WHEN** the stored slug is requested exactly
- **THEN** the page renders with no redirect

### Requirement: Bookability is evaluated over the (service, location) pair
A `(service, location)` pair SHALL be treated as bookable only when **all four** hold: the service is active, the location is active, at least one `BarberService` row exists for that service, and at least one such barber is active **and** works at that location.

A location SHALL be offered only when at least one pair is bookable at it. A barber SHALL be offered for a chosen `(service, location)` only when active, at that location, and holding a `BarberService` row for that service.

This settles what `docs/tech-debt.md` T23 deferred. Because the client picks a branch first, a service with active barbers at Centro and none at Norte is bookable at Centro and dead at Norte; reporting a single global fact per service would offer the client a service at a branch where nobody can perform it, and the dead end would appear at B3 as an empty calendar rather than here as an absence.

Bookability SHALL be derived at read time and MUST NOT be persisted.

#### Scenario: A service bookable at one branch only
- **WHEN** a service is assigned exclusively to an active barber at "Centro", and "Norte" is also active
- **THEN** the service is offered after selecting "Centro" and is absent after selecting "Norte"

#### Scenario: A branch whose every service is dead
- **WHEN** a location's only assigned barbers are inactive
- **THEN** that location is not offered at the branch step

#### Scenario: A service assigned only to inactive barbers
- **WHEN** every barber assigned to a service at the selected location is inactive
- **THEN** the service is not offered

#### Scenario: An inactive service with an active barber
- **WHEN** a deactivated service is assigned to an active barber at an active location
- **THEN** it is not offered

#### Scenario: A barber who does not perform the chosen service
- **WHEN** the barber step renders for a chosen service
- **THEN** only barbers holding a `BarberService` row for that service at that location appear

### Requirement: The owner is resolved inside the application layer and never leaves it
The catalogue reads SHALL be owner-scoped. The owner id SHALL be obtained from `publicSlug` through `IBusinessProfileRepository`, and that contract SHALL document **exactly two** deliberate non-owner-scoped reads, each with its reason and each bounded by what it may return:

- one returning the owner id alone, for the booking route, which needs the owner and never the profile;
- one returning the public projection **and** the owner in a separate field, for the profile page, which needs both in a single round trip.

The count SHALL NOT grow beyond two. Giving the location, service, barber and assignment repositories slug-scoped methods of their own would take it to five and put an unscoped query back within reach in four aggregates that currently make one inexpressible.

The owner id MUST NOT appear in the public projection, in the catalogue projection, in any component prop, in the serialized payload sent to the browser, or in any URL. Where it is returned beside a projection, it SHALL be a **sibling field** and SHALL be removed before any value reaches a caller that only renders.

B1 excluded `ownerId` from the public projection on purpose — "the next field added to it would ship to every anonymous visitor with nothing to catch it". B2 needs that value server-side, so the exclusion has to be re-earned rather than inherited: it is fetched, used as a query predicate, and dropped.

#### Scenario: The owner id does not reach the client
- **WHEN** any page under `/b/{slug}` or `/b/{slug}/reservar` renders
- **THEN** no owner identifier appears in the response body or in the serialized client payload

#### Scenario: The public projection is unchanged by the widened read
- **WHEN** the read that returns both the projection and the owner resolves
- **THEN** the projection carries exactly the fields it carried before, with no owner identifier, no row id and no timestamp

#### Scenario: A caller that only renders cannot receive the owner
- **WHEN** the profile is resolved for rendering alone
- **THEN** the resolution carries no owner identifier

#### Scenario: Catalogue reads stay owner-scoped
- **WHEN** the catalogue repository is reviewed
- **THEN** every method takes the owner as a required parameter, and an unscoped catalogue query is inexpressible through the contract

### Requirement: The selection travels in the query string and every id is verified against the resolved shop
The selection SHALL be carried as `?local=`, `?servicio=`, `?barbero=`, `?fecha=` and `?hora=`, so that back, forward, reload and a shared link all restore the same step.

Each value is supplied entirely by a stranger. Each SHALL be bounded by length **before** any query, and SHALL then be verified to belong to the resolved shop **and** to be consistent with the rest of the selection: the service bookable at the given location, the barber active at that location and performing that service, the date a real calendar date inside the booking horizon, and the time a member of the list of starts generated for that date.

`?fecha` and `?hora` are not identifiers and are not looked up. A date is validated as a canonical calendar date within bounds; a time is only ever matched against the generated list. Neither is ever parsed into a value that is then trusted.

A value that fails any check MUST NOT be rendered, MUST NOT be used to select a substitute, and MUST NOT reach a query that is not owner-scoped.

#### Scenario: An id belonging to a different barbershop
- **WHEN** a request carries a valid service id owned by another barbershop
- **THEN** no field of that service is rendered and no data belonging to the other shop appears in the response

#### Scenario: An inconsistent triple
- **WHEN** the location, service and barber are each valid for the shop but the barber does not work at the given location
- **THEN** the barber selection is discarded and the barber step renders

#### Scenario: A time that is not on offer
- **WHEN** a request carries an `hora` that is not among the starts generated for the given `fecha`
- **THEN** it is discarded and the slot step renders

#### Scenario: An overlong parameter
- **WHEN** a parameter carries several thousand characters
- **THEN** it is rejected before any query is issued

#### Scenario: A repeated or array-valued parameter
- **WHEN** the same parameter appears more than once in the query string
- **THEN** the request is resolved deterministically and no driver error reaches the response

### Requirement: An unknown id and a cross-owner id are indistinguishable
The response to an id belonging to another owner SHALL be identical to the response to an id that matches no row — same step, same status, same copy.

A differential response is an oracle: it answers "does this id exist somewhere in the system" for anyone willing to sweep, on a route with no rate limit. The two cases are also indistinguishable to the client, who in both situations simply holds a link that no longer works.

#### Scenario: Cross-owner and unknown resolve alike
- **WHEN** one request carries a service id owned by another shop and another carries a service id matching no row
- **THEN** both produce the same step, the same HTTP status and the same visible copy

#### Scenario: The attempt is recorded
- **WHEN** a well-formed id fails owner scoping
- **THEN** an `info` log records it, sanitized and truncated, without disclosing anything to the client

### Requirement: A selection that no longer resolves falls back to the last valid step
When a parameter is discarded, the request SHALL render the step that parameter belongs to, **preserving every upstream selection that is still valid**, and SHALL disclose in Spanish that the previous choice is no longer available. It SHALL NOT produce a 404 and SHALL NOT silently substitute another option.

Changing an upstream selection SHALL discard every downstream one. Carrying a service from a branch the client just changed produces an inconsistent triple that would have to be caught later anyway. The date and the time are downstream of the barber, so changing the branch, the service or the barber discards them too.

The links shared on WhatsApp outlive the catalogue they were built from, and they outlive the calendar even faster: a date that was in range last week may be in the past today, and a time that was free an hour ago may be taken. A stale link is the normal case, not the exception, and 404ing the whole page for a barber who was deactivated last week discards a branch and a service choice that are both still correct.

#### Scenario: The chosen barber was deactivated after the link was shared
- **WHEN** a link carrying a valid location, service and barber is opened after that barber is deactivated
- **THEN** the location and service selections are preserved, the barber step renders with the remaining barbers, and a Spanish notice states the previous choice is unavailable
- **THEN** the response is not a 404

#### Scenario: A date that has since passed
- **WHEN** a link carrying a date now in the past is opened
- **THEN** the location, service and barber selections are preserved, the date step renders, and a Spanish notice states the date is no longer available
- **THEN** the response is not a 404

#### Scenario: A time taken between sharing and opening
- **WHEN** a link carrying a start that another client has since booked is opened
- **THEN** the slot step renders with the remaining starts and a Spanish notice, and no other start is selected on the client's behalf

#### Scenario: The branch is changed
- **WHEN** the client returns to the branch step and selects a different location
- **THEN** the service, barber, date and time selections are discarded rather than carried forward

#### Scenario: The whole shop stops being bookable mid-flow
- **WHEN** every location is deactivated while the client is on the barber step
- **THEN** the next navigation renders the designed empty state rather than an operable list

### Requirement: The catalogue is one composed read with an explicit projection
The catalogue SHALL be obtained in a single database round trip per request, built with an explicit `select`. It SHALL NOT return persisted rows.

The projection SHALL carry only what the flow renders or hands to the availability step: for a location its id, name and address; for a service its id, name, description, price and duration; for a barber its id, display name, bio and avatar URL. No `ownerId`, no timestamps, and **no `isActive`** — that flag has already been applied as a filter, and returning it tells a stranger the shop has deactivated rows.

Four sequential round trips is the shape T47 warns about on the busiest public route, against a transaction-mode pooler shared with the owner's dashboard.

`durationMinutes` is included because slot generation sizes appointments by it and would otherwise re-issue this whole query.

**The availability read is a second composed read, not an extension of this one.** On the steps that need it, the request costs exactly one round trip more: the catalogue, then the barber's windows, absences and blocking bookings together. A step that does not need availability SHALL NOT issue that second read.

#### Scenario: The read is a projection
- **WHEN** the catalogue read executes
- **THEN** it issues explicit column selections rather than reading whole records

#### Scenario: One round trip
- **WHEN** a request renders any step
- **THEN** the catalogue is obtained in a single database round trip

#### Scenario: Availability costs exactly one more round trip
- **WHEN** a request renders the date or the slot step
- **THEN** it issues the catalogue read and one further read, and no more

#### Scenario: The earlier steps do not pay for availability
- **WHEN** a request renders the branch, service or barber step
- **THEN** no availability read is issued

#### Scenario: Excluded columns stay excluded
- **WHEN** the response is inspected
- **THEN** no owner identifier, timestamp or activity flag appears

### Requirement: Prices are carried as canonical decimal strings
`Service.price` SHALL be carried through the flow as a canonical two-decimal string and formatted for display in es-AR through the shared helper. It MUST NOT be handled as a number or as a driver decimal at any point.

**Measured, not anticipated.** PC3 verified against the live database that the driver returns a stored `2000.50` as `2000.5`, and integer-cent arithmetic read the lone `5` as five centavos — M3 had documented the same failure for this exact column. This is the first surface that shows a price to a paying client, and a factor-of-ten error here is money.

#### Scenario: A price ending in fifty centavos
- **WHEN** a service priced at `2000.50` renders
- **THEN** it displays as `$2.000,50`, and neither as `$2.000,05` nor as `$20.005`

#### Scenario: A whole-peso price
- **WHEN** a service priced at `10000.00` renders
- **THEN** it displays with two decimal places in es-AR formatting

### Requirement: The route reads no payment configuration
No request to `/b/{slug}/reservar` SHALL read `PaymentConfig`, call the payment-readiness rule, construct a credential cipher or construct a Supabase client. The composition root SHALL hand over no `PaymentConfig` repository.

That row holds the encrypted Mercado Pago access token. PC3 established that a surface with no need for a cipher must not build one, and B1's composer records the absence deliberately rather than incidentally.

**The accepted consequence is stated rather than discovered:** a client can complete all three steps at a shop whose owner never configured a deposit, and meet the wall at B4. That is the correct trade — moving the payment gate here would put the encrypted token one query away from an anonymous, unauthenticated, unrate-limited route, to save three taps in a state that exists only between the payment stories and the owner's first configuration.

#### Scenario: A shop with a complete catalogue and no deposit policy
- **WHEN** the owner has bookable services but has configured neither a payment method nor a deposit
- **THEN** all three steps render normally and no `PaymentConfig` row is read

#### Scenario: Composition review
- **WHEN** the change is complete
- **THEN** the public composition root constructs no Supabase client, no cipher and no `PaymentConfig` repository

### Requirement: The route declares no loading boundary
This route SHALL NOT define a `loading.tsx` and SHALL NOT introduce any Suspense boundary above the slug resolution.

B1 measured this on the deployment runtime: a boundary makes Next.js commit `200 OK` before the page resolves anything, degrading `notFound()` to a soft 404 and `permanentRedirect()` to a `<meta http-equiv="refresh">`. WhatsApp and Instagram follow HTTP redirects when building a link preview and do **not** execute a meta refresh — on a product whose distribution channel is WhatsApp. Raising the outcome inside `generateMetadata` was tried on this runtime and does not work; that avenue is closed.

This route both redirects and 404s, so it inherits the constraint whole. Skeletons below an already-resolved boundary are permitted.

#### Scenario: Configuration review
- **WHEN** the change is complete
- **THEN** no `loading.tsx` exists under the booking route and no Suspense boundary wraps the slug resolution

#### Scenario: A crawler meets an unknown slug
- **WHEN** a link-preview bot requests `/b/{unknown}/reservar`
- **THEN** it receives HTTP 404, not a 200 carrying not-found content

### Requirement: Every empty state is designed and discloses no cause
The flow SHALL define distinct Spanish states for: no bookable branch anywhere, a branch with no bookable service, a service with no available barber at that branch, and a shop with no catalogue at all.

None SHALL disclose *why* — whether something was deactivated, never created, or merely unassigned. The client cannot act on that difference and the owner has not consented to publishing it.

A shop with a published profile and nothing else is the normal state minutes after the first save, and `/b/{slug}/reservar` is reachable by typing it. Each state SHALL render a complete page, never an empty list, and SHALL return HTTP 200.

#### Scenario: A shop that has configured nothing
- **WHEN** a client opens the booking route for a shop with no location, service or barber
- **THEN** a designed Spanish empty state renders with status 200
- **THEN** the copy does not reveal whether the shop ever had a branch or a service

#### Scenario: A branch with nothing bookable is never reachable
- **WHEN** the branch step renders
- **THEN** only locations with at least one bookable pair are offered

#### Scenario: A service whose last barber was unassigned
- **WHEN** the only `BarberService` row for the selected service at that branch is removed and the barber step is opened
- **THEN** its own empty state renders, distinct from the branch and service empty states

### Requirement: The call to action on the profile page is gated on the catalogue
`/b/{slug}` SHALL present an operable "Reservar" control only when at least one `(service, location)` pair is bookable. Otherwise it SHALL present the same non-actionable, disclosed state B1 established, and SHALL NOT link into the wizard.

Sending a client into a three-step flow that ends in an empty state is a worse answer than saying so on the page they already opened. The gate SHALL be answered within the profile page's existing request rather than by a second round trip.

#### Scenario: A bookable shop
- **WHEN** a profile with at least one bookable pair renders
- **THEN** "Reservar" is a link to `/b/{slug}/reservar`

#### Scenario: A shop with nothing bookable
- **WHEN** no bookable pair exists
- **THEN** no operable call to action is rendered and the Spanish disclosure explains that booking is unavailable
- **THEN** no `PaymentConfig` read occurs

### Requirement: The steps work before hydration and are individually shareable
Each step SHALL be server-rendered, and navigation between steps SHALL be a `<Link>` to the next URL. The flow SHALL be completable without client-side JavaScript having run.

`useSearchParams` SHALL NOT be read in a Client Component above the resolution: it forces a Suspense boundary and reintroduces the status degradation the loading-boundary requirement exists to prevent.

Every step SHALL offer an explicit back control and a persistent summary of what is already selected. Browser back and forward SHALL land on the step the URL names.

#### Scenario: Navigation before hydration
- **WHEN** a step is chosen before the page has hydrated
- **THEN** the next step renders

#### Scenario: A shared mid-flow URL
- **WHEN** a URL carrying a valid location and service is opened in a fresh browser
- **THEN** the barber step renders with both upstream selections shown

#### Scenario: Back and forward
- **WHEN** the client advances two steps and presses back twice
- **THEN** the branch step renders and the downstream parameters no longer bind

### Requirement: Navigation in the public flow does not prefetch
Every link in the booking flow, and the profile page's call to action, SHALL disable router prefetching. The setting SHALL live in a single shared component rather than being repeated at each call site.

**Measured in the browser, not anticipated.** The router prefetches the RSC payload of each link that enters the viewport, and on this route that payload is a full catalogue read — so the branch step issued one extra server request *per branch* before the client touched anything, and a service step at the per-owner cap of fifty would issue fifty. The client picks exactly one option per step, so every other prefetch is work discarded, on the one route with neither a cache nor a rate limit and a pool shared with the owner's dashboard.

**The slot step raises the stakes rather than changing the rule.** Its payload is a catalogue read *and* an availability computation, and on a five-minute grid it can render on the order of a hundred links on one screen. Every link the date step and the slot step render therefore goes through the same shared component.

The cost is accepted and named: a tap waits for the navigation rather than finding it warmed. The per-option pending state covers that wait.

One component holds the decision because a setting repeated at six call sites is one that gets re-enabled at five of them without anyone noticing.

#### Scenario: The branch step is rendered
- **WHEN** a client opens the branch step for a shop with several branches
- **THEN** exactly one request is issued, and no prefetch request is made for any branch

#### Scenario: The slot step is rendered
- **WHEN** a client opens a slot step carrying a hundred starts
- **THEN** exactly one request is issued, and no prefetch request is made for any start

#### Scenario: A step is chosen
- **WHEN** the client selects an option
- **THEN** exactly one further request is issued

#### Scenario: The setting has one home
- **WHEN** the flow's navigation is reviewed
- **THEN** prefetching is disabled in a single shared component that every public-flow link uses

### Requirement: A single offerable branch does not become a step
When exactly one location is offerable, the branch step SHALL be skipped and the service step SHALL render directly, with the branch named in the selection summary and still changeable.

Most barbershops in the target market have one branch. A choice with one option asks the client to confirm something they were never given a say in, on the first screen of the flow that earns the business money.

#### Scenario: One offerable branch
- **WHEN** the owner has exactly one location with a bookable pair
- **THEN** the service step renders first, the branch is named in the summary, and no branch selection is presented

#### Scenario: Two offerable branches
- **WHEN** two locations each have a bookable pair
- **THEN** the branch step renders with both

### Requirement: The public flow presents a client-facing failure, never the dashboard's
A failure of the catalogue read SHALL render the client-toned Spanish error boundary already serving this namespace, with a retry. The dashboard's error boundary MUST NOT be what a client meets, and coverage of the nested segment SHALL be verified rather than assumed.

No response on any failure path SHALL contain a stack trace, connection string, SQL, table or column name, or English technical text.

#### Scenario: The pooler refuses the connection
- **WHEN** the catalogue read fails
- **THEN** the client-facing Spanish error state renders with a retry control

#### Scenario: No internal detail escapes
- **WHEN** any failure path renders
- **THEN** the response body carries no stack trace, connection string, SQL, schema name or English technical text

### Requirement: Parameterized URLs do not compete with the page the owner shares
The bare `/b/{slug}/reservar` is the only address of this route search engines SHALL be invited to index. Parameterized variants SHALL either declare a canonical pointing at the bare path or declare `noindex`, and the choice SHALL be recorded with its reason.

B1 made `/b/{slug}` deliberately indexable because discovery is what the product is for. Left unhandled, this route generates one crawlable URL per `(location, service, barber)` combination per shop — near-duplicates competing with the page the owner actually shares, and a crawl budget spent sweeping a parameter space.

#### Scenario: A parameterized URL is crawled
- **WHEN** a crawler requests the route carrying a selection
- **THEN** the page either declares the bare path as canonical or declares `noindex`

#### Scenario: The decision is recorded
- **WHEN** the change is complete
- **THEN** the indexing choice and its reason are written down

### Requirement: The flow speaks Spanish from its own copy key
All copy SHALL live under a `booking` key in `src/lib/copy.ts`, a sibling of `publicProfile` rather than nested inside it, and SHALL be written in es-AR. No user-facing literal SHALL appear outside the copy module, and no dashboard string SHALL be reused.

B1's rule is one key per public surface. The profile page and the booking flow address the same person at different moments, and sharing strings means editing one and silently changing the other.

#### Scenario: Copy location
- **WHEN** the booking route renders
- **THEN** every user-facing string originates in `src/lib/copy.ts` under the `booking` key

#### Scenario: No dashboard copy is reused
- **WHEN** the copy module is reviewed
- **THEN** no `businessProfile` or other dashboard string is referenced by the booking flow

### Requirement: The flow holds together on a phone at its content bounds
Every step SHALL render without horizontal overflow at a 360-pixel viewport with the column maxima: 120-character location, service and barber names, a 500-character barber bio, a 500-character service description, and a service list at the per-owner cap of fifty.

Clients open this link primarily on phones. `docs/tech-debt.md` T18 is this exact failure, already observed once with a long unbroken name.

Barber avatars SHALL render through a plain `<img>` with reserved space and a designed initials fallback, lazily below the fold. No image optimization, remote pattern configuration or image service SHALL be introduced.

#### Scenario: Content at maximum length on a small viewport
- **WHEN** a step renders 120-character names and a 500-character bio at 360 pixels wide
- **THEN** the text wraps, the page does not scroll horizontally, and no control is pushed off screen

#### Scenario: Fifty services
- **WHEN** the service step renders a catalogue at the per-owner cap
- **THEN** the layout holds and every entry remains reachable

#### Scenario: A missing or unreachable avatar
- **WHEN** a barber has no avatar, or the stored URL resolves to a missing object
- **THEN** the initials fallback renders in reserved space, with no broken image element and no layout shift

### Requirement: Every control is reachable without a mouse and announced correctly
Each step SHALL be a semantic list of controls with full keyboard navigation and a visible focus indicator. The step indicator SHALL mark the current step programmatically, not by styling alone. Selected state MUST NOT be conveyed by colour alone. Contrast SHALL meet WCAG AA.

#### Scenario: Keyboard traversal
- **WHEN** a step is operated with the keyboard only
- **THEN** every option and the back control are reachable, and focus is visible throughout

#### Scenario: The current step is announced
- **WHEN** the step indicator renders
- **THEN** the current step is exposed to assistive technology rather than indicated by styling alone

### Requirement: The flow is five steps and its progress is computed, never counted by hand

The flow SHALL be branch, service, barber, date, time. The step indicator and the selection summary SHALL derive the total and the current position from the flow definition rather than from a literal, so that B2's single-offerable-branch skip continues to produce a correct indicator without a second rule.

Every step SHALL keep the explicit back control and the persistent summary of what is already selected, and the summary SHALL name the chosen date and time once they exist.

#### Scenario: Five steps with a branch choice
- **WHEN** a shop with two offerable branches renders any step
- **THEN** the indicator reports five steps and marks the current one programmatically

#### Scenario: Four steps when the branch is implied
- **WHEN** a shop with exactly one offerable branch renders any step
- **THEN** the indicator reports four steps, and the branch is named in the summary and remains changeable

#### Scenario: The summary carries the whole selection
- **WHEN** the slot step renders with a branch, service, barber and date chosen
- **THEN** all four appear in the summary in es-AR

### Requirement: A completed selection ends in a disclosed, inert confirmation

When a valid time is selected the flow SHALL render a summary of the complete selection with a **non-actionable** call to action and a Spanish disclosure that booking cannot be completed yet. It MUST NOT link to a route that does not exist, and MUST NOT link to any dashboard route.

B1 shipped "Reservar" inert with a disclosure when `/b/{slug}` did not exist, and B2 inherited that answer. Linking a client into a route that redirects to `/login` is worse than saying so on the page they are already on.

The step SHALL NOT read `PaymentConfig`, so the accepted consequence B2 named stands unchanged: a client can complete every step at a shop whose owner never configured a deposit.

#### Scenario: The selection is complete
- **WHEN** a client selects a valid start time
- **THEN** the complete selection renders with a Spanish disclosure and no operable control that leads anywhere

#### Scenario: No payment configuration is read
- **WHEN** the completed step renders
- **THEN** no `PaymentConfig` row is read and no credential cipher is constructed
