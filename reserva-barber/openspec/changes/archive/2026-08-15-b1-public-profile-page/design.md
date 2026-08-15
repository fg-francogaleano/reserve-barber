## Context

Since A1 this application has had exactly one audience: an authenticated owner. `decideGuardAction` is deny-by-default — every path except `/login` redirects without a session — and every repository contract takes an `ownerId`, so an unscoped query is inexpressible through them. Both properties were deliberate, and B1 is the story that has to break both.

P1 shipped the `BusinessProfile` singleton, the slug, the images, and a shareable link the editor had to disclose as dead: `/b/{slug}` redirects to `/login`. Everything a client needs to see already exists in the database. What does not exist is any route that will show it to someone without a session.

The constraints that shape this design:

- **Cloudflare `workerd` under OpenNext.** `docs/s0-versions-decision.md` and the `image-storage` spec both record this stack diverging from Node in ways that were only visible on the real runtime. Nothing new that touches the runtime gets adopted on reasoning alone.
- **Every page in the project is `force-dynamic`.** No caching infrastructure exists.
- **`APP_ORIGIN` already exists** and is read at `app/(dashboard)/perfil/page.tsx:37`. `resolveOrigin` falls back to the `Host` header when it is absent.
- **P1 already solved the image payload problem in the browser** — downscale and re-encode before upload — so what reaches the bucket is already small.
- **`PaymentConfig` holds the encrypted Mercado Pago access token.** PC3 established that a surface with no need for a cipher must not construct one.

Eighteen decisions were put to the owner before any code was written; all eighteen were accepted as recommended. They are recorded below with the alternatives they were chosen over.

## Goals / Non-Goals

**Goals:**
- A public profile page at `/b/[slug]` that renders for a visitor with no session.
- Open exactly one public namespace in the route guard, and prove by test that nothing else opened with it.
- One canonical URL per shop.
- Ship without new infrastructure: no cache layer, no image service, no new environment variable, no migration.
- Leave every document that this change falsifies corrected in the same change.

**Non-Goals:**
- Any booking step. Location, service, barber, date and slot pickers are B2 and B3.
- Listing locations, barbers, services or prices on the profile.
- Slug aliases or redirects from a previous slug (T33, accepted).
- Rate limiting the new public route (T17, deferred with a corrected trigger).
- Any bookability gate. B2 owns it.
- Any write. This change ships no Server Action and no Route Handler.

## Decisions

### D1 — Images render through a plain `<img>`, not `next/image`

`next.config.ts` carries no `images.remotePatterns`, so `next/image` against a Supabase URL fails outright, and OpenNext on `workerd` does not run the framework's sharp-based optimizer. The component path is unconfigured *and* unproven on this runtime.

What makes optimization unnecessary is that P1 solved the payload problem at the other end: the browser downscales and re-encodes before upload, so objects in the bucket are already around 500 KB. `ProfileForm.tsx:561` is the existing precedent for a plain `<img>` in this codebase.

*Considered:* `next/image` with `unoptimized: true` plus remote patterns — ceremony around the same bytes, plus a config to verify on the deployment runtime. Cloudflare Images — the only path that genuinely reduces bytes, but it is a platform decision with a cost, smuggled inside a product story. Both rejected; if measurement later shows images hurt on mobile, Cloudflare Images is an isolated change to one component.

**Consequence:** explicit `width`/`height` or an enforced aspect ratio is mandatory, not stylistic. Without the intrinsic sizing `next/image` would have provided, an image resolving late shifts the layout under a thumb already reaching for "Reservar".

### D2 — "Reservar" ships disabled and disclosed, and B1 deploys alone

`/b/{slug}/reservar` does not exist. The control is rendered non-actionable with Spanish copy explaining that booking is not available yet.

This is the same problem P1 met one story ago — a surface that exists before the thing it points at — answered the same way. *Considered:* shipping B1 and B2 together, which makes the button real but merges the guard change with M4's bookability gate into one reviewable unit; the guard exception is the most dangerous line in this change and deserves to be reviewed alone. Also considered: letting the button 404, rejected outright.

### D3 — Absolute metadata comes from `APP_ORIGIN` or is omitted; never from `Host`

`resolveOrigin` falls back to the `Host` header. On `/perfil` that was an owner spoofing a header addressed to themselves. Here the header comes from a stranger and feeds `metadataBase`, the canonical URL and the OpenGraph tags — a forged value produces a page advertising an attacker's origin.

The route therefore passes `configured: process.env.APP_ORIGIN` and, when that yields nothing, **omits all absolute metadata** while still rendering the page.

*Considered:* failing the route when `APP_ORIGIN` is missing, which follows PC2's precedent of validating at the composition root so a forgetful deploy breaks one page instead of the dashboard. Rejected because the page it would break is the client-facing one — the only page that earns the business money. Degrading the link preview is visible, diagnosable and survivable; a dead shop page is not. *Also considered:* keeping the `Host` fallback, which leaves the injection open on the one route where the header is untrusted.

`resolveOrigin` itself is not modified — its `Host` fallback stays correct for `/perfil`. The public route simply does not offer it those sources.

### D4 — Exact match, then normalize-and-308, then 404

Slugs are stored canonical (P1 design D10), so an exact match is the common path. A miss is normalized through the same `slugify` used at write time; if the normalized form differs from the request and matches a stored slug, the response is a 308 to `/b/{canonical}`.

This is the URL-level version of what P1 already does in the editor field: show what was persisted, not what was typed. *Considered:* exact-match-only, which 404s a client who typed the shop's name with a capital from an Instagram story — a self-inflicted dead end. *Considered:* serving every variant, which gives one shop N indexable addresses and splits its previews, its analytics and (given D13) its search results.

308 rather than 301 or 302: permanent, and method-preserving, so a future POST to a booking route under a non-canonical prefix would not silently become a GET.

### D5 — `findByPublicSlug` joins the existing contract, and the contract documents the exception

`IBusinessProfileRepository` currently states that "an unscoped profile query is inexpressible through this contract". That sentence has to change, and the change is the interesting part: it becomes a named exception with its reason — on the public page the slug *is* the key, because there is no session to scope by.

*Considered:* a separate `IPublicProfileRepository`, which preserves the old contract's invariant untouched. Rejected because it duplicates the Prisma→domain mapping and leaves two repositories over one table that must be kept in step. This project documents its exceptions rather than routing around them — `PaymentConfig` does it for its three writers, `decideGuardAction` does it for Server Actions. An invariant with one explained exception is worth more than two contracts to synchronize.

### D6 — The public read returns a projection, not the aggregate

An explicit `select` yielding business name, bio, image URLs, slug and ordered links. Not the row, not the domain entity.

`BusinessProfile` happens not to carry `ownerId` today — that is luck, not design. It does carry `id`, and the next field added to it would reach every anonymous visitor with nothing in the type system to object. PC2 established this shape for `PaymentConfig` reads serving the public flow; this is the same reasoning on a less sensitive table, applied before it becomes sensitive.

### D7 — `force-dynamic`, with the absent cache recorded as debt

Every page in the project is `force-dynamic`. In the dashboard that is required by the data; here it is a choice.

*Considered:* `revalidate` of 30–60 seconds, which would absorb a traffic spike from a shared link. Rejected because ISR on OpenNext/Cloudflare needs an incremental cache backed by R2 or KV — this stack's first, adopted for traffic that does not exist yet, on the runtime whose divergences S0 was built to surface early. *Considered:* a slug-keyed cache invalidated from the profile save, which couples the dashboard editor to the public route's cache.

Dynamic rendering also gives the owner what they expect: they save, they reload, they see it.

**This is a bet on low traffic, and the bet is written down.** A tech-debt entry records both the absent cache and the absent rate limit, triggered by measured traffic or the first widely shared link.

### D8 — A dedicated public layout, plus a root-layout fix

`app/b/layout.tsx` carries the client-facing shell with no dashboard navigation. `app/layout.tsx` changes `lang="en"` to `es-AR` and replaces the `create-next-app` title and description.

The `lang` fix is not optional and not scoped to this route: the attribute lives on the root `<html>`, and today a screen reader pronounces this entirely Spanish product with English phonetics. The dedicated layout is where B2 will hang its wizard without revisiting this decision.

### D9 — `/b` with no slug is a 404

*Considered:* redirecting to `/login`, which leaks that there is an administrative panel behind this namespace.

### D10 — The page shows brand only

Name, bio, images, social links, call to action. No locations.

*Considered:* previewing the branches so a client knows there is more than one before entering the flow. Rejected because it creates a second place where locations are listed while the first does not exist yet — B2 would inherit two views to keep in step from its first day.

### D11 — The call to action does not consult bookability, and this page never reads `PaymentConfig`

An owner can have a published profile and no location, no barber, no assigned service, or no deposit policy. The button renders regardless; B2 owns the gate.

The decisive argument is not scope, it is reach: `isBookable()` lives on `PaymentConfig`, the row holding the **encrypted Mercado Pago access token**. PC3 deliberately built its readiness panel without constructing a cipher so that a missing `PAYMENT_CREDENTIALS_KEY` could not take down a page about deposit amounts. A page anonymous visitors open has an even stronger version of that reason: it should have no relationship with that table at all.

Recorded explicitly so B2 does not assume B1 handled it.

### D12 — No rate limiting; T17's trigger is corrected instead

B1 makes an unauthenticated database read publicly addressable for the first time. T17 currently defers rate limiting on the reasoning that "the dashboard routes are not publicly linked", with a trigger naming B4–B6.

That reasoning expires here, so the entry is corrected even though the mitigation is not built. *Considered:* a Cloudflare rate-limiting rule (no code, ~15 minutes, but configuration outside the repository that nobody will remember exists) and a middleware throttle (burns Worker CPU on precisely the request that should be cheap).

**An accepted debt whose written justification is false is worse than an unjustified one**, because the next reader treats the reasoning as still-evaluated. Correcting the entry is the deliverable; the rule is not.

### D13 — The page is indexable

Discovery is what the product is for. The cost is T33's long tail: an indexed result surviving a slug change and pointing at a 404 for weeks. That cost is recorded against T33 rather than paid for by making every shop invisible.

### D14 — T33 stays accepted, its text corrected

The owner chose this knowingly in P1 over freezing the slug and over a slug-history table. Nothing has changed except the date on which it starts costing something. The entry's claim that "the cost is currently zero: B1 has not shipped" is corrected; the editor's change-time warning remains the only mitigation.

*Considered:* building the alias table now, ~3–4 hours — a story of its own smuggled into another.

### D15 — Slug misses are logged at `info` with the truncated, sanitized value

Truncated to the column's 60-character bound and sanitized before writing.

*Considered:* logging only the fact of the miss. Rejected because without the value there is no way to distinguish a client holding a link from before a slug change (T33 happening for real) from someone enumerating slugs — findings that call for opposite responses. The value is stranger-supplied, which is what the truncation and sanitization are for.

### D16 — Social links open in a new tab

`target="_blank"` with `rel="noopener noreferrer"`. On a phone, following a link into the Instagram application and returning to a tab that was replaced is a one-way trip.

### D17 — The public 404 offers no route onward

Message only. *Considered:* a link to `/`, which is the dashboard and would deposit a lost client on a login screen while disclosing that a panel exists.

### D18 — Public copy lives under its own key

A new `publicProfile` key in `src/lib/copy.ts`, sibling to `businessProfile`, sharing no strings with it. Two audiences, two tones; sharing strings means editing a message for the owner and silently changing what a client reads.

### D19 — No loading skeleton, because it costs the HTTP statuses

**Decided during verification, against the original plan.** D8 and the first draft of the spec both called for a `loading.tsx`. Driving the real runtime showed the two are incompatible.

A `loading.tsx` opens a Suspense boundary; Next streams the shell and commits `200 OK` before the page resolves anything. `notFound()` and `permanentRedirect()` then arrive too late to set a status, and degrade to a not-found boundary inside the stream and a `<meta http-equiv="refresh">`. Measured both ways:

| Request | With `loading.tsx` | Without |
| --- | --- | --- |
| unknown slug | `200` (soft 404) | `404` |
| non-canonical spelling | `200` + meta refresh | `308` |

*Considered and falsified:* raising the outcome inside `generateMetadata`, on the theory that it runs before the stream. Built and measured — the statuses stayed at `200`. Recorded so the next person does not spend the same rebuild on it.

The statuses win because they are the page's contract with machines rather than decoration. WhatsApp and Instagram follow HTTP redirects when building a link preview and do not execute a meta refresh, so a link shared in a non-canonical spelling would lose its preview — on a product distributed through WhatsApp. Soft 404s are also what search engines penalize, which matters given D13. What is surrendered is a skeleton over a single fast query.

### D20 — The route parameter is percent-decoded before normalization

**Found by verification, not by reasoning.** `/b/Barbería-Don-Juan-Centro` reaches the application as `Barber%C3%ADa-Don-Juan-Centro`; without decoding, `slugify` produced `barber-c3-ada-don-juan-centro` and the request 404'd instead of redirecting. Every accented business name in the target market was affected, and no unit test would have caught it because the encoding is introduced by the HTTP layer.

Two orderings are load-bearing. The **length** bound runs before decoding — percent-encoding only lengthens a string, so checking first is strictly stricter. The **content** checks (`/`, `..`, `\0`) run after, because `%2F` and `%00` are exactly how those get past a check placed too early.

Canonicality is judged against the value **as it arrived**, not the decoded one, so `/b/barberia%2Ddon%2Djuan` still redirects rather than becoming a second address for one shop. A malformed sequence (`%`, `%zz`) resolves to not-found rather than raising `URIError` on a public page.

## Risks / Trade-offs

**A prefix test that is one character too permissive exposes the entire dashboard** → `pathname === '/b' || pathname.startsWith('/b/')`, never `startsWith('/b')`. The failure has no symptom — the pages simply render — so it is asserted by a test naming `/barberos` specifically, not verified in a browser.

**The unscoped read becomes the template for the next one** → It is the only such method, it is named for what makes it safe (`findByPublicSlug`), and the contract documents why it exists. B2 through B7 will each want their own public read; this one sets the precedent that a public read returns a projection.

**No cache and no rate limit on the first publicly addressable database read** → Accepted (D7, D12), recorded as debt with a trigger. The realistic risk today is zero because nobody has the link; the day the owner posts it to Instagram is the day the trigger fires.

**A slug change strands every shared link, and now also a search result** → T33, accepted by the owner (D14), mitigated by the editor's change-time warning and made observable by the miss log (D15).

**Images are unoptimized and served from a host this Worker does not control** → Bounded by P1's client-side downscale; slots reserve their space so a slow bucket cannot shift the layout; missing objects fall back to their placeholders rather than rendering broken.

**A stale `photoUrl` pointing at a deleted object** → T32 documents best-effort deletion; this is its inverse. Handled as a rendering fallback, not as a data repair.

**The first page whose audience is a client, built by people who have only built dashboards** → Mobile at 360 pixels with content at its column maxima is a spec requirement, not a review note; T18 records this exact overflow already happening once.

## Migration Plan

No database migration. No new environment variable. No new secret.

Deployment order matters in one respect: the guard change and the public route must ship together. Opening `/b/**` before the route exists gives anonymous visitors a 404 from the framework instead of a redirect — harmless but untidy; shipping the route before the guard leaves it unreachable. They are in one change, so one deploy.

Rollback is a revert. Nothing persisted changes shape, so a rollback loses no data and strands no rows — the only consequence is that shared links stop resolving again, exactly as they do today.

**Verification is on `opennextjs-cloudflare preview`, not `next dev`** — the same rule the `image-storage` spec set for the upload path, for the same reason. Specifically: a real slug renders with its images, an unknown slug 404s, and the OpenGraph preview is confirmed by pasting the link into a real WhatsApp message.

## Open Questions

None blocking. All eighteen decisions were settled with the owner before implementation.

Two questions are deliberately handed forward rather than answered here:

- **When does the public route need a cache or a rate limit?** Deferred to measured traffic (D7, D12). Nothing here can answer it without data.
- **What does bookability mean for a shop whose profile is live but whose catalogue is empty?** Handed to B2 with D11 recorded, so B2 decides it with the flow in front of it rather than inheriting a decision made blind.
