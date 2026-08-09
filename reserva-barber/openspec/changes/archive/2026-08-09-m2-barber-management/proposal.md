## Why

A barbershop with no barbers cannot take a booking. M1 gave the owner locations they can create and edit; M2 is the story that puts people in them, and it gates everything downstream — M4 assigns services to a barber, M5 gives that barber a schedule, B2 asks the client to pick one. Until it ships, `docs/data-model.md` §5 describes an entity that does not exist in `prisma/schema.prisma`.

It is also the first entity in this project whose **ownership is derived rather than stored**. A `Barber` has no `ownerId`; it belongs to the owner only through `location.ownerId`. Every dashboard resource that arrives after this one — services, working hours, bookings, clients — is reached through a parent the same way, so the scoping pattern established here is the one they all repeat. Getting it wrong once is getting it wrong five times.

## What Changes

- Add a dashboard section at `/barberos` where the owner lists, creates and edits barbers, each assigned to exactly one of their own locations, with reassignment allowed on edit.
- Add the `Barber` model, its migration, and `@@unique([locationId, displayName])` — two barbers named "Juan" at the same branch are indistinguishable in B2's picker, while the same name recurring across branches is legitimate.
- **Make ownership structural for a derived-ownership entity**: every barber read and write carries the owner *through the relation* (`where: { location: { ownerId } }`). Denormalizing `ownerId` onto `Barber` is rejected — it duplicates a fact the foreign key already carries and can drift on reassignment.
- Enforce that a barber can never be **moved into** an inactive location, while always being allowed to **stay** in one. The exemption is resolved against the barber's stored location, never against a value echoed by the form — a `currentLocationId` field in the payload would hand the caller the operand of its own security check.
- Extract name normalization into one shared domain helper (M2 is its second consumer) and extend it to strip **bidirectional control characters**, which today survive `Location.name` and reverse the rendering of surrounding text. **BREAKING** for `location-management`: its normalization requirement gains a rule, and names already stored containing those characters would normalize differently on next save.
- Add a per-location cap on barbers, since M2 ships create and edit but neither delete nor deactivation (M6).
- Resolve tech-debt **T8**, whose recorded trigger is this story.
- Do **not** ship: `isActive` control (M6), `avatarUrl` upload (P1 owns Supabase Storage setup), service assignment (M4), working hours (M5), any public rendering of a barber (B2), deletion.

## Capabilities

### New Capabilities

- `barber-management`: The owner registers barbers and assigns each to one of their own locations — validation and name normalization, uniqueness per location, ownership enforced through the location relation on every read and write, the inactive-location assignment rule, the per-location cap, reassignment, and the Spanish (es-AR) states of both forms including the case where no location exists yet.

### Modified Capabilities

- `data-persistence`: adds the `Barber` model with its unique constraint, its `(locationId, isActive)` index, and `onDelete: Restrict` on the location relation. Establishes that an entity whose ownership is derived is queried through its parent relation, and that its repository contract takes `ownerId` as a required parameter exactly as a directly-owned entity does.
- `location-management`: name normalization becomes a shared domain rule rather than a location-specific one, and gains the removal of bidirectional control characters. The requirement text moves from "location names are normalized" to a rule the location schema consumes, with identical observable behaviour except for the new class of stripped characters.

## Impact

- **Code (new):** `app/(dashboard)/barberos/{page,actions,formState,BarberForm,loading,not-found}.*`, `.../nuevo/page.tsx`, `.../[id]/editar/page.tsx`; `src/server/domain/models/{Barber,normalizeName}.ts`; `src/server/domain/errors/BarberErrors.ts`; `src/server/domain/repositories/IBarberRepository.ts`; `src/server/application/barbers/barberSchema.ts`; `src/server/application/services/BarberService.ts`; `src/server/infrastructure/prisma/PrismaBarberRepository.ts`.
- **Code (modified):** `prisma/schema.prisma`, `src/server/domain/models/Location.ts` (normalization extracted), `src/server/application/locations/locationSchema.ts` (imports the shared helper), `src/lib/copy.ts`, `app/(dashboard)/layout.tsx` (navigation).
- **UI primitives:** `src/components/ui/` holds only `button`, `card`, `input`, `label`. This change adds a `textarea` primitive and hand-styles a **native** `<select>` — Radix's `Select` renders no form-associated control and would break the house pattern's promise that the form submits before hydration and without JavaScript.
- **Data migration:** one migration creating `Barber`. Creating a table is not a lock hazard, but the foreign key briefly locks `Location`. DDL travels over `DIRECT_URL` (session-mode pooler, port 5432) while the runtime stays on transaction mode (6543) — `docs/s0-versions-decision.md`. Both Prisma clients regenerated.
- **Docs:** `docs/data-model.md` §5 (derived ownership, uniqueness, normalization, `onDelete`), `docs/frontend-standards.md` (route table), `docs/tech-debt.md` (T8 decided; T9/T12 extended to barbers; new entries for the advisory cap, reassignment rewriting derived booking history, the `P2002` blanket mapping, and unauthenticated action-POST cost), `docs/roadmap.md` (M2 ticked).
- **Accepted risks, recorded rather than fixed:** the per-location cap is advisory — four round trips on a transaction-mode pooler with no database constraint behind the count, so concurrent creates can exceed it by one; and reassigning a barber silently rewrites the derived location of that barber's historical bookings, harmless at zero bookings and not at B4.
- **Downstream:** unblocks M4 and M5 directly, B2 through them. `Barber` is also where M4's `BarberService` will attach, which is why the blanket `P2002` → duplicate-name mapping needs a recorded trigger before a second unique constraint touches barber writes.
