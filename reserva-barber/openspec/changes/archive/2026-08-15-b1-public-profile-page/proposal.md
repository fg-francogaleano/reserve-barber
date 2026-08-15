## Why

P1 gave the owner a shareable link and had to disclose, in the editor itself, that it does not resolve: `/b/{slug}` currently redirects to `/login`, so an owner who shares it today sends clients to a login page. B1 makes that link real.

This is the **first route in the project served to an unauthenticated human**, and the first database read reachable without a session. Every decision below follows from that single fact — the route guard has been deny-by-default since A1, and this change is its first exception.

## What Changes

- A public, server-rendered profile page at `/b/[slug]`, resolved by `publicSlug` with no session in the request: cover, profile image, business name, bio, social links, and a primary **"Reservar"** call to action.
- **BREAKING (security-relevant)**: the route guard admits a public namespace for the first time. `/b/**` no longer redirects to `/login`. The exception is an exact-segment prefix test — `pathname === '/b' || pathname.startsWith('/b/')` — because `startsWith('/b')` would silently expose `/barberos` and every route under it.
- A new repository read that is **not owner-scoped**. `IBusinessProfileRepository` currently documents that "an unscoped profile query is inexpressible through this contract"; B1 breaks that invariant deliberately, because on the public page the slug *is* the key, and the contract records the exception rather than hiding it. The read returns a narrow public projection, never the whole row.
- Canonical URL handling: an exact slug match renders; a value that normalizes to a stored slug responds **308** to the canonical URL; anything else is a real **404** with a Spanish public not-found page.
- Link-preview metadata (`generateMetadata`, OpenGraph), because this URL's primary distribution channel is WhatsApp and Instagram. The origin comes from `APP_ORIGIN`; when it is absent the page still renders and absolute metadata is **omitted**, never derived from the `Host` header.
- The root layout stops declaring `lang="en"` and stops carrying the `create-next-app` title — B1 is the first page a paying client sees.
- **"Reservar" ships disabled**, disclosed as not yet available, mirroring exactly how P1 disclosed the unpublished link. B2 builds `/b/{slug}/reservar`.
- Retires P1's "not yet published" disclosure from `/perfil`, which this change makes false.

## Capabilities

### New Capabilities
- `public-profile-page`: the unauthenticated `/b/[slug]` route — slug resolution and canonicalization, the not-owner-scoped public read and its projection, every empty and error state, link-preview metadata, and the deliberately inert booking call to action.

### Modified Capabilities
- `owner-authentication`: the "Dashboard is guarded at three layers" requirement gains a public namespace. The guard stops being "everything except `/login`" and must now state that opening `/b/**` leaves every dashboard route protected, asserted by test rather than observed in a browser.
- `business-profile`: the requirement "The shareable link is displayed and disclosed as not yet published" is retired. Its stated justification — `/b/**` is denied to anonymous visitors until B1 opens it — expires with this change.

## Impact

**New code**
- `app/b/[slug]/{page,not-found,loading,error}.tsx` — the public route and its four states.
- `app/b/layout.tsx` — the client-facing shell, without dashboard navigation.
- `src/components/booking/` — first use of the directory `frontend-standards.md` reserves for the public flow.
- `src/server/application/businessProfile/PublicProfileService.ts` — resolve-or-null plus the canonicalization decision as a pure function.

**Modified code**
- `src/server/application/auth/routeGuard.ts` (+ tests) — the public-namespace exception.
- `src/server/domain/repositories/IBusinessProfileRepository.ts` — `findByPublicSlug`, and the contract comment that currently asserts the opposite.
- `src/server/infrastructure/prisma/PrismaBusinessProfileRepository.ts` — narrow `select`, links ordered by `orderIndex` (the existing `@@index([businessProfileId, orderIndex])` backs it).
- `app/layout.tsx` — `lang="es-AR"`, real metadata.
- `src/lib/copy.ts` — new `publicProfile` key, sibling to `businessProfile`; the two audiences do not share strings.
- `app/(dashboard)/perfil/` — remove the unpublished-link disclosure.

**No change**
- No migration. No new environment variable (`APP_ORIGIN` already exists and is already read at `app/(dashboard)/perfil/page.tsx:37`).
- No `next.config.ts` image configuration: images render through a plain `<img>` with explicit dimensions, following `ProfileForm.tsx:561` and relying on the client-side downscale P1 already built. Cloudflare Images is not introduced.
- **The public page never reads `PaymentConfig`.** That row holds the encrypted Mercado Pago access token; a page anonymous visitors open has no reason to touch it. The bookability gate therefore belongs to B2, recorded so B2 does not assume B1 handled it.
- No caching layer. The page is `force-dynamic` like every other page in the project; introducing this stack's first ISR over `workerd` for traffic that does not exist yet is the class of risk S0 was built to avoid.

**Documentation that becomes false on deploy and is corrected in this change**
- `docs/tech-debt.md` **T33** — "the cost is currently zero: B1 has not shipped" stops being true; the exposure begins here.
- `docs/tech-debt.md` **T17** — its trigger names B4–B6, but B1 is the story that makes an unauthenticated database read publicly addressable. The recorded reasoning ("the dashboard routes are not publicly linked") expires now.
- `docs/roadmap.md` — B1 ticked, and P1's sub-bullet about the link redirecting to `/login` corrected.

**New debt expected**
- The absence of a cache and of rate limiting on the first public database read, with a trigger keyed on measured traffic or the first widely shared link.
