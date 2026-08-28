## Context

`Client` has existed since B3 and been written since B4: `id`, `ownerId`, `name`, `email`, `phone`, timestamps, `@@unique([ownerId, email])`. Every guest who books resolves to one, and a returning guest overwrites their own name and telephone. Nothing has ever read the table as a table.

Four pre-existing facts shape this design, and none of them is new:

- **`Client.ownerId` is a real column.** Unlike `Barber`, scoping is a single predicate rather than a join through a location. Easier to write, and therefore easier to leave out with nothing looking wrong.
- **The connection pool is shared with the public booking flow** (T47); B2 measured ~0.35–0.40 s per Supavisor round trip. Round trips are the unit of cost.
- **The booking write creates the client before it writes the booking**, outside any shared transaction (`BookingCreationService.ts`: `clients.resolve()` at the client step, `bookings.createProvisional()` two steps later, with the live-hold cap check between them). Client rows with no bookings are therefore reachable today.
- **T68 caps what a gate can prove from the development machine**, and this is the story its re-scoped cost points at: the entry was corrected at D3 to *"a large payload"* rather than *"real volume"* precisely because D3's projection was narrow. This one's cannot be.

The Worker sits at **3152.48 KiB gzip** of the paid plan's 10 MiB (T51).

## Goals / Non-Goals

**Goals:**

- Turn stored contact details into something the owner can find and act on.
- Count business rather than checkout attempts, and never leave a zero ambiguous.
- Keep the page free of client JavaScript, writes, and new dependencies.
- Hold the privacy line this surface is the first to need: nothing in a URL, nothing in a log, nothing cached.

**Non-Goals:**

- Search, export, a detail page, editing, deleting, or revenue per client.
- Fixing T54 or T56. This change decides T54 and re-costs T56; neither is implemented here.
- Keyset paging. Offset is chosen knowingly (D5) and the trade-off is written down.

## Decisions

### D1 — `/clientes`, one page, read-only

`app/(dashboard)/clientes/page.tsx`, matching the route the project-structure sketch has always named and the brief's own word. `dynamic = 'force-dynamic'`, `robots: noindex`, `requireOwner()` before any read. One nav entry.

No writes at all, so no Server Action, no `revalidatePath`, no second composition root that can mutate. As with D3, the whole story being one `SELECT` is what makes the rest of it cheap.

### D2 — The headline count is `CONFIRMED`, and the second count is not a feature

D1's `confirmedAllTime` established the reasoning and this reuses it verbatim: a count of rows is a count of checkout attempts.

The second count — cancelled plus expired, rendered only when non-zero — is here for one reason, and the reason should survive into the code comment: **the primary number is ambiguous at zero.** A failed checkout and a serial canceller both read as zero, and they are opposite facts about a person. Anything beyond that pair is a statistic and belongs to D5.

*Alternative considered:* a single "total bookings" column. Rejected: it makes an abandoned checkout look like business, which is the specific error D1 already refused to make on the dashboard home.

### D3 — Ordering is `confirmedCount DESC, id ASC`, and the tiebreaker is load-bearing

"Most clients first" is the useful order for the question the story asks. The `id` tiebreaker is **correctness**: most clients will have exactly one confirmed booking, so ties are the ordinary case, and PostgreSQL is free to return tied rows in any order it likes — including a different one per query. With offset paging, that means the same client on page one and page two, and another client on neither, with nothing visible to indicate it.

A unique final sort key is the whole fix, and it is one clause.

### D4 — The counts are one aggregate over the page, never a query per row

Prisma's `_count` with a filtered relation, or a single `GROUP BY` — either way, **one statement**. Writing "for each client, count their bookings" is the natural expression of this feature and is an N+1 on a page that renders an entire customer base.

The total for the clamp comes from the same round trip.

### D5 — Offset paging, chosen knowingly

`?pagina=N` → `skip`/`take`, with a named `CLIENTS_PAGE_SIZE`.

Keyset paging would be stable under concurrent writes; offset is not. A booking confirmed between two page loads shifts the ordering and can duplicate or skip a row across pages. **That is accepted and stated rather than discovered**, because at this product's volume the simpler thing is right and the failure is a cosmetic anomaly in a directory rather than a wrong number anywhere. The stable tiebreaker (D3) removes the *unforced* half of the problem — ties — leaving only genuine concurrent change.

When volume justifies keyset, the ordering already has the unique final key it needs.

### D6 — The page parameter is clamped before it becomes an offset

`clientPageParams.ts`, following `recentBookingsParams.ts` and `barberCalendarParams.ts`: bound the length, parse, degrade — never throw, never 404, first occurrence of a repeated parameter.

One rule is new and specific to paging: **the clamp is against the known total, and it happens before the value reaches `skip`.** `?pagina=999999999` is an offset PostgreSQL will honour by walking and discarding rows. That means the total must be read first, or read in the same statement, and the page resolved after it — which is also what makes "beyond the last page" degrade to the last page rather than to an empty table.

### D7 — A new port, `IClientDirectoryRepository`

Not a widened `IClientRepository`: that contract is the booking write's — `resolve` and `findByEmail`, both keyed by an email address, both about identity rather than reporting. Its own header says `ownerId` is half the identity. A page's paged projection with aggregate counts is a different shape, and `IDashboardSummaryRepository` set the precedent with the argument: the separation is about **shape**, not scoping.

```ts
listForOwner(input: { ownerId: string; skip: number; take: number }):
  Promise<{ rows: readonly ClientDirectoryRow[]; total: number }>;
```

Every method takes `ownerId`, so an unscoped read is inexpressible.

### D8 — The projection carries contact details because they are the story, and nothing else

`id`, `name`, `email`, `phone`, `confirmedCount`, `inactiveCount`. No `createdAt`, no booking ids, no money.

Elsewhere in this project the rule has been to keep contact details *out* of a projection (`RecentBooking` says so; D3's calendar says so). Here they are the point — so the discipline moves to the surrounding constraints instead: uncached, unindexed, never logged, never in a URL. **That inversion is worth stating explicitly**, because "no email in the projection" is otherwise a pattern a reader would expect this code to follow and would be wrong to enforce.

### D9 — No search, and the reason is the URL rather than the effort

A search box on this table is a `?q=` carrying an email address into browser history, into `Referer` headers on any outbound link, and into every access log between the browser and the Worker. The alternatives — a POST, or a hashed lookup token — are a design rather than an addition.

Recorded here so that "add search" is a decision someone makes deliberately rather than a gap someone fills.

### D10 — `tel:` and `mailto:`

The owner's next action after finding a client is to contact them. A number that has to be transcribed by hand off a phone screen is the failure this table exists to remove. Two attributes, no JavaScript.

### D11 — The first table primitive, and cards below `sm`

`src/components/ui/table.tsx` from shadcn: markup and Tailwind classes, no JavaScript, no bundle cost worth measuring.

Below the small breakpoint it becomes a list of per-client blocks. A four-column table of contact data on a phone is a horizontally scrolling table, which on the surface an owner opens between clients is unusable. The same call D3 made for its timeline.

### D12 — Prefetch on the page links follows D3's **corrected** reasoning

D3's first version justified `prefetch={false}` as saving "a database round trip per hover" and that was wrong: the route has a `loading.tsx`, and the App Router's default prefetch for a dynamic route stops at that boundary. The prop is still worth setting — it avoids an RSC payload request per link — but **this design must not restate the round-trip claim**, which was corrected in D3's design D12 for exactly this reason.

### D13 — T54 is decided here and implemented elsewhere, and the entry gets a correction

The debt entry narrowed its trigger to D4 and asked for the backfill question to be settled.

**The decision:** nullable `clientName` / `clientPhone` snapshot columns on `Booking`, **no backfill**, readers falling back to the join when the snapshot is null. Backfilling existing rows from the current `Client` stamps today's possibly-wrong name onto history permanently — which is the defect the entry describes, applied to every row at once, rather than the fix.

**The correction:** the entry says *"D4's client table and D3's calendar are where it bites"*. For D4 that is wrong. T54 is about a rename propagating backwards through *historical bookings*; this table renders the `Client` row, which is current by definition — the newest name is the correct thing to show. D3's calendar and D1's list are where it bites. D4 is where the cause is visible without the damage being visible.

Implementation is a write-path change to B4's transaction and belongs to its own change, for the reason D1 already gave when it declined the same thing: riding a schema decision into a read-only story is how a concurrency-critical transaction gets edited without a transaction review.

### D14 — T56 is re-costed, not resolved, and this page is why

An owner looking at a customer's contact details is exactly who reaches for "delete this person". There is no such control, and there cannot be one until somebody decides between deleting and anonymising — `Client` is `onDelete: Restrict` from `Booking`, so the row cannot go while the bookings stay, and the bookings are financial records the owner has a legitimate reason to keep.

D4 makes the absence visible for the first time and records that this page is the entry's natural home. It does not invent the policy.

## Risks / Trade-offs

- **[T68 makes this gate partly unrunnable from the development machine]** → Expected, and this is the story the entry was re-scoped for: a client row carries an email address and a telephone number by definition, so the payload cannot be narrowed out of trouble the way D3's was. Confirm the path with `repeat('x', 1400)` first, run from an unaffected path, and report unrunnable probes as **not run**. Reduce the exposure where it is free: the gate's own fixture uses short values and a small page size, so the isolation and counting probes have the best chance of returning even on the affected path.
- **[Offset paging can duplicate or skip a row under concurrent writes]** → Accepted (D5), stated in the spec, and reduced to the genuinely-concurrent case by the stable tiebreaker.
- **[The single-predicate owner scope is easy to omit]** → Two-owner fixture in both directions, in the gate and in the adapter test. A leaked customer list produces no row that looks wrong.
- **[Contact details on screen are a new class of exposure for this product]** → No cache, no index, no URL, no log, no export. The projection inversion (D8) is documented so the constraints are understood as deliberate rather than accidental.
- **[Zero-booking rows may confuse an owner reading the table as a customer count]** → The secondary count distinguishes them, and the copy for a zero row must not call the person a customer. It does not fix the underlying oddity, which is that a refused checkout leaves a row — worth a debt note rather than a change to B4's ordering inside a read-only story.
- **[A shop with thousands of clients]** → **Measured after the fact, and the first wording of this risk was wrong.** It said "offset degradation at very deep pages", which understates it: the counts, the ordering and `count(*) OVER ()` are all computed **before** `LIMIT` applies, so the cost of drawing *any* page is proportional to the shop's whole booking history, and paging deeper adds almost nothing to it. `EXPLAIN (ANALYZE)` against the live database shows `Seq Scan on "Booking"` under a hash join — and `Booking` has no index on `clientId`, because PostgreSQL creates none for a foreign key and the schema declares none. At today's 20 bookings the plan is correct and takes 0.74 ms, so no index is added here: D1's rule is that indexes come from measurement, and this measurement says "not yet". Recorded as **T81** with the plan attached and a trigger to re-measure.

## Migration Plan

**No database migration.** `Client` has every column this story reads, and `@@unique([ownerId, email])` backs the owner scan. The plan is to be **confirmed by the gate**, not assumed.

An ordinary Worker deploy; rollback is a redeploy of the previous version, since the change adds one route, one nav entry and one UI primitive, and writes nothing.

Order of work: the page-parameter rule and its tests, then the port and adapter, then the service, then the primitive and the page, then the nav entry, then the gate, then the runtime pass, then the docs.

## Open Questions

- **Is "most bookings first" the right default, or should it be "most recent booking first"?** The story's *why* is "know my customer base", which argues for volume. A shop chasing lapsed clients would want recency, and that is a column this projection does not carry. Revisit if an owner asks; adding `lastBookingAt` is one more aggregate on the same statement.
- **What page size?** A judgement, named as a constant, like every other guessed bound in this project. Start at something that fills a phone screen without paging constantly.
- **Does the zero-booking row deserve a debt entry of its own?** The underlying cause — client created before the booking, outside a transaction — is a write-path oddity that this story only surfaces. Probably yes, once the table shows one in production.
