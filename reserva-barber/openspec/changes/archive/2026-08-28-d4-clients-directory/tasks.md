## 1. Pure rules — tests first, no I/O

- [x] 1.1 Write failing tests for `src/server/application/dashboard/clientPageParams.test.ts`: absent, malformed, array-valued, over-length, zero, negative, and valid values; a page beyond the last clamping to the last page; a page below the first clamping to the first; and that no input shape throws.
- [x] 1.2 Implement `CLIENTS_PAGE_PARAM`, `CLIENTS_PAGE_SIZE`, `resolveClientPage` and `clientPageHref` in `src/server/application/dashboard/clientPageParams.ts`, following `recentBookingsParams.ts` and `barberCalendarParams.ts` — bound the length, parse, degrade, first occurrence of a repeated parameter (design D6).
- [x] 1.3 Write failing tests asserting the clamp happens **against a total** and produces a `skip` that can never exceed it, so an absurd page never reaches the database as an offset (design D6).

## 2. The read

- [x] 2.1 Define `IClientDirectoryRepository` in `src/server/domain/repositories/IClientDirectoryRepository.ts` with `ClientDirectoryRow` and `listForOwner`, plus the header stating the invariants: owner scope is a single predicate and therefore the tenancy boundary, one round trip for rows and total, counts as one aggregate never per row, and the projection carrying contact details **by design** with the constraints that make that acceptable (design D7, D8).
- [x] 2.2 Write failing tests in `src/server/infrastructure/prisma/PrismaClientDirectoryRepository.test.ts` against a mocked client: the owner predicate is present; ordering is confirmed-count descending then `id` ascending; `skip`/`take` are applied; the confirmed and inactive counts are filtered relation counts rather than separate queries; the projection carries no timestamps, booking ids or monetary values.
- [x] 2.3 Implement `PrismaClientDirectoryRepository` — one round trip returning the page and the total, with per-client counts as a single aggregate (design D4).
- [x] 2.4 Write failing tests for `src/server/application/services/ClientDirectoryService.test.ts`: it resolves the requested page against the total, clamps before computing `skip`, and returns rows plus the resolved page.
- [x] 2.5 Implement `ClientDirectoryService` in `src/server/application/services/ClientDirectoryService.ts`.

## 3. The page

- [x] 3.1 Add `src/components/ui/table.tsx` (shadcn) — markup and classes only, no JavaScript (design D11).
- [x] 3.2 Create `app/(dashboard)/clientes/clientDirectoryService.ts` — the composition root: Prisma client and logger, nothing else.
- [x] 3.3 Add a source-level test asserting the composition root's dependencies — no cipher, no storage client, no Supabase session client, no writer — so the claim cannot drift from the code (the C2/D3 pattern).
- [x] 3.4 Add the `clients` namespace to `src/lib/copy.ts`: heading, column labels, the primary and secondary count labels, the three empty/failure states, the paging controls, and copy for a zero-booking row that does **not** call that person a customer.
- [x] 3.5 Build `app/(dashboard)/clientes/page.tsx`: `requireOwner()` first, `dynamic = 'force-dynamic'`, `robots: { index: false, follow: false }`, the table at `sm` and above, per-client blocks below it, `tel:`/`mailto:` links, and paging links carrying `prefetch={false}` **without restating D3's corrected round-trip claim** (design D10, D11, D12).
- [x] 3.6 Implement the three distinct states — no clients yet (with the route to the public profile), page beyond the last resolving to the last, and the failure card inside the page — never sharing copy and never rendering an empty table on a failed read.
- [x] 3.7 Add `app/(dashboard)/clientes/loading.tsx`, shaped like the table.
- [x] 3.8 Write `app/(dashboard)/clientes/page.test.tsx` covering: the three states, a zero-booking row distinguishable from a serial canceller, the secondary count appearing only when non-zero, `tel:`/`mailto:` links, a maximum-length name wrapping, and that no client field reaches a log call.

## 4. The entry point

- [x] 4.1 Add the `/clientes` nav entry to `app/(dashboard)/layout.tsx`.
- [x] 4.2 Assert the nav entry renders and routes correctly.

## 5. Verification against the live database

- [x] 5.1 Confirm the network path **before** writing the gate: run the documented `repeat('x', 1400)` check from T68 and record whether this machine's path is affected. Expect it to be — this is the story that entry was re-scoped for.
- [x] 5.2 Write `scripts/d4-gate.ts` with a two-owner fixture, using short values and a small page size so the probes that can return do return: cross-owner isolation in both directions; a client with only cancelled bookings; a client with no bookings at all; twenty tied clients paged twice with no duplicate and no omission; counts matching real rows; and the round-trip count measured. Copy `probeOrSkip` from `scripts/d3-gate.ts`.
- [x] 5.3 Run the gate, remove its fixture, and record the result — reporting any probe that could not run as **not run**, never as passed.
- [x] 5.4 Drive the page authenticated over HTTP on `next dev` and on `wrangler dev` against the live database, using a marked fixture removed afterwards: the guard, the three states, the zero-booking row, the secondary count, the paging links, and the phone layout.

## 6. Quality gates and documentation

- [x] 6.1 Run the full suite, `npm run lint` and `tsc --noEmit`; no test skipped, no implicit `any`.
- [x] 6.2 Measure the Worker's gzip size against the 3152.48 KiB baseline.
- [x] 6.3 Update `docs/tech-debt.md`: record T54's decision (nullable snapshots, no backfill, readers fall back) **and correct its "D4's client table is where it bites" claim**; re-cost T56 naming this page as its natural home; re-measure T68 against this gate and record honestly whether it ran.
- [x] 6.4 Open a debt note for the zero-booking client row — the write path creates a client before the booking and outside a transaction — if the runtime pass finds one in real data.
- [x] 6.5 Write the D4 entry in `docs/roadmap.md` and check the story off.
- [x] 6.6 Run `openspec validate d4-clients-directory --strict` and resolve anything it reports.
