## Context

M1 and M2 settled the shape of a dashboard resource: an owner-scoped repository whose contract makes an unscoped query inexpressible, a Zod schema at the application boundary emitting English codes, a service translating database violations into domain errors, and a `useActionState` form that never loses what was typed. M3 is the third entity to walk that path, and the first to leave it in two places.

**Ownership goes back to being stored.** `docs/data-model.md` §6 gives `Service` a real `ownerId` column. M2's derived-ownership join was a response to `Barber` having no owner of its own; applying it here would be cargo cult. `Service` scopes the way `Location` does — on a column — and the repository contract still takes `ownerId` as a required parameter, because that is the property that matters and it is orthogonal to how the predicate is expressed.

**Money arrives.** `Service.price` is the first `Decimal` column, the first value formatted as currency, and the first field whose correct input on an es-AR keyboard is rejected by the platform's own number parser. Prisma returns `Decimal` as a `decimal.js` instance: it is not a plain value, it does not survive the RSC → Client Component boundary, and the failure appears only at runtime on `workerd` — not in `next build`, not in Vitest under Node. Four later fields inherit whatever boundary is drawn here (`Booking.priceAtBooking`, `Booking.depositAmount`, `PaymentConfig.depositValue`, and every income aggregate in D5/D6).

**`durationMinutes` is not a display field.** B3 generates the entire slot grid from it. A duration accepted here is a grid B3 must tile.

Constraints inherited from the stack, unchanged: Prisma on `workerd` through a **transaction-mode** Supavisor pooler, so consecutive queries may not share a connection and never share a transaction; Server Action POSTs pass the middleware by design, so each action's own `requireOwner()` is the only barrier; React 19 resets an uncontrolled form once its action resolves.

## Goals / Non-Goals

**Goals:**

- The owner can create and edit the services the business sells, with a price and a duration.
- A monetary value has exactly one representation per layer, and the driver's type never leaves infrastructure.
- A price the owner can legitimately type is a price the system accepts — including `4500,50`.
- `durationMinutes` cannot describe a slot grid that does not tile.
- The catalog cannot become an inescapable dead end once M6 adds deactivation.
- Every failure mode found by the edge-case pass is either handled or explicitly recorded as accepted.

**Non-Goals:**

- Deactivating or deleting services (M6). `isActive` ships as a column, exposed by nothing.
- Assigning services to barbers (M4) — the actual gate to the booking flow.
- Public rendering of a service, price display to a client, or bookability (B2/B3).
- The deposit interaction with a zero price (PC3).
- Currency selection. ARS is fixed by `docs/data-model.md`.
- Retrofitting the logging fix of D11 onto locations and barbers.

## Decisions

### D1 — `Service` needs two names disambiguated before the first file is written

`src/server/application/services/BarberService.ts` already exists as the *application service for the Barber aggregate*. `docs/data-model.md` §7 assigns that exact name to M4's **join table**. Following the current convention, M3's application class would be `ServiceService`.

Chosen: the M3 application class is **`ServiceCatalogService`**, and the existing `BarberService` class is renamed **`BarberCatalogService`** in this change. The application-layer folder is **`application/servicesCatalog/`**, because `application/services/` already means "service classes" and one repository cannot have two folders named `services` meaning different things.

**Alternative considered:** leave the rename to M4. Rejected — renaming one class now is mechanical; renaming it while simultaneously introducing a join table with the vacated name is two changes tangled in one diff, in the story that gates the booking flow.

**Alternative considered:** name the Prisma model something other than `Service` to dodge the collision. Rejected — `docs/data-model.md` §6 is the canonical vocabulary and `base-standards.md` §8 requires code to use its entity names exactly. The ambiguity belongs to the DDD layer word, so the DDD layer word is the one that moves.

### D2 — Scope on the `ownerId` column; do not import M2's join

`where: { ownerId }` on every read and write, mirroring `Location`. Every `IServiceRepository` method takes `ownerId` as a required parameter, so an unscoped query stays inexpressible — the property M2 established, expressed the way this entity's schema actually supports.

Because ownership is a scalar, the owner-scoped update is `update({ where: { id, ownerId } })` — Prisma's documented extended `where`-unique with an additional scalar filter, which is a weaker requirement than the relation filter M2's D3 gate had to prove. No gate is needed here. A mismatched owner yields `P2025`, which maps to `null` and is treated as not-found, **never** as a silent success.

**Explicitly rejected:** read through `findByIdForOwner`, then update by `id` alone. Two decisions with only one of them enforced — the pattern M1's D7 exists to forbid.

### D3 — Money crosses layers as a canonical string; `Decimal` never leaves infrastructure

`PrismaServiceRepository.toDomain()` is the only place in the codebase that reads a `Decimal`. It emits `row.price.toFixed(2)` — a canonical `"4500.50"`. The domain entity carries `price: string`.

| Representation | Verdict |
|---|---|
| `number` (float) | Rejected. `docs/data-model.md` forbids floating point for money; `0.1 + 0.2` is the whole reason. |
| Integer minor units (cents as `Int`) | Rejected, though genuinely defensible. It sidesteps the serialization problem entirely, but contradicts `data-model.md`'s explicit `Decimal` convention and would force a second representation once `PaymentConfig.depositValue` (a percentage) arrives. |
| `Decimal` all the way to the component | Rejected. Fails at the RSC boundary and only at runtime on `workerd`. |
| **Canonical `string` (chosen)** | Serializes trivially, compares exactly, formats deterministically, and keeps the driver type in one file. |

The rule generalizes: **a monetary value is converted at the repository boundary and never crosses a layer as a driver type.** This is the part of M3 that four later fields inherit, which is why it is stated as a rule and not as an implementation note.

> **Measured correction (task 4.1).** The argument above assumed a leak would *fail* at the RSC boundary.
> It does not. On `workerd`, `JSON.stringify` of the driver decimal yields `"4500.5"` — it serializes via
> `toJSON` but **drops the canonical two-decimal form**. A leak is therefore silent: `4500,5` in one place
> and `4500,50` in another, with nothing raised. This makes the rule more important and moves its
> enforcement from "a runtime error will catch it" to inspection (task 8.10) plus the repository test
> asserting a two-decimal string. Recorded in `docs/s0-versions-decision.md`.

### D4 — The column's precision and the validation ceiling are one number, declared twice

Column: `@db.Decimal(12, 2)`. Validation ceiling: `9_999_999.99` ARS.

The column is deliberately **wider** than the rule. Postgres raises `numeric field overflow` as SQLSTATE `22003`, which is not a typed Prisma code and would fall through to the generic infrastructure handler — the owner would see "no pudimos guardar los cambios" for what is a field error. Making validation strictly tighter than the column means that path is unreachable by construction rather than by handling.

Headroom is intentional and cheap: ARS inflation makes a seven-digit ceiling a foreseeable product decision to revisit, and revisiting a Zod constant is a deploy while revisiting a column type on a populated table is a migration.

### D5 — The price is parsed, not trusted, and the input is text

**The input is `type="text" inputMode="decimal"`, not `type="number"`.** When a browser's number parser rejects the value — which is what an es-AR keyboard's `4500,50` produces in Chrome — the control submits an **empty string**. Three failures follow at once: the server reports "falta el precio" for a price that was typed; the echo-back that preserves input on rejection has nothing to echo; and "missing" becomes indistinguishable from "malformed". `inputMode="decimal"` still raises the numeric keypad on mobile, which is the only real benefit `type="number"` offered.

Server-side parsing is the sole authority and accepts:

- `4500`, `4500.50`, `4500,50` → canonical `"4500.50"`. Both separators, because the platform and the keyboard disagree and the owner should not have to know which one won.
- Rejected: more than two decimals (**never silently rounded** — the owner must see the price they will charge), negatives, `NaN`/`Infinity`, exponent notation, and empty.
- Rejected as **ambiguous**: `4.500` and `4,500`. A thousands separator cannot be distinguished from a decimal separator without guessing, and guessing wrong is a 1000× price error. Refusal with a message naming the expected format beats a plausible wrong number.

`0` is accepted — `docs/data-model.md` §6 says `≥ 0`, and the consequence for deposits is PC3's question, not M3's.

### D6 — `SLOT_GRANULARITY_MINUTES` is a domain constant, and duration is validated against it

`SLOT_GRANULARITY_MINUTES = 5`, in `src/server/domain/models/slotGranularity.ts`. `durationMinutes` must be an integer, a multiple of it, and within `5 … 480`.

It lives in the **domain** layer because B3 (slot generation) and B5 (deposit/booking sizing) consume the same number. Two definitions of the slot grid would surface not as a failed test but as appointments that cannot be booked.

**Alternative considered:** no granularity rule, per the literal reading of `data-model.md` §6 ("typically a multiple of…"). Rejected: "typically" is not a validation rule, and B3 would inherit a grid that does not tile from data M3 already accepted.

**Alternative considered:** 15 minutes, the coarser value named in the data model. Rejected as too coarse for real services — a beard trim is 20 minutes, and rounding it to 15 or 30 misprices the barber's day. 5 divides 15, 20, 30 and 45, so it constrains nothing the owner actually wants.

### D7 — No form attribute may block submission or mutate a value

`required` is retained on the required fields: it never changes what the user typed, and M1/M2 already ship it.

Rejected outright: `type="number"`, `min`, `max`, `step`, and `pattern`. Each one lets the browser block the submit with a **tooltip in the browser's locale**, from a string that lives nowhere in `src/lib/copy.ts` and was reviewed by nobody. Worse, the server-side rule then never runs, so the validation that the spec describes is not the validation the owner meets. `step="5"` on the duration field is the concrete instance: it would replace D6's Spanish message with an untranslated native one.

**Inherited caveat, stated rather than fixed:** `maxLength` is retained for parity with M2, but it silently truncates a paste and makes the "121 characters" boundary **unreachable through the UI**. Those scenarios are therefore exercised against the Server Action directly, not through the rendered input. A test that drives the input would pass while proving nothing.

### D8 — The cap counts active services only

`MAX_SERVICES_PER_OWNER = 50`, counting rows with `isActive = true`.

Counting every row is the obvious implementation and it is a trap. M3 ships neither delete nor deactivation, but M6 ships deactivation — and an owner who deactivates fifty services would then be **permanently unable to create a fifty-first**, with no remedy anywhere in the application. The cap exists to bound accidental over-creation, not to cap the historical record, and history is exactly what a deactivated row is.

**It is advisory, and the spec must not claim otherwise.** The count and the insert are separate round trips on a transaction-mode pooler with no database constraint behind the count, so concurrent creates can exceed it — the shape already recorded as T13 for barbers. Rejecting a database-level count constraint has the same reason as M1's rejected `lower(name)` index: Prisma cannot express it, so every later `prisma migrate dev` reports drift that is not drift.

### D9 — The duplicate pre-check compares in memory (inherited, not re-derived)

Prisma's `mode: 'insensitive'` compiles to `ILIKE`, making `%` and `_` in a submitted name into wildcards, so `"Corte 50%"` would collide with `"Corte 500"`. M1 proved this; M2 inherited the fix; M3 inherits it verbatim. The row set is bounded by the cap, so this never scans an unbounded table.

Uniqueness is `@@unique([ownerId, name])` — **per owner**, because a service is offered by the business, not by a branch. The database constraint is the authoritative guarantee; the pre-check exists only to produce a readable field error and cannot be the guarantee, because check and write are separate round trips.

### D10 — Error taxonomy

- `ServiceNotFoundError` — unknown id **or** a service belonging to someone else. Deliberately indistinguishable; answering "forbidden" would confirm the row exists.
- `DuplicateServiceNameError` — pre-check hit, or `P2002` from the database.
- `ServiceLimitReachedError` — observed active count at the cap.

`P2002` is translated unconditionally, which is correct *only while `Service` participates in exactly one unique constraint*. M4 adds `BarberService(barberId, serviceId)`; from then on an unrelated violation would render "ya tenés un servicio con ese nombre". This is the T15 shape with the same trigger, recorded rather than solved — reading `error.meta.target` would drag Prisma's error shape into the application layer, which is what the structural check exists to avoid.

**No `P2003` mapping.** M2 needed one because a barber's destination location could vanish between check and write. `Service`'s only foreign key is `ownerId`, and the session owner cannot disappear mid-request without the request having already failed at `requireOwner()`.

### D11 — Log the driver's error *code*, never its message

A Postgres unique violation embeds the offending values in its text: `Key (ownerId, name)=(owner-root, Corte Clásico) already exists`. The current pattern logs `error.message` verbatim, which writes business data into structured logs and lets a name containing quotes or newlines forge log fields.

Chosen: on a **recognized** constraint violation, log the Prisma code and the operation and nothing else. Unrecognized errors keep logging their message — an unknown failure with its detail stripped is an unknown failure nobody can diagnose.

**Alternative considered:** sanitize the message by pattern. Rejected — it chases a format neither Prisma nor Postgres promises to keep stable, and a sanitizer that silently stops matching fails open.

**Scope discipline:** locations and barbers have this exposure identically. Fixing them here would alter the observable behaviour of two closed changes without updating their artifacts, which `base-standards.md` §7 forbids. It is recorded as debt with its trigger.

### D12 — Currency is formatted on the server only

`Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' })` runs in Server Components, never in a Client Component. Formatting the same value in both places invites a hydration mismatch, since the build's ICU data and the browser's need not agree.

This is also a **verification gate, not just a decision**: if `workerd`'s ICU is trimmed, the call degrades *silently* to `ARS 4500.00` instead of `$ 4.500,00`. It passes every test under Node and fails only in production. It is checked during `npm run preview`, alongside the `Decimal` boundary — the two runtime-only failures in this change.

### D13 — T8 (last-write-wins) is re-accepted for a third table

`docs/tech-debt.md` T8 was evaluated at M2 and re-declined; the premise requires two concurrent editors and `data-persistence` → "Exactly one Owner" forbids the second administrative user that would produce them. Nothing about services changes that. What M3 owes is the record, not the fix: T8 gains "last evaluated: M3" and keeps its existing triggers.

## Risks / Trade-offs

**A `Decimal` escapes to a Client Component** → the failure is invisible to `next build` and to Vitest under Node. D3 confines it to one function; `npm run preview` is a required gate, not a nicety.

**`Intl` degrades silently on `workerd`** → same gate, same run (D12). If ICU is trimmed, the fallback is a formatter written by hand — recorded as an open question rather than pre-solved, because it is cheap to check and wasteful to build speculatively.

**A rejected price cannot be echoed back** → mitigated by D5's choice of a text input, which is the only reason the echo has anything to echo. This is the highest-frequency failure in the change: it is one attribute, and getting it wrong breaks a promise the spec makes in three places.

**Ambiguous separators are refused, which some owners will read as a bug** → accepted. A refusal costs one retype; a wrong guess on `4.500` charges 4.50 or 4500 and nobody notices until reconciliation.

**The cap can be exceeded under concurrency** → accepted and documented (D8), same blast radius as T13: one extra row against a limit that bounds accidents.

**A double submit before hydration can report a successful create as a duplicate** → the T12 mechanism, third table. Data integrity holds because the constraint guarantees one row; the losing response says the service already exists. T12 is extended, not duplicated.

**A write that timed out may have landed** → the owner sees the generic infrastructure message and cannot tell whether the service exists. Retrying then reports a duplicate. Mitigated by copy that directs the owner to the list before retrying — the cheapest correct answer, since real idempotency needs a request key the form does not carry.

**Case-variant names can both survive a race** → T9, third table. The airtight fix is a `lower(name)` unique index, still not expressible in Prisma.

**Session expiry discards up to 500 characters of description** → T16, unchanged mechanism, one more field of the same size. Recorded, not fixed.

**The rename touches four importers of a shipped class** → purely mechanical, and `tsc --noEmit` catches every miss. It is sequenced *before* the new files so that no new code is written against the old name.

## Migration Plan

1. **Update `docs/data-model.md` §6 first** — per-owner uniqueness, shared name normalization, price precision and bounds, duration granularity, `description` null-on-blank; and add `services` to §1's `Owner` relationships. Spec-first per `docs/base-standards.md` §7. The doc currently states none of these rules, so writing code first would make the schema the source of truth instead of the document.
2. Rename `BarberService` → `BarberCatalogService` and update its four importers. Land this before any new file, so nothing is written against the name that is going away.
3. Add the `Service` model and the `Owner.services` back-relation to `prisma/schema.prisma`.
4. Generate the migration (`--name add_service`) and **read the emitted SQL before applying it** — in particular that `price` is `DECIMAL(12,2)` and not the default `DECIMAL(65,30)`.
5. Apply over `DIRECT_URL` (session-mode pooler, port 5432). The table is new and empty; the only lock is a brief one on `Owner` for the foreign key.
6. Regenerate **both** Prisma clients — the `workerd` runtime client and the CLI client used by seed and provisioning — and confirm `prisma/seed.ts` still runs.
7. Confirm the constraint bites: insert a duplicate `(ownerId, name)` directly and observe the rejection.
8. Run `npm run preview` and verify the two runtime-only properties: a price round-trips to the list without a serialization error, and it renders as `$ 4.500,00`.

**Rollback:** the migration is additive and the table starts empty, so rolling back is dropping it. Nothing depends on `Service` until this change's own code ships, so the schema step and the application step can be deployed independently.

## Open Questions

1. **Does `workerd` provide full ICU for `es-AR` currency formatting?** Settled by observation in step 8, not by discussion. If it degrades, the fallback is a small hand-written formatter — cheap, but not worth building before the answer is known.
2. **Does T10 get fixed in this change?** The "Nuevo servicio" call to action is the third link-styled-as-button, and T10's own trigger says to fix the anchor-background bug before the workaround is copied a third time. Fix or re-defer explicitly; silently copying it a third time is the one option the debt entry rules out.
3. **Should the seed create services?** M4 will want at least two to exist, and M4 is the next story. Out of this change's required scope; if added, it must use an idempotent `upsert` on the `(ownerId, name)` key, never a `findFirst` by name — the rule M1's seed established.
4. **What does M6 do with a deactivated service that a barber is still assigned to?** D8 decides only that the cap ignores it. Whether M4's assignment rows survive deactivation, and whether the barbers view surfaces it, belongs to M6 and M4 respectively. Named here so it is not discovered by a client meeting an unbookable service.
