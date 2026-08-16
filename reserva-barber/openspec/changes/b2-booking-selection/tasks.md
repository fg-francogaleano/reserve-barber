## 1. Owner resolution — the second unscoped read

> Goes first and alone, test-first. It is the one change here that weakens a contract the
> whole project leans on, and it should be reviewable before anything else exists to
> distract from it (design D3).

- [x] 1.1 Write failing tests in `PrismaBusinessProfileRepository.test.ts`: `findOwnerIdByPublicSlug` returns the owner id for a stored slug, `null` for an unknown one, and issues an explicit `select` rather than a row read
- [x] 1.2 Add `findOwnerIdByPublicSlug` to `IBusinessProfileRepository` and rewrite the contract's doc comment — it currently names **one** deliberate exception; it must now name two, each with its own reason, so the count is never mistaken for a contract that stopped holding
- [x] 1.3 Implement it with `select: { ownerId: true }`
- [x] 1.4 Add a regression test asserting `PublicBusinessProfile` still carries no `ownerId`, no row id and no timestamps — B1's structural guarantee, now that a nearby method returns the value it excludes

## 2. The bookability predicate and the composed read

- [x] 2.1 Define the public projections in `src/server/domain/models/BookingCatalog.ts`: `PublicLocation` (id, name, address), `PublicService` (id, name, description, price as canonical decimal string, `durationMinutes`), `PublicBarber` (id, `displayName`, bio, `avatarUrl`) — and no `isActive`, no `ownerId`, no timestamps
- [x] 2.2 Define `IPublicCatalogRepository` with an owner-scoped composed read; the owner parameter is required, so an unscoped catalogue query is inexpressible through the contract
- [x] 2.3 Write failing tests for the four-term predicate over `(service, location)`, each term failing in isolation: inactive service, inactive location, no `BarberService` row, all assigned barbers inactive — plus the asymmetric case, a service bookable at one branch and dead at another
- [x] 2.4 Implement `PrismaPublicCatalogRepository` as **one** round trip with an explicit `select`, asserting in test that excluded columns never appear in the result
- [x] 2.5 Verify price values survive as canonical two-decimal strings through the shared helper — cover a `.50` price explicitly (design D12)

## 3. The selection contract as a pure function

- [x] 3.1 Write failing tests for `bookingSelectionParams.ts` covering: length bound applied before any use; an id belonging to another owner; an unknown id; an inconsistent triple (barber not at the given location, service not bookable there); a repeated/array-valued parameter; and the fallback step each case produces
- [x] 3.2 Add a test asserting a cross-owner id and an unknown id produce **identical** output — same step, same discarded set (design D7)
- [x] 3.3 Add a test that changing an upstream selection discards every downstream one
- [x] 3.4 Implement `src/server/application/booking/bookingSelectionParams.ts` returning `{ step, selection, discarded[] }`, with no I/O — following `publicSlugLookup.ts`

## 4. Application service

- [x] 4.1 Write failing tests for `PublicBookingCatalogService`: slug resolves to owner then catalogue; unknown slug short-circuits with no catalogue query; a shop with no catalogue returns the empty result rather than throwing; the owner id never appears in the returned value
- [x] 4.2 Implement `src/server/application/services/PublicBookingCatalogService.ts`, reusing the existing slug resolution rather than writing a second normalizer
- [x] 4.3 Log a well-formed id that fails owner scoping at `info`, sanitized and truncated by the same treatment `PublicProfileService.forLog` applies
- [x] 4.4 `app/b/[slug]/reservar/bookingCatalogService.ts` — synchronous composition root, carrying the guard comment naming what must stay absent: no Supabase client, no cipher, no `PaymentConfig` repository

## 5. Copy

- [x] 5.1 Add a `booking` key to `src/lib/copy.ts` in es-AR, a **sibling** of `publicProfile` rather than nested inside it: step headings, the back control, the selection summary, and the pending state
- [x] 5.2 Write the four empty states as distinct strings — nothing bookable anywhere, no service at this branch, no barber for this service here, and a shop with no catalogue — none disclosing whether something was deactivated, never created, or unassigned
- [x] 5.3 Write the stale-selection notice: the previous choice is unavailable, without saying why

## 6. The route

- [x] 6.1 `app/b/[slug]/reservar/page.tsx` as a Server Component with `export const dynamic = 'force-dynamic'`, resolving the slug **before** parsing any parameter
- [x] 6.2 Issue the 308 for a non-canonical slug **preserving the query string unchanged**, and `notFound()` otherwise (design D9)
- [x] 6.3 Confirm no `loading.tsx` exists under the route and add the regression test that asserts it stays absent, mirroring the one B1 added after its runtime reversal (design D8)
- [x] 6.4 Declare the bare `/b/{slug}/reservar` as canonical on parameterized variants (design D14)
- [x] 6.5 Route tests: unknown slug → 404 with no catalogue query; hostile slug → 404 with no driver error; non-canonical spelling mid-selection → 308 with every parameter intact

## 7. The steps

- [x] 7.1 `src/components/booking/BookingStepIndicator.tsx` — current step exposed to assistive technology, not indicated by styling alone
- [x] 7.2 `src/components/booking/BookingSelectionSummary.tsx` — persistent, showing what is already chosen, with each entry changeable
- [x] 7.3 `src/components/booking/LocationStep.tsx` — only locations with at least one bookable pair; skipped entirely when exactly one is offerable, with the branch named in the summary and still changeable (design D13)
- [x] 7.4 `src/components/booking/ServiceStep.tsx` — services bookable at the selected branch, prices formatted es-AR through the shared helper
- [x] 7.5 `src/components/booking/BarberStep.tsx` — barbers active at that location performing that service; avatar via plain `<img>` with reserved space and an initials fallback, no `next/image`
- [x] 7.6 Navigation between steps by `<Link>` only; no `useSearchParams` in a Client Component above the resolution (design D8)
- [x] 7.7 Explicit back control on every step, and per-option pending state so a tap on a slow connection is not read as nothing happening
- [x] 7.8 Component tests for every step including its empty state, and for the stale-selection notice

## 8. The profile page gate

> Last, so `/b/{slug}` never links to a route that is not yet complete (design D10).

- [x] 8.1 Extend `app/b/[slug]/publicProfileService.ts` to compose the catalogue repository, answering the gate inside the profile page's existing request
- [x] 8.2 Replace the disabled button in `app/b/[slug]/page.tsx` with a `<Link>` when at least one pair is bookable; otherwise keep B1's disabled-and-disclosed treatment verbatim
- [x] 8.3 Update `app/b/[slug]/page.test.tsx`: the live call to action, its gated absence, and an assertion that no `PaymentConfig` read occurs on either path

## 9. Accessibility and content bounds

- [x] 9.1 Full keyboard traversal of every step with a visible focus indicator; selected state not conveyed by colour alone — every option is a native `<a>`, `aria-current="step"` confirmed in the live HTML, `focus-visible:ring-2` present on every control. **WCAG AA contrast was NOT measured** — no colour was introduced by this change, all tokens are inherited
- [x] 9.2 Verify no horizontal overflow at 360 px with 120-character location, service and barber names, a 500-character barber bio and a 500-character service description (T18) — **measured on `workerd`** with the maxima written to the live database: `scrollWidth` 345–360 against a 360 px viewport at all four steps, with the 120/500-character content confirmed rendered at full length
- [ ] 9.3 Verify the service step holds at the per-owner cap of fifty services — **not verified.** Would need 50 service rows in the live database; the width risk is covered by 9.2 and the scan-time problem is recorded as T48
- [x] 9.4 Confirm at runtime that `app/b/[slug]/error.tsx` actually covers the nested segment — the assumption is expected to hold, and B1 got the equivalent one wrong for `not-found.tsx` (design, Open Questions) — **confirmed by forcing a real failure** (`DATABASE_URL` pointed at an unreachable host): `/b/{slug}/reservar` returned 500 and rendered the public boundary's copy, with no stack trace, connection string or driver text in the response

## 10. Documentation

- [x] 10.1 `docs/data-model.md` §6 — the availability rule's unit becomes the `(service, location)` pair; remove the clause deferring it to "the story that defines the public service/barber selection"
- [x] 10.2 `docs/tech-debt.md` **T23** — record the modelling half as closed for the public flow, and restate what remains as the dashboard's per-service marker with a trigger that no longer points at a shipped story
- [x] 10.3 `docs/tech-debt.md` **T47** — extend to `/b/[slug]/reservar` and re-cost it honestly: a heavier query plus an `L × S` parameter space a crawler can sweep, on a pool shared with the dashboard
- [x] 10.4 Open a new entry for the unbounded service step — fifty entries at 360 px with no grouping or search — with a trigger keyed on a real catalogue reaching that size
- [x] 10.5 `docs/roadmap.md` — tick B2, and correct its own entry's "or a deposit policy" clause, which names a gate this story does not own

## 11. Verification

- [x] 11.1 `npm run lint`, `tsc --noEmit`, full Vitest suite green, coverage gate met on domain and application layers
- [x] 11.2 Drive the real application against the live database (`/verify`), following B1 and PC3 — driven on `workerd` via `opennextjs-cloudflare build` + `wrangler dev` against the live Supabase instance
- [x] 11.3 Non-negotiable runtime cases, all four observed:
  - **Two branches, service bookable at only one** — the live catalogue already provided it: 4 active locations, only **Merlo** and **Sucursal Centro** offered. **Sucursal Norte** has two *active* barbers and zero assignments, **Moreno** has none; both correctly absent. A per-service answer would have offered them.
  - **A price ending in `.50`** — service price temporarily set to `2000.50`, rendered `$2.000,50`; neither `$2.000,05` nor `$20.005`. Price restored.
  - **A stale link** — `?local={Sucursal Norte}` (a real, active, unbookable branch) falls back to the branch step with the Spanish notice, not a 404; a real barber with no assignment falls back to the barber step keeping branch and service.
  - **A shop with no catalogue** — all four locations temporarily deactivated: `/reservar` returned **200** with the designed empty state, and `/b/{slug}` reverted to the disabled control with **no link to `/reservar`**. Locations restored.
  - Also confirmed: **`owner-root` appears zero times** in both responses (design D3/D10), a cross-owner-shaped id and an unknown id produce **byte-identical rendered `<main>`** (1763 bytes each), and a parameterized URL declares the bare path as canonical.
- [x] 11.6 Disable router prefetch across the public flow via a single `StepLink` component, after the preview showed it issuing one extra catalogue query per rendered link; re-measured at one request per step (design D15)
- [x] 11.4 Confirm the HTTP statuses on the deployed build — on `workerd`: unknown slug → **404**; `/b/BARBERIA-DON-JUAN-CENTRO/reservar?local=…&servicio=…` → **308** with `Location` carrying the query string unchanged; canonical → 200. Null-byte and malformed-percent slugs → 404 with no driver error
- [ ] 11.5 Deploy and verify in production, following B1's precedent — **not done**, awaiting review of the diff
