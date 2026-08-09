## Context

M1 established the shape every dashboard resource follows: an owner-scoped repository whose contract makes an unscoped query inexpressible, a Zod schema at the application boundary emitting English codes, a service translating database violations into domain errors, and a `useActionState` form whose rejected submissions never lose what was typed. M2 repeats that shape for a second entity — and in doing so hits three things M1 never had to solve.

**Ownership is derived.** `Barber` has no `ownerId`. It belongs to the owner only through `location.ownerId`, which means the security predicate is a join rather than a column comparison. Every dashboard entity arriving after this one (services are owner-owned, but working hours, time off, and bookings all hang off `Barber`) reaches its owner the same way. Whatever this change does becomes the pattern.

**The form has a control whose valid values are rows in another table.** M1's inputs were free text; nothing about them could be stale. A `<select>` of locations is stale the instant the HTML leaves the server, and its option set is simultaneously a UX affordance and — if implemented carelessly — a place where a security decision looks like it has been made when it has not.

**A second entity now shares the name-normalization rule.** M1 wrote `normalizeLocationName` for one caller. A rule with two callers and one implementation is a shared rule; a rule with two implementations is a future bug.

Constraints inherited from the stack: Prisma on `workerd` through a **transaction-mode** Supavisor pooler, so consecutive queries may not share a connection and never share a transaction; Server Action POSTs pass the middleware by design, so each action's own `requireOwner()` is the only barrier; React 19 resets an uncontrolled form once its action resolves.

## Goals / Non-Goals

**Goals:**

- The owner can register barbers, assign each to one of their own locations, and reassign them later.
- Ownership enforcement for a derived-ownership entity is structural — expressible only one way, and that way is correct.
- A barber can never be moved into an inactive location, and can always stay in one.
- The normalization rule has exactly one implementation, hardened against invisible characters that defeat uniqueness.
- Every failure mode found by the edge-case pass is either handled or explicitly recorded as accepted.

**Non-Goals:**

- Deactivating or deleting barbers (M6). `isActive` ships as a column, exposed by nothing.
- Avatar upload (P1 owns Supabase Storage setup). `avatarUrl` ships as an unused column.
- Service assignment (M4), working hours and time off (M5), public rendering (B2).
- Optimistic concurrency control on edits — evaluated here and deliberately re-declined (D13).
- Rate limiting authenticated dashboard actions.

## Decisions

### D1 — Scope through the relation; do not denormalize `ownerId` onto `Barber`

`where: { location: { ownerId } }` on every read and write.

**Alternative considered:** add an `ownerId` column to `Barber` and scope on it directly. Rejected on two grounds. It duplicates a fact the foreign key already carries, which `docs/data-model.md` explicitly calls out as the kind of denormalization this schema avoids. Worse, it *can drift*: reassignment writes `locationId`, and any path that forgets to write `ownerId` alongside it produces a row whose two ownership answers disagree — with the wrong one being the fast, indexed, trusted one. A join that cannot be wrong beats a column that can.

**Cost accepted:** every barber query carries a join. At one owner and a 50-per-location cap this is not a measurable cost, and `Location(ownerId, isActive)` from M1 already backs the outer half of it.

### D2 — Uniqueness is per location, not per owner

`@@unique([locationId, displayName])`.

Per-owner uniqueness would reject a legitimate reality: the same first name working at two branches. Per-location uniqueness targets the actual harm, which is B2 rendering two indistinguishable options in a picker. `docs/data-model.md` §5 is silent on this today and must be updated before the code is written.

### D3 — The owner-scoped update mechanism must be settled empirically before anything depends on it

`update({ where: { id, location: { ownerId } } })` is **not known to work**. Prisma's extended `where`-unique accepts additional *scalar* filters; whether it accepts a *relation* filter in an `update` predicate on Prisma 7 is unverified, and the answer decides how the security boundary is written.

The fallback that certainly works is `updateMany({ where: { id, location: { ownerId } }, data })`, treating `count === 0` as not-found and re-reading through the scoped finder when the entity is needed.

**Explicitly rejected fallback:** read the barber through `findByIdForOwner`, then update by `id` alone. That is two decisions with only one of them enforced — precisely the pattern M1's design D7 exists to forbid. If the relation filter is unavailable, `updateMany` is the answer, not a guard read.

This mirrors M1's task 4.3, where the `mode: 'insensitive'` hazard was proven with a test *before* the implementation leaned on it. Same discipline, different unknown.

### D4 — The "unchanged location" exemption is resolved against the database, never against the payload

The rule is: destination must be active **unless** it is the barber's current location. The tempting implementation renders the current location as a hidden field so the action can compare. That hands the caller the operand of the check — a payload asserting `locationId = X, currentLocationId = X` satisfies "unchanged" for any inactive location the owner holds, and D5's guarantee evaporates.

So: the action resolves the barber through the owner-scoped finder and compares against `barber.locationId` as stored. **No form field carrying the barber's current location may exist**, which also removes the temptation for a later contributor to "optimize away" the read.

This is the same rule `location-management` already states for `ownerId` ("MUST NOT be read from the submitted form under any circumstance"), applied to a field nobody thinks of as a security field. That is exactly why it needed writing down.

**Corollary:** the destination's active state is verified at write time, not merely reflected in the rendered options. The option set is stale the moment it reaches the browser.

### D5 — The location control offers active locations ∪ the barber's current location

Three candidate option sets were considered:

| Option set | Creating into an inactive location | Editing a barber already at an inactive location |
|---|---|---|
| All of the owner's locations | Accepted → barber silently absent from B2, no visible cause | Fine |
| Active only | Blocked ✓ | **No option matches the barber's `locationId`; a native `<select>` selects the first option, so saving an unrelated field silently reassigns the barber** ✗ |
| **Active ∪ current (chosen)** | Blocked ✓ | Fine ✓ |

The middle column is why filtering at the point of choice matters: `docs/data-model.md` §5 makes a barber at an inactive location unbookable, so accepting the assignment produces a person who never appears in the booking flow, with the cause recorded in a document rather than in the UI. The right column is M1's lesson one level down — its location list deliberately includes inactive rows because "hiding an inactive location would make it uneditable".

The chosen inactive option renders with a visible marker so the owner understands why exactly one inactive branch appears in a list of active ones.

**No-op today**, since nothing can set `isActive = false` before M6. It is written now because it is the enforcement of a rule that already exists in the data model, not the anticipation of a feature — and because M6's test plan will not be looking at the barber edit form.

### D6 — A native `<select>`, not shadcn/Radix `Select`

`docs/frontend-standards.md` justifies the house form pattern partly because "the form still submits before hydration and with JavaScript disabled". Radix's `Select` renders a button and a portalled listbox — no form-associated control — so it submits nothing without a hidden mirror input and a client-side sync. Adopting it would quietly retire a property the standards document treats as a reason for the whole pattern.

A native `<select>` styled to match `Input` keeps the promise. `src/components/ui/` currently holds only `button`, `card`, `input`, `label`, so this change also adds a `textarea` primitive for `bio`.

**Accepted limitation:** a native select has no type-ahead search. At the M1 cap of 50 locations this is fine; revisit if that cap ever moves.

### D7 — One normalization module, extended to strip bidirectional controls

`normalizeLocationName` moves to a shared domain module and both schemas import it. The alias is deleted rather than kept, so the rule has one name and one home.

While it is being touched, it gains removal of U+202A–U+202E and U+2066–U+2069. These are invisible, survive a length check, and make two names that render identically differ in bytes — defeating the uniqueness constraint the same way zero-width characters do, which the helper already handles. Unlike zero-width characters they additionally reverse the rendering direction of *surrounding* text, so one crafted name corrupts the rows next to it — in the dashboard now, in the public booking flow after B2.

M1's existing normalization tests must pass **unchanged** as the regression proof that the extraction preserved behaviour.

### D8 — The cap is per location, and it is advisory

`MAX_BARBERS_PER_LOCATION = 50`. Per location rather than per owner: it is the natural bound for a branch's roster, and it also bounds the row set the in-memory duplicate pre-check scans.

**It is not a guarantee and the spec must not claim otherwise.** `createBarber` performs four round trips against a transaction-mode pooler; two concurrent creates can both observe `count = 49` and both write, and unlike the duplicate rule no database constraint catches the race. M1's spec says the application "SHALL enforce a server-side maximum", which overstates the same mechanism. M2 states what is true — rejection when the *observed* count is at the cap — and records the race.

**Alternative considered:** a database-level count constraint via trigger. Rejected: Prisma cannot express it in `schema.prisma`, so every later `prisma migrate dev` would report drift that is not drift — the same reasoning that rejected the `lower(name)` expression index in M1 (T9).

### D9 — The duplicate pre-check compares in memory (inherited, not re-derived)

Prisma's `mode: 'insensitive'` compiles to `ILIKE` on PostgreSQL, so `%` and `_` in a submitted name become wildcards and "Juan 50%" collides with "Juan 500". M1 proved this and solved it by comparing lowercased strings in memory over a capped row set. M2 inherits the solution verbatim; the only change is the scope of the row set (per location instead of per owner).

### D10 — The list uses a read model; the entity stays free of joined data

The list needs each barber's location *name*. Widening the `Barber` domain entity to carry it would put presentation-driven, join-derived data inside a domain object — and would then require every construction site to supply it. Instead the repository exposes a listing that returns `{ barber, locationName, locationIsActive }`, and the entity stays exactly what `docs/data-model.md` §5 describes.

One query with `include`, ordered by location name then display name. Never one query per location.

### D11 — Error taxonomy, including the two Prisma codes M1 did not need

- `BarberNotFoundError` — unknown id **or** a barber whose location belongs to someone else. Deliberately indistinguishable; answering "forbidden" would confirm the row exists.
- `DuplicateBarberNameError` — pre-check hit, or `P2002` from the database.
- `LocationNotAvailableError` — destination unknown, foreign, or inactive-and-not-current. All three collapse into one answer for the same reason as above.
- `BarberLimitReachedError` — observed count at the cap.

Two Prisma codes need handling that M1 never encountered:

- **`P2002` is translated unconditionally**, which is correct *only while `Barber` participates in exactly one business unique constraint*. M4 adds `BarberService(barberId, serviceId)`; from then on an unrelated violation would render "Ya tenés un barbero con ese nombre". Recorded with M4 as the trigger rather than solved now — reading `error.meta.target` would drag Prisma's error shape into the application layer, which is exactly what the structural check exists to avoid.
- **`P2003`** (foreign key) means the destination location vanished between the check and the write. Left unhandled it surfaces as the generic infrastructure message — a not-found condition dressed as a technical failure, sending the owner to look for a problem that does not exist. It maps to `LocationNotAvailableError`.

### D12 — The bio is clamped in the list

`bio` is the product's first multi-line free-text field. Rendered with `whitespace-pre-line`, 500 characters of newlines stretch one card into a column and destroy the grid; rendered without it, deliberate line breaks vanish. The list clamps to a bounded number of lines; the full value lives on the edit form, which is where it is edited anyway.

### D13 — T8 (last-write-wins) is re-accepted, with a new trigger

`docs/tech-debt.md` T8 names **M2** as its trigger: "once barbers are attached to locations, a location name becomes load-bearing for staffing and silent loss stops being harmless."

Evaluated and re-declined. The premise still requires two concurrent editors, and `data-persistence` → "Exactly one Owner" forbids the second administrative user that would produce them. Adding a version column and a precondition to a three-field form buys nothing against a failure that cannot currently occur.

What M2 owes is not the fix but the *record*: T8 is updated to say M2 evaluated it, why it was re-accepted, and the new trigger — a second `Owner`, or story D3 (the per-barber calendar), where a stale overwrite starts costing appointments rather than a retyped name.

## Risks / Trade-offs

**The relation filter in `update` may not exist** → D3 settles it with a test before any code depends on it, and names the exact fallback. This is a gate, not a hope: if neither form works, the story stops and the finding goes into `docs/s0-versions-decision.md`.

**The `<select>` is a hint that looks like a control** → every check it appears to perform is re-performed server-side at write time (D4). The only correct mental model is that the option set exists to be helpful, never to be trusted.

**The extraction of `normalizeLocationName` touches shipped M1 behaviour** → M1's tests are kept as-is and must pass unchanged; the only intended behavioural delta is the new class of stripped characters, which has its own scenario in the `location-management` delta.

**Reassignment silently rewrites derived booking history** → a booking's location is derived through `barber.locationId` (`docs/data-model.md` §11), so moving a barber retroactively moves every booking they ever took. Harmless at zero bookings, wrong at B4 and in D5's location-filtered statistics. Recorded in `docs/tech-debt.md` with B4 as the trigger; not solvable here, since the fix is a `locationId` snapshot on `Booking`, which does not exist yet.

**The cap can be exceeded under concurrency** → accepted and documented (D8). The blast radius is one extra row against a limit that exists to bound accidents, not to shape the product.

**A double submit before hydration can report a successful create as a duplicate** → the T12 mechanism, unchanged: data integrity holds because the constraint guarantees one row, but the losing response says the barber already exists. T12 is extended to cover barbers rather than duplicated.

**Session expiry discards up to 500 characters of bio** → `requireOwner()` redirects to `/login?next=…` and the owner returns to an empty form. M1 accepted this for two short fields; a 500-character bio raises the cost without changing the mechanism. Recorded, not fixed — draft persistence is a larger feature than the story it would ride in on.

**Unauthenticated Server Action POSTs are unmetered** → verified: the middleware passes `next-action` requests through by design, then `resolveOwnerFromSession` short-circuits at `!user`, so each costs one Supabase Auth round trip and **zero** database calls. Real, cross-cutting (M1 has it identically), and low-impact. Recorded as debt; solving it inside M2 would put a rate limiter in a story about barbers.

## Migration Plan

1. Update `docs/data-model.md` §5 first — derived ownership, per-location uniqueness, normalization, `bio` null-on-blank, `onDelete: Restrict`. Spec-first per `docs/base-standards.md` §7.
2. Add the `Barber` model and the `Location.barbers` back-relation to `prisma/schema.prisma`.
3. Generate the migration (`--name add_barber`) and **read the emitted SQL before applying it**.
4. Apply over `DIRECT_URL` (session-mode pooler, port 5432). Creating a table is not a lock hazard; the foreign key briefly locks `Location`. Verify the table, the unique index, the `(locationId, isActive)` index and the `RESTRICT` FK all exist.
5. Regenerate **both** Prisma clients — the `workerd` runtime client and the CLI client used by seed and provisioning.
6. Confirm the constraint bites: insert a duplicate `(locationId, displayName)` directly and observe the rejection.

**Rollback:** the migration is additive and the table starts empty, so rolling back is dropping it. Nothing existing depends on `Barber` until this change's own code ships, which means the schema step and the application step can be deployed independently if needed.

## Open Questions

1. **Does Prisma 7 accept a relation filter in an `update` predicate?** Settled by the D3 gate test, not by discussion. It changes which repository method the security boundary is written against.
2. **What happens to barbers when M6 deactivates their location?** Strictly nothing needs to: `docs/data-model.md` §5 already makes them unbookable by derivation, so no cascade is required for correctness. But M6 must decide whether the barbers list marks them as effectively inactive, or the owner reads "Juan — Activo" at a closed branch and cannot tell why nobody books him. Explicitly deferred to M6 rather than guessed at here.
3. **Should the seed create a barber?** M4 and M5 will both want one to exist. Left out of this change's required scope; if added, it must use the same idempotent `upsert` on the `(locationId, displayName)` key that M1's task 9b.1 established, never a `findFirst` by name.
