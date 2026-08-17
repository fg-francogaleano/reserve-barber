## Why

B1 shipped a public profile whose primary control is disabled. "Reservar" discloses, in Spanish, that booking is not available yet — the same admission P1 had to make one story earlier about a link that did not resolve. B2 makes the control real.

It is also the story that answers a question B1 deliberately left open: **what a client meets when there is nothing to book.** B1 renders "Reservar" for every published profile regardless of whether the owner has a location, a barber or an assigned service, because deciding that required reading a catalogue B1 had no business reading. That gate is this change's.

And it is the **first route in the project whose inputs are entirely stranger-supplied**. B1 took one hostile value, the slug in the path. B2 takes three more — location, service and barber ids in the query string — and every one of them is a key into owner-scoped data on a route with no session, no cache and no rate limit.

## What Changes

- A public, server-rendered three-step selection at `/b/[slug]/reservar`: **branch → service → barber**, each step narrowing the next, with the selection carried in the query string so back, forward and a shared link all work.
- **Every list is filtered by real bookability, never by existence.** A branch offering nothing bookable is not offered; a service nobody performs at the selected branch is not offered; a barber who does not work at that branch or does not perform that service is not offered.
- **The unit of bookability becomes the `(service, location)` pair.** `docs/tech-debt.md` T23 records that the honest unit is the pair rather than the service, deferred because "B2 has not defined how it presents services per branch". This change defines it, which is what T23 has been waiting for.
- **The catalogue gate and the payment gate are separated, and B2 owns only the first.** The roadmap entry for this story lists "no deposit policy" alongside the catalogue conditions; that conflates two independent gates and is corrected here. B2 answers *is there anything to book*; B4 answers *can a deposit be charged*. The public route continues to construct no Supabase client, no cipher and no `PaymentConfig` repository.
- A second **not-owner-scoped** repository read. `findOwnerIdByPublicSlug` joins `findByPublicSlug` as a documented exception, because B1's public projection deliberately excludes `ownerId` and the catalogue reads need it. The owner id is resolved inside the application layer and never crosses back out.
- **Canonical slug redirection extends to the nested route.** B1's 308 covers `/b/{slug}` only; `/b/{SLUG}/reservar` currently answers at any spelling. The redirect must preserve the query string.
- `/b/[slug]` stops rendering an inert button. It renders a link — **conditional on the catalogue gate**, so a shop with nothing bookable presents no operable call to action rather than a route into an empty wizard.
- No mutation, therefore no Route Handler and no Server Action. `backend-standards.md`'s rule that the public flow must mutate through Route Handlers first binds at B4.

## Capabilities

### New Capabilities
- `booking-selection`: the unauthenticated `/b/[slug]/reservar` route — the bookability predicate over `(service, location)`, the query-string selection contract and its hostile-input validation, owner resolution without leaking the owner id, every empty and recovery state, and the step-by-step presentation.

### Modified Capabilities
- `public-profile-page`: two requirements change. "The booking call to action is present, primary and deliberately inert" is **retired** — its stated reason, that `/b/{slug}/reservar` does not exist until B2, expires with this change, and the control becomes conditional on the catalogue gate. "Slug matching is canonical, and other spellings redirect to the canonical URL" **extends** to paths below the slug segment, with the query string preserved.
- `service-catalog`: the bookability requirement carries a paragraph stating that the `(service, location)` question "remains open and this requirement does not settle it", naming B2 as its trigger. B2 settles the shape, so the paragraph becomes false as written and is replaced by what actually remains — the dashboard still reporting one global fact per service.

## Impact

**New code**
- `app/b/[slug]/reservar/page.tsx` — the route. `force-dynamic`, and deliberately **no `loading.tsx`**.
- `app/b/[slug]/reservar/bookingCatalogService.ts` — composition root, synchronous, carrying the same guard comment as `publicProfileService.ts` about what must stay absent.
- `src/server/application/services/PublicBookingCatalogService.ts` — slug → owner → catalogue, applying the bookability predicate.
- `src/server/application/booking/bookingSelectionParams.ts` — the selection contract as a pure function, following `publicSlugLookup.ts`: bound, validate, and decide which step to fall back to when a stale id no longer resolves.
- `src/server/domain/models/BookingCatalog.ts` — public projections for location, service and barber.
- `src/server/domain/repositories/IPublicCatalogRepository.ts` + `src/server/infrastructure/prisma/PrismaPublicCatalogRepository.ts` — one composed, owner-scoped read with an explicit `select`.
- `src/components/booking/` — the step components, joining `ProfileHeader` and `SocialLinkList`.

**Modified code**
- `src/server/domain/repositories/IBusinessProfileRepository.ts` — `findOwnerIdByPublicSlug`, documented as the second deliberate exception with its reason, next to the first.
- `src/server/infrastructure/prisma/PrismaBusinessProfileRepository.ts` — its implementation, `select: { ownerId: true }`.
- `app/b/[slug]/page.tsx` (+ test) — the call to action becomes a real link, gated.
- `app/b/[slug]/publicProfileService.ts` — composes the catalogue repository so the profile page can answer the gate in the same request.
- `src/lib/copy.ts` — a new `booking` key, sibling to `publicProfile`. Not nested inside it: B1's rule is one key per public surface.

**No change**
- No migration, no new environment variable, no new dependency.
- **No `PaymentConfig` read, no Supabase client, no cipher.** The absence is the requirement, not an omission.
- No cache and no rate limit — inherited from T47, and re-costed rather than assumed, because this route is heavier and has a parameter space to sweep.
- No `next/image`: barber avatars render through a plain `<img>` with reserved space, following B1.
- No client-side wizard framework. The steps are server-rendered and navigate by `<Link>`, so the flow works before hydration and every step is shareable.

**Documentation corrected in this change**
- `docs/data-model.md` §6 — the availability rule's "deliberately deferred to the story that defines the public service/barber selection" clause expires; the unit is now the pair.
- `docs/tech-debt.md` **T23** — the modelling half closes for the public flow; what remains is the dashboard's per-service marker, recorded with a narrowed trigger rather than left pointing at a story that already shipped.
- `docs/tech-debt.md` **T47** — extended to `/b/[slug]/reservar`, whose exposure is larger than the profile page's.
- `docs/roadmap.md` — B2 ticked, and the "or a deposit policy" clause in its own entry corrected, since it names a gate this story does not own.

**New debt expected**
- Parameterized wizard URLs are near-duplicates of a page B1 made deliberately indexable; whichever of canonical-or-`noindex` is chosen, the reasoning is recorded.
- A step-2 list bounded only by `MAX_SERVICES_PER_OWNER` (50) has no scan-time answer on a phone.
