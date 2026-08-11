# Technical Debt & Deferred Work
## Reserva Barber

> Known work that was **deliberately deferred**, each with the reason and the signal that should
> bring it back. Anything not written down here does not exist — it becomes a surprise for whoever
> touches that code next.
>
> This is not a wish list. An entry earns its place by having a concrete trigger. When an item is
> done, delete it; when its trigger fires, it stops being debt and becomes work.

---

## Open

### T1 — Client-side recovery from a missing Server Action
**Status:** deferred · **Effort:** ~1–2 h · **Owner story:** none (cross-cutting)

Pinning `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` keeps Server Action ids stable across deploys, so the
`"Server action not found"` dead end should no longer occur in the normal workflow. Three cases remain
uncovered: **renaming an action, moving its file, or a build that ships without the key.** In any of
those, an already-open tab still meets an unrecoverable error screen.

The safety net is a client-side handler that recognises the error and reloads the page **once** —
turning a dead end into a flicker.

- **Where:** a `global-error.tsx` (the login page has no error boundary of its own today) plus the
  existing `app/(dashboard)/error.tsx`, sharing a tested predicate.
- **The hazard to design around:** a reload loop. If the error survives the reload, reloading again
  makes the app unusable — worse than the bug. Guard with a one-shot `sessionStorage` flag and cover
  the "already reloaded" path with a test.
- **Trigger:** any recurrence of `"Server action not found"` in production, or before shipping the
  public booking flow — whichever comes first.

### T2 — Password policy is documented but not enforced
**Status:** **needs a human** · **Effort:** ~2 min

`docs/data-model.md` §1 requires a 12-character minimum. That rule lives in Supabase, not in this
codebase, and **has not been applied yet**: Authentication → Policies → minimum password length.
Until then the provider's default (6) is what actually protects the only administrative account.

- **Trigger:** now. Nothing depends on it, which is exactly why it will be forgotten.

### T3 — Login UI behaviours not covered by the component tests
**Status:** partially closed by M1 · **Effort:** ~5 min in a browser

M1 installed React Testing Library + jsdom (design D4), which now covers the equivalent
behaviours **on the location forms**: pending-state disabling, `aria-live` + focus on the error
region, and value preservation after a rejection. The login page itself was not retested, and one
item cannot be covered by jsdom at all:

- **a failed login answers `200` with form state, never `401`** — this is a property of the HTTP
  response, which jsdom does not produce. It needs a real request (browser, `curl`, or the
  Playwright suite that was considered and declined in M1).

- **Trigger:** the next time the login page is touched for any reason, or if an E2E runner is ever
  added.

### T7 — The login form very likely clears the email on a failed attempt
**Status:** **needs a decision** · **Effort:** ~20 min

`openspec/specs/owner-authentication/spec.md` requires that after a failed login "the email value is
preserved, the password is cleared". M1 discovered that **React 19 resets an uncontrolled form once
its action resolves** — the location form lost both fields for exactly this reason, caught by the
first component test written against it (`LocationForm.test.tsx`). `app/login/LoginForm.tsx` uses the
same pattern: uncontrolled inputs plus `useActionState`. If the behaviour is identical there, A1
does not meet its own spec, and the `passwordResetKey` remount that clears the password is
redundant work guarding something React already does.

The fix is the one M1 applied: echo the submitted email back in the action's state and render it as
`defaultValue`.

- **Not fixed in M1** deliberately: it belongs to the `owner-authentication` spec, and changing
  shipped behaviour of a closed change without updating its artifacts would violate the spec-first
  policy (`docs/base-standards.md` §7).
- **Trigger:** confirm it in a browser first — one failed login answers the question. If confirmed,
  it is a bug against an existing requirement, not debt, and should be scheduled as its own change.

### T8 — Concurrent edits to the same location, barber or service silently overwrite each other
**Status:** accepted · **Effort:** ~2 h if it becomes real · **Last evaluated:** M3 (2026-08-09)

M1 ships no version column and no `updatedAt` precondition on the location update. M2 inherits the
same pattern for barbers, M3 for services. Two sessions editing the same row means the later save
discards the earlier one with a success message and no warning.

Re-evaluated during M2 (design D13) and re-accepted; re-evaluated again at M3 with the same
conclusion and nothing new to weigh — a fourth field on the form does not change the premise. It
still requires two concurrent editors, and "Exactly one Owner" forbids the second administrative
account that would produce them. Adding optimistic concurrency control here would cost more than the
failure it prevents.

**Re-evaluated at M4 (2026-08-10) — re-accepted, but only after the premise nearly broke.**
M4 introduces the first *set-valued* write, and the original reasoning ("costs a retyped name")
would not have survived it. Under a naive replace — removals computed as `stored − checked` — a
second tab would silently delete an assignment it never displayed, and the loss would be a service
quietly becoming unbookable: no error, no badge the owner is looking at, no audit trail. That is
categorically worse than a lost name.

The fix was design, not concurrency control. Removals are confined to the ids the form actually
rendered (`data-model.md` §7, design D3), which makes collateral deletion unreachable rather than
unlikely. What remains is a conflict over an id **both** views rendered, which is genuinely
last-write-wins and is the same exposure M1–M3 already carry. So no version column here either.

- **Trigger:** a second `Owner` row becomes possible, or story D3 (per-barber calendar) where a
  stale overwrite starts costing appointments rather than a retyped name. **Also:** any future
  set-valued write that cannot carry a rendered baseline — the exemption above is specific to
  being able to bound removals by what was displayed.

### T10 — No background utility resolves on an `<a>` element
**Status:** **needs investigation — re-deferred at M3** · **Effort:** ~1 h to diagnose, unknown to fix · **Last evaluated:** M3 (2026-08-09)

Verified in the browser during M1: `bg-primary` and `bg-muted` paint a `<div>` and a `<span>`, and
**never** an `<a>` — the anchor computes `background-color: rgba(0,0,0,0)` with the class present in
its `classList`. The first casualty was M1's "Nueva sucursal" call to action, which rendered as dark
text on a dark background (`text-primary-foreground` resolved, the background did not) and was
effectively invisible.

Root cause not found. No rule in any readable stylesheet gives an anchor a background or suppresses
one, and the `.bg-primary` rule itself is not enumerable from the page — so the stylesheet that
defines it is not fully accessible to the inspecting extension. That is where the next attempt should
start: read the generated CSS from the build output rather than from the live DOM.

**Worked around in M1**, not fixed: the create control puts the variant classes on an inner `<span>`
inside the `<Link>`. Any future link-styled-as-button hits the same wall.

**M3 evaluation (one hypothesis eliminated, decision to re-defer).** M3 is the third copy of the
workaround, which this entry previously said not to allow. It was allowed anyway, deliberately, and
here is what changed and why:

- **Falsified:** `app/globals.css` contains **no anchor rule of any kind** — no `a { background… }`,
  no reset suppressing it. The "something in a readable stylesheet suppresses anchor backgrounds"
  hypothesis is dead and the next investigation should not re-walk it.
- **What that leaves:** either the generated Tailwind output (read `.next/static/css/*.css` directly,
  as this entry already suggested), or **the original observation itself**. `bg-primary` on a `<span>`
  and on an `<a>` resolve to the same generated rule; for one to paint and the other not, something
  must override it, and nothing in the project does. An artifact of the inspecting extension is now a
  live possibility that was not considered when this was filed. **Re-verify the symptom before
  hunting the cause** — that is a five-minute check, not an hour.
- **Why re-deferred rather than fixed:** the fix is bounded by a diagnosis that needs a browser, and
  M3's remaining risk sits in money handling, not in a call-to-action's colour. Spending unbounded
  time here would trade a real risk for a cosmetic one.

- **Trigger:** **now, and no later than P1** — its public profile is a page where a button that looks
  broken is the first thing a client sees, not a dashboard control only the owner meets. Start with
  the re-verification above, not with the CSS.

### T11 — Cross-owner isolation has no executable proof
**Status:** **needs a test when it becomes possible** · **Effort:** ~1 h

Ownership scoping is the security boundary of the whole dashboard: `findByIdForOwner`, the scoped
`update`, and every list query carry `ownerId` so another owner's row resolves as not-found. All of
it is asserted **only by unit tests against a mocked Prisma client**, which verify the *shape of the
call* — that `ownerId` appears in the `where` — not that Prisma actually honours a compound
predicate on `update`.

It cannot be proven end-to-end today, and that is not an oversight: `data-persistence` → "Exactly one
Owner" forbids a second `Owner` row, and no application path may create one. With a single owner
there is no exposure — every row belongs to the only owner there is. The gap is in the *assurance*,
not in the behaviour.

**Narrowed at M3 (2026-08-09).** An adversarial pass ran the scoping predicate against the real
database rather than a mock: `update({ where: { id, ownerId } })` with a foreign owner raises `P2025`
and leaves the row untouched, `findFirst` with a foreign owner returns `null`, and the same update
with the correct owner applies. Recorded in `docs/s0-versions-decision.md`. So **the mechanism is now
proven** — Prisma does honour the extra scalar predicate. What remains unproven is isolation between
two *real* owners, which is what this entry is actually about, and that still needs a second `Owner`.

**Narrowed again at M4 (2026-08-10).** M4 introduces the first relation whose ownership rule the
database *cannot* express — `BarberService` joins a `Barber` (ownership derived through `location`)
to a `Service` (ownership stored), with no shared column for a composite key. `scripts/m4-gate.ts`
probes D and E prove against the real database that the join predicate
`barber.location.ownerId` genuinely filters: a foreign owner reads zero rows and deletes zero rows.

One asymmetry is now explicit rather than latent: the **insert** cannot be scoped at all.
`createMany` is a raw multi-row insert admitting no relation filter, so the foreign keys prove only
that both ids exist, never that they agree about the owner. `BarberServiceAssignmentService` is the
entire guarantee there, which is why it must remain the table's only writer.

- **Trigger:** the moment a second `Owner` becomes possible — multi-tenancy, a dedicated test project
  with its own owner, or any change that relaxes "Exactly one Owner". Before that ships, add an
  integration test against a real database with two owners covering: list scoping, a foreign id
  resolving to `null`, a scoped update affecting zero rows, and **a cross-owner assignment writing
  zero rows**.

### T12 — A double submit can report a successful creation as a duplicate
**Status:** accepted — **now observed, no longer theoretical** · **Effort:** ~1 h if it becomes real

Applies to **locations** (`(ownerId, name)`), **barbers** (`(locationId, displayName)`) and **services** (`(ownerId, name)`). The spec claims the second of two rapid submissions "does not present the successful outcome as a failure". Data integrity is never at risk — the constraint guarantees exactly one row. But when two identical creates race **before hydration** (so the disabled-submit state does not yet exist), one wins and the other is rejected by the constraint, rendering "Ya tenés una sucursal con ese nombre", "Ya tenés un barbero con ese nombre" or "Ya tenés un servicio con ese nombre." The owner created a row and may be told it already exists.

**Reproduced in M3 (task 10.20).** Two native form submissions dispatched in the same tick through
separate iframes, so no pending-state guard could exist between them:

```
POST /servicios/nuevo 303   ← winner, redirected
POST /servicios/nuevo 200   ← loser, returned form state
rows in database: 1
```

Data integrity held exactly as claimed. The losing response is the one that carries the misleading
duplicate message. Earlier entries said "which response the browser commits before hydration is a
race" — it is not a race in the sense of being unpredictable: **the loser reliably gets the duplicate
error**, and the only open question is whether the user is looking at that tab.

A candidate fix is to treat a constraint violation on create as success when the existing row already
matches what was submitted, redirecting instead of erroring. That deserves thought before it is
written: it makes "create" quietly idempotent, which is helpful here and would be wrong elsewhere.

- **Trigger:** any report of that message appearing right after a successful create — or the arrival
  of the public booking flow (B4–B6), where the same double-submit shape carries a deposit and the
  stakes stop being cosmetic.

### T9 — Case-variant names can both survive a race
**Status:** accepted · **Effort:** ~30 min per table

Applies to **locations** (`(ownerId, name)` unique index), **barbers** (`(locationId, displayName)` unique index) and **services** (`(ownerId, name)` unique index). The case-insensitive duplicate pre-check runs in the application in a separate round trip (location design D2, barber design D9, service design D9). Two submissions of "Centro" and "centro", "Pedro" and "pedro", or "Corte" and "corte", interleaving closely enough can both be accepted.

The airtight fix is a unique index on the lowercased column; rejected because Prisma cannot express
an expression index in `schema.prisma` and every later `prisma migrate dev` would report drift that
is not drift.

- **Trigger:** a second `Owner`, or any report of duplicate-looking rows in production.

### T18 — The barbers list overflows horizontally on a long unbroken name
**Status:** **confirmed defect against a shipped requirement** · **Effort:** ~2 min · **Found:** M3 (2026-08-09)

`openspec/specs/barber-management/spec.md` → "Long free text renders without breaking the layout"
requires that "Long unbroken names and bios MUST wrap rather than overflow horizontally". **They do
not.** Measured in the browser at a 360 px container with a 124-character unbroken display name:

```
mainClientWidth: 360   mainScrollWidth: 1113   overflows: true
```

**Cause** (diagnosed while fixing the identical bug in M3's services list). The card title is
`<CardTitle className="flex items-start justify-between gap-3">` wrapping
`<span className="break-words">`. A flex item defaults to `min-width: auto` and refuses to shrink
below its content's intrinsic width, so `break-words` never gets the opportunity to act. Clearing it
on the span alone is **not** enough — the title is itself a grid item inside `CardHeader`, so both
levels need it.

**Fix**, already applied and verified in `app/(dashboard)/servicios/page.tsx`:

```diff
-<CardTitle className="flex items-start justify-between gap-3">
-  <span className="break-words">{…}</span>
+<CardTitle className="flex min-w-0 items-start justify-between gap-3">
+  <span className="min-w-0 break-words">{…}</span>
```

**Not fixed in M3** deliberately: it belongs to the `barber-management` spec, and changing shipped
behaviour of a closed change without updating its artifacts violates `docs/base-standards.md` §7 —
the same reasoning that left T7 open. M2's task 10.19 recorded this scenario as verified, so the
check that was performed did not use an unbroken name.

- **Trigger:** now — it is a two-token fix against a requirement that already exists, and it should
  ship as its own small change rather than riding along in an unrelated one. Also re-check the
  `sucursales` list, which was not measured.

### T4 — Owner email hardcoded in a committed migration
**Status:** **needs a decision** · **Effort:** ~0 (accept) or ~30 min (parameterise)

`prisma/migrations/*_add_owner_and_location_fk/migration.sql` contains the owner's real address, and
the repository is on GitHub. Impact is limited — the same address already appears as the author of
every commit — and changing it now needs a fresh migration because the row exists in production.

- **Trigger:** if the repository is public **and** the address should not be. Otherwise close this as
  accepted.

### T5 — Development still runs on Windows
**Status:** deferred · **Effort:** ~1 h

OpenNext states plainly that Windows is not fully supported, and this project has already paid for it
twice: builds fail without Developer Mode, and `patches/@opennextjs+cloudflare+1.20.1.patch` exists
solely to fix a Windows path-separator bug (`docs/s0-versions-decision.md`, findings 1–3). **A patched
dependency is a standing liability** — the next adapter upgrade may silently break it.

Moving development to WSL removes that entire class of problem and lets the patch be deleted. It also
matches how the code is actually built for production, which is Linux.

- **Trigger:** an `@opennextjs/cloudflare` upgrade, or the next Windows-only build failure.
- **Note:** the project must live in the Linux filesystem (`~/…`), not under `/mnt/c/…` — crossing
  filesystems makes installs and builds several times slower.

### T13 — Per-location barber cap is advisory, not guaranteed
**Status:** accepted · **Effort:** ~1–2 h if it becomes real

`BarberService` rejects a create when `count >= MAX_BARBERS_PER_LOCATION` (= 50). That count is read in a separate query from the insert (design D8), so two concurrent creates can both observe `count = 49` and both write, producing 51 barbers. The constraint that would prevent it — a `CHECK (count(*) <= 50)` deferrable constraint — cannot be expressed in Prisma schema, and requires a raw migration that wrangler's Prisma shadow-database setup makes harder to maintain.

Accepted because: 50 is a ceiling no real barbershop approaches; the advisory check still stops accidental over-creation; and zero-database-call enforcement at the app layer (advisory lock, serializable isolation) costs more than the failure it prevents with a single owner.

- **Trigger:** any confirmed report of a location exceeding 50 barbers, or the arrival of multi-owner tenancy where competing concurrent creates are a realistic scenario.

### T14 — Reassigning a barber retroactively rewrites derived booking history
**Status:** deferred · **Effort:** unknown until booking model is defined

`BarberService.updateBarber` allows moving a barber from one location to another. At zero bookings (the current state) this is harmless. Once bookings exist, a reassignment silently changes which location every past appointment is associated with through the barber row — breaking per-location statistics and any location-filtered booking history query.

The scope of the fix depends on what the booking model looks like: it may require either snapshotting the `locationId` into the `Booking` row at creation time, or refusing reassignment when the barber has any booking history.

- **Trigger:** story B4 (barber booking history) or any story that queries bookings filtered by location, whichever comes first.

### T15 — Unqualified `P2002` violation translates as duplicate name, on two tables now
**Status:** deferred · **Effort:** ~30 min · **Last evaluated:** M3 (2026-08-09)

`BarberCatalogService.createBarber` catches `P2002` (unique constraint violation) and throws `DuplicateBarberNameError`; `ServiceCatalogService` does the same with `DuplicateServiceNameError`. Today each table carries exactly one unique constraint — `Barber(locationId, displayName)` and `Service(ownerId, name)` — so both translations are always correct. M4 adds `BarberService(barberId, serviceId)`, which touches **both** aggregates; from that point on, a violation on an unrelated constraint would produce "Ya tenés un barbero con ese nombre" or "Ya tenés un servicio con ese nombre" when the actual conflict is the assignment.

M3 deliberately reproduced the same unqualified mapping rather than reading `error.meta.target`: doing that would drag Prisma's error shape into the application layer, which is precisely what the structural check exists to avoid. The fix belongs with M4, which is when a second constraint first exists.

**Re-audited at M4 (2026-08-10) — the bound holds, and is now enforced rather than assumed.**
`BarberService(barberId, serviceId)` exists as of M4, so a second unique constraint is live. Both
translations nevertheless remain correct, and deliberately **not** because anyone remembered to be
careful:

- Assignments are written through `PrismaBarberServiceRepository`, never nested inside a `Service` or
  `Barber` write, so no violation from that table can surface inside either catalogue service.
- The assignment insert requests `skipDuplicates`, so a `(barberId, serviceId)` violation is not
  raised at all — the failure mode the entry predicted cannot occur even in principle.
- `BarberServiceAssignmentService.test.ts` asserts a `P2002` reaching the assignment path propagates
  untouched rather than becoming `DuplicateServiceNameError` or `DuplicateBarberNameError`.

Reading `error.meta.target` to qualify the translation was re-rejected for the reason M3 gave: it
drags Prisma's error shape into the application layer, which is what the boundary exists to prevent.

- **Trigger:** any change that nests an assignment write inside a barber or service write, or a
  migration adding a **second reachable** unique constraint to `Barber` or `Service` themselves.
  The M4 trigger is discharged.

### T19 — Per-owner service cap is advisory, not guaranteed
**Status:** accepted · **Effort:** ~1–2 h if it becomes real · **Added:** M3 (2026-08-09)

`ServiceCatalogService` rejects a create when `countActiveByOwner >= MAX_SERVICES_PER_OWNER` (= 50). The count is read in a separate round trip from the insert against a transaction-mode pooler (design D8), so two concurrent creates can both observe 49 and both write, producing 51 active services. Identical mechanism to T13; the fix is blocked for the same reason (Prisma cannot express a count constraint, and a raw migration would show as permanent drift).

The count deliberately excludes inactive rows. Counting every row would mean that once M6 ships deactivation, an owner who deactivated 50 services would be **permanently unable to create another**, with no remedy anywhere in the application. Verified in M3 task 10.18: at 50 active the create is refused; deactivating one row makes the same submission succeed.

- **Trigger:** any confirmed report of an owner exceeding 50 active services, or multi-owner tenancy.

### T20 — Location and barber write paths still log raw driver error messages
**Status:** **known gap, deliberately not closed in M3** · **Effort:** ~15 min · **Added:** M3 (2026-08-09)

A PostgreSQL unique violation embeds the offending values in its message — `Key (ownerId, name)=(owner-root, Corte Clásico) already exists`. M3 added `toErrorLogContext()` (design D11), which logs the driver **code** and the operation for recognized constraint violations and never the message, so business data cannot reach the log stream and a name containing quotes or newlines cannot forge fields in structured log output. Unrecognized errors keep their message, because a failure stripped of its detail cannot be diagnosed.

`app/(dashboard)/sucursales/actions.ts` and `app/(dashboard)/barberos/actions.ts` still log `error.message` verbatim and have the exposure M3 fixed for services.

**Not fixed in M3** deliberately: retrofitting it would alter the observable behaviour of two closed changes without updating their artifacts, which `docs/base-standards.md` §7 forbids. The fix is mechanical — import the helper and replace the `cause:` line in each `toFailureState`.

- **Trigger:** the next change that touches either actions file for any reason, or the first time logs are shipped anywhere they can be read by someone who should not see the owner's data.

### T21 — `skipDuplicates` becomes silent update-discarding if the assignment row ever gains a field
**Status:** accepted · **Effort:** ~1 h when triggered · **Added:** M4 (2026-08-10)

`PrismaBarberServiceRepository.setForBarber` inserts with `skipDuplicates: true`. Today that is
exactly right: `BarberService` carries no mutable column, so a re-inserted row is the same intent
expressed twice — a double click or a retried timeout — and absorbing it is what makes the write
idempotent. It is also what keeps T15's translations bounded.

The day the row gains a mutable field — a per-barber price or duration override is the plausible
one — the same flag stops meaning "tolerate a re-submission" and starts meaning "silently discard
the update". The write would report success and change nothing, which is the worst shape a data bug
can take. The replacement is a per-row `upsert` inside the same batch array (never a sequence of
awaited writes, per design D4).

This is recorded rather than pre-solved because writing an upsert now would add a code path with no
caller and imply the row has state it does not have.

- **Trigger:** the first migration that adds any column to `BarberService` beyond `createdAt`.

### T22 — The assignment cap can lock an owner out of their own editor
**Status:** accepted — **latent, becomes reachable at M6** · **Effort:** ~30 min · **Added:** M4 (2026-08-10, adversarial review)

`barberServicesSchema` rejects a submission whose id list exceeds `MAX_SERVICES_PER_OWNER` (50). But that constant counts **active** services only (T19), while the editor renders `assignable = active ∪ already-assigned`. An owner sitting at 50 active services with any deactivated-but-still-assigned service therefore renders more than 50 baseline inputs, and their own form is rejected as `too_many` — **that barber can never be saved again, with no remedy anywhere in the application.**

Identical in shape to the mistake T19 documents: two rules disagreeing about what "the cap" counts. The fix is to bound both lists by the size of the assignable set rather than by the active-service cap.

Unreachable today because service deactivation does not exist. The requirement "The submitted set is bounded before any database read" in `openspec/specs/barber-service-assignment` states the flawed rule and must be amended with the code.

- **Trigger:** M6 (service deactivation), or any change that lets total services exceed the active cap.

### T23 — Bookability is reported per service, not per (service, location)
**Status:** deferred — **the decision half is closed, the modelling half is not** · **Effort:** ~2 h · **Added:** M4 (2026-08-10, adversarial review) · **Half-closed:** M4a (2026-08-11)

**Closed at M4a: a closed branch now suppresses bookability.** The original question — whether a barber at a deactivated location should count — is answered **no**. The booking flow selects a location first (B2), so a barber at a closed branch is unreachable by any booking, and a dashboard that called such a service bookable was asserting revenue that could not be earned. `countActiveBarbersByService` now requires `barber.location.isActive`, the `service-catalog` requirement is normative rather than provisional, and `scripts/m4a-gate.ts` proves the predicate discriminates against the real database.

**Still open: the unit of bookability is wrong.** Because the client picks a branch before a service, the honest unit is the **(service, location) pair**, not the service. A service with active barbers at Centro and none at Norte is bookable at Centro and dead at Norte, and the dashboard reports a single "bookable" that hides the second half. The owner cannot see that a branch offers nothing.

Not modelled now because B2 has not defined how it presents services per branch, and building a per-location dashboard against a spec that does not exist is designing for an imagined consumer. The aggregate already groups by `serviceId`; extending it to `(serviceId, locationId)` is mechanical once B2 fixes the shape.

- **Trigger:** B2 (public location → service → barber selection).

`countActiveBarbersByService` filters `barber.isActive` but not `barber.location.isActive`, so a service performed only by barbers at a **deactivated branch** is presented as bookable on the dashboard.

This is an underspecification, not a contradiction: `data-model.md` §6 says "at least one assigned **active** barber" and is silent about the location. But M2 deliberately ruled that a barber may *remain* at an inactive location, so the state is live rather than hypothetical — and B2 will inherit whichever answer is frozen here.

The question is a product one and has not been answered: **should a closed branch suppress bookability?** It is recorded as undecided rather than resolved by whichever behaviour the code happens to have.

- **Trigger:** B2 (public service/barber selection) at the latest, or the first location deactivation with assigned barbers.

### T24 — The editor's empty state states something false when every service is inactive
**Status:** accepted · **Effort:** ~15 min · **Added:** M4 (2026-08-10, adversarial review)

`COPY.barberServices.emptyNoServices` reads "Antes de asignar servicios, creá al menos uno en el catálogo". It renders whenever the assignable set is empty — which includes the case where the owner **has** services and all of them are inactive and unassigned. The message then tells the owner to create something they already have.

Fix is to branch the empty state on "no services at all" versus "none currently assignable". Same M6 trigger as T22.

- **Trigger:** M6 (service deactivation).

### T25 — The assignment route parameter is decorative for the write
**Status:** accepted · **Effort:** ~30 min · **Added:** M4 (2026-08-10, adversarial review)

`setBarberServicesAction` reads `barberId` from a hidden form field, not from the route segment, so a payload can name a different barber than the URL displays. This is **not** a tenancy hole — `findByIdForOwner` still scopes it to the session owner — and it is the ordinary shape of a Server Action, which receives no route params.

What is unrecorded is whether that mismatch is intended. Today a crafted payload silently edits a different barber the owner owns, and no scenario says whether that should be honoured or refused.

- **Trigger:** a second administrative user (which would make the mismatch a privilege question rather than a UX one), or any report of an edit landing on the wrong barber.

### T26 — The service duplicate-name pre-check can miss a row once services exceed the active cap
**Status:** accepted · **Effort:** ~15 min · **Added:** M4 (2026-08-10, adversarial review) · **Origin:** M3

`PrismaServiceRepository.existsByOwnerAndName` reads with `take: MAX_SERVICES_PER_OWNER`, but that constant counts active services only while the query is unfiltered by `isActive`. Once total services exceed 50, the pre-check can read a truncated set and miss a genuine duplicate.

Impact is bounded: the database's `@@unique([ownerId, name])` remains the authoritative guarantee (M3 design D9), so the outcome is a worse error message — the generic infrastructure message instead of a readable field error — never a duplicate row.

Same root cause as T22: a cap that counts active rows being used to bound a query over all rows.

- **Trigger:** M6 (service deactivation), together with T22.

### T27 — One window per day cannot express a split shift, and slot generation will offer the break
**Status:** accepted — **known product gap, not an oversight** · **Effort:** ~3 h · **Added:** M5a (2026-08-11)

The owner chose a single continuous window per weekday. The common local pattern is a split shift — 9–13 and 16–20 — and a barber who works one must enter 9–20. Slot generation will then offer appointments at 14:00 with the shop closed: the client books, pays a deposit, and nobody is there.

The defect surfaces in the availability story, not here, but it is created here and must not be discovered there. `data-model.md` §8 previously permitted multiple non-overlapping windows for exactly this reason.

**The schema is deliberately left capable.** The unique constraint is `(barberId, dayOfWeek, startMinute)` rather than `(barberId, dayOfWeek)`, so restoring the second window is a UI change plus re-enabling an overlap validation — **no migration over live data**. The cost of keeping it open is one column in an index.

- **Trigger:** the first barber who works a split shift, or B3 — whichever comes first. B3 must not ship assuming a single window is sufficient.

### T28 — "Every day has 1440 minutes" is an assumption, not a fact
**Status:** accepted · **Effort:** ~2 h if it becomes real · **Added:** M5a (2026-08-11)

Working hours are stored as minutes from midnight, and all-day ranges are computed as local midnight to local midnight. Both are exact only while the business's timezone has no daylight saving. Argentina has observed none since 2009, so this is correct today rather than approximately correct.

If DST returns, three things break together and must be revisited as one: a day is 23 or 25 hours rather than 1440 minutes, `BUSINESS_UTC_OFFSET_MINUTES` stops being a constant, and a window spanning the transition shifts by an hour. The conversion module already computes the offset per instant rather than assuming it, so the code path is prepared; the assumptions around it are not.

- **Trigger:** Argentina reinstating daylight saving, or a location outside the current timezone.

### T29 — Editing a schedule retroactively strands existing bookings
**Status:** deferred · **Effort:** unknown until the booking model exists · **Added:** M5a (2026-08-11)

Saving a schedule replaces the barber's week wholesale. Once bookings exist, narrowing or removing a window leaves confirmed appointments outside working hours, and nothing detects or reports it. At zero bookings — the current state — this is harmless.

Same shape as T14 (barber reassignment rewriting derived history): the fix depends on what the booking model looks like, and may be either a warning that names the affected appointments or a refusal to narrow a window that has bookings inside it.

- **Trigger:** B4 (booking creation), or any story that queries bookings against working hours.

### T16 — Session expiry during long free-text entry silently discards up to 500 characters
**Status:** accepted · **Effort:** ~2–4 h (server-sent draft save or client-side autosave) · **Last evaluated:** M3 (2026-08-09)

`requireOwner()` redirects to `/login?next=…` when the session expires. If the owner was mid-way through typing a 500-character barber bio **or service description**, the redirect discards it. React 19 resets uncontrolled forms on resolve, so even a rejected submit clears the field unless the action echoes it back — which it does, but an expired session never reaches the action.

M3 adds a second field of the same size and does not change the mechanism. It does slightly raise the cost: a service form carries four fields the owner must retype, against three on the barber form.

Accepted because: the session lifetime is long relative to the time to type 500 characters; no data loss occurs beyond a single form field; and autosave infrastructure (draft table, SSE, or `localStorage`) costs far more than the failure it prevents.

- **Trigger:** a confirmed user complaint about lost bio text, or the arrival of a rich-text or multi-step form where the loss is more expensive.

### T17 — Unauthenticated Server Action POSTs are not rate-limited or metered
**Status:** accepted · **Effort:** ~2–4 h (Cloudflare rate-limiting rule or middleware throttle)

`requireOwner()` short-circuits at `!user` and returns an error state without making any database call. This means the create and edit Server Action routes accept unlimited unauthenticated POSTs at zero database cost, but they still consume CPU and egress on the Worker. An attacker who discovers the action endpoint can submit it in a tight loop.

Accepted because: the dashboard routes are not publicly linked; Cloudflare Workers enforces a 10 ms CPU-time soft limit per request; the free tier's 100k daily requests provides implicit throttling; and the payoff of a dedicated rate-limiting rule is low before the app has real traffic.

- **Trigger:** any observed spike in unauthenticated action POSTs, or the arrival of the public booking flow (B4–B6) where the action endpoints become implicitly discoverable.

### T6 — Platform decision: Cloudflare vs Vercel
**Status:** **decided — stay on Cloudflare**, revisit on trigger

Evaluated on 2026-08-05 after repeated infrastructure friction. Staying, because the strongest argument
for migrating — deployment skew breaking Server Actions — turned out to be solvable on Cloudflare for
free, and because Cloudflare's free tier permits commercial use while Vercel's Hobby plan does not
(this app charges deposits, so Vercel would cost ~US$20/month, against a documented ~$0 budget).
Vercel Hobby is additionally unable to run story **B7**, whose cron must fire every few minutes.

Revisit if **any** of these happens:

- deployment skew recurs in production **with the key pinned**
- an adapter upgrade breaks the build and the patch no longer applies
- the Mercado Pago webhook flow hits a `workerd` limitation
- two consecutive stories spend more time on infrastructure than on product

That last one is the honest criterion: for a solo developer, velocity is the scarcest resource.

---

## Closed

### T18 — The barbers list overflows horizontally on a long unbroken name
**Closed:** M4 (2026-08-10) · **Was:** confirmed defect against a shipped requirement

Fixed exactly as the entry prescribed — `min-w-0` on both `CardTitle` and its inner `<span>` in
`app/(dashboard)/barberos/page.tsx`. M4 was the right moment rather than an unrelated ride-along:
this change adds the assigned-service count to that same title row, so it touches the defect's
own markup and updates the `barber-management` spec in the same breath, which is what
`base-standards.md` §7 asks for.

The `sucursales` list named at the end of that entry was **not** measured and remains unchecked —
carried forward as the remaining scope, not silently closed with the rest.

### T20 — Location and barber write paths still log raw driver error messages
**Closed for barbers:** M4 (2026-08-10) · **Still open for locations**

`app/(dashboard)/barberos/actions.ts` now logs through `toErrorLogContext(operation, error)`, so a
recognized constraint violation records the driver code and the operation and never the message that
embeds the submitted display name. The trigger this entry named — "the next change that touches
either actions file for any reason" — is exactly what happened.

`app/(dashboard)/sucursales/actions.ts` is unchanged and still has the exposure. M4 has no reason to
open that file, and editing a closed change's behaviour without touching its artifacts is what §7
forbids. **The original trigger still stands for it.**
