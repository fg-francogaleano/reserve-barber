## 1. Route guard — the public namespace

> The most dangerous change in this story. It goes first, alone, test-first, so it can be
> reviewed on its own before anything else exists to distract from it.

- [x] 1.1 Add failing tests to `routeGuard.test.ts`: `/b/{slug}` and `/b` are permitted without a session; **`/barberos`, `/barberos/{id}/horarios`, `/barberos/{id}/ausencias` and `/barberos/{id}/servicios` still redirect to `/login` with their `next` parameter**; an authenticated owner on `/b/{slug}` is not redirected to the dashboard; Server Actions still short-circuit first
- [x] 1.2 Implement the exception in `decideGuardAction` as an exact-segment test — `pathname === '/b' || pathname.startsWith('/b/')` — and update the function's doc comment to name the two permitted entries and why the bare `startsWith('/b')` form is forbidden
- [x] 1.3 Confirm the `middleware.ts` matcher reaches `/b/**` and that its static-asset exclusions do not shadow the namespace

## 2. Domain and repository — the read that carries no owner

- [x] 2.1 Define the public projection type (business name, bio, `photoUrl`, `coverUrl`, `publicSlug`, ordered links) alongside the `BusinessProfile` model
- [x] 2.2 Add `findByPublicSlug` to `IBusinessProfileRepository`, and rewrite the contract's doc comment: it currently asserts an unscoped query is inexpressible — it must now name this method as the one deliberate exception, with its reason
- [x] 2.3 Write failing tests in `PrismaBusinessProfileRepository.test.ts`: slug hit, slug miss returns `null`, links ordered by `orderIndex` in one query, and the projection excludes `ownerId`, `id` and timestamps
- [x] 2.4 Implement `findByPublicSlug` with an explicit `select`, never a whole-row read

## 3. Application — resolution and canonicalization

- [x] 3.1 Write failing unit tests for the slug resolution decision as a pure function: exact match → render; a value normalizing to a stored slug → redirect to canonical; no match → not found; and a bounds guard that rejects an overlong, null-byte or traversal parameter **before** any query
- [x] 3.2 Implement `PublicProfileService` in `src/server/application/businessProfile/`, reusing the existing `slugify` — do not write a second normalizer
- [x] 3.3 Log a resolution miss at `info` with the requested value truncated to 60 characters and sanitized

## 4. Copy and layout shells

- [x] 4.1 Add the `publicProfile` key to `src/lib/copy.ts` in es-AR — page states, the disabled booking control, not-found and error copy — sharing no string with `businessProfile`
- [x] 4.2 Fix `app/layout.tsx`: `lang="es-AR"`, and replace the `create-next-app` title and description with real product metadata
- [x] 4.3 Add `app/b/layout.tsx` — the client-facing shell, with no dashboard navigation and no route into `/login`

## 5. The page and its states

- [x] 5.1 `app/b/[slug]/page.tsx` as a Server Component with `export const dynamic = 'force-dynamic'`, rendering through `PublicProfileService`, issuing a 308 for a non-canonical slug and calling `notFound()` otherwise
- [x] 5.2 `src/components/booking/ProfileHeader.tsx` — cover and profile image via plain `<img>` with explicit dimensions and lazy loading, a designed fallback band for a missing cover, and an initials placeholder for a missing image
- [x] 5.3 `src/components/booking/SocialLinkList.tsx` — re-check each URL's protocol against the `http:`/`https:` allowlist at render time, `target="_blank"` with `rel="noopener noreferrer"`, and omit the whole section when the set is empty
- [x] 5.4 Render the bio only when present — no placeholder copy for a bio the owner did not write
- [x] 5.5 Render the primary "Reservar" control as visibly deliberate and non-actionable, with copy stating booking is not available yet, and **no link to `/b/{slug}/reservar`**
- [x] 5.6 ~~`app/b/[slug]/loading.tsx` — a skeleton~~ **Reversed by runtime verification (design D19).** The skeleton's Suspense boundary commits `200 OK` before the page resolves, degrading the 404 to a soft 404 and the 308 to a meta refresh. Skeleton removed; a regression test asserts the file stays absent
- [x] 5.7 `app/b/[slug]/not-found.tsx` — 404 in es-AR, `noindex`, no dashboard chrome, no onward route, and copy that does not disclose whether the slug ever existed
- [x] 5.8 `app/b/[slug]/error.tsx` — client-toned Spanish error state with a retry, distinct from `app/error.tsx`
- [x] 5.9 Component tests covering every state above, including a profile carrying only a business name

## 6. Metadata

- [x] 6.1 `generateMetadata` using `resolveOrigin({ configured: process.env.APP_ORIGIN })` **only** — do not pass `host` or `forwardedProto` on this route
- [x] 6.2 When no origin resolves, omit `metadataBase`, the canonical URL and all OpenGraph tags, and still render the page
- [x] 6.3 Title from the business name; description from the bio truncated at a word boundary; OpenGraph image from `coverUrl ?? photoUrl`; canonical `/b/{slug}`; indexable
- [x] 6.4 Confirm metadata generation for an unresolvable slug returns generic values rather than throwing
- [x] 6.5 Tests: no `Host`-derived value can appear in any emitted metadata

## 7. Retire P1's unpublished disclosure

- [x] 7.1 Remove the "not yet reachable" copy from `src/lib/copy.ts` and from `ShareableLink.tsx` / `ProfileForm.tsx`, keeping the slug-change warning and every clipboard behaviour untouched
- [x] 7.2 Update `app/(dashboard)/perfil/` tests that assert on the removed copy

## 7b. Defects found by runtime verification

> Neither was reachable by reasoning or by unit tests: both are introduced by the
> HTTP layer and only appear on `opennextjs-cloudflare preview`.

- [x] 7b.1 **Percent-encoded route parameter** (design D20). `/b/Barbería-…` arrived as `Barber%C3%ADa-…` and normalized to a slug nobody holds, so accented business names 404'd instead of redirecting. Decode before `slugify`; length bound before decoding, content checks after; malformed sequences resolve to not-found rather than raising
- [x] 7b.2 **Loading boundary destroyed the HTTP statuses** (design D19). Removed `loading.tsx`; added a regression test asserting it stays absent
- [x] 7b.3 Falsified the `generateMetadata` workaround by building and measuring it — recorded as a closed avenue in design D19 so it is not re-attempted

- [x] 7b.4 **The cover band buried the top half of the avatar** — reported by the owner, invisible to every automated check. The band carried a `relative` that positioned nothing, and a positioned element paints above static siblings regardless of DOM order, so the 48px the avatar is pulled up by `-mt-12` rendered *behind* it. Removed the ownerless `relative` and gave the avatar row `relative z-10`, which states the intent rather than relying on the absence of a class. Regression test added.
  - Worth naming: the component tests asserted the *classes* (`break-words`, dimensions) and passed the whole time. Class assertions cannot see stacking or layout — this defect and the 120-character overflow were both found by looking at the rendered page, not by the suite.

## 8. Responsive and content-bounds pass

- [x] 8.1 Verify at a 360-pixel viewport with a 120-character business name and a 1000-character bio: text wraps, no horizontal overflow, "Reservar" reachable — the failure T18 already recorded once
- [x] 8.2 Verify no layout shift as images resolve, and with images blocked entirely

## 9. Documentation — the artifacts this change falsifies

- [x] 9.1 `docs/tech-debt.md` T33 — replace "the cost is currently zero: B1 has not shipped"; the exposure begins now, and D13's indexing decision adds a search-result tail
- [x] 9.2 `docs/tech-debt.md` T17 — correct the trigger: B1, not B4–B6, is the story that makes an unauthenticated database read publicly addressable, and the recorded reasoning ("the dashboard routes are not publicly linked") no longer holds
- [x] 9.3 `docs/tech-debt.md` — new entry for the absent cache and absent rate limit on `/b/[slug]`, triggered by measured traffic or the first widely shared link
- [x] 9.4 `docs/roadmap.md` — tick B1, record what it carried, and correct P1's sub-bullet stating the link redirects to `/login`
- [x] 9.5 Record for B2: the bookability gate is B2's, and the public route must keep away from `PaymentConfig`

## 10. Verification on the deployment runtime

> `opennextjs-cloudflare preview`, never `next dev` — the rule `image-storage` set for the
> upload path, for the reason S0 established.

- [x] 10.1 `npm run typecheck`, `npm run lint` and `npm test` all green
- [x] 10.2 Under `npm run preview`: a real slug renders with both images; an unknown slug returns a real 404; a non-canonical spelling 308s to the canonical URL; `/b` alone 404s
- [x] 10.3 Under `npm run preview`: `/barberos` still redirects to `/login` without a session — verified in the browser as well as in the test
- [x] 10.6 **Also verified under `npm run dev`**, which the spec did not ask for and should have: `next dev` is where the feature is developed day to day, and a route that only works under `preview` is a broken route. All eight paths behave identically in both runtimes (200 / 308 / 404 / 307), confirmed in a real browser as well as with `curl`.
- [x] 10.6b **Turbopack cache corruption on a route tree that changed underneath a running dev server.** Symptom: `Jest worker encountered 2 child process exceptions, exceeding retry limit` plus a blank page on `/b/**`, while the dashboard renders fine; the dev overlay marks the build `(stale)`; the server log fills with `write EPIPE`. Two things this cost, both worth recording:
  - **`curl` does not reproduce it** — the HTML request returns 200 while the browser fails. Diagnosing it requires a real browser, which is why the first pass missed it entirely.
  - **Restarting the dev server is NOT enough.** The corruption lives in `.next`, which survives a restart. `rm -rf .next` is the fix; after it, every path renders correctly in the browser.
- [x] 10.7 Configure `APP_ORIGIN` in all three environments: `wrangler.jsonc` `vars` for production (versioned, not a secret, so a fresh clone cannot deploy without it), `.env` for `next dev` (:3000), `.dev.vars` for the preview (:8787), and documented in `.env.example`. Verified: canonical and every `og:` tag now emitted, previously absent
- [x] 10.4 **Confirmed by the owner in a real WhatsApp message (2026-08-15).** The card renders. Deployed as version `51c956ba`; every path was verified against the production origin (`200` / `308` to canonical / `404` / `307`) and all seven link-preview tags emitted with the production URL. This is the check that closes the loop the whole story was built around: the link a client actually receives, on the channel it actually travels through
- [x] 10.5 Verified at a 360px viewport in a real browser: no horizontal overflow with a 120-character name and a 1000-character bio (`scrollWidth` 345 of 360), both images loaded, and **zero layout shift with images broken** (`h1Shift: 0`, `btnShift: 0`) — the throttled-connection worst case. The loading-state half of this task no longer applies: the skeleton was removed (design D19)
