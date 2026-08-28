## Why

**The product has stored a stranger's name, email address and telephone number since B4, and has never shown any of it to the person who collected it.** Every guest who books leaves a `Client` row — deduplicated per owner by email address, updated on every return visit — and the only place a client's name has ever appeared is as a label on a booking: ten rows in D1's recent list, one day at a time in D3's calendar. The owner cannot answer *"who are my customers"*, and cannot reach one of them without going hunting through appointments for a name they half-remember.

The brief has always named this surface — `project-context.md` §7: *"Clientes: tabla con Nombre, Teléfono, Email y cantidad de Reservas"* — and it is the last thing in the dashboard that turns stored data into something the owner can act on. A telephone number nobody can find is not a telephone number.

**It is also the first surface in this product that renders a guest's contact details**, which changes what the story is about. Every other dashboard page shows the owner their own configuration or their own bookings. This one shows other people's personal data, on a page whose whole value is that it is complete. That is what dictates its non-functional shape: uncached, unindexed, nothing in a URL, nothing in a log.

**Two debt entries name this story, and one of them is wrong about it.** T54's trigger was narrowed to D4 — *"D1 has passed and is spent as a trigger"* — and T56 (guest data with no deletion path) has been waiting for the surface an owner would look for a delete control on. This change owes both an answer, and it owes T54 a correction: see below.

## What Changes

### The capability

- **A read-only clients table** at `/clientes`, with a nav entry: name, telephone, email, and how many bookings each client represents.
- **The count is `CONFIRMED` bookings, all time** — never a row count. D1 settled the reasoning for its own historical figure: a count of every booking is a count of *checkout attempts*, and abandoned holds accumulate without bound relative to real business.
- **A second, muted count of cancelled and expired bookings, shown only when it is non-zero.** Not a statistic — it exists because the primary number is ambiguous without it. A client at zero is either somebody whose checkout died before it became a booking or somebody who booked three times and cancelled all three, and those are opposite facts about a customer.
- **Ordering is confirmed count descending, then `id` ascending**, and the tiebreaker is correctness rather than tidiness (see below).
- **Bounded and paged** by a named page-size constant and a clamped `?pagina`, degrading rather than failing — the rule `recentBookingsParams.ts` established for the only other read parameter in this dashboard.
- **Contact details are actionable**: `tel:` and `mailto:`, because the owner's realistic next action after finding a client is to contact them.
- **A new owner-scoped read-only port**, `IClientDirectoryRepository`, returning the page and the total from **one round trip**, with the per-client counts as a single aggregate rather than a query per row.
- **The project's first table primitive.** `src/components/ui/table.tsx` — shadcn's is markup and classes, no JavaScript.
- **No migration.** `Client` already carries every column, and `@@unique([ownerId, email])` backs the scan.

### What the edge-case pass forced into scope

- **A client with zero bookings is not hypothetical — it exists in production now.** `BookingCreationService` calls `clients.resolve()`, which *creates* the row, and only then checks the live-hold cap and writes the booking; neither is in a shared transaction. A stranger who trips the cap, or whose slot is taken in the interval, leaves a `Client` behind with no booking at all. **This table will show them, and without the secondary count it will show them as customers.**
- **Ties in the ordering are the common case, not the rare one.** Most clients will have exactly one confirmed booking. An ordering that is not total lets offset paging return the same row on two pages and skip another entirely, silently. A unique final sort key is what makes the sequence a sequence.
- **`?pagina` is an offset the database will honour.** `999999999` makes PostgreSQL walk and discard rows; it is clamped against the known total before it reaches `skip`.
- **The count is an N+1 by default.** "Count each client's bookings" is the natural way to write this and issues one query per row, on a page that renders a whole customer base, against the pool the public booking flow shares (T47).
- **Three empty tables that must not look alike**: a shop with no clients yet, a page past the last one, and a read that failed.

### What is deliberately not here

- **No search or filter.** An email address in a query string is personal data in browser history, in a `Referer`, and in every access log between here and the user. Search on this table needs a POST or a token — a design of its own, not a checkbox on this one.
- **No CSV export.** It needs formula-injection handling and a download path, for something nobody has asked for.
- **No client detail page.** A `/clientes/[id]` route is a second enumeration surface, and nothing needs it yet.
- **No edit and no delete.** T56 is a **policy** decision before it is an implementation — anonymise versus delete — and `Client` is `onDelete: Restrict` from `Booking`, so a client with history cannot be removed without first deciding what happens to their bookings. This change makes the surface obvious and re-costs the entry; it does not invent the policy.
- **No revenue per client.** D5 owns money.
- **No fix for T54.** It is a write-path change to B4's transaction — the concurrency-critical one — and this story contains no writes. D4 **decides** it; a separate change implements it.

### The correction this story owes T54

T54 says *"D4's client table and D3's calendar are where it bites"*. **For D4 that is wrong, and the entry should say so.** T54 is about a rename propagating backwards through *historical bookings*; this table renders the `Client` row itself, which is current by definition — the newest name is the correct thing to show. D3's calendar and D1's list are where it bites. D4 is where the *cause* is visible without the damage being visible, which is a different and weaker claim than the one recorded.

The backfill question the entry asks D4 to settle is answered in `design.md`: **nullable snapshot columns, no backfill, readers fall back to the join** — because backfilling stamps today's possibly-wrong name onto history permanently, which is the defect rather than the fix.

## Capabilities

### New Capabilities

- `clients-directory`: the owner's view of their customer base. What a client is counted as having booked, how the list is ordered and bounded, how the page parameter is resolved and clamped, what a zero-booking row means and how it is told apart from a serial canceller, every empty and failure state, the one-round-trip owner-scoped read contract, the privacy constraints this surface carries as the first renderer of guest contact details, and the gate that proves it against the live database.

A capability of its own rather than a section of `dashboard-home`: that spec governs a fixed set of counters and a bounded recent list on one page, and its requirements are written about those figures. A directory of people, with its own ordering, paging and privacy rules, would not be a subsection of it — it would be a second document living inside the first.

### Modified Capabilities

None. The dashboard gains a page; no existing requirement changes behaviour.

## Impact

**New:**
- `app/(dashboard)/clientes/` — `page.tsx`, `loading.tsx`, the composition root, and their tests (including the source-level root assertion C2 and D3 established).
- `src/server/domain/repositories/IClientDirectoryRepository.ts` — the port.
- `src/server/infrastructure/prisma/PrismaClientDirectoryRepository.ts` — the adapter.
- `src/server/application/services/ClientDirectoryService.ts` — the composition.
- `src/server/application/dashboard/clientPageParams.ts` — the `pagina` resolver.
- `src/components/ui/table.tsx` — the first table primitive in the project.
- `scripts/d4-gate.ts`.

**Modified:**
- `app/(dashboard)/layout.tsx` — one nav entry.
- `src/lib/copy.ts` — the `clients` namespace.
- `docs/tech-debt.md` — T54 decided and its "where it bites" claim corrected, T56 re-costed with D4 named as its natural home, T68 re-measured against this gate.
- `docs/roadmap.md` — the D4 entry.

**Dependencies:** none added. No package, no provider, no environment variable, no external call. The composition root builds a Prisma client and a logger; no cipher, no storage client, no session client, so the count of surfaces permitted to decrypt a Mercado Pago credential is unchanged and a test asserts it.

**Verification:** `scripts/d4-gate.ts` against the live database — two-owner isolation in both directions, a client with only cancelled bookings, a client with zero bookings, the tie ordering stable across two pages, and the counts matching real rows. Then an authenticated runtime pass on Node and `workerd`.

> ⚠ **This is the gate T68 was re-scoped for, and it is expected to be partly unrunnable from the development machine.** D3's gate ran clean because its projection was eight narrow columns; the entry's cost was corrected to *"a large payload"* rather than *"real volume"* on exactly that evidence. **A client row carries an email address and a telephone number by definition** — that is the story — so a page of them is squarely over the ~1.4 KB ceiling. Confirm the path first with the documented `repeat('x', 1400)` check, run the gate from an unaffected path, and report every probe that cannot run as **not run** — never as passed. `probeOrSkip` in `scripts/d3-gate.ts` is the helper to copy.
