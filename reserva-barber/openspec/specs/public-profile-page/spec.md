# public-profile-page Specification

## Purpose
The page a guest reaches from the link a barbershop shares: the shop's brand — name, bio, profile and cover images, social links — plus the entry point into booking. The first route in this project served without a session, and the first database read reachable without one. Created by archiving change b1-public-profile-page.

## Requirements

### Requirement: The page renders for a visitor with no session
`/b/{slug}` SHALL render for an unauthenticated request. An owner holding a valid session SHALL see the same page, not a redirect and not dashboard chrome.

The authenticated case is called out because the guard already branches on `hasSession` for `/login`, and the natural way to write that branch a second time is to send the owner somewhere else. The owner needs to see exactly what their clients see; that is how they check their own page.

#### Scenario: An anonymous visitor opens a published profile
- **WHEN** a request with no session cookie opens `/b/{slug}` for a stored slug
- **THEN** the public profile renders and no redirect to `/login` occurs

#### Scenario: The owner opens their own public page
- **WHEN** an owner with a valid session opens their own `/b/{slug}`
- **THEN** the client-facing page renders, without dashboard navigation and without a redirect

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

### Requirement: The route parameter is percent-decoded before it is normalized
The requested slug SHALL be percent-decoded before `slugify` is applied. A malformed percent sequence SHALL resolve to not-found rather than raising. The path-separator, null-byte and traversal checks SHALL run **after** decoding.

Measured on the deployment runtime, not assumed: `/b/Barbería-Don-Juan-Centro` reaches the application as `Barber%C3%ADa-Don-Juan-Centro`, which without decoding normalizes to `barber-c3-ada-don-juan-centro` — a slug nobody holds. A client typing the shop's own name with its accent would get a 404 where a redirect was intended, and every accented business name in the target market is affected.

Ordering matters, and the pre-decode bound SHALL NOT be the column's 60. Percent-encoding inflates every accented character from one character to six, so "Peluquería y Estética Íntegra de Ñuñoa" — 38 characters, normalizing to a valid 38-character slug — arrives as 73. Testing the raw value against 60 looks stricter and is simply wrong: it rejects legitimate URLs for every accented business name long enough, which is the failure this requirement exists to prevent, one step earlier. The raw ceiling SHALL therefore be generous, existing only to refuse absurd payloads, and the column bound SHALL be enforced after normalization, where `slugify` already truncates.

The **content** checks run after decoding, because `%2F` and `%00` are precisely how a separator or a null byte gets past a check that runs too early.

Canonicality SHALL be judged against the value **as it arrived**, not against the decoded form, so an unnecessarily encoded spelling of a canonical slug still redirects rather than serving a second URL for one shop.

#### Scenario: An accented business name in the URL
- **WHEN** `/b/Barbería-Don-Juan-Centro` is requested and `barberia-don-juan-centro` is stored
- **THEN** the request resolves to that profile rather than to not-found

#### Scenario: An accented name whose encoding exceeds the column bound
- **WHEN** a name of 38 characters carrying several accents is requested, arriving percent-encoded as 73 characters
- **THEN** it is decoded and normalized rather than rejected for length, and the resulting slug is at most 60 characters

#### Scenario: An encoded separator
- **WHEN** the parameter decodes to a value containing `/`, `..` or a null byte
- **THEN** it resolves to not-found and no query is issued

#### Scenario: A malformed percent sequence
- **WHEN** the parameter is `barberia%` or `%zz`
- **THEN** it resolves to not-found without raising

#### Scenario: An unnecessarily encoded canonical slug
- **WHEN** `/b/barberia%2Ddon%2Djuan` is requested and `barberia-don-juan` is stored
- **THEN** the response redirects to the canonical URL rather than serving the profile at a second address

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

### Requirement: An unknown slug is a real 404 that discloses nothing
An unresolvable slug SHALL produce HTTP status 404 with a Spanish not-found page carrying no dashboard navigation and no link to `/login`. The copy SHALL NOT distinguish "this slug never existed" from "the owner changed their slug", because the system cannot distinguish them either.

The miss SHALL be logged at `info` with the requested value, truncated to the column's 60-character bound and sanitized before it is written.

That log is the only signal that will exist when `docs/tech-debt.md` T33 — a changed slug stranding every link already shared — actually happens to a real owner. Logging the fact without the value would record that misses are occurring while making it impossible to tell a client holding a stale link from someone enumerating slugs, and those two findings call for opposite responses.

#### Scenario: A link shared before the owner changed their slug
- **WHEN** an anonymous client opens a slug that no longer exists
- **THEN** the response status is 404, a Spanish not-found page renders with no route into the dashboard, and the copy does not state whether the slug ever existed

#### Scenario: The miss is recorded
- **WHEN** a slug fails to resolve
- **THEN** an `info` log records the requested value, truncated and sanitized

#### Scenario: No profile exists at all
- **WHEN** any slug is requested before the owner has ever saved a profile
- **THEN** the request resolves to a clean 404 rather than an error

#### Scenario: The namespace root
- **WHEN** `/b` is requested with no slug
- **THEN** the response is 404, not a redirect to `/login`, and it is **this product's** Spanish not-found page rather than the framework's English one

#### Scenario: The whole namespace shares one not-found page
- **WHEN** any unresolvable path under `/b` is requested, whether or not it carries a slug
- **THEN** the same Spanish not-found page renders, and no English framework page is served to a client

### Requirement: A hostile route parameter cannot reach an unbounded query
The route parameter SHALL be bounded before it is used in a lookup. A value longer than the 60-character column bound, or carrying a null byte or path-traversal segments, SHALL resolve to not-found without issuing a database query and without any driver error reaching the response.

The column is bounded; the route parameter is not, and it is the one value in this feature supplied entirely by a stranger.

#### Scenario: An overlong parameter
- **WHEN** a request arrives for a slug of several thousand characters
- **THEN** it resolves to 404 without issuing a database query

#### Scenario: A traversal or null-byte parameter
- **WHEN** the parameter contains `../` segments or a null byte
- **THEN** it resolves to 404 and no database driver error appears in the response

### Requirement: Every field except the business name is optional, and each absence is designed
`bio`, `photoUrl` and `coverUrl` are nullable and the social link set may be empty. Each absence SHALL have a defined rendering: a designed fallback band for the missing cover, an initials placeholder derived from the business name for the missing image, and **omission** of the bio block and of the social section when empty.

No placeholder copy SHALL stand in for a bio the owner did not write. A profile holding nothing but a name and a slug is the normal state minutes after the first save, and it must still produce a page that looks deliberate.

#### Scenario: A profile carrying only a name
- **WHEN** a profile with no bio, no images and no social links is opened
- **THEN** the business name renders inside the cover fallback with an initials avatar, and no bio block, no social section and no broken image element is present

#### Scenario: A missing cover does not collapse the layout
- **WHEN** `coverUrl` is absent
- **THEN** the header renders at its full height with the fallback treatment

### Requirement: Social links are rendered defensively
Each social URL's protocol SHALL be re-checked against the `http:`/`https:` allowlist **at render time**, and every link SHALL carry `target="_blank"` with `rel="noopener noreferrer"`. Neither the bio nor any other stored value SHALL be rendered as raw HTML.

P1 validates the protocol on the way in, and this page is what that control was protecting. A render-time check costs nothing and survives any future write path — a seed, a migration, a support script — that does not run the P1 validator. Opening in a new tab is chosen for the phone: returning from the Instagram application to a browser tab that was replaced is a one-way trip.

#### Scenario: A stored URL with a disallowed scheme
- **WHEN** a social link whose URL is not `http:` or `https:` is present in the data
- **THEN** it is not rendered as a link

#### Scenario: A rendered social link
- **WHEN** a valid social link renders
- **THEN** it opens in a new tab and carries `rel="noopener noreferrer"`

### Requirement: Absolute metadata is emitted only from a configured origin
Link-preview metadata SHALL be built from `APP_ORIGIN`. When that value is absent or unusable, the page SHALL still render and every absolute value — `metadataBase`, the canonical URL and the OpenGraph tags — SHALL be **omitted**. The request's `Host` header SHALL NOT be used as a fallback on this route.

On `/perfil` the `Host` fallback was harmless: an owner spoofing a header addressed to themselves. Here the header is supplied by a stranger and feeds tags that tell the world where this business lives, so a forged value produces a page advertising someone else's origin. Omitting the metadata degrades the link preview — visible, diagnosable, and survivable — where failing the route would take down the one page the business depends on.

Metadata resolution SHALL tolerate an unresolvable slug: it SHALL return generic values and let the page produce the 404, never throw.

#### Scenario: A forged Host header
- **WHEN** a request arrives with a `Host` header naming another origin and no `APP_ORIGIN` is configured
- **THEN** no canonical, `metadataBase` or OpenGraph value naming that host is emitted, and the profile still renders

#### Scenario: A configured origin
- **WHEN** `APP_ORIGIN` is set and a stored slug is opened
- **THEN** the title carries the business name, the description derives from the bio truncated at a word boundary, and the OpenGraph image is the cover or, absent that, the profile image

#### Scenario: Metadata for a slug that does not resolve
- **WHEN** metadata is generated for an unknown slug
- **THEN** generic metadata is returned and the response is the 404 page, not an error

### Requirement: The page declares one canonical URL and is indexable
The profile page SHALL be indexable by search engines and SHALL declare the canonical `/b/{slug}` URL. The not-found page SHALL declare `noindex`.

Discovery is what the product is for; a barbershop that cannot be found by name gains nothing from a public page. The cost is the long tail of T33 — an indexed result surviving a slug change and pointing at a 404 for weeks — which is recorded against that entry rather than paid for by making the page invisible.

#### Scenario: A published profile
- **WHEN** a stored slug renders
- **THEN** the page is indexable and declares the canonical URL for that slug

#### Scenario: The not-found page
- **WHEN** the not-found page renders
- **THEN** it declares `noindex`

### Requirement: Images render without server optimization and reserve their space before they load
Profile and cover images SHALL render through a plain `<img>` with explicit dimensions or an enforced aspect ratio, and SHALL load lazily where they are below the fold. No Next.js image optimization, remote pattern configuration or third-party image service SHALL be introduced.

`next.config.ts` carries no `images.remotePatterns`, and OpenNext on `workerd` does not run the framework's sharp-based optimizer — so the component path is not merely unconfigured, it is unproven on this runtime. What makes optimization unnecessary is that P1 already solved the payload problem at the other end: images are downscaled and re-encoded **in the browser** before upload, so the bytes in the bucket are already small. `ProfileForm.tsx:561` is the existing precedent.

Reserving the space is not cosmetic. Storage is a host this Worker does not control, and a layout that shifts as an image resolves moves the "Reservar" control under a thumb already travelling toward it.

#### Scenario: Image storage is slow or unavailable
- **WHEN** the storage host does not respond within the request budget
- **THEN** the business name, bio, social links and the "Reservar" control still render, and the image slots fall back to their placeholders without shifting the layout

#### Scenario: A stored URL whose object no longer exists
- **WHEN** an image URL resolves to a missing object
- **THEN** the slot shows its designed fallback rather than a broken image element

#### Scenario: Configuration review
- **WHEN** the change is complete
- **THEN** no image optimization, remote pattern or image service has been introduced

### Requirement: The public tree speaks Spanish and shares no copy with the dashboard
All public copy SHALL live under a `publicProfile` key in `src/lib/copy.ts`, separate from `businessProfile`, and SHALL be written in es-AR. The document SHALL declare `lang="es-AR"`, and the root metadata SHALL no longer carry the scaffold's generated title and description. The public route SHALL render outside the dashboard layout, with no dashboard navigation reachable from it.

The two audiences have different tones and different vocabularies; sharing strings means editing a message for the owner and silently changing what a client reads. The `lang` attribute is not a detail either — it lives on the root document, and a screen reader currently pronounces this entirely Spanish product with English phonetics.

#### Scenario: A client-facing page
- **WHEN** any page under `/b/` renders
- **THEN** the document declares `lang="es-AR"`, no dashboard navigation is present, and no user-facing literal appears outside `src/lib/copy.ts`

#### Scenario: Copy is not shared with the owner's surfaces
- **WHEN** public copy is added
- **THEN** it lives under its own key and no `businessProfile` string is reused

### Requirement: The route declares no loading boundary, so its HTTP statuses stay real
This route SHALL NOT define a `loading.tsx`, and SHALL NOT introduce any other Suspense boundary above the profile resolution.

**Measured on the deployment runtime.** A `loading.tsx` opens a Suspense boundary, Next.js begins streaming the shell immediately, and the response headers are committed as `200 OK` before the page has resolved anything. By the time `notFound()` or `permanentRedirect()` runs, the status can no longer be set — Next degrades them to a not-found boundary rendered inside the stream and a `<meta http-equiv="refresh">` respectively. Verified with both files present and absent:

| Request | With `loading.tsx` | Without |
| --- | --- | --- |
| unknown slug | `200` (soft 404) | `404` |
| non-canonical spelling | `200` + meta refresh | `308` |

Raising the outcome inside `generateMetadata` — which appeared to run before the stream — was tried and **does not work** on this runtime; the statuses stayed at `200`. That avenue is recorded as closed so it is not re-attempted.

The statuses win over the skeleton because they are the page's contract with machines, not decoration. WhatsApp and Instagram follow HTTP redirects when building a link preview and do **not** execute a meta refresh, so a shop's link shared in a non-canonical spelling would lose its preview — on a product whose distribution channel is WhatsApp. A soft 404 is also the shape search engines penalize. Against that, the page issues a single fast query, so what is given up is a skeleton on a very short wait.

#### Scenario: Configuration review
- **WHEN** the change is complete
- **THEN** no `loading.tsx` exists under the public route and no Suspense boundary wraps the profile resolution

#### Scenario: An unknown slug reaches a crawler
- **WHEN** a search engine or link-preview bot requests a slug that does not resolve
- **THEN** it receives HTTP `404`, not a `200` carrying not-found content

### Requirement: The page presents an error state built for a client
The route SHALL provide an error boundary whose copy addresses a client rather than the owner. The dashboard's error boundary SHALL NOT be what a client meets.

`app/error.tsx` exists and is written for someone who administers the business. A guest who opened a link from a WhatsApp message needs different words and no invitation into a dashboard.

#### Scenario: The read fails
- **WHEN** the profile read fails for a reason other than not-found
- **THEN** a client-toned Spanish error state renders with a retry, distinct from the dashboard's error boundary

### Requirement: The page is rendered per request, and that is a recorded decision
The route SHALL be dynamically rendered, consistent with every other page in this project. No incremental static regeneration, route cache or slug-keyed cache SHALL be introduced in this change, and the absence SHALL be recorded in `docs/tech-debt.md` with a trigger keyed on measured traffic or the first widely shared link.

Every page in the project is `force-dynamic`. In the dashboard that is required; here it is a choice, and the alternative is this stack's first ISR configuration over `workerd` — new infrastructure, adopted for traffic that does not exist yet, in the runtime whose divergences S0 exists to have caught early. Dynamic rendering also means a profile edit is visible immediately, which is what the owner expects the moment after they save.

#### Scenario: A profile edit is visible immediately
- **WHEN** the owner saves a change to their profile and reloads the public page
- **THEN** the change is visible with no staleness window

#### Scenario: The decision is recorded
- **WHEN** the change is complete
- **THEN** a tech-debt entry records the absent cache and the absent rate limit on this route, with its trigger

### Requirement: The page holds together on a phone at its content bounds
The layout SHALL render without horizontal overflow at a 360-pixel viewport width, including a 120-character business name and a 1000-character bio — the maxima the columns permit.

Clients open this link primarily on phones (`frontend-standards.md`). `docs/tech-debt.md` T18 is this exact failure, already observed once on the barbers list with a long unbroken name.

#### Scenario: Content at its maximum length on a small viewport
- **WHEN** a profile with a 120-character name and a 1000-character bio renders at 360 pixels wide
- **THEN** the text wraps, the page does not scroll horizontally, and the "Reservar" control remains reachable
