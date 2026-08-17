## Context

B1 opened `/b/**` to the public and left a disabled button behind. Its spec records the reason plainly: `/b/{slug}/reservar` did not exist, and a control that navigates to a 404 sends a real client to a dead end. B2 builds that route.

Three inherited facts constrain every decision below.

**The guard exception and the shell already exist.** `decideGuardAction` admits `/b` and everything under `/b/`, verified against `/b/{slug}/reservar` specifically, and `app/b/layout.tsx` is documented as "where B2 hangs the booking wizard". Neither is revisited.

**The composition root is defined by what it refuses to build.** `publicProfileService.ts` constructs no Supabase client, no cipher and no `PaymentConfig` repository, and says so in a comment written for this story to read. B2 adds a second composer under the same rule.

**B1 measured things on `workerd` that contradict the framework's defaults.** A `loading.tsx` commits `200 OK` before resolution and degrades `notFound()` and `permanentRedirect()`; raising outcomes from `generateMetadata` does not work on this runtime. Those findings are load-bearing here, because this route also redirects and 404s.

What is new is the threat surface. B1 took exactly one stranger-supplied value — the slug in the path — and spent a requirement bounding it. B2 takes three more in the query string, and each is a key into owner-scoped data on a route with no session, no cache and no rate limit.

## Goals / Non-Goals

**Goals:**
- A three-step selection — branch → service → barber — where each list is filtered by real bookability rather than existence.
- Fix the unit of bookability as the `(service, location)` pair, which is what `docs/tech-debt.md` T23 has been waiting on since M4.
- Validate every stranger-supplied id against the resolved shop, with cross-owner and unknown indistinguishable.
- Keep `ownerId` server-side, honoring B1's projection rule rather than inheriting it by luck.
- Define what a client meets when there is nothing to book — the question B1 explicitly handed over.
- Hand B3 a validated `(location, service, barber)` triple and the service duration it needs.

**Non-Goals:**
- Dates, slots, availability (B3). Client details or any provisional row (B4). Any payment (B5/B6).
- The payment-readiness gate. It stays with B4 and `PaymentConfig.isBookable()`.
- The dashboard's per-branch bookability breakdown. B2 settles the aggregate's shape; presenting it to the owner is separate work.
- Caching or rate limiting (T47). An "any available barber" option. Service categories or search.

## Decisions

### D1 — Query-string selection, not path segments

`/b/{slug}/reservar?local=&servicio=&barbero=` rather than `/b/{slug}/reservar/{locationId}/{serviceId}`.

`frontend-standards.md` asks for step state "in a hook/URL search params so back/forward works and steps are shareable/restorable". Path segments would also be shareable, but they force a route-tree shape where a missing middle segment is a routing miss rather than a recoverable state — and recovering from stale selections is D6, the single most common real-world path through this feature. Query parameters make "the barber is gone but the branch is fine" a value decision instead of a 404.

Spanish parameter names, matching the Spanish route segment. Rejected: opaque encoded state, which breaks the shareability that motivated URL state at all.

### D2 — The selection contract is a pure function

`bookingSelectionParams.ts` takes the raw parameters and the resolved catalogue and returns `{ step, selection, discarded[] }`. No I/O, following `publicSlugLookup.ts`.

The interesting behavior of this feature is a decision table — which parameters survive, which are discarded, which step results — over inputs a browser cannot easily produce. Testing it through a rendered page means constructing hostile URLs against a live database to assert a heading. B1 split the same way and its slug edge cases are covered by unit tests as a result.

### D3 — The owner id is fetched, used as a predicate, and dropped

Two contract methods carry no owner, and the count stays at **two** — it does not grow:

- `findOwnerIdByPublicSlug` — a single column, for the booking route, which needs the owner and never the profile.
- `findWithOwnerByPublicSlug` — the public projection **plus** the owner in a separate field, for the profile page, which needs both. This **replaces** B1's `findByPublicSlug` rather than joining it; see D10 for why, and note that the projection it returns is byte-identical to B1's.

Three alternatives were weighed:

- **Add `ownerId` to `PublicBusinessProfile`.** Rejected outright. B1's requirement says the projection's exclusion "makes structural what is currently a coincidence", and the value would then ship to every anonymous visitor. Returning it in a *sibling field* is a different thing: the projection is unchanged, and the owner is destructured off before it is built.
- **Give the catalogue repository slug-scoped methods.** Rejected: it multiplies unscoped reads across four aggregates. That would take the count from one to five and put "forgot to filter by owner" back within reach in four places that currently make it impossible.
- **Resolve the owner once, then scope normally.** Chosen. Every catalogue query stays owner-scoped and inexpressible otherwise, which is the property `ILocationRepository`, `IServiceRepository`, `IBarberRepository` and `IBarberServiceRepository` all document.

**Revised during implementation.** The design originally added `findOwnerIdByPublicSlug` *alongside* `findByPublicSlug`, which would have left the profile page reading the same row twice by the same unique key — see D10.

### D4 — Bookability is `(service, location)`, evaluated at read time

The predicate is the conjunction of four facts, and T23 names B2 as the story that gets to fix the unit. It is fixed as the pair.

The alternative — reuse the dashboard's per-service `countActiveBarbersByService` — is wrong here in a way that only shows up with two branches: it would offer a service at a branch where nobody performs it, and the dead end would surface at B3 as an empty calendar. A client cannot tell an empty calendar from a busy barbershop.

The dashboard keeps its coarser per-service marker. Extending it is presentation work on an aggregate whose shape is now settled, and doing it here would grow a public-flow change into a dashboard change for an owner-facing gap no client can hit.

No denormalized flag. `data-model.md` §7 already rejects one: it needs invalidating on four distinct events and is wrong the first time one is missed.

### D5 — One composed read per request

A single owner-scoped catalogue read joining locations, services and assignments, with an explicit `select`.

Four sequential round trips is precisely the shape T47 warns about, against a transaction-mode pooler shared with the owner's dashboard — saturation takes down the admin surface alongside the public one. With D3's owner lookup and B1's `cache()`-deduplicated slug resolution, a request costs two round trips.

The projection deliberately omits `isActive`. It has already been applied as a filter, and returning it tells a stranger the shop has deactivated rows.

`durationMinutes` is carried although B2 renders nothing with it. B3 sizes slots by it, and the alternative is B3 re-issuing this query.

### D6 — A stale selection falls back; it never 404s and never substitutes

Upstream selections that are still valid survive; the discarded one renders its own step with a Spanish notice. Changing an upstream selection discards everything downstream.

Links to this route live in WhatsApp threads and outlive the catalogue they were built from. A stale link is the normal case. 404ing the page for a barber deactivated last week throws away a branch and a service that are both still correct, and silently substituting another barber books the client with someone they did not choose — which is the failure this whole story exists to prevent.

### D7 — Cross-owner and unknown ids produce byte-identical outcomes

Same step, same status, same copy. Any difference is an existence oracle on a route with no rate limit, and the two cases are indistinguishable to the client anyway: both mean a link that stopped working.

The attempt is logged at `info`, sanitized and truncated through the same treatment `PublicProfileService.forLog` applies. That log is the only signal that will exist if someone starts sweeping — the same argument D15 made in B1 for logging the slug value rather than only the fact.

### D8 — No `loading.tsx`, inherited whole from B1's measurements

B1's table is reproduced by this route because it makes the same two calls:

| Request | With `loading.tsx` | Without |
| --- | --- | --- |
| unknown slug | `200` (soft 404) | `404` |
| non-canonical spelling | `200` + meta refresh | `308` |

The consequence lands on the distribution channel: WhatsApp and Instagram follow HTTP redirects when building a preview and do not execute a meta refresh. Skeletons below an already-resolved boundary are fine; a boundary above the resolution is not.

This also forces a component decision — no `useSearchParams` in a Client Component above the resolution, because it requires a Suspense boundary and would reintroduce the degradation through the back door. Steps are server-rendered and navigate by `<Link>`, which is also what makes the flow work before hydration.

### D9 — Canonicalization extends below the slug, carrying the query string

B1 shipped the 308 for `/b/{slug}` when nothing existed below it. `/b/{SLUG}/reservar` answers at every spelling today.

The query string must survive, or a redirect the client never asked for silently discards their selection. And the status must stay 308 rather than 302 for the reason B1 already recorded: it is method-preserving, and B4 posts to this path.

### D10 — The profile call to action is gated, and B1's read is widened rather than doubled

`/b/{slug}` renders a link when at least one pair is bookable, and otherwise keeps exactly the disabled-and-disclosed treatment B1 designed — that state still ships, as the exception rather than the rule.

Sending a client into three steps that end in an empty state is worse than saying so on the page they already opened.

**Revised during implementation, and the original text was wrong.** This decision first said the gate would be "answered within the profile page's existing request … a second round trip is not a trade worth making", while D3 specified a separate `findOwnerIdByPublicSlug`. Those two cannot both hold: the gate needs the owner, so the page would have read the profile row, then read the *same row by the same unique key* for its `ownerId`, then read the catalogue — three round trips where B1 had one, on the page T47 is already about.

The alternatives, once the contradiction was visible:

- **Three round trips, text corrected.** Rejected. A 200% increase on the busiest public page to decide whether a button is a link.
- **A dedicated `hasBookableCatalogForSlug` boolean.** Two round trips and no owner id anywhere near the page — but it writes the bookability predicate a **second** time, in SQL, which is the "two definitions waiting to disagree" this design objects to elsewhere.
- **Widen B1's read.** Chosen. `findByPublicSlug` becomes `findWithOwnerByPublicSlug`, returning `{ profile, ownerId }` — one extra column on a row already being fetched by its unique key. Profile page: 2 round trips. Booking route: 2. One definition of bookability.

The cost is that the page now holds an `ownerId` variable, which B1's design never had to. It is mitigated the way B1 mitigated the projection: `PublicProfileService.resolveBySlug` destructures the owner off so a caller that only renders cannot receive it, and a test asserts the value never appears in the rendered output.

`findByPublicSlug` is **removed** rather than kept alongside. Its only caller was the method now widened, and this project has an explicit position on contract methods with no caller — PC1 declined to write `isBookable` for exactly that reason.

### D11 — The route reads no `PaymentConfig`, and the consequence is stated

The prohibition survives intact from B1 and PC3: that row holds the encrypted Mercado Pago access token, and a surface with no need for a cipher must not construct one.

This has a real cost and it is named rather than discovered: **a client can complete all three steps at a shop with no deposit configured and meet the wall at B4.** Moving the gate here would put the encrypted token one query away from an anonymous, unrate-limited route to save three taps, in a state that exists only between the payment stories and the owner's first configuration. The roadmap entry for B2 lists "no deposit policy" among this story's conditions; that conflates two gates and is corrected.

### D12 — Prices stay canonical decimal strings end to end

Carried as two-decimal strings, formatted for display through the shared es-AR helper.

**Measured, not anticipated.** PC3 verified against the live database that the driver returns a stored `2000.50` as `2000.5`, and integer-cent arithmetic read the lone `5` as five centavos; M3 had documented the identical failure for this column. B2 is the first surface that shows a price to a paying client. Round fixtures will not catch this — the runtime verification drives a `.50` price on purpose.

### D13 — One offerable branch skips its step

The service step renders first, with the branch named in the summary and still changeable.

Most barbershops in the target market have one branch. A one-option choice asks the client to confirm something they were never given a say in, on the first screen of the flow that earns the business money. The branch stays visible and changeable so the skip is never a trap for the shops that do have two.

### D15 — Prefetching is off, in one place

**Added after runtime verification, from an observation the design had not anticipated.** Next prefetches the RSC payload of every `<Link>` entering the viewport. On this route that payload is a full catalogue read, so the branch step fired one extra server request per branch, unprompted — `1 + L` queries per page view, `1 + 50` on a service step at the cap.

That is the exact amplification D5 minimised inside a single request and T47 warns about across requests, arriving through a mechanism neither of them looked at. The client picks one option per step; every other prefetch is discarded work.

`StepLink` wraps `next/link` with `prefetch={false}` and every public-flow link goes through it, including the profile page's call to action — warming the booking route from there would have added a third catalogue query to the busiest page in the product for a client who may never press the button.

Re-measured after the change: branch step, one request; each navigation, one more. The trade is a tap that waits ~1 s rather than finding the page warmed, which the per-option pending state covers.

Rejected: setting the prop at each of the six call sites. A decision spread across six places is one that gets re-enabled at five of them silently, and `prefetch` is invisible in the DOM — no rendered-output test can catch the regression, which is why the invariant needs one home and a mocked-`next/link` test.

### D14 — Parameterized URLs get a canonical, and the reason is recorded

B1 made `/b/{slug}` deliberately indexable because discovery is what the product is for. Unhandled, this route generates one crawlable URL per `(location, service, barber)` combination per shop — near-duplicates competing with the page the owner actually shares.

Declaring the bare `/b/{slug}/reservar` canonical is preferred over `noindex`: the entry point stays discoverable while the parameter space collapses to one address.

## Risks / Trade-offs

- **The owner id is now in the call stack of a public route.** → It never enters the projection, and its absence from the rendered output and the serialized payload is asserted by test rather than by comment. This is the same failure mode B1's projection requirement was written against, and the test is the structural half.

- **T47 gets worse and is being accepted again rather than fixed.** A heavier query, plus a parameter space a crawler can sweep at `L × S` requests per shop, on a pool shared with the dashboard. → Re-costed in the tech-debt entry rather than silently inherited, with the trigger kept keyed on measured traffic. Fixing it here would mean adopting this stack's first ISR or rate-limiting configuration for traffic that does not exist.

- **The B4 wall is real and this change chooses it.** A client completing three steps at an unconfigured shop meets a refusal at the end. → Bounded to the window between the payment stories shipping and the owner's first configuration; PC3 already reports readiness to the owner in the dashboard.

- **Fifty services on a phone has no scan-time answer.** `MAX_SERVICES_PER_OWNER` is 50 and step 2 can legitimately render all of them at 360 px. → The layout is required to hold at that bound; grouping or search is recorded as debt rather than invented here for a catalogue size no real shop has yet.

- **Server-rendered steps mean a round trip per tap.** → The alternative is a client wizard that breaks shareability and pre-hydration operation, and reintroduces the Suspense boundary D8 forbids. Each step is one composed query on a fast path; per-card pending state covers the perceived wait on a phone connection.

- **A second unscoped repository read normalizes the exception.** → Documented on the contract next to the first, with its reason, exactly as B1 handled `findByPublicSlug`. Two documented exceptions with stated reasons is a different thing from a contract that no longer holds.

## Migration Plan

No migration, no new environment variable, no new dependency, no schema change.

Deployment is additive: a new route under a namespace already public, plus one changed control on `/b/{slug}`. Rollback is reverting the commit — the disabled button returns and the new route 404s, which is exactly the state B1 shipped and verified in production.

Order of work: contract and pure functions first (D2, D3), then the composed read (D5), then the route and steps, then the profile page's gate (D10). The gate lands last so that `/b/{slug}` never links to a route that is not yet complete.

Verification against the live database is required, following B1 and PC3 — both found defects no unit test caught. Two cases are non-negotiable: a shop with two branches where a service is bookable at only one, and a price ending in `.50`.

## Open Questions

- **Does `app/b/[slug]/error.tsx` actually cover the nested segment?** Expected to, by Next's upward resolution — the same assumption B1 checked rather than trusted for `not-found.tsx`, and got wrong the first time. To be verified at runtime, not reasoned about.
- **Where does the branch step's address belong** — on the card, or only in the summary after selection? An address is what disambiguates two branches with similar names, and it is also the longest string on the step.
- **Should the service step show duration alongside price?** It is already in the projection for B3. Showing it is useful; showing it before the client has picked a barber may imply a precision the availability step has not yet earned.
