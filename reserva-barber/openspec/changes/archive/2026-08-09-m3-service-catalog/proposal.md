## Why

A barbershop with barbers but no services still cannot take a booking. M1 gave the owner locations, M2 put people in them; M3 is what those people sell. It is the last catalog entity before **M4** — the actual gate to the booking flow — and until it ships, `docs/data-model.md` §6 describes an entity absent from `prisma/schema.prisma`.

It is also the story that introduces **money** to this product. `Service.price` is the first `Decimal` column, the first value rendered as currency, and the first number whose parsing depends on an es-AR keyboard producing a comma where the platform expects a dot. Four later entities inherit whatever boundary is drawn here — `Booking.priceAtBooking`, `Booking.depositAmount`, `PaymentConfig.depositValue`, and every income aggregate in D5/D6. A `Decimal` that escapes the repository fails at runtime on `workerd` and nowhere else; getting the boundary right once is getting it right five times.

Second, `durationMinutes` is not a display field. B3 generates the entire slot grid from it. A duration this story accepts is a grid B3 must tile, so the granularity rule belongs here, at the only moment it can still be refused cheaply.

## What Changes

- Add a dashboard section at `/servicios` where the owner lists, creates and edits services, each with a name, price, duration and optional description.
- Add the `Service` model, its migration, the `Owner.services` relation, and `@@unique([ownerId, name])`. Uniqueness is **per owner**, not per location: `data-model.md` §6 gives `Service` a real `ownerId` column, so unlike `Barber` its ownership is *stored*, and scoping mirrors `Location` rather than the derived-ownership pattern M2 established.
- **Confine `Decimal` to the infrastructure layer.** Prisma returns money as a `decimal.js` instance, which is not a serializable value across the RSC → Client Component boundary. The domain entity carries a canonical `string`; `toDomain()` is the only place a `Decimal` is read. This is a rule for every money field that follows, not a local convenience.
- **Accept the price as text, not as a number input.** `<input type="number">` submits an *empty string* when the browser's parser rejects the value — which is what a es-AR keyboard's `4500,50` produces in Chrome. The server would then report "falta el precio" for a price the owner typed, and the echo-back that preserves input on rejection would have nothing to echo. Server-side parsing accepts both separators and is the only authority.
- Introduce `SLOT_GRANULARITY_MINUTES` as a **domain** constant and validate `durationMinutes` against it. It lives in the domain layer because B3 and B5 consume the same number; two definitions of the slot grid would be a defect that only appears as unbookable appointments.
- Add a per-owner cap on services, since M3 ships create and edit but neither delete nor deactivation (M6). The cap **counts active services only** — counting every row would let a future M6 deactivation permanently lock an owner out of creating anything, with no remedy inside the application.
- Stop logging raw driver error text on constraint violations. A Postgres unique violation embeds the submitted value in its message (`Key (ownerId, name)=(…) already exists`), so the current pattern writes business data into structured logs and lets a crafted name forge log fields.
- Rename the application-layer `BarberService` class to `BarberCatalogService`. M4 introduces a Prisma model of exactly that name (`data-model.md` §7); resolving the collision while renaming one class is cheaper than resolving it while also adding a join table. The M3 class is `ServiceCatalogService` for the same reason.
- Do **not** ship: the `isActive` control (M6), barber assignment (M4), deletion, currency selection, any public rendering of a service (B2), or the deposit interaction with a zero price (PC3 owns that question).

## Capabilities

### New Capabilities

- `service-catalog`: The owner creates and edits the services the business sells — name validation, normalization and per-owner uniqueness; price parsing, precision and bounds; duration granularity; the per-owner cap; ownership enforced on every read and write; the money-formatting contract; and the Spanish (es-AR) states of both forms, including the accessible error, submitting, empty and infrastructure-failure states.

### Modified Capabilities

- `data-persistence`: adds the `Service` model, the `Owner.services` relation, `@@unique([ownerId, name])` and the `(ownerId, isActive)` index. Establishes the first monetary column (`Decimal(12, 2)`) and the rule that a monetary value is converted to a canonical string at the repository boundary and never crosses a layer as a driver type — the constraint that makes money safe on the `workerd` runtime.

## Impact

- **Code (new):** `app/(dashboard)/servicios/{page,actions,formState,ServiceForm,loading,not-found}.*`, `.../nuevo/page.tsx`, `.../[id]/editar/page.tsx`; `src/server/domain/models/{Service,slotGranularity}.ts`; `src/server/domain/errors/ServiceErrors.ts`; `src/server/domain/repositories/IServiceRepository.ts`; `src/server/application/servicesCatalog/serviceSchema.ts`; `src/server/application/services/ServiceCatalogService.ts`; `src/server/infrastructure/prisma/PrismaServiceRepository.ts`; `src/lib/formatCurrency.ts`.
- **Code (modified):** `prisma/schema.prisma` (`Service`, `Owner.services`), `src/lib/copy.ts`, `app/(dashboard)/layout.tsx` (navigation), and the rename of `src/server/application/services/BarberService.ts` with its four importers.
- **Naming:** the application-layer folder is `application/servicesCatalog/` rather than `application/services/`, which already holds service *classes*. One repository cannot have two folders named `services` meaning different things.
- **Data migration:** one migration creating `Service`. The table is new and empty, so there is no backfill and no lock hazard beyond a brief foreign-key lock on `Owner`. DDL travels over `DIRECT_URL` (session mode, 5432) while the runtime stays on transaction mode (6543) — `docs/s0-versions-decision.md`. Both Prisma clients regenerated; `prisma/seed.ts` reviewed against the second generator.
- **Runtime verification is not optional.** Two failures in this change are invisible to `next build` and to Vitest under Node: a `Decimal` reaching a Client Component, and `Intl.NumberFormat('es-AR', { currency: 'ARS' })` silently degrading to an `ARS 4500.00` fallback if `workerd`'s ICU is trimmed. Both are caught only by `npm run preview`.
- **Docs:** `docs/data-model.md` §6 must be updated **before** implementation per the spec-first policy (`base-standards.md` §7) — it currently states no uniqueness, normalization, precision or granularity rule for `Service`, all of which this change adds; §1 gains the `services` relation. Also `docs/frontend-standards.md` (route table), `docs/roadmap.md` (M3 ticked), `docs/tech-debt.md`.
- **Accepted risks, recorded rather than fixed:** the per-owner cap is advisory, since the count and the insert are separate round trips on a transaction-mode pooler (the shape already recorded as T13); T9 and T12 extend to a third table; and the blanket `P2002` → duplicate-name mapping is correct only while `Service` carries one unique constraint, which M4 changes — the same trigger already recorded as T15.
- **Deliberately not corrected here:** locations and barbers log raw driver error text with the same exposure this change fixes for services. Retrofitting them would alter the observable behaviour of two closed changes without updating their artifacts, which `base-standards.md` §7 forbids. It is recorded as debt with the trigger instead.
- **T10 reaches its third copy.** The "Nuevo servicio" call to action is the third link-styled-as-button, and T10's own trigger says to fix the anchor-background bug before the workaround is copied a third time. This change either closes T10 or re-defers it explicitly.
- **Downstream:** unblocks M4 directly, and B2/B3 through it. PC3 inherits an open question this change deliberately does not answer — a `price` of `0` is legal, but a `PERCENT` deposit of zero contradicts "a mandatory deposit confirms every booking".
