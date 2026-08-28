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

### T8 — Concurrent edits to the same location, barber, service or schedule silently overwrite each other

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
M4 introduces the first _set-valued_ write, and the original reasoning ("costs a retyped name")
would not have survived it. Under a naive replace — removals computed as `stored − checked` — a
second tab would silently delete an assignment it never displayed, and the loss would be a service
quietly becoming unbookable: no error, no badge the owner is looking at, no audit trail. That is
categorically worse than a lost name.

The fix was design, not concurrency control. Removals are confined to the ids the form actually
rendered (`data-model.md` §7, design D3), which makes collateral deletion unreachable rather than
unlikely. What remains is a conflict over an id **both** views rendered, which is genuinely
last-write-wins and is the same exposure M1–M3 already carry. So no version column here either.

**Extended at M5a1 (2026-08-11).** The entry never named **working hours**, which M5a added with a
whole-week replacement: a stale tab reinstates its own snapshot of all seven days over whatever a
second tab saved. This is _not_ the collateral-deletion class M4 had to solve — the schedule form
renders every day, so nothing is removed that was never displayed — it is plain last-write-wins on
values, the same exposure the scalar forms carry. Re-accepted on the same reasoning, and named here
so the next set-valued write does not have to rediscover which class it belongs to.

- **Trigger:** a second `Owner` row becomes possible, or story D3 (per-barber calendar) where a
  stale overwrite starts costing appointments rather than a retyped name. **Also:** any future
  set-valued write that cannot carry a rendered baseline — the exemption above is specific to
  being able to bound removals by what was displayed.

### T10 — No background utility resolves on an `<a>` element

**Status:** **CLOSED at P1 (2026-08-12) — never a defect in this application** · **Resolution:** the three workarounds were deleted; see the closing note at the end of this entry

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

**P1 (2026-08-12) — MECHANISM FOUND. The symptom is real; the cause is almost certainly not this
application.** Status moves from "needs investigation" to "needs one 30-second confirmation".

Re-verified first, as this entry asked. The symptom **does reproduce**: a `<Link>` carrying
`buttonVariants()` renders as dark text on a dark background. So the "artifact of the inspecting
extension" hypothesis is dead in its original form — but a sharper version of it is now the answer.

What was measured, in `next dev`, on a real anchor:

- `bg-primary` computes `rgba(0,0,0,0)` on an `<a>`, and `rgb(237,237,237)` on a fresh `<div>`,
  `<span>` **and** `<button>` carrying the identical class. So the utility works; anchors are singled
  out.
- Not about `href` (an `<a>` with none behaves the same), not `:visited`, not the cva string — a bare
  `class="bg-primary"` is enough. An inline `style` on the same anchor paints normally, so nothing is
  blocking paint.
- Every other utility in the same string resolves: `h-9` gives 36px, `text-primary-foreground` gives
  the right colour.
- **The decisive test.** Injecting `a.bg-primary{background-color:rgb(9,9,9)}` **unlayered** wins and
  paints. The _same rule_ inside `@layer utilities` loses and stays transparent.

That is the whole mechanism: **something unlayered sets `background-color` on anchors, and unlayered
CSS beats anything inside a cascade layer regardless of specificity.** Tailwind v4 emits every
utility into `@layer utilities`, so `bg-*` on an `<a>` cannot win — no amount of specificity would
help, which is why nothing in the project looked like the culprit.

The overriding rule is **in no stylesheet the page can enumerate**: a deep walk of
`document.styleSheets` (descending through `@layer`, `@media`, `@supports`) finds no anchor
background rule, and `document.adoptedStyleSheets` is empty. CSS injected by a browser extension via
`chrome.scripting.insertCSS` behaves exactly like this — it applies, it is unlayered, and it is
invisible to page JavaScript. The page also carries a `data-styled` (styled-components) `<style>`
element that this project does not use, which is independent evidence that something is injecting
into the page.

**This also explains the original "not enumerable" clue**, which sent M1 and M3 hunting in the wrong
place: the rule that could not be found was never `.bg-primary` — it was the invisible rule beating it.

**What remains — 30 seconds, and it needs a human.** Open any dashboard page in a private window with
extensions disabled, or in a different browser, and look at a link-styled-as-button. If it paints,
the defect is not in the product, every workaround can be deleted, and this entry closes. If it does
not, the cause is inside the app after all and this measurement narrows the search to "find the
unlayered anchor rule".

**The workaround stays until that check runs**, now carrying the diagnosis in its comment rather than
a shrug. No fourth copy was added: P1's own editor uses real `<button>` elements and needed none.

**Worth keeping regardless of the outcome:** any unlayered CSS — an extension, a user stylesheet, a
third-party widget — silently defeats _every_ Tailwind v4 utility, because they all live in a layer.
That is a general fragility of this stack, not a quirk of anchors.

**CLOSING NOTE — P1 (2026-08-12). The check ran, and the answer is that the application was never
at fault.** An `<a class="bg-primary">` was compared against a `<div>`, a `<span>` and a `<button>`
carrying the same class, on `/login` of the deployed Worker, in a Chrome incognito window with
extensions disabled **and** in a different browser. In both, the anchor painted like everything else.
The defect only reproduces in the developer's ordinary Chrome profile, which is where the injected
unlayered rule lives.

**The three workarounds were deleted** — `sucursales`, `barberos` and `servicios` now put
`buttonVariants()` directly on the `<Link>`, which is the ordinary shadcn/ui pattern. What the entry
had feared — a fourth silent copy — never happened: P1's own editor uses real `<button>` elements.

Three things this cost, and they are the reason the entry is worth reading rather than deleting:

- **The original clue pointed at the wrong place for three milestones.** "The `.bg-primary` rule is
  not enumerable from the page" was read as "the stylesheet is unreadable", so M1 and M3 both went
  hunting for a rule inside the project. The unenumerable rule was never `.bg-primary` — it was the
  invisible one beating it.
- **A workaround outlived its justification by two milestones** because re-verifying the symptom was
  never the first step. The M3 evaluation finally said so, and it took five minutes when it ran.
- **The failure is invisible to every automated check.** Tests pass, the class is in the CSS, the
  computed style is wrong only in one browser profile. Nothing but looking would have found it, and
  nothing but looking _somewhere else_ would have cleared it.

Still true and worth carrying forward: unlayered CSS defeats every Tailwind v4 utility regardless of
specificity. If a control ever renders unstyled again with its class present and the stylesheet
intact, check a clean browser profile **before** touching the code.

### T11 — Cross-owner isolation has no executable proof

**Status:** **needs a test when it becomes possible** · **Effort:** ~1 h

Ownership scoping is the security boundary of the whole dashboard: `findByIdForOwner`, the scoped
`update`, and every list query carry `ownerId` so another owner's row resolves as not-found. All of
it is asserted **only by unit tests against a mocked Prisma client**, which verify the _shape of the
call_ — that `ownerId` appears in the `where` — not that Prisma actually honours a compound
predicate on `update`.

It cannot be proven end-to-end today, and that is not an oversight: `data-persistence` → "Exactly one
Owner" forbids a second `Owner` row, and no application path may create one. With a single owner
there is no exposure — every row belongs to the only owner there is. The gap is in the _assurance_,
not in the behaviour.

**Narrowed at M3 (2026-08-09).** An adversarial pass ran the scoping predicate against the real
database rather than a mock: `update({ where: { id, ownerId } })` with a foreign owner raises `P2025`
and leaves the row untouched, `findFirst` with a foreign owner returns `null`, and the same update
with the correct owner applies. Recorded in `docs/s0-versions-decision.md`. So **the mechanism is now
proven** — Prisma does honour the extra scalar predicate. What remains unproven is isolation between
two _real_ owners, which is what this entry is actually about, and that still needs a second `Owner`.

**Narrowed again at M4 (2026-08-10).** M4 introduces the first relation whose ownership rule the
database _cannot_ express — `BarberService` joins a `Barber` (ownership derived through `location`)
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

**P1 (2026-08-11) — `meta.target` does not exist on this stack, and the boundary now has a
precedent.** P1 is the first change that genuinely needs to tell two unique violations apart
(`BusinessProfile.ownerId` versus `BusinessProfile.publicSlug`, plus `SocialLink(businessProfileId,
platform)`), so it had to find out what a violation actually reports. Measured by
`scripts/p1-gate-db.ts` against the real database:

- `error.meta.target` is **absent**. Prisma 7 with the `@prisma/adapter-pg` driver adapter reports
  the constraint at `meta.driverAdapterError.cause.constraint.fields`, as column names that arrive
  **already quoted** (`['"publicSlug"']`). Any future attempt to qualify a translation must read
  that, not `target` — the gate's first version asserted `target` and failed every probe.
- The three constraints are cleanly distinguishable: `ownerId`, `publicSlug`, and
  `businessProfileId,platform`.

P1 resolves the tension this entry describes by **translating in the repository** rather than in the
service: `PrismaBusinessProfileRepository` reads the driver structure — where Prisma is already known
— and throws a domain error, so nothing Prisma-shaped crosses into the application layer. That is the
same rule `data-persistence` already states for rows, applied to errors.

This narrows the entry rather than closing it. `LocationService`, `BarberCatalogService` and
`ServiceCatalogService` still catch a bare `P2002` in the application layer and still assume it can
only mean one thing. The fix for them is now a known, demonstrated move rather than an open question.

- **Trigger (unchanged in kind, cheaper now):** the first table in the catalogue paths to carry a
  second unique constraint. Move that service's translation into its repository, following P1.

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

### T23 — The dashboard reports bookability per service, not per (service, location)

**Status:** deferred — **decision closed (M4a), shape closed (B2), dashboard presentation open** · **Effort:** ~1 h · **Added:** M4 (2026-08-10, adversarial review) · **Half-closed:** M4a (2026-08-11) · **Shape fixed:** B2 (2026-08-15)

**Closed at M4a: a closed branch now suppresses bookability.** The original question — whether a barber at a deactivated location should count — is answered **no**. The booking flow selects a location first (B2), so a barber at a closed branch is unreachable by any booking, and a dashboard that called such a service bookable was asserting revenue that could not be earned. `countActiveBarbersByService` now requires `barber.location.isActive`, the `service-catalog` requirement is normative rather than provisional, and `scripts/m4a-gate.ts` proves the predicate discriminates against the real database.

**Closed at B2: the unit is the (service, location) pair, and the public flow applies it.** The booking catalogue is keyed on the pair — a service with active barbers at Centro and none at Norte is offered at Centro and absent at Norte. No client is ever shown a service at a branch where nobody can perform it, which was the failure this entry was opened about.

**Still open: the dashboard.** It reports a single "bookable" per service and therefore hides the second half — an owner whose Norte branch can deliver nothing sees no marker saying so. This is now a gap in the **owner's** view only; the client's is correct.

The remaining work is presentation against an aggregate whose shape is settled: extend `countActiveBarbersByService` to group by `(serviceId, locationId)` and give the services list a per-branch breakdown. B2 deliberately stopped short of it — growing a public-flow change into a dashboard change, to close an owner-facing gap no client can reach, is the scope drift that makes a story unreviewable.

- **Trigger:** the first owner with two locations whose catalogues differ, or **M6** (deactivation), which is when a branch can quietly start offering nothing.

`countActiveBarbersByService` filters `barber.isActive` but not `barber.location.isActive`, so a service performed only by barbers at a **deactivated branch** is presented as bookable on the dashboard.

This is an underspecification, not a contradiction: `data-model.md` §6 says "at least one assigned **active** barber" and is silent about the location. But M2 deliberately ruled that a barber may _remain_ at an inactive location, so the state is live rather than hypothetical — and B2 will inherit whichever answer is frozen here.

The question is a product one and has not been answered: **should a closed branch suppress bookability?** It is recorded as undecided rather than resolved by whichever behaviour the code happens to have.

- **Trigger:** B2 (public service/barber selection) at the latest, or the first location deactivation with assigned barbers.

### T24 — The editor's empty state states something false when every service is inactive

**Status:** accepted · **Effort:** ~15 min · **Added:** M4 (2026-08-10, adversarial review)

`COPY.barberServices.emptyNoServices` reads "Antes de asignar servicios, creá al menos uno en el catálogo". It renders whenever the assignable set is empty — which includes the case where the owner **has** services and all of them are inactive and unassigned. The message then tells the owner to create something they already have.

Fix is to branch the empty state on "no services at all" versus "none currently assignable". Same M6 trigger as T22.

- **Trigger:** M6 (service deactivation).

### T25 — The assignment and schedule route parameters are decorative for the write

**Status:** accepted · **Effort:** ~30 min · **Added:** M4 (2026-08-10, adversarial review)

`setBarberServicesAction` reads `barberId` from a hidden form field, not from the route segment, so a payload can name a different barber than the URL displays. This is **not** a tenancy hole — `findByIdForOwner` still scopes it to the session owner — and it is the ordinary shape of a Server Action, which receives no route params.

What is unrecorded is whether that mismatch is intended. Today a crafted payload silently edits a different barber the owner owns, and no scenario says whether that should be honoured or refused.

**Extended at M5a1 (2026-08-11).** The same shape exists in `setWorkingHoursAction`: `barberId` comes from a hidden body field, not the route segment, so a payload can name a different barber than the URL displays. Still not a tenancy hole — `findByIdForOwner` scopes it to the session owner — and still unrecorded as to whether the mismatch is intended.

- **Trigger:** a second administrative user (which would make the mismatch a privilege question rather than a UX one), or any report of an edit landing on the wrong barber.

### T26 — The service duplicate-name pre-check can miss a row once services exceed the active cap

**Status:** accepted · **Effort:** ~15 min · **Added:** M4 (2026-08-10, adversarial review) · **Origin:** M3

`PrismaServiceRepository.existsByOwnerAndName` reads with `take: MAX_SERVICES_PER_OWNER`, but that constant counts active services only while the query is unfiltered by `isActive`. Once total services exceed 50, the pre-check can read a truncated set and miss a genuine duplicate.

Impact is bounded: the database's `@@unique([ownerId, name])` remains the authoritative guarantee (M3 design D9), so the outcome is a worse error message — the generic infrastructure message instead of a readable field error — never a duplicate row.

Same root cause as T22: a cap that counts active rows being used to bound a query over all rows.

- **Trigger:** M6 (service deactivation), together with T22.

### T27 — One window per day cannot express a split shift _in the editor_

**Status:** accepted — **halved by B3, not closed** · **Effort:** ~2 h (the editor's second window) · **Added:** M5a (2026-08-11) · **Narrowed:** B3 (2026-08-16)

The owner chose a single continuous window per weekday. The common local pattern is a split shift — 9–13 and 16–20 — and a barber who works one must enter 9–20. Slot generation will then offer appointments at 14:00 with the shop closed: the client books, pays a deposit, and nobody is there.

The defect surfaces in the availability story, not here, but it is created here and must not be discovered there. `data-model.md` §8 previously permitted multiple non-overlapping windows for exactly this reason.

**The schema is deliberately left capable.** The unique constraint is `(barberId, dayOfWeek, startMinute)` rather than `(barberId, dayOfWeek)`, so restoring the second window is a UI change plus re-enabling an overlap validation — **no migration over live data**. The cost of keeping it open is one column in an index.

**B3 answered the half of this entry that was its own.** The entry predicted the defect would surface in the availability story; it does not, because slot generation consumes a **list** of windows and refuses an appointment that would span two of them. `scripts/b3-gate.ts` proves it against the live database with a real 9–13 / 16–20 barber: 12:30 is offered, 13:00 and 14:00 are not, 16:00 is. That barber cannot be created through the dashboard — only the gate can write the second window.

**What remains is the editor**, and it is now the whole of this entry: the owner still has one pair of time fields per weekday, so a barber who works a split shift still has to enter 9–20, and the generator will faithfully sell the break they had no way to describe. The defect is unchanged in the product; what changed is that fixing the editor is now sufficient, and no availability code has to be revisited when it happens.

- **Trigger:** the first barber who works a split shift. The generator, the schema and the gate are already waiting for them.

### T28 — "Every day has 1440 minutes" is an assumption, not a fact

**Status:** accepted · **Effort:** ~2 h if it becomes real · **Added:** M5a (2026-08-11)

Working hours are stored as minutes from midnight, and all-day ranges are computed as local midnight to local midnight. Both are exact only while the business's timezone has no daylight saving. Argentina has observed none since 2009, so this is correct today rather than approximately correct.

M5b adds a second consumer: a whole-day absence is computed as local midnight to local midnight, which is 23 or 25 hours on a transition day rather than 24. If DST returns, three things break together and must be revisited as one: a day is 23 or 25 hours rather than 1440 minutes, `BUSINESS_UTC_OFFSET_MINUTES` stops being a constant, and a window spanning the transition shifts by an hour. The conversion module already computes the offset per instant rather than assuming it, so the code path is prepared; the assumptions around it are not.

**B3 adds the third consumer, and it is the one that sells things.** Slot generation converts each working window to instants per day and steps a five-minute grid across it, and the date strip is sixty calendar days built by adding one day at a time. Neither assumes a fixed day length — `dayBoundsOf` computes both midnights rather than adding 24 hours, and `addDays` goes through the calendar — so the arithmetic is prepared. What is **not** prepared is the day a transition falls inside a working window: the window would shift by an hour against the appointments already booked inside it, and nothing would report it.

- **Trigger:** Argentina reinstating daylight saving, or a location outside the current timezone.

### T29 — Editing a schedule retroactively strands existing bookings

**Status:** deferred · **Effort:** unknown until bookings can be created · **Added:** M5a (2026-08-11) · **Re-costed:** B3 (2026-08-16)

Saving a schedule replaces the barber's week wholesale. Once bookings exist, narrowing or removing a window leaves confirmed appointments outside working hours, and nothing detects or reports it.

Same shape as T14 (barber reassignment rewriting derived history): the fix depends on what the booking model looks like, and may be either a warning that names the affected appointments or a refusal to narrow a window that has bookings inside it.

**B3 removed the sentence that made this safe to ignore.** The entry said "at zero bookings — the current state — this is harmless", and that was true only because the table did not exist. It exists now, with the index and the read that would find the stranded appointments. The count is still zero because nothing writes one until B4, so the _consequence_ has not arrived — but the reason it could not arrive has.

Note what B3 does **not** create: a barber whose schedule shrank still shows the shrunken schedule to clients, so no new booking lands outside working hours. The exposure is entirely to appointments booked before the edit.

**B4 closed the half it could and named the half it could not (2026-08-17).** The booking transaction
re-asserts, under its lock and immediately before the insert, that the appointment still falls inside
a working window and outside every absence. That closes the _race_: an owner narrowing a schedule
while a client is on the details step can no longer produce a booking outside working hours, which was
the one path B4 itself could have opened.

What remains is the original entry, unchanged in kind: **an edit made after a booking already exists
still strands it**, silently, with nothing that detects or reports it. B4 makes this reachable for the
first time — bookings can now exist — so the entry moves from deferred to real. The fix is still the
one this entry always described: a warning that names the affected appointments, or a refusal to
narrow a window that has bookings inside it. The read that finds them is the one B4's transaction
already performs.

- **Trigger:** the first schedule edit made against a barber who has bookings — which is now possible
  rather than hypothetical. Also **D1**, whose dashboard is the first surface that could show an
  owner a stranded appointment at all.

**D1 shipped and does not surface it (2026-08-24).** The trigger above named the dashboard as the
first surface that _could_ show a stranded appointment. It can, and it does not: a `CONFIRMED`
booking outside its barber's current working hours is counted by "turnos de hoy" and rendered in the
recent list looking entirely ordinary, because nothing on that page compares a booking against the
schedule it was made under. Detecting one means reading each booking's barber's current windows and
absences — the read B4's transaction already performs, but per booking rather than per write, which
is a different query and a different story.

Recorded so the trigger is not read as satisfied by D1's existence. **The surface arrived; the check
did not.**

- **Trigger (unchanged):** the first schedule edit made against a barber who has bookings, or **D3**,
  whose per-barber calendar renders appointments _against_ a schedule and is therefore the first
  place where a stranded one looks wrong rather than merely being present.

**D3 shipped and answered half of it (2026-08-27).** The trigger above is now satisfied in the
direction it named: the per-barber calendar compares every occupying appointment against the
schedule as it stands and badges the ones that fall outside it — *"Fuera del horario laboral"* —
including on a weekday the barber no longer works at all, where nothing contains the appointment and
it is rendered with no window to sit inside. The check is a pure containment test
(`fallsOutsideWorkingHours`) over data the same read already returned, so it costs no query, and
`scripts/d3-gate.ts` §6.6–6.8 proves it by **actually narrowing a window underneath an existing
booking** and reading the day back through the real repository rather than asserting against a
fixture that was told the answer.

**What remains is the whole write side, and it is the larger half.** The edit still succeeds
silently. Nothing warns the owner at the moment they narrow a window that appointments are inside
it, nothing refuses, and nothing lists them. The owner now has a surface that will *eventually* show
them the damage — if they think to open that barber, on that day — which is strictly better than the
dashboard's silence and is not the same thing as being told.

- **Trigger (re-stated):** the first owner report of an appointment discovered this way, or any story
  that touches the schedule editor. The read that finds the affected appointments now exists twice —
  in B4's transaction and in D3's day composition — so the remaining work is a warning surface on the
  editor, not a new query.

### T30 — Per-barber absence cap is advisory, not guaranteed

**Status:** accepted · **Effort:** ~1–2 h if it becomes real · **Added:** M5b (2026-08-11)

`BarberTimeOffService` refuses a create once the barber has reached `MAX_TIME_OFF_PER_BARBER` (= 100). The count is read in a separate round trip from the insert against a transaction-mode pooler, so two concurrent creates can both observe 99 and both write. Identical mechanism to T13 and T19, blocked for the same reason: Prisma cannot express a count constraint, and a raw migration would show as permanent drift.

Unlike the service cap (T19), this one counts **every** row rather than only the active ones, because an absence has no active flag — so an owner who accumulates a year of past absences approaches the limit through ordinary use rather than through a deactivation quirk. The backward bound of one year on `startsAt` is what keeps that from growing without end.

- **Trigger:** any confirmed report of a barber exceeding 100 absences, or multi-owner tenancy.

### T31 — A failed absence removal tells the owner nothing

**Status:** accepted · **Effort:** ~1 h · **Added:** M5b (2026-08-11, pre-archive review)

`removeAbsenceAction` is a plain `<form action={fn}>` with no `useActionState`, so it has nowhere to put a message. An infrastructure failure is logged and swallowed; the only signal the owner gets is that the row is still there after the list refreshes.

That is enough to notice but not enough to explain, and it differs from every other write in the dashboard, which returns failures as form state. Surfacing it properly means a client component per row purely to hold a rare error — more machinery than the failure justifies today.

The create path is unaffected: it carries form state and reports failures normally.

- **Trigger:** the first report of an absence that would not delete, or any change that gives the list rows client state for another reason.

### T32 — Unreferenced storage objects accumulate with no reclamation path

**Status:** accepted · **Effort:** ~2–3 h (a sweep keyed on the owner prefix, or a `storagePath` column plus a scheduled job) · **Added:** P1 (2026-08-11)

An image is uploaded **before** the database transaction opens, because storage is not transactional and a network round trip must not hold a transaction open on a pooled connection. When the transaction then fails, the uploaded object is referenced by nothing. It is logged with its key and left in place.

Replacement has the same shape from the other end: the previous object is deleted best-effort after a successful save, and a failed delete is logged rather than raised, because a save that fails in order to reclaim a few hundred kilobytes is a worse outcome than the kilobytes.

Accepted because the accumulation is bounded and small: one owner, a client-side downscale that caps each object at roughly 500 KB, and one orphan per failed save. What does not exist is any process that reclaims them — the log is the only inventory.

**Do not fix this before B6.** Transfer receipts add a second bucket with identical orphan semantics and a _private_ audience; one entry covering both is worth more than one written now that B6 would rewrite.

- **Trigger:** B6 shipping (fix both buckets together), any measured storage growth that is not explained by real profile edits, or multi-owner tenancy.

### T33 — Changing the public slug breaks every link already shared

**Status:** accepted — owner's explicit decision, **re-affirmed and now live** · **Effort:** ~3–4 h (slug history table, lookup fallback, redirect) · **Added:** P1 (2026-08-11) · **Last evaluated:** B1 (2026-08-15)

`BusinessProfile.publicSlug` is editable. Changing it changes the public URL, and every link already handed out — WhatsApp messages, an Instagram bio, printed cards — stops resolving. There is no alias table and no redirect from a previous slug.

The owner chose this knowingly over the two alternatives: freezing the slug after the first save (unrecoverable from a typo without a database edit) and keeping old slugs alive (a second table, and a story of its own). The mitigation shipped instead is a warning at the moment the slug is altered away from its stored value, which is the only moment it can be acted on — there is no way to learn afterwards who holds the old link.

**B1 (2026-08-15) turned this from theory into exposure.** The entry previously read "the cost is currently zero: B1 has not shipped, so no link resolves yet and none can have been usefully shared." That is no longer true — `/b/{slug}` resolves, the editor no longer warns the owner against sharing the link, and every link handed out from today is a link a slug change can strand.

B1 re-affirmed the decision rather than reopening it: nothing changed except the date on which it starts costing something, and building the alias table would have been a story of its own smuggled into another (B1 design D14).

Two things B1 did add:

- **A search-result tail.** The public page is indexable (B1 design D13), so a slug change now also leaves indexed results pointing at a 404 for however long it takes a crawler to revisit. That is a longer tail than the shared-link problem and it is the price of being findable, which is what the product is for.
- **The only signal that will exist when this happens.** `PublicProfileService` logs an unresolved slug at `info` with the requested value (design D15). Without the value there is no way to tell a client holding a stranded link from someone enumerating slugs, and those call for opposite responses. That log is the inventory; nothing else records it.

- **Trigger:** the first slug change made now that B1 is live, any owner report of a shared link that stopped working, or a rise in the unresolved-slug log that correlates with a slug edit rather than with enumeration.

### T34 — A controlled `<select>` needs a manual write-back after React's post-action form reset

**Status:** accepted — measured workaround, isolated to one component · **Effort:** ~1 h to revisit when React or the form shape changes · **Added:** P1 (2026-08-12)

React 19 resets an uncontrolled form once its action resolves. Controlling a value is the documented answer, and for text inputs it is enough — React restores the DOM value on its own. **It is not enough for `<select>`.** The reset drops the element to its first option, React's `value` prop is unchanged from the previous render, so no DOM write is scheduled and the element keeps reporting `""`.

That is not cosmetic on this form: the social link set is replaced wholesale (design D7) and blank rows are discarded as absence, so a select silently reading `""` makes the next save delete a link the owner had already stored. Measured directly — the first save carried `WHATSAPP` and the second carried `""` with the row's URL still intact.

`ProfileForm` therefore keeps a ref per select and writes the state value back to the DOM after every commit, which is the commit the reset arrives in. The effect has no dependency array on purpose.

The cost is a piece of imperative DOM code inside an otherwise declarative form, and a rule that is easy to not know: **any future `<select>` inside a form with a Server Action needs the same treatment**, and nothing in the type system will say so. The two regression tests in `ProfileForm.test.tsx` assert on the submitted `FormData`, not on the DOM, so they will still catch it if the write-back is removed.

- **Trigger:** a React upgrade that restores controlled selects after a form reset (delete the workaround and let the tests confirm), or the second `<select>` added to any action-backed form in this project — at which point this belongs in a shared component rather than copied.

### T16 — Session expiry during long free-text entry silently discards up to 500 characters

**Status:** accepted · **Effort:** ~2–4 h (server-sent draft save or client-side autosave) · **Last evaluated:** M3 (2026-08-09)

`requireOwner()` redirects to `/login?next=…` when the session expires. If the owner was mid-way through typing a 500-character barber bio **or service description**, the redirect discards it. React 19 resets uncontrolled forms on resolve, so even a rejected submit clears the field unless the action echoes it back — which it does, but an expired session never reaches the action.

M3 adds a second field of the same size and does not change the mechanism. It does slightly raise the cost: a service form carries four fields the owner must retype, against three on the barber form.

Accepted because: the session lifetime is long relative to the time to type 500 characters; no data loss occurs beyond a single form field; and autosave infrastructure (draft table, SSE, or `localStorage`) costs far more than the failure it prevents.

- **Trigger:** a confirmed user complaint about lost bio text, or the arrival of a rich-text or multi-step form where the loss is more expensive.

### T17 — Unauthenticated Server Action POSTs are not rate-limited or metered

**Status:** accepted · **Effort:** ~2–4 h (Cloudflare rate-limiting rule or middleware throttle) · **Last evaluated:** B1 (2026-08-15)

`requireOwner()` short-circuits at `!user` and returns an error state without making any database call. This means the create and edit Server Action routes accept unlimited unauthenticated POSTs at zero database cost, but they still consume CPU and egress on the Worker. An attacker who discovers the action endpoint can submit it in a tight loop.

**The original justification has partly expired, and B1 is why.** This entry used to be accepted because, among other reasons, "the dashboard routes are not publicly linked". That was true while every route in the application required a session. B1 opened `/b/**` to anonymous visitors, so the application now has a publicly addressable surface, and the trigger this entry carried — "the arrival of the public booking flow (B4–B6)" — named the wrong story. The moment of change is B1, not B4.

What still holds: Cloudflare Workers enforces a 10 ms CPU-time soft limit per request; the free tier's 100k daily requests provides implicit throttling; and no link has been shared yet, so the realistic traffic is zero. The mitigation was therefore **not** built at B1 — but the reasoning was corrected, because an accepted debt whose written justification is false is worse than one with no justification at all: the next reader treats it as still-evaluated (B1 design D12).

Note the scope difference B1 introduces. This entry is about _Server Action POSTs_, which remain undiscoverable. The new public **read** surface is a different shape and is tracked separately in T47.

**B4 arrived, and it changed the shape of this entry rather than closing it (2026-08-17).** The first
publicly-linked write shipped — but as a **Route Handler**, not a Server Action, so the endpoint this
entry is about did not gain a new caller. What B4 added is its own throttle on `POST /api/bookings`
(`bookingThrottle.ts`), plus a per-client hold cap checked against the database.

Two consequences worth stating. First, the dashboard's Server Action POSTs are still entirely
unmetered, and are now the _only_ unmetered write surface in the application — B4 did not widen this
entry, it narrowed it by covering everything except this. Second, B4's own throttle is **per-isolate**
and is documented as such: `workerd` offers no counter shared across isolates, so it blunts a naive
loop and does not defeat a distributed one. That limitation is tracked separately in **T55**.

- **Trigger:** any observed spike in unauthenticated action POSTs, or the first Cloudflare
  rate-limiting rule added for T47/T55 — at which point covering the action endpoints costs almost
  nothing extra, because the rule is already there.

**Re-costed by B5 (2026-08-19).** The unmetered surface is now larger in a way this entry's title no
longer describes. B5 adds **two** unauthenticated public endpoints — the payment initiation write and
the Mercado Pago notification handler — and the second is the first endpoint in this project that a
**third party** calls on a schedule we do not control. Neither is a Server Action, so neither is
covered by the wording here, but both share the exposure: no metering, no attribution, no per-owner
accounting. The notification handler additionally triggers an **outbound** call, which is why B5
orders its cheap `ref` lookup first (see T60) — an unresolvable notification must never spend one.

### T48 — The public profile has no loading state, because a skeleton costs its HTTP statuses

**Status:** accepted — measured trade-off, statuses chosen over the skeleton · **Effort:** unknown; needs a way to stream a shell without committing the status early · **Added:** B1 (2026-08-15)

`/b/[slug]` ships **no** `loading.tsx`. A client on a slow connection sees nothing until the server responds, rather than a skeleton.

This is not an omission, and the alternative was built and measured before it was rejected. A `loading.tsx` opens a Suspense boundary; Next.js streams the shell and commits `200 OK` before the page has resolved anything, so `notFound()` and `permanentRedirect()` arrive too late to set a status:

| Request                | With `loading.tsx`                    | Without |
| ---------------------- | ------------------------------------- | ------- |
| unknown slug           | `200` (soft 404)                      | `404`   |
| non-canonical spelling | `200` + `<meta http-equiv="refresh">` | `308`   |

Raising the outcome inside `generateMetadata` was also built and measured — **it does not work on this runtime**, the statuses stayed at `200`. Do not re-attempt it without new information.

The statuses were chosen because they are this page's contract with machines: WhatsApp and Instagram follow HTTP redirects when building a link preview and do not execute a meta refresh, so a link shared in a non-canonical spelling would lose its preview on the product's main distribution channel. Soft 404s are also what search engines penalize, which matters because the page is indexable (B1 design D13).

The cost is bounded today: one query, no images blocking first paint. It grows the moment this route does more work — which is precisely what B2 and B3 will do to it.

- **Trigger:** **B2 or B3**, whichever first makes this route wait on more than one query — at which point the missing loading state stops being a few milliseconds. Also: any Next.js or OpenNext release that lets a route stream a shell while deferring its status commit, and any measured complaint about the page appearing blank on a slow connection.

### T47 — The public surface has neither a cache nor a rate limit

**Status:** accepted — deliberate bet on low traffic · **Effort:** ~2–4 h (a Cloudflare rate-limiting rule, or ISR backed by R2/KV, or a slug-keyed cache invalidated from the profile save) · **Added:** B1 (2026-08-15) · **Re-costed:** B2 (2026-08-15)

`/b/[slug]` is `force-dynamic`, like every other page in this project. Unlike the others it is reachable **without a session**, so every request from anyone issues a database query through Supavisor. There is no cache in front of it and no rate limit on it.

**B2 widened this, and the new numbers are worse than the entry originally described.** Two changes:

- **The profile page went from one query to two.** The bookability gate reads the catalogue. The owner lookup was folded into the existing profile read rather than added beside it (B2 design D10), so the increase is one query and not two — but it is still double what B1 shipped.
- **`/b/[slug]/reservar` is a second public route, with a heavier query and a parameter space.** The catalogue read joins locations, barbers and assignments. Worse, the route accepts `?local=&servicio=&barbero=`, so a crawler that follows every offered link generates on the order of `L × S` requests per shop instead of one. The parameterized URLs declare the bare path as canonical, which asks politely; it does not enforce anything.

The pool is still shared with the dashboard, so the saturation consequence is unchanged and now easier to reach.

**Measured on `workerd` against the live database** (B2 runtime verification), which turns the argument above into numbers:

| Route                                                         | Queries | Response |
| ------------------------------------------------------------- | ------- | -------- |
| `/b/{unknown}/reservar` (short-circuits before the catalogue) | 1       | ~0.21 s  |
| `/b/{slug}/reservar`                                          | 2       | ~0.97 s  |
| `/b/{slug}`                                                   | 2       | ~1.17 s  |

Roughly **0.35–0.40 s per Supavisor round trip** from this location. Two things follow. The profile page cost about 0.4 s when B2 added the bookability gate — a real regression on the busiest public page, accepted for the gate. And it confirms B2 design D10 was right to reject the three-query option, which would have landed near 1.5 s.

**A third finding, since fixed: router prefetch was multiplying the reads.** Next prefetches the RSC payload of every `<Link>` that enters the viewport, and on this route that payload is a full catalogue query. Observed in the browser: rendering the branch step fired **two extra server requests**, one per branch, before the client touched anything — a page view costing `1 + L` queries, and `1 + 50` on a service step at the per-owner cap. The client picks exactly one option per step, so every other prefetch was work thrown away.

Fixed by routing all public-flow navigation through `src/components/booking/StepLink.tsx`, which sets `prefetch={false}` in one place. Re-measured after the change: the branch step issues **one** request, and each step navigation issues exactly one more. The cost is that a tap now waits for the navigation (~1 s) instead of finding it warmed.

**This does not close the entry.** The per-request cost is unchanged; what went away is a multiplier nobody had asked for.

**B3 adds a third public route shape and a parameter space that is no longer bounded by the catalogue.** Two changes, and the second is the one that matters:

- **The slot step costs one round trip more than the barber step.** The availability inputs — the barber's windows for that weekday, the absences overlapping the day, and the blocking bookings — come back as a single composed read entered from `Barber`, measured at **~400 ms** against the live database (`scripts/b3-gate.ts`, 2026-08-16). Three separate reads would have made the slot step five round trips; it is three. The date step is cheaper still: it reads only the barber's seven schedule rows.

  **Measured end to end on `workerd` against the live database** (B3 runtime verification, `opennextjs-cloudflare preview`, same location as the B2 row above):

  | Step                                        | Queries | Response     |
  | ------------------------------------------- | ------- | ------------ |
  | branch / service / barber (unchanged by B3) | 2       | ~1.09–1.15 s |
  | date step (adds the weekly schedule read)   | 3       | ~1.40 s      |
  | slot step (adds the composed day read)      | 3       | ~1.68 s      |

  So B3 costs about **+0.28 s on the date step and +0.53 s on the slot step**, against a route that already sat near a second. Both are one round trip more than the step before them, which is the contract the spec sets — but the flow is now five steps deep on a phone, and the total time from opening the link to seeing times is the sum of all of them.

- **`?fecha` multiplies the crawlable space by the horizon.** B2 left this route generating on the order of `L × S` URLs per shop. B3 makes it `L × S × B × 61`, and each distinct date is a real availability read rather than a repeat of a cached one. `MAX_BOOKING_HORIZON_DAYS` is what keeps that number finite at all — without it the parameter is unbounded — and the parameterized URLs still declare the bare path as canonical, which asks politely and enforces nothing.

Router prefetch was the multiplier B2 removed, and B3 would have reintroduced it at a worse rate: the slot step renders on the order of a hundred links on one screen, each of whose prefetch payload is an availability computation. Both new steps route through `StepLink`, so the count stays at one request per navigation.

**The bet is unchanged and is now larger.** A single crawler sweeping dates costs more than the entire dashboard does in a day, against a pool the dashboard shares.

Two consequences, and they are different problems:

- **Cost amplification.** A slug-enumeration loop, or simply an Instagram story that lands, produces a traffic shape this project has never seen. The pool is shared with the dashboard, so saturation would take down the owner's admin surface alongside the public page.
- **Repeated work per request.** `generateMetadata` and the page component both resolve the slug. They are deduplicated with React's `cache()` within a render pass, so this is one query per request today — but that deduplication is a line of code, not a structural guarantee, and a future component reading the profile again would silently add a third query.

**Accepted deliberately**, and the alternatives were weighed rather than skipped (B1 design D7, D12):

- `revalidate` would need an incremental cache backed by R2 or KV — this stack's **first** ISR configuration, adopted on `workerd`, for traffic that does not exist yet. `docs/s0-versions-decision.md` is a list of things this runtime does differently than expected; adding one more unproven mechanism to serve zero users is the wrong trade.
- A slug-keyed cache invalidated from the profile save couples the dashboard editor to the public route's cache.
- A Cloudflare rate-limiting rule is cheap (~15 min, no code) but lives outside the repository, where nobody will remember it exists.

Dynamic rendering also buys something real: the owner saves their profile, reloads, and sees the change with no staleness window.

**The honest summary is that this is a bet on having no traffic, written down so it is a bet and not an oversight.**

**B4 fired the last clause of the trigger, and the calculation did change (2026-08-17).** The public
surface now **writes**. Three things follow that were not true when this entry was last costed:

- **The details step adds a payment-configuration read**, and the write adds a catalogue read, an
  availability read, a client upsert and an interactive transaction. The transaction is the expensive
  one: it _pins_ a pooled connection for its duration rather than borrowing one per statement, and the
  pool is shared with the owner's dashboard. A burst on one barber queues on the advisory lock while
  holding connections.
- **A bad request now costs a slot, not a query.** That is a different kind of exposure, and it is why
  B4 shipped bounds of its own rather than waiting for this entry: a per-origin throttle (**T55**,
  per-isolate and explicitly not a rate limit) and a per-client hold cap checked against the database.
- **The mitigation this entry keeps deferring is now the same work as T55's.** A Cloudflare
  rate-limiting rule covers the read surface and the write surface at once. The objection recorded
  above — that it "lives outside the repository, where nobody will remember it exists" — is answered by
  these two entries naming it.

The bet itself is unchanged: still no real traffic, still deliberate. What changed is the downside.

- **Trigger:** the first time the owner shares the link somewhere with reach (an Instagram bio, a
  story, printed cards), any measured growth in requests to `/b/**`, any Supavisor pool saturation,
  **any crawler observed sweeping the `reservar` parameter space**, or any observed burst on
  `POST /api/bookings`. Do this together with **T55** — it is one rule.

**Re-costed by B5 (2026-08-19), and one clause is now wrong.** This entry is written about a surface
whose worst case is cost. B5 adds a public endpoint that a third party calls, and one whose handler
performs an **outbound HTTPS request** to Mercado Pago per accepted notification. The amplification
shape is therefore no longer "our database per request" but "our database _and_ the owner's Mercado
Pago rate limit per request". A Cloudflare rate-limiting rule — still the mitigation this entry and
T55 both defer to, still ~15 min and no code — now covers three surfaces rather than two, which makes
it cheaper per unit of risk than at any previous costing.

**Re-costed by B6 (2026-08-22), and the shape changes again — this time toward bandwidth.**
B6 adds a fourth public endpoint, `POST /api/payments/transfer`, and it is unlike the three before
it: the receipt intent accepts a **multipart body of up to 10 MB** and spends a storage round trip
per accepted upload. Every previous entry on this list is about database round trips; this one adds
ingress and object storage to the amplification.

Three things bound it, and only the last is real:

- The route refuses on `Content-Length` **before reading the body**, so an oversized request costs a
  header parse rather than 10 MB of isolate memory.
- `BookingThrottle`, which is per-isolate and defeats one script from one address — see T55.
- **`uploadCount` against `MAX_RECEIPT_UPLOADS_PER_BOOKING`, read before the upload and re-checked
  inside the transaction.** This is the bound that holds: three uploads per booking, and a booking
  requires passing the whole wizard and the hold cap first. An attacker willing to create bookings
  can still push 30 MB per booking.

  **This sentence was false when first written, and the correction is the point.** The cap lived
  only inside the transaction that records the row — which runs _after_ the upload. It therefore
  bounded rows and left object storage completely unbounded: a token holder could push 10 MB per
  request for as long as their booking sat in `PENDING_APPROVAL` (a status nothing expires until the
  appointment passes — T64), and every one of those requests would be answered "too many attempts"
  while the file was quietly kept. Found by an adversarial review after the change was otherwise
  complete, and after this entry, `design.md` and the spec had all three asserted the bound held.
  The pre-check now runs before any byte is written; the transactional check stays for the race.

**The confirmation page went from one query to two, and they are issued together.** The Mercado Pago
presence check cannot be a Prisma `select` — `"mpAccessToken" IS NOT NULL` is not expressible as a
projected column — and selecting the token to reduce it in the process was rejected for the reason
B4 gave: it would bring a bearer credential into a route a stranger reaches without a session. So it
is a raw statement, keyed by the same cancellation token, issued in parallel with the booking read.
The page should therefore still read as one round trip rather than two.

**Control measurement first (B6, 2026-08-23).** `/b/{slug}` — a page B6 did not touch, two queries —
read **~1.18 s** on the preview against the live database (1256, 1153, 1132, 1186 ms, discarding a
3585 ms cold first). B2 measured that same page at **~1.17 s** on 2026-08-15. The environment has
not drifted, so every figure in this entry remains comparable with every other, which is the thing
that had to be established before attributing anything to B6.

Measurements must be taken the same way to be compared: browser timings include asset loading and
render, and are not the page's server cost. Everything recorded here is a terminal request for the
document alone.

**A correction, because the first version of this paragraph was wrong.** It said the gate's 1018 ms
was inflated by `maxUses: 1` — "setup the Worker does not repeat". The Worker _does_ repeat it:
`createPrismaClient` sets `maxUses: 1` too, deliberately, because workerd cannot reuse a socket
across request contexts and a carried-over connection hangs until the read timeout. **Every request
this application serves pays connection setup for every query it issues**, and that is a property of
the runtime, not of the gate. The gate's figure was representative; the reasoning dismissing it was
not.

That reframes what `Promise.all` buys on this page. The two statements do not queue behind one
round trip — they open **two connections concurrently**, so the page pays one setup in wall-clock
time rather than two. It is still the right shape; it is just not the "one round trip instead of
two" the paragraph above implies, because the round trip was never the dominant cost.

**The confirmation page reads ~1.22 s** (1200, 1250, 1295, 1134 ms; 3284 ms cold, discarded) against
the control's ~1.18 s. A difference of **38 ms**, with the two samples' ranges almost entirely
overlapping — 1132–1256 for the control, 1134–1295 for the page.

**The parallel statement is free in wall-clock terms.** Not "costs nothing" — four samples cannot
resolve a difference this small, and the honest statement is that B6's second query costs less than
the noise floor of this measurement. What it does not do is add a second connection setup in series,
which is what the `Promise.all` was there to prevent and what a ~1.6 s reading would have exposed.

Measured on the preview, 2026-08-23. Both figures taken the same way, minutes apart, on the same
machine and network — which is the only reason the 38 ms is worth quoting at all.

| Route                                                    | Queries | Response   |
| -------------------------------------------------------- | ------- | ---------- |
| `/b/{slug}` (control, untouched by B6)                   | 2       | ~1.18 s    |
| `/b/{slug}/reserva/{token}` (B6: +1 statement, parallel) | 2       | ~1.22 s    |
| cold start, either                                       | —       | ~3.3–3.6 s |

**The cold start is the number nobody has costed, and it is the largest one here.** Both pages take
over three seconds on the first request after a Worker starts. That is outside this entry's scope —
it is not a cache or a rate limit — but it is a worse first impression than anything this entry
tracks, and it belongs to whoever looks at public-surface performance next.

### T49 — The public 404 page renders an empty body without JavaScript

**Status:** accepted · **Effort:** unknown — see the cause · **Added:** B2 (2026-08-15, runtime verification) · **Origin:** B1

**Measured on `workerd`, on the deployed build**, across all three public routes:

| Request                 | Status | `robots` | Rendered body text |
| ----------------------- | ------ | -------- | ------------------ |
| `/b`                    | 404    | noindex  | _(empty)_          |
| `/b/{unknown}`          | 404    | noindex  | _(empty)_          |
| `/b/{unknown}/reservar` | 404    | noindex  | _(empty)_          |

The Spanish copy — "No encontramos esta barbería" — is present **only inside the RSC flight payload**, so the visible page is assembled by client-side JavaScript. With scripts stripped, the `<body>` contains nothing but a suspense marker. The same extraction run against the success pages returns their full text, so this is the not-found path specifically, not a measurement artefact.

**This is B1 behaviour, not B2's** — `/b` and `/b/{unknown}` are B1's routes and are unchanged by this story. It went unnoticed because B1's tests assert the _component_ renders, which it does, under a test renderer that is not the streaming SSR path.

**What is not affected:** the parts B1 argued for. The status is a real `404`, `noindex` is emitted, and no English framework page is served. Crawlers and link-preview bots read the status, so the requirement that made B1 remove its `loading.tsx` still holds.

**What is affected:** a client with JavaScript disabled or still loading sees a blank page instead of "pedile el link actualizado a la barbería" — on the one screen whose entire job is telling someone their link is broken. Related to **T44**, which records the same class of failure for dashboard forms, though the mechanism differs: this is the not-found slot being streamed rather than `useActionState` losing its state.

- **Trigger:** T33 becoming real (an owner changes their slug and strands live links), or any decision to make the public surface work without JavaScript.

### T51 — The Worker is one story away from the free plan's size ceiling, and the build reports a size Cloudflare does not agree with

**Status:** accepted — bought headroom, did not remove the ceiling · **Effort:** ~5 min (paid plan) · **Added:** B2 (2026-08-15, deploy failure)

**B2's first deploy was rejected**, and the cause was not the code:

```
Your Worker exceeded the size limit of 3 MiB.
```

Measured rather than guessed. Deploying `main` — identical to what was already live — was used as the control:

| Build                | reported gzip | outcome      |
| -------------------- | ------------- | ------------ |
| `main` (B1)          | 3045.35 KiB   | deployed     |
| B2, compiler `fast`  | 3064.88 KiB   | **rejected** |
| B2, compiler `small` | 2588.18 KiB   | deployed     |

**B1 had been sitting under ~20 KiB from the ceiling.** B2 adds ~19.5 KiB, so B2 is the proximate cause and not the real one — any story of any size would have tipped it, and B3 would not have fitted either.

**Two facts worth keeping:**

1. **What counts toward the limit is `worker.js` + the Prisma wasm, and nothing else.** `worker.js.map` is 2577 KiB gzip and is not counted; static assets upload separately. Raw `8902 + 3592 = 12494 KiB` matches wrangler's reported "Total Upload" exactly, which is how the composition was confirmed.
2. **`wrangler deploy --dry-run` is not a reliable gate.** It reported 3064.88 KiB against a 3072 KiB ceiling — "fits by 7 KiB" — and the API rejected it anyway. Cloudflare's server-side measurement is stricter than the figure wrangler prints, so the dry-run can only ever say "definitely too big", never "this will fit".

**What bought the headroom** is `compilerBuild = "small"` on the workerd generator (`prisma/schema.prisma`). Prisma ships two builds of the wasm query compiler — 3591 KiB and 1809 KiB — and defaults to the larger one for every runtime except `vercel-edge`. Verified at runtime against the live database, not just by size: the three-level nested catalogue join, `Decimal` prices, per-location filtering, and the 404/308 statuses all behave identically, and response times are unchanged because the ~0.35–0.40 s Supavisor round trip dominates query compilation.

**The ceiling is still there.** Current headroom is ~484 KiB against 3072, and the remaining bundle has no obvious fat: no duplicated Next runtimes, no `@edge-runtime/primitives`, and the 4 MB capsize font-metrics JSON is not inlined. The next lever is Workers Paid (US$5/month, 10 MiB) — there is no second `compilerBuild` trick to find.

**B3 measured at 2608.15 KiB gzip** — two Prisma models, two components, a calendar module and a repository for **+19.97 KiB** over B2's 2588.18. Headroom is now **~464 KiB** against the 3072 KiB ceiling. The two new tables cost almost nothing because the wasm query compiler is a fixed size and the generated client grows only by its types, which do not ship.

**B4 measured at 2746.52 KiB gzip** — **+138.37 KiB** over B3, the largest single-story increase since B2, leaving **~325 KiB** of headroom. The jump is proportionate to what the story added: a route handler, two repositories with an interactive transaction, a component, a confirmation page and a validation schema. Two things worth naming rather than inferring:

- **This is the first story whose growth is visible against the remaining headroom.** At ~138 KiB per story there are two more stories of room, and B5 (Mercado Pago SDK or a hand-rolled client), B6 (Supabase Storage upload) and N1 (Resend) are each plausibly larger than B4. **B5 is the story that should assume it will not fit** and price the paid plan into its own plan rather than discovering the rejection at deploy time, as B2 did.
- **The dry-run figure remains a lower bound, not a gate.** 2746.52 KiB is what wrangler prints; B2 proved Cloudflare's own measurement is stricter. "~325 KiB of headroom" means "definitely not rejected for size today", never "325 KiB may safely be added".

- **Trigger (unchanged in kind, closer in time):** the next story that adds a runtime dependency of any size — realistically **B5**. The lever is still Workers Paid (US$5/month, 10 MiB); there is no second `compilerBuild` trick to find.

- **Trigger:** the next deploy rejection, or any story that adds more than ~400 KiB gzip. Payments (B5), email (N1) and the cron trigger (B7) are all still to come and all add dependencies.

**B6 measured at 2924.08 KiB gzip (2026-08-22), leaving ~148 KiB of headroom.** Reported by
`wrangler deploy --dry-run` on the branch carrying B5 + B6 together.

**B5 never re-costed this entry, so the +177.56 KiB over B4's 2746.52 covers both stories and cannot
be split between them.** That is a gap in the record, not an estimate to be invented: whoever wants
B5's number alone can build its branch, and nobody should guess it from here.

**The prediction in the B4 note above has come true.** It said "at ~138 KiB per story there are two
more stories of room". Two stories later there is **less than one**, by that same measure. B6 was
expected to be cheap — `@supabase/supabase-js` was already a dependency, so the storage adapter adds
almost nothing — and the cost is in the surface area instead: a route, three repositories' worth of
new methods, two application services, five components, a dashboard page and its actions.

**B7 and N1 are both still to come, and N1 adds Resend**, a dependency this bundle has never carried.
On the trend above, N1 alone is plausibly larger than the remaining margin.

**And ~148 KiB is not 148 KiB of usable room.** B2 measured that Cloudflare's server-side check is
stricter than wrangler's figure: a build reporting 3064.88 KiB — "fits by 7 KiB" — was rejected by
the API. The dry-run can say "definitely too big"; it cannot say "this will fit". So the honest
reading is "not rejected today, with a margin nobody should spend deliberately".

- **Trigger (now, not on the next rejection):** the lever is unchanged — Workers Paid, US$5/month,
  10 MiB, ~5 minutes of work and no code. B2 discovered its ceiling as a failed deploy in the middle
  of a story. **The recommendation is to take the paid plan before starting N1** rather than
  discovering it the same way a second time.

### ✅ RESOLVED — WORKERS PAID TAKEN, N1 DEPLOYED (2026-08-26)

**Status: closed.** Franco took the paid plan and N1 deployed on the first attempt.

```
Total Upload: 12796.09 KiB / gzip: 3068.31 KiB
Uploaded reserva-barber (15.93 sec)
Deployed reserva-barber triggers (1.08 sec)
Current Version ID: a5a8df49-b30f-4e74-bf00-d3ca8f5f44a7
```

**3068.31 KiB against the free plan's 3072 would almost certainly have been refused** — B2's rejected
build reported *less* than this one. Against the paid plan's 10 MiB it is **~30% of the ceiling**,
with roughly 7 MiB free. At the ~140 KiB/story trend this entry has tracked since B4, that is on the
order of fifty stories of headroom rather than none.

**What this entry cost while it was open**, worth keeping because the lesson is about timing rather
than bytes: it was opened at B2 by a failed deploy mid-story, recommended the paid plan from B6
onward, forced B7 to restructure a story into a second Worker rather than pay US$5, and was the
blocker on N1's deploy. **The five-minute fix was available for four stories before it was taken.**

**What stays true and is not closed by the upgrade:**

- **`wrangler deploy --dry-run` remains a lower bound, not a gate.** B2's measurement stands: the
  API's own check is stricter than the printed figure. That matters less now, and it is still not a
  green light.
- **The two-bundler rule from B7 is unaffected.** A custom entrypoint that imports application code
  reaching Prisma still ships the query compiler twice — that was a correctness-of-bundling problem,
  not a size-limit one, and 10 MiB does not make it a good idea.
- **The cron Worker is unchanged**, at 878.62 KiB with its own config.

- **Trigger:** none. Re-open only if a story adds a dependency large enough to matter against 10 MiB,
  which on the current trend is not a realistic concern.

<details>
<summary>The measurement that forced the decision, kept for the record</summary>

### ⛔ N1 MEASURED AT 3068.26 KiB — THE FREE PLAN IS EXHAUSTED (2026-08-25)

| build                  | reported gzip | headroom vs 3072 |
| ---------------------- | ------------- | ---------------- |
| B6                     | 2924.08 KiB   | ~148 KiB         |
| **N1**                 | **3068.26 KiB** | **3.74 KiB**   |
| B2, rejected by the API| 3064.88 KiB   | 7.12 KiB         |

**N1 reports a larger figure than the build Cloudflare's API actually rejected.** B2's whole lesson
is recorded above: the number wrangler prints is a **lower bound**, and a build reporting "fits by
7 KiB" was refused. This one claims to fit by 3.74.

**The honest reading is that the next production deploy will be rejected**, and no amount of
re-measuring locally will change that — `--dry-run` can say "definitely too big" and can never say
"this will fit".

The cost is **+144.18 KiB over B6**, which is the ~138 KiB/story trend this entry has been tracking
since B4, landing exactly where it predicted. And it is not the dependency: `package.json` is
byte-identical, asserted by a test, and the Resend adapter is `fetch` against a single endpoint
modelled on `MercadoPagoGateway`. The bytes are the story's surface — a port, a builder, a service,
a projection, two composition roots, a copy namespace, a clamp module and page changes — exactly as
B6 was "expected to be cheap" and cost +177.56 KiB in surface area alone.

**Nobody should read "no new dependency" as "no new bytes". That was the plan's own assumption and
the measurement contradicts it.**

- **The lever is unchanged and is now the only one: Workers Paid, US$5/month, 10 MiB, ~5 minutes and
  no code.** This entry has recommended taking it before N1 since B6, and B7 restructured a story
  rather than pay it. There is nothing left to restructure here — the story is already SDK-free.
- **What is NOT blocked by this:** everything below the deploy. The workerd runtime was verified
  locally at this exact size (`wrangler dev` on the same build), so the code is known to work on the
  production runtime; only the upload is in question.

</details>

**B7 hit the ceiling and did not deploy over it (2026-08-23).** This entry's prediction came true one
story earlier than expected, and the story was restructured rather than the plan upgraded.

B7 needs a `scheduled()` handler, which OpenNext's generated worker does not export, so it was first
built as a committed entrypoint wrapping that worker. Measured with `wrangler deploy --dry-run`:

| entrypoint                            | gzip            |                                |
| ------------------------------------- | --------------- | ------------------------------ |
| B6, before this story                 | 2924.08 KiB     |                                |
| wrapper, `scheduled` body stubbed out | 2924.23 KiB     | the wrapper costs **0.15 KiB** |
| wrapper importing the sweep           | **3812.20 KiB** | **740 KiB over the ceiling**   |

**The +888 KiB was the Prisma query compiler bundled twice.** `--dry-run --outdir` held the same
1.85 MB wasm under two names: `query_compiler_small_bg.wasm` and
`src_generated_prisma_internal_query_compiler_small_bg_*.wasm`. Anything a custom entrypoint imports
from `src/` is compiled by **wrangler's own esbuild pass**, separately from the copy the OpenNext
build already placed inside `.open-next/server-functions/default/handler.mjs`.

**This is the most reusable fact in this entry: a custom Worker entrypoint cannot import application
code that reaches Prisma.** It is a structural consequence of two bundlers, not a quirk, and it
applies to any future scheduled, queue or email handler considered for the app's Worker.

The sweep moved to its own Worker (`wrangler.cron.jsonc`), which resolves it without spending
anything: **app 2924.14 KiB** — B6's number restored — and **cron 878.62 KiB**, each against 3072.
So B7 leaves the app's headroom exactly as it found it, at **~148 KiB**, and adds a second Worker
with ~2.2 MiB of its own room for anything scheduled that comes later.

- **Trigger (unchanged, and now with one more reason):** N1 adds Resend to the _app_ Worker, where
  the ~148 KiB has not moved since B6 — and B2 measured that Cloudflare's own check is stricter than
  wrangler's figure. The paid plan remains the recommendation before N1. What B7 adds is a second
  option that did not exist before: work that needs no request context can go in the cron Worker
  instead, where the room is.

### T50 — The service step has no answer for a catalogue at its cap

**Status:** accepted · **Effort:** ~2–4 h (grouping, or a filter, or search) · **Added:** B2 (2026-08-15)

`MAX_SERVICES_PER_OWNER` is 50, and every one of them can legitimately be bookable at a branch. The service step renders them as a flat list of cards, which at a 360-pixel viewport is a long scroll with no way to jump, filter or group.

The layout **holds** — that is required and tested. What it does not do is stay scannable, and this is the screen between a client deciding to book and actually booking.

**Not solved now because no real catalogue is anywhere near the cap.** Inventing a grouping scheme requires knowing how owners actually organize services (by category? by duration? by price?), and every answer available today is a guess about a shop that does not exist yet. Categories are also not modelled — `Service` has no grouping column — so this would be a schema change made for an imagined user.

- **Trigger:** the first owner whose catalogue passes roughly 15 services at one branch, or any request for categories.

### T46 — The deposit effect preview will list services nobody can book

**Status:** accepted — **dormant until M6** · **Effort:** ~30 min · **Added:** PC3 (2026-08-15)

`PrismaServiceRepository.findAllByOwner` selects every service of the owner with no `isActive`
predicate, and PC3's effect preview and both save-time warnings are built from it.

**Harmless today**, and that is the whole problem with it: `isActive` defaults to true and nothing in
the product sets it to false, so every row is active and the preview is correct. **M6** is the story
that introduces deactivation, and the moment it ships this surface starts showing the owner what
their seña charges for services that cannot be booked at all — and naming deactivated services in
the "la seña es más alta que el precio de estos servicios" warning, which would be advice about
nothing.

**The fix is not simply adding the filter to `findAllByOwner`.** It has three consumers and they do
not want the same rows:

- `ServiceCatalogService.list` — the services page, which under M6 **must** show inactive rows; that
  page is where deactivation is managed.
- `BarberServiceAssignmentService` (two call sites) — an existing assignment to a deactivated service
  still has to render, or it would silently vanish from the barber's list.
- `PaymentConfigService.previewPolicy` — the only one that wants active rows only.

So the change belongs at PC3's call site, or in a second explicitly-named repository method, decided
when M6 settles what deactivation means for a service that is already assigned. Filtering inside
`findAllByOwner` would fix this surface by breaking the other two.

Recorded here because M6 has no reason to open the deposit editor, and a defect created by one story
and surfacing in another is exactly what gets lost.

- **Trigger:** **M6.** Anyone implementing service deactivation must check all three consumers above,
  starting with `PaymentConfigService.previewPolicy`.

### T45 — ~~`MIN_DEPOSIT_AMOUNT` is a placeholder, not a measured limit~~ — **CLOSED (B5, 2026-08-19)**

**Status:** accepted · **Effort:** ~30 min (one lookup, one constant) · **Added:** PC3 (2026-08-15)

`src/server/domain/models/depositPolicy.ts` floors every computed deposit at `MIN_DEPOSIT_AMOUNT`,
currently **`'1.00'` ARS**. The floor has to exist: a percentage policy applied to a cheap service
computes amounts like $0,50, and a charge below a gateway's minimum cannot be created — the failure
would land inside a client's checkout rather than at configuration time.

**What that number is, PC3 did not verify.** No Mercado Pago documentation was consulted for the
real minimum chargeable amount in ARS; `1.00` was chosen as a value that is obviously above zero and
obviously below any plausible deposit. It is marked provisional in the code, in `data-model.md` §14,
and here — three places, because an unverified number that looks settled is exactly how the next
story treats a guess as established.

Both directions are wrong in their own way. Set **above** the real minimum, it silently raises small
deposits the gateway would have accepted. Set **below**, it fails to protect, and B5 meets the
rejection it was supposed to prevent.

The blast radius is small today: it only binds on services cheap enough for a percentage to compute
under a peso, and the owner is warned by name at configuration time when that happens.

- ~~**Trigger:** **B5**, which is the first story to call Mercado Pago with a real charge and therefore
  the first in a position to know.~~ — **fired, and answered.**

**Closed by B5 on 2026-08-19. `MIN_DEPOSIT_AMOUNT` is now `15.00` ARS, measured.**

Read from Mercado Pago's `/v1/payment_methods` against a real Argentine account. Sixteen active
methods, in four bands:

| band                                       | `min_allowed_amount` |
| ------------------------------------------ | -------------------- |
| prepaid cards (Visa, Mastercard, Cabal)    | 1 ARS                |
| debit, and Visa / Mastercard / Amex credit | 3 ARS                |
| Diners, Naranja, Argencard, Cabal credit   | 15 ARS               |
| Rapipago, Pago Fácil (cash tickets)        | 50 ARS               |

**15 was chosen because it is the point at which every card method works**, and cards are what this
product charges with. Both alternatives were rejected in writing. **1** is the literal floor — below
it nobody can pay at all — and it satisfies the letter of this entry while missing its purpose: a
two-peso deposit is payable only by prepaid card, so a client with an ordinary Visa reaches the
checkout and finds nothing usable, which is this entry's failure arriving two pesos later. **50**
would raise a configured deposit twenty-five times over in order to preserve cash methods the
product has never offered.

**How the number was reached matters as much as the number**, because the first attempt was wrong in
the direction this entry warns about. The gate originally created preferences at descending amounts
and reported the smallest accepted — and accepted every one, down to **0.01 ARS**. A preference is a
checkout _link_; Mercado Pago validates the charge when somebody pays, not when the link is made. The
probe had found nothing, and `0.01` would have closed this entry with a figure that looked measured
and was not — the exact failure described above, committed by the story sent to fix it. The result
was too clean to believe, which is the only reason it was caught.

Updated in `src/server/domain/models/depositPolicy.ts`, `docs/data-model.md` §14, and here. Pinned by
a test that asserts the value rather than only its shape, so it cannot drift back to a guess quietly.

**One consequence survives, as `T61`:** a deposit between 15 and 50 ARS is payable but silently
offers the client fewer payment methods than a larger one, and nothing says so.

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

### T43 — No account-switch warning when Mercado Pago is unreachable

**Status:** accepted · **Effort:** ~2 h · **Added:** PC2 (2026-08-13)

Replacing Mercado Pago credentials with a **stranger's** — valid, live, but belonging to someone
else — is the failure that sends every future deposit elsewhere, and no format check can catch it.

PC2 answers it by naming the account on the confirmation screen, from what Mercado Pago returns
during verification. That works **only when Mercado Pago is reachable.** When it is not, the save
still proceeds (by design: a third party being down must not block a settings save) and the
confirmation falls back to four characters of the token, which tells the owner almost nothing.

An offline version was built and withdrawn. It compared the token's trailing numeric segment across
the old and new credentials, on the belief that the segment is the Mercado Pago account id — true of
the OAuth reference example, false of real panel-issued credentials, where the segment read
`1325562541` against a User ID of `156842883`. A comparison of two meaningless numbers is worse than
none: a false "different account" trains the owner to dismiss the warning, and a false "same account"
suppresses it in the one case it exists for.

Closing it properly means storing the **verified** account id — the one Mercado Pago returns — so a
later replacement can be compared against it without another call. That needs a column and a
migration, which PC2 otherwise avoided entirely.

- **Trigger:** B5, which is the first story to call Mercado Pago with the stored token in anger and
  therefore the first that can record the verified account id as a by-product; or the first report of
  payments arriving in an unexpected account.

### T42 — Nothing warns an owner who ships with test credentials

**Status:** accepted · **Effort:** ~2 h · **Added:** PC2 (2026-08-13)

PC2 set out to render a persistent banner whenever the stored Mercado Pago credentials were test
ones, so an owner could not publish their booking link and silently take bookings that never charge.

**That protection does not exist**, because the signal it was built on turned out not to be one.
Mercado Pago's "Tus integraciones" panel issues the `APP_USR-` prefix for **test and production
alike** — confirmed against a real account during verification. Only the legacy `TEST-` prefix
identifies a test credential, and current accounts do not produce it.

What was removed is the _claim_: the page previously printed `Entorno: Producción` for every
`APP_USR-` credential, which was false for test ones and read as confirmation. It now shows the
account id, which is a fact, and says nothing about the environment it cannot determine.

Nothing available closes the gap. No documented Mercado Pago call distinguishes a test credential,
and the credential string does not carry it. The two candidates, neither taken:

- **The owner declares it** with a checkbox. Needs a new column and a migration, and its protection
  is only as good as the owner remembering to tick — and to untick.
- **Infer it from an undocumented response field**, on top of `/users/me`, which is already
  undocumented. A safety banner resting on that can vanish without notice.

What partially covers it today is **D6a**: switching from test to production credentials changes the
Mercado Pago account, and the confirmation states that prominently. That catches the _transition_,
not the steady state of having shipped with the wrong ones.

**A lead worth following, found after this entry was written.** During the live verification, Mercado
Pago's verification response named the account **`TEST_USER_1842645601`**. The credential string says
nothing about the environment — but the **account nickname does**, explicitly, for a test account.

That is a real signal and it costs nothing: the verifier already makes that call and already reads
`nickname`. It carries the same caveat as everything else resting on `/users/me` — undocumented, so
it may change without notice — which makes it usable as a _hint that raises a warning_, never as the
thing a "you are safe to launch" claim depends on. Consider it evidence to confirm rather than a
mechanism to adopt untested: the pattern to check is whether test accounts reliably carry a
recognisable marker, against more than one account.

- ~~**Trigger:** PC3, which builds the payment-readiness view…~~ — **fired. The view was built; the
  detection was not.**

**PC3 update (2026-08-15).** The readiness view now exists, on `/sena`: it states whether the
business can take bookings, and names which half is missing — a payment method, a deposit policy, or
both. It reads `hasMercadoPagoCredentials`, the presence flag the repository derives without
decrypting, so it never touches `PAYMENT_CREDENTIALS_KEY`.

**Test-credential detection was deliberately left out**, and the reason is the readiness panel
itself. That panel is precisely what an owner consults before publishing their booking link, so a
false "ya podés recibir reservas" resting on an undocumented `/users/me` field observed against
**one** account would be worse than the panel saying nothing about environment at all — it would
convert a silent gap into an explicit reassurance.

The `TEST_USER_` nickname lead still stands and is still the best one available. What it needs
before anything is built on it: confirmation that the marker appears reliably, against more than one
test account, and a decision about what the panel says when the marker is merely absent.

- **Trigger:** unchanged in substance — the first story or session that can check the nickname marker
  against several real test accounts. The place it belongs is now built and waiting for it.

**The risk INVERTED on 2026-08-22, and this entry is now about the opposite failure.** Franco replaced
the stored credential with his **production** one while closing B5. The booking flow is deployed and
public, so **real money can now move**: anyone who reaches the shop's link can be charged for real,
and there is still no warning anywhere in the dashboard saying which environment is configured.

The entry's original fear was an owner shipping test credentials and taking bookings that never
charge. The live fear is now its mirror — an owner _testing_ against a production credential and
charging somebody by accident — and **the same missing signal causes both**. Neither direction is
detectable today, because Mercado Pago stopped issuing the `TEST-` prefix and `APP_USR-` says
nothing. That is what makes this entry worth more than it looks: it is not a nicety about a label,
it is the only thing that would tell an owner whether the next tap on "Pagar seña" moves money.

**Re-costed by B5 (2026-08-19) — the consequence arrived.** Every previous costing of this entry could
only describe a configuration curiosity, because nothing in the product charged anything. B5 confirms
appointments automatically on an approved payment. **An owner who saved `TEST-` credentials now has
real clients completing a checkout that moves no money, against bookings the system marks `CONFIRMED`
and the barber will hold time for.** The blast radius moved from "a label in the dashboard is unhelpful"
to "the agenda fills with appointments nobody paid for", and the owner has no surface that would say so.

**And the fix is NOT unchanged — an earlier version of this paragraph said it was, and that was
wrong.** It leaned on `MercadoPagoView.environment` as though it were a working signal. It is not:
`credentialEnvironment` only ever returns `'test'` for the legacy `TEST-` prefix, and Mercado Pago
no longer issues that form — confirmed again while running B5's gate, where a current test credential
arrives as `APP_USR-` exactly like a production one. So the marker this entry's remedy was going to
read **can never fire on a credential issued today**, and any banner built on it would be dead code
that looks like protection.

Whatever closes this has to come from somewhere else. Three candidates, none of them free:
ask Mercado Pago `/users/me` and compare the account against a known test-user list; have the owner
declare which environment they configured and store the declaration; or detect it after the fact,
when a payment approves for an amount and card that could only be sandbox. The first is the only one
that does not rely on the owner being right, and it is undocumented territory — the same endpoint
T43 already records as decoration rather than authority.

- **Trigger:** unchanged in substance, but the effort is no longer ~2 h and the approach is undecided.
  Re-estimate before starting: this is now a research task with a small implementation, not the
  reverse.

### T38 — No key-rotation or re-encryption tooling

**Status:** accepted · **Effort:** ~3 h · **Added:** PC2 (2026-08-13)

`PAYMENT_CREDENTIALS_KEY` encrypts `PaymentConfig.mpAccessToken`. The stored envelope carries a `v1`
version marker precisely so a key or algorithm change can identify what it is reading — but **nothing
performs the rotation**. There is no re-encryption script and no dual-key read path, so rotating the
key today makes every stored credential unreadable at once.

The `v1` marker is the whole preparation: adding a `v2` and a read path that accepts both is the
shape of the fix, and it was left undone because a rotation nobody has needed is speculative work on
the project's most sensitive column.

- **Trigger:** a suspected key compromise, the first additional secret stored in this table, or PC3
  if it adds one.

### T39 — A lost key is unrecoverable, and only the dashboard says so

**Status:** accepted · **Effort:** ~0 (documented, not fixed) · **Added:** PC2 (2026-08-13)

If the key is lost, or rotated without T38's re-encryption, every stored Mercado Pago credential is
permanently unreadable. The recovery _is_ re-pasting them, which is acceptable — the credentials
still exist in the owner's Mercado Pago panel.

What was built is the reporting: the dashboard decrypts on load and renders an **Unreadable** state
distinct from both "configured" and "not configured", with re-entry offered inline (design D12).
Without it the page would render a healthy "configured" panel and B5 would meet the failure in a
client's checkout.

The gap: **only that page reports it.** Nothing checks proactively, so an owner who does not visit
`/mercado-pago` learns about it when a payment fails.

- **Trigger:** B5 shipping, which is the first code that reads the token for real — it should surface
  the same distinction rather than treating an unreadable credential as an absent one.

### T40 — The public key cannot be proven to belong to the verified account

**Status:** accepted · **Effort:** unknown — may not be possible · **Added:** PC2 (2026-08-13)

PC2 verifies the **access token** against Mercado Pago and shows the owner which account it belongs
to. It does **not** prove the _public key_ belongs to that same account: no available call ties the
two, and the public key's body is an opaque UUID that encodes nothing.

Three checks narrow it — shape validation that rejects each credential in the other's field
(design D9), the environment-consistency rule (D8), and the account-identity confirmation (D6) — so
the plausible mistakes are covered. The residual case is a well-formed public key from a _different_
account of the owner's own, which would produce a checkout that initializes against one account while
charges are created on another.

- **Trigger:** the first report of a Mercado Pago payment that initializes but does not complete, or
  any Mercado Pago API change that exposes the public key's owner.

### T41 — `intent` values are not namespaced per form

**Status:** ~~accepted~~ · **Effort:** ~30 min · **Added:** PC2 (2026-08-13)

Both PC1's and PC2's editors carry the owner's confirmation answer on the pressed button as `intent`,
with values like `confirm` and `edit`. They live on separate pages today, so nothing collides.

PC3 adds the deposit policy to this settings area. If two forms ever share one page, `FormData.get`
returns the **first** value for a name — the same hazard the button-not-hidden-field rule exists for,
one level up — and one form's confirmation could be consumed by the other's action.

- ~~**Trigger:** PC3, or any change that puts two confirming forms on one page. The fix is prefixing
  the values (`mp-confirm`, `deposit-confirm`) before the second form lands, not after.~~ — **fired.**

**CLOSED by PC3 (2026-08-15), before the collision was reachable.**

The eight `intent` values a form can now submit are namespaced: `transfer-confirm`, `transfer-edit`,
`mp-confirm`, `mp-edit`, `mp-remove`, `mp-confirm-remove`, `deposit-confirm`, `deposit-edit`. Each
action recognizes only its own prefix and treats every other value as unconfirmed, which is asserted
by test — including that a `mp-confirm` submitted to the transfer action does **not** confirm.

Done as the entry prescribed: **before** the third form landed, not after. The three editors that
share this settings area all decide where a client's money goes, and a confirmation consumed by the
wrong action is a guard that asks and then ignores the answer.

Two `intent` reads deliberately left alone, because neither is a submitted confirmation:
`MercadoPagoCredentialsForm`'s `state.pendingIntent` is internal form state (`'save' | 'remove'`),
and `/perfil`'s image-removal intent belongs to P1's own form on its own page.

### T35 — No audit trail for changes to the transfer destination

**Status:** accepted · **Effort:** ~3 h · **Added:** PC1 (2026-08-13) · **Re-scoped:** PC2 (2026-08-13)

`PaymentConfig.updatedAt` is overwritten on every save, so there is no record of what the CBU/alias
was before a change or when it changed. This is the only value in the product whose corruption moves
real money: if a client's deposit lands in an account nobody recognizes, there is nothing to
reconstruct a timeline from.

What exists instead is a structured log line per successful write carrying the **previous and new
last four digits** plus presence flags — enough to answer "when did this change" from the log stream,
and never enough to expose the account itself. That was chosen over building a `PaymentConfigAudit`
table now, which would be forensics for an incident class that may never occur; the log line is what
makes the incident investigable if it does.

The gap is retention: Cloudflare Workers logs are not kept indefinitely, so an incident discovered
months later has nothing to read.

**PC2 re-scoped this rather than closing it.** The same table now holds Mercado Pago credentials, and
its trigger named that case. PC2 applied the same treatment instead of building the audit table: each
successful credential write logs `previousTokenLastFour` alongside `tokenLastFour`, plus the
environment and whether Mercado Pago verified the pair — enough to reconstruct _when the account
changed_ from the log stream, and never enough to expose a credential.

Credential rotation is in one way better covered than the transfer destination: the account id is
recoverable from the token itself, so a switch between Mercado Pago accounts is stated to the owner
at the moment they make it (design D6a), not merely reconstructable afterwards. The transfer
destination has no equivalent — no checksum can tell whose account a valid alias is.

**PC3 extended it to the third column pair, and this one needs no redaction.** Each successful
deposit-policy write and removal logs `previousType`/`previousValue` alongside `newType`/`newValue`
**in full**. The deposit policy is not a secret — it is disclosed to every client who books — so
unlike the transfer destination and the credential, there is nothing to withhold. Copying the
redaction pattern here would have carried the mechanism without its reason and thrown away the only
audit trail this story produces for free.

That makes the deposit policy the best-covered of the three: "what was the seña before this, and
when did it change" is answerable exactly from the log stream, not merely narrowed to four digits.

The retention gap is unchanged and now covers all three.

- **Trigger:** the first report of a deposit that did not arrive, of payments arriving in an
  unexpected Mercado Pago account, or of a client charged an amount the owner does not recognize. At
  that point the log stream is what gets read, and if it has already rolled over, the audit table
  becomes work rather than debt.

### T36 — Two tabs editing the transfer destination is last-write-wins

**Status:** accepted · **Effort:** ~1 h · **Added:** PC1 (2026-08-13)

The save carries no concurrency token, so two tabs editing the destination resolve by whichever
commits last. No warning, no conflict.

Accepted because producing the conflict requires **one person to race themselves**: the product has
exactly one administrative user, and `docs/base-standards.md` §4 fixes that for this version. The
blast radius is also bounded by design D5 — the write names only the three transfer columns, so a
lost update cannot reach across into PC2's credentials or PC3's deposit policy.

The confirmation step (design D14) partially covers it by accident: the second tab's save shows the
owner the destination it is about to store, which is where they would notice it is not the one they
just saved in the other tab.

- **Trigger:** the first story that introduces a second administrative user or any shared-account
  access. At that point the fix is an `updatedAt` token in a hidden field, compared at write time.

### T44 — The no-JavaScript promise is false for every dashboard form

**Status:** **needs a decision** · **Effort:** unknown — see the two causes · **Added:** PC2 (2026-08-14) · **Scope widened:** D1 (2026-08-24)

`docs/frontend-standards.md` states "the house promise that the form submits correctly before
hydration and with JavaScript disabled". **That promise does not hold anywhere in the dashboard.**
Measured with JavaScript disabled, in a **production build**, not just `next dev`:

**Cause 1 — the form does not render.** `app/(dashboard)/loading.tsx` wraps the whole segment in a
Suspense boundary. Its content is streamed and attached by inline scripts, so with JavaScript off the
client components inside never appear: the page renders its heading and its server-rendered cards,
and the `<form>` is simply absent. `/login` has no `loading.tsx` and its form renders correctly — that
is the control that identifies the cause. Removing the **group-level** file makes the form appear;
removing only the per-route one does nothing.

**Cause 2 — and this is the harder one — the form gives no feedback.** With the form rendered, a
submission that must produce an error produced none: `useActionState` does not restore its returned
state after a no-JavaScript POST unless a `permalink` is supplied. The action runs, the page
re-renders from the **initial** state, and the owner sees an unchanged form. No error, no
confirmation, no success. Nothing is written, so it is safe — but it is silent, and a confirmation
step that can never be reached is a confirmation step that does not exist.

Cause 2 makes fixing cause 1 pointless on its own, which is why nothing was changed: removing the
loading skeletons across ten routes would buy a form that renders and still says nothing.

Options, none taken:

- **Accept it and amend `frontend-standards.md`**, so the project stops claiming something untrue.
  Cheapest, and honest. The claim currently misleads every future story that reads the standard.
- **Supply `permalink` to `useActionState`** on the forms that matter, and drop the group-level
  `loading.tsx`. Restores the promise; costs the skeletons and needs a per-form URL.
- **Server-render the error state from the URL** instead of from action state. Largest change.

- ~~**Trigger:** PC3 and the booking flow both add forms…~~ — **fired at PC3. Decided, not yet
  implemented.**

**PC3 decision (2026-08-15): option 2, "implemented in B4" — superseded (2026-08-17), see below.**

PC3 added a fourth form and inherited the behaviour exactly as predicted. It was **not** fixed in
that story, and that was a choice rather than an omission:

- Fixing it means supplying a `permalink` per form **and** dropping the group-level `loading.tsx`
  across ten routes. That is a decision about the whole dashboard's loading architecture, and riding
  it along inside a settings editor would bury it where nobody would find the reasoning.
- The population affected today is still **one person** — the owner, on their own machine. PC3 does
  not widen it.
- **B4 is where it stops being cosmetic.** From B4 onward the forms are used by guest clients, and a
  form that silently accepts a submission and reports nothing would take a booking without telling
  the client whether it worked. That is the story that must not inherit this.

Option 1 (amend `frontend-standards.md` to stop claiming something untrue) is **not** taken, because
the claim is the thing that keeps every form in this project built correctly — native `<form>`,
uncontrolled inputs, confirmations as server-returned state, cancel controls as submit buttons. Every
one of those choices is right on its own merits and would decay if the standard dropped the promise.
The standard is aspirational for the dashboard today and should stay so until that half is fixed.

**B4 revision (2026-08-17): option 2 was unexecutable as written, and this entry now splits in two.**

`backend-standards.md`'s API Design Standards make the public booking flow's mutations **Route
Handlers**, a hard rule with its own reasoning, not a Server Action — and PC3's option 2
(`permalink` + `useActionState`) is a Server Action pattern. B4's form posts to `POST /api/bookings`,
where `useActionState` has no role at all. The decision could not be carried out by the story it was
assigned to, which is a sharper failure than being merely undone: it was never a coherent instruction
for that surface.

**What B4 actually did (option 3, decided fresh):** the handler answers a browser submission with a
redirect carrying an outcome code, and the receiving page renders that outcome — success, each
validation failure, slot-taken, not-payment-ready, throttled — from the URL, on the server, before
hydration. This is not a workaround borrowed from the dashboard's problem; it is the shape a Route
Handler naturally produces, and it satisfies the house promise on the one surface a stranger actually
reaches without touching `loading.tsx` or `useActionState` anywhere.

**What remains open, and is now this entry's sole scope:** the ten dashboard forms behind
`app/(dashboard)/loading.tsx`, still built on Server Actions, still silent with JavaScript off, for
the reasons Cause 1 and Cause 2 above describe. B4 does not touch them and does not need to — nothing
in the public booking flow depends on the dashboard's loading architecture. Fixing them is still a
`permalink`-per-form-plus-skeleton-removal decision, or a move to the same server-rendered-from-URL
shape B4 just proved out, which is now a validated precedent rather than a hypothesis.

- **Trigger:** the next dashboard story that adds or meaningfully touches a form, or any report of a
  no-JavaScript dashboard submission producing no feedback — whichever comes first. Not B4 again.

**D1 widened Cause 1, and the widening is the finding (2026-08-24).** D1 added no form and no client
component — its barber filter is a `<form method="get">` with a native `<select>`, in a page that
ships **no client JavaScript at all**. It was written up as the first dashboard page whose only
interaction works with JavaScript disabled. Driving the production build on `workerd` with JavaScript
off proved that false, and not in the way this entry predicted:

> Cause 1 says the page "renders its heading and its server-rendered cards, and the `<form>` is
> simply absent". On `/` **nothing renders**. The skeleton is served and never resolves — no heading,
> no counters, no filter.

The mechanism is the same streamed boundary; the scope is larger than measured. PC2 was looking at
pages whose shell renders outside the boundary and whose _client components_ fall inside it. D1's page
is `force-dynamic` with its entire body awaiting a database read, so **everything** is inside, and
what fails is not "client components do not attach" but "the fallback is the whole response".

Two consequences worth carrying:

- **A page of pure Server Components is not immune.** Writing a route with no client JavaScript is not
  a route around this entry — which is exactly the mistake D1's design made. Any dashboard route
  behind a `loading.tsx` is affected regardless of what it is built from.
- **The per-route escape does not exist.** D1 put its skeleton in a `(home)` route group to avoid
  giving the create/edit forms a counter-grid fallback. Deleting that file does not restore the page:
  it inherits `app/(dashboard)/loading.tsx` instead, which has covered `/` since A1. Cause 1 already
  said "removing only the per-route one does nothing", and D1 is the case that confirms it.

**Nothing was changed in D1**, on the reasoning this entry has carried since PC3: fixing one page
while ten forms stay silent buys little, and the fix is a decision about the whole dashboard's loading
architecture. What D1 changed is the **claim** — the design note, the spec requirement and the roadmap
entry were corrected to state that the page adds no client JavaScript and to stop asserting it works
without it.

- **Trigger (unchanged, with one addition):** as above, **or** the first time a story is tempted to
  claim no-JavaScript support for a dashboard route on the grounds that it contains no client
  components. That reasoning is now known to be wrong.

### T37 — The transfer editor's no-JavaScript path is reasoned, not verified

**Status:** accepted · **Effort:** ~20 min · **Added:** PC1 (2026-08-13)

`frontend-standards.md` requires that forms submit correctly before hydration and with JavaScript
disabled, and the transfer editor is built to satisfy it: a native `<form action={serverAction}>`,
uncontrolled inputs, no `onClick` handlers, the confirmation step rendered as **server-returned form
state** rather than a dialog, and the "Volver a editar" control implemented as a submit button
carrying `name`/`value` rather than a script.

Every one of those is a design choice made for this reason — but the path was never actually driven
with JavaScript off. Every other verification for PC1 ran with it on.

The specific thing worth checking is the **confirmation round trip**, not the plain save: it is the
only two-step flow in the dashboard, and it is the step that stands between a mistyped destination
and a client's deposit reaching a stranger. If it silently required JavaScript, the owner most likely
to meet the failure is one on a locked-down or ancient browser, and they would be confirming nothing
while believing they had.

- ~~**Trigger:** the next change that touches `TransferDetailsForm.tsx`~~ — **fired, and answered.**

**CLOSED by PC2 (2026-08-14). The answer is no: it silently requires JavaScript.**

Verified with JavaScript disabled against a production build, on both `/transferencia` and
`/mercado-pago`. The suspicion recorded above was correct, and understated: the confirmation does not
merely fail to work, the **form does not render at all**, and when forced to render it accepts
submissions and reports nothing back.

Every design choice listed above was made correctly — native `<form action={serverAction}>`,
uncontrolled inputs, no `onClick` handlers, the confirmation as server-returned form state, the
cancel control as a submit button carrying `name`/`value`. None of them was the problem. The
promise is broken one level up, by the framework's streaming boundary and by `useActionState`'s
state not surviving a no-JavaScript POST.

That is why this closes rather than becoming a PC2 fix: the cause is project-wide, not in either
form, and the remedy is a decision about the whole dashboard. It moves to **T44**.

---

### T52 — A day with working hours but no free time looks selectable until you tap it

**Status:** accepted — **deliberate, and the cheaper of two honest answers** · **Effort:** ~2 h (a per-day availability summary, or a cached one) · **Added:** B3 (2026-08-16)

The date strip marks a day the barber does not work at all, because that costs nothing: the seven
schedule rows are already loaded. It does **not** mark a day whose every slot is taken or covered by
an absence. Those days render as ordinary options, and the client learns the truth one tap later,
from the slot step's empty state.

**The alternative was measured and refused.** Answering "is anything free that day" for the whole
strip means one full availability computation per day — sixty of them, each a composed read of
windows, absences and bookings — on the public route that has neither a cache nor a rate limit and
draws from the pool the owner's dashboard shares (T47). At ~400 ms per read that is not a page, it is
an outage waiting for a crawler.

What it costs today is one wasted tap on a fully-booked day, on a shop with no bookings at all. What
it would cost the other way is the busiest public route in the product.

**This entry exists so nobody "fixes" it without knowing the price.** The right solution when it
becomes real is not to compute the strip honestly — it is to cache the per-day answer, or to derive a
cheap upper bound (a day with no absence and no booking cannot be full) and mark only the days that
bound rules out.

**B4 made it reachable for the first time (2026-08-17).** B3 shipped this with the table empty, so no
day could ever be full and the wasted tap was theoretical. Bookings can now be created, so a fully
booked day is a state a real client can meet — and they meet it exactly as designed: the day looks
selectable, the slot step renders `emptyDay`, and they pick another. Nothing changed in the code;
what changed is that the entry now describes something that happens.

- **Trigger:** the first barber whose days are regularly full, or any complaint about tapping into an
  empty day. Also: whenever T47 gets a cache, since that is what makes the honest version affordable.

### T53 — The lead time and the booking horizon are guesses, and they are per-product not per-shop

**Status:** accepted · **Effort:** ~3 h (per-owner settings, with the dashboard UI) · **Added:** B3 (2026-08-16)

`MIN_BOOKING_LEAD_MINUTES` is 60 and `MAX_BOOKING_HORIZON_DAYS` is 60. Both are judgements made
without a single real shop using the product, and both are wrong for someone:

- A barbershop that takes walk-in-shaped bookings wants the lead time at 15 minutes or zero, and
  currently loses an hour of sellable time every day.
- A shop that books a month out does not want sixty days of strip; one that books seasonally may want
  more.

Neither is a safety bound, so neither is dangerous to change — but both are currently a deploy rather
than a setting, and the horizon is also load-bearing for T47's parameter space, so raising it is not
free.

**B4 added a third to the same family (2026-08-17): `HOLD_DURATION_MINUTES` = 15.** Comfortable for a
Mercado Pago checkout, tight but workable for locating a bank transfer destination — and, like the
other two, a judgement made before any real shop used the product. It is the one of the three with a
cost in both directions: too short expires a client who was genuinely paying, too long lets an
abandoned checkout hold a slot four times an hour, which is what makes the per-client cap load-bearing
(`BookingCreationService.MAX_LIVE_HOLDS_PER_CLIENT`, itself a fourth guess of the same kind).

One interaction to note before lowering the lead time: `holdExpiresAtFor` clamps the hold at
`startTime`, and that clamp is currently unreachable _only_ because the lead time is 60 minutes.
Lowering it below the hold duration makes the clamp live. It is written into the rule and tested, so
this is a fact to know rather than a change to make.

- **Trigger:** the first owner who asks for any of them, which is likely to be the first owner. **B6**
  for the hold duration specifically — it is the first story that can measure how long uploading a
  transfer receipt actually takes.

**B6 added a fourth, and could not do what this entry asked of it (2026-08-22).**
`TRANSFER_HOLD_DURATION_MINUTES` = **45**, applied when a client commits to paying by transfer,
declared beside the other three and under the same clamp.

The trigger above named B6 as "the first story that can measure how long uploading a transfer
receipt actually takes". **It cannot, and pretending otherwise would be the failure T45 recorded** —
a probe that reports a number it was not really measuring. No real shop has used this product, so
there is nothing to measure; 45 is a judgement about a sequence nobody has timed: authenticate into
a banking app, register a destination (several Argentine banks gate that behind their own
confirmation step), transfer, capture, return, upload.

What B6 delivers instead is the constant, its home, and the reasoning — including why it is not 60.
`MIN_BOOKING_LEAD_MINUTES` is 60, so a 60-minute hold would sit exactly on `holdExpiresAtFor`'s
clamp for the nearest bookable appointment. **That clamp is no longer theoretical**: at three times
the creation duration it is materially closer to being reached, and `b6-gate.ts` (11.6c) exercises
it against a real row, where `holdExpiresAt` came back equal to `startTime` to the millisecond.

The cost of being wrong is asymmetric in a way the other three are not. Too long holds a slot; too
short leaves a client who has already transferred real money with **no row anywhere recording that
they paid**, because unlike the Mercado Pago path there is no gateway to ask afterwards.

- **Trigger (added):** the first real transfer. One shop's first week of `transfer.commit` and
  `transfer.receipt` log lines is enough to replace all four of these guesses with measurements, and
  this is the one where being wrong costs the most.

**B7 added a fifth, and it is the first of the family that protects another path rather than sizing a
client's patience (2026-08-23).** `EXPIRY_GRACE_MINUTES` = **10**: how long after a hold has lapsed
the sweep waits before writing `EXPIRED`.

It exists because `confirmIfSlotFree` — B5's guarantee that an approved payment still confirms a
booking whose slot nobody took — is guarded on the booking still being `PENDING_PAYMENT`. A sweep
with no grace would flip the row first, and every approval arriving just after the deadline would
become an approved charge against an appointment that no longer exists. Mercado Pago's preference
expiry is set to `holdExpiresAt`, so it refuses an attempt _begun_ after the deadline; it does
nothing about one begun thirty seconds before it and approved a minute after.

**Unlike the other four, being too generous costs nothing at all**, and the first draft of this
entry got that wrong — it claimed a client could "occupy a hold for `HOLD_DURATION_MINUTES +
EXPIRY_GRACE_MINUTES`, bounded by `MAX_LIVE_HOLDS_PER_CLIENT`". **Both halves of that are false**,
and an adversarial pass before archiving caught it. Availability released the slot when the hold
lapsed, because it reads `holdExpiresAt` and not the status, so nothing is held during the grace.
And `countLiveHoldsForClient` asks the same question — its predicate is `holdExpiresAt > now` — so
the row stops counting against the client's cap at the deadline too, not at the cutoff.

**What the grace actually delays is one thing only: the status write.** No slot, no cap, no client
experience. That is precisely why it can be generous. Being too _short_ costs a client their paid
appointment, which is why the value leans long — the asymmetry is total, with a real cost on one
side and none on the other.

**This is the one of the five with a clear path to being measured**, and it needs no shop to be
using the product for real money: the interval between a `payment.confirm` log line and the
`holdExpiresAt` of the booking it names is the delivery latency, directly. A week of them replaces
this guess with a distribution.

- **Trigger:** the first `bookingUnavailable` outcome in production whose payment was approved
  within an hour of the deadline. That is this constant being too short, and the log line already
  carries everything needed to see it.

### T54 — A returning client's rename re-labels every booking they ever made

**Status:** accepted — **decided, not discovered** · **Effort:** ~1 h now (a migration over an empty
table), unknown later · **Added:** B4 (2026-08-17)

`Client` is deduplicated by `(ownerId, email)`, and a returning client's `name` and `phone` overwrite
what is stored. That is the right default: the owner needs the number that answers today, and a
client who corrects a typo expects the correction to stick.

The cost is that **`Booking` snapshots `priceAtBooking` and `depositAmount` but no contact detail**.
So an overwrite silently rewrites what every earlier booking by that client displays — in D1's
dashboard, in D4's client table, in D3's calendar. A booking from March shows the name entered in
September.

Two realistic ways it bites: a client mistypes their name, corrects it later, and the correction
propagates backwards through history that should be immutable; or two people share one email address
(a couple booking back-to-back), and each booking is labelled with whoever booked most recently.

**The alternative was considered and declined.** Snapshotting `clientName` and `clientPhone` onto
`Booking` would fix it exactly, and today it costs a migration over a table with **zero rows** — this
is the cheapest this fix will ever be. It was declined because B4 was already the concurrency-critical
story and `data-model.md` §11 does not model contact snapshots, so adding two columns mid-change would
have been a schema decision ridden along inside a transaction review. That reasoning expires the
moment the table is not empty.

- **Trigger:** **D1 or D4** — the first surfaces that render a client's name against a historical
  booking, and therefore the first place anyone can see this. Fix it before the table has meaningful
  volume, because the migration is the whole cost and the migration only gets more expensive.

**D1 arrived, decided against fixing it here, and the entry's cost is no longer what it says
(2026-08-24).** The paragraph above prices this at "a migration over a table with **zero rows**" and
calls that "the cheapest this fix will ever be". `Booking` has had a writer since B4 and the table is
no longer empty, so that sentence is now false — and this entry itself warns that an accepted debt
whose written justification is false is worse than one with no justification, because the next reader
treats it as still-evaluated. Correcting it is the point of this note.

**Why not in D1**, stated so the deferral is a decision rather than an omission:

- **D1 barely exposes it.** The recent-bookings list is ten rows ordered by `createdAt`. The failure
  this entry describes — a booking from March showing the name entered in September — needs distance
  between the booking and the rename, and ten recent rows rarely have any. **D4's client table and
  D3's calendar are where it bites**, and both render history by design rather than by accident.
- **The fix is a write-path change and D1 contains no writes.** Snapshotting `clientName` and
  `clientPhone` means two columns _and_ an edit to B4's booking transaction — the concurrency-critical
  one. Riding that into a read-only story is the same objection B4 used to decline it in the first
  place, pointed the other way.

**Revised cost:** still a migration plus a write-path edit, but now over a table with rows, so it
needs a **backfill decision** the original never had to make: existing bookings have no snapshot, and
either they are backfilled from the current `Client` row (which stamps today's possibly-wrong name
onto history permanently) or the columns are nullable and every reader falls back to the join. The
second is correct and is more work than the entry has ever priced.

- **Trigger (narrowed):** **D4**. D1 has passed and is spent as a trigger. Decide the backfill
  question when D4 renders the client table, because that is the surface that makes the wrong answer
  visible.

**D4 arrived, answered the backfill question, and corrected this entry about itself (2026-08-27).**

**The correction first, because it changes what this entry is for.** The paragraphs above say
*"D4's client table and D3's calendar are where it bites"*. **For D4 that is wrong.** This debt is
about a rename propagating backwards through *historical bookings*; the clients table renders the
`Client` row itself, which is current by definition — the newest name is the correct thing to show
there, and showing it is not a defect. **D3's calendar and D1's recent list are where it bites**, and
D3 shipped without addressing it. D4 is where the *cause* is visible without the damage being
visible, which is a weaker claim than the one recorded and was worth catching before somebody
"fixed" a page that was already right.

**The decision, which is what the trigger actually asked for:** nullable `clientName` and
`clientPhone` snapshot columns on `Booking`, **no backfill**, and readers falling back to the join
when the snapshot is null. Backfilling existing rows from the current `Client` stamps today's
possibly-wrong name onto every historical booking at once — which is this entry's own defect, applied
universally, rather than the fix for it. Nullable columns mean history written before the change
keeps saying "we do not know", which is true, and history written after it is immutable, which is the
point.

**Not implemented in D4**, and the reason is D1's own: the fix is a write-path change to B4's
booking transaction — the concurrency-critical one — and D4 contains no writes. Riding a schema
decision into a read-only story is how a transaction gets edited without a transaction review.

- **Trigger (re-stated):** the next change that touches B4's booking write for any reason, or the
  first owner report of a historical booking showing the wrong name. The decision above is made;
  what remains is one migration and one edit inside the transaction.

### T55 — The booking write's throttle is per-isolate and does not defeat a distributed attempt

**Status:** accepted · **Effort:** ~2 h (a Cloudflare rate-limiting rule, shared with T47) · **Added:**
B4 (2026-08-17)

`bookingThrottle.ts` limits `POST /api/bookings` to 10 attempts per origin per minute. It is a
`Map` inside one isolate, and `workerd` gives no counter shared across them, so an attacker
distributing requests simply lands on different instances and each sees a fresh map. What it does
defeat is one script, one address, a tight loop — the shape of nearly every real abuse of an
unauthenticated endpoint, and the reason it is worth having at all.

**The bound that actually holds is elsewhere and is deliberate.**
`MAX_LIVE_HOLDS_PER_CLIENT` (3) is checked against the database, so it cannot be spread across
isolates: the rows are shared even when the isolates are not. An attacker can still burn requests, but
they cannot hold more than three slots per email address per owner — which is the outcome that
actually costs the owner money.

This entry exists because an accepted debt with a false justification is worse than one with none
(B1 design D12). The throttle looks like a rate limit and is not one; nobody should read its presence
as meaning the endpoint is rate-limited.

The real fix is the one T47 has been pointing at for three stories: a **Cloudflare rate-limiting
rule**, which is edge-side, shared across isolates, and covers the read surface at the same time.


> **C1 adds a fourth public endpoint under the same throttle, and one residual worth naming
> (2026-08-27).** `POST /api/bookings/cancel` reuses `BookingThrottle` with the same per-isolate
> limitation. It also refuses an oversized body by reading `Content-Length` — which is a header
> check and nothing more: a **chunked** request that declares no length is still buffered before
> anything measures it. The transfer endpoint carries the identical residual. Closing it properly
> means reading the stream rather than the header, on both endpoints, and is deferred here rather
> than left implied by the guard's existence.
>
> What actually bounds the cancellation endpoint is not the throttle but the credential: a 256-bit
> token from `crypto.getRandomValues`, generated and never derived. Unlike the booking write, it has
> **no second database-checked bound** behind the throttle — `MAX_LIVE_HOLDS_PER_CLIENT` has no
> analogue for a write that only releases.

- **Trigger:** any observed request spike on the public surface, or the first Cloudflare
  rate-limiting rule added for T47 — the two are the same work and should be done together.

**Re-costed by B5 (2026-08-19), with a measurement that changes how this is verified.** B5's payment
initiation endpoint reuses `BookingThrottle`, so the per-isolate limitation described here applies to
it unchanged. Two additions:

- **The notification endpoint is deliberately NOT throttled.** Throttling a gateway's retries would
  convert a transient failure into a permanent one, because a dropped notification is not re-sent
  forever. Its protection is the cheap `ref` rejection and idempotency, not a rate limit.
- **This throttle cannot be verified end-to-end in production, and B4 measured why.** `cf-connecting-ip`
  **cannot be spoofed against real Cloudflare** — Cloudflare sets and overwrites the header — so a
  multi-origin test from one machine trips Cloudflare's own edge protection with a `403` before the
  application throttle is ever consulted. Route tests and the preview run are where this is provable.
  Anyone re-attempting the production check will otherwise record a false failure, as B4's first pass did.

**B6 adds a third throttled endpoint, and it is the most expensive one.**
`POST /api/payments/transfer` carries both intents — the commitment and the multipart receipt — and
shares `BookingThrottle` with the other two, so the per-isolate caveat above applies unchanged.

What is different is the cost of a request that gets through. The booking write and the payment
initiation are small JSON bodies; this one buffers up to 10 MB into an isolate with a hard memory
bound and then spends a storage round trip. The route refuses on `Content-Length` **before reading
the body** for exactly that reason, which is a memory guard rather than a formality.

**The bound that actually holds here is `uploadCount` against `MAX_RECEIPT_UPLOADS_PER_BOOKING` (3),
checked against the database** — the same shape as `MAX_LIVE_HOLDS_PER_CLIENT` backing the booking
write. It cannot be spread across isolates because the row is shared, and it caps what a legitimate
token holder can push into object storage. Verified in `b6-gate.ts` (11.7d): the fourth submission
for one booking is refused.

### T56 — Guest personal data accumulates with no deletion path

**Status:** accepted · **Effort:** unknown (a policy decision before an implementation) · **Added:**
B4 (2026-08-17)

B4 is the first story that stores a stranger's personal data: `Client` holds a name, an email address
and a phone number for every guest who books, indefinitely. There is no path — in the dashboard, in
the public flow, or in any script — that deletes one, and `Client` is `onDelete: Restrict` from
`Booking`, so a client with any booking history cannot be removed without deciding what happens to the
bookings first.

This is the same shape as **T32** (unreferenced storage objects with no reclamation path), and it is
listed beside it deliberately: both are things this product accumulates and cannot yet remove. The
difference is that a stray image costs storage, and this one is a person's contact details held by a
business they visited once.

What makes it unresolved rather than simply unbuilt is that the policy question comes first. A booking
is a financial record the owner has a legitimate reason to keep; the client's contact details are not
the same thing, and the two currently live in one row. Anonymising the client (blanking name, email
and phone while keeping the row for referential integrity) is the shape that satisfies both, and it is
a decision nobody has made.

Scope is small today — no real shop has used the product, so the table is empty — which is exactly why
it is worth deciding before it is not.

**N1 made it worse by one location and did not address it (2026-08-25).** Guest personal data now
lives in a third place: **the client's own mailbox, and the email provider's outbound record.**
Neither is reachable by anything this product could build — an anonymising write over `Client` cannot
unsend a message or reach into a provider's retention. So the deletion rule this entry keeps
deferring will, when it is written, already be unable to be complete, and it should say so rather
than imply otherwise.

- **Trigger:** the first real shop taking real bookings, or any request from a client to be removed.
  Also **N1**, which is when these addresses start receiving email and the data stops being merely
  stored.

**D4 gave this entry a home, and made its absence visible for the first time (2026-08-27).** Until
now a guest's contact details were stored and never displayed: the owner could not have asked to
remove a client because they could not see one. The clients directory shows every name, email address
and telephone number this product holds, on one page, and the control an owner will reach for next is
"remove this person" — which does not exist.

Nothing changed about the difficulty. The policy question is still first, and it is still unanswered:
a booking is a financial record the owner has a legitimate reason to keep, `Client` is
`onDelete: Restrict` from `Booking`, and anonymising (blanking name, email and telephone while keeping
the row for referential integrity) remains the shape that satisfies both. D4 deliberately ships **no**
edit and **no** delete control rather than inventing that policy inside a read-only story.

What D4 does add is the constraint set that makes displaying this data acceptable in the first place,
and it is worth listing because a future deletion feature must not weaken any of it: the page is
uncached and unindexed, no personal data appears in any URL (which is why the table has no search), no
log line may carry a name, address or telephone number, and the projection carries nothing beyond
what is rendered.

- **Trigger (narrowed):** **the clients directory is now the natural place for it.** The next request
  from a client to be removed, or the first real shop, decides the policy; the surface to attach it
  to already exists.

### T57 — An optional constructor dependency is a hole the type system stops guarding

**Status:** accepted — **one instance fixed, the pattern is not** · **Effort:** ~1 h (a composition-root
test per public route) · **Added:** B4 (2026-08-18, found in runtime verification)

`PublicBookingCatalogService` takes its `PaymentConfig` repository as an **optional** fifth
constructor argument, and the optionality is correct: the public profile page builds the same service
for its bookability gate and must not be able to reach a payment row at all.

**B4 then omitted it from the booking route's composition root.** The result compiled, passed
`tsc --noEmit`, and passed all 2061 tests — while `depositFor` returned `null` on every request, so
the details step rendered "esta barbería todavía no está tomando reservas online" for a shop whose
deposit was configured correctly. The entire story was dead in the runtime with a fully green suite.
It was caught by the first manual check of the change's group 11, not by anything automated.

**Why the suite could not see it.** The page tests mock `bookingCatalogService()` wholesale and stub
`depositFor`; the service tests construct `PublicBookingCatalogService` directly and pass the
repository. Neither exercises the real composer. That is not an oversight in those tests — it is what
they are for — but it means **nothing in the suite asserted what the application actually builds at
startup**.

The instance is fixed and pinned by a test that reads the composer's source. The **pattern** is not:
every public route in this project has a composition root, every one of them is a plain function
returning a hand-wired object graph, and any dependency any of them takes optionally can be dropped
the same way. B5 (Mercado Pago client), B6 (Supabase Storage) and N1 (Resend) each add one.

Two candidate fixes, neither taken yet:

- **A composition-root test per route**, asserting the graph it builds — cheap, and the shape B4 used.
- **Make the dependency required and pass an explicit null object** for the profile page, so omission
  is a type error rather than a silent default. Stronger, and it costs a null implementation.

- **Trigger:** **B5** — the first story after this one to add a dependency to a public composition
  root, and therefore the first chance to repeat the defect exactly.

### T58 — A mock can certify a call that cannot work against the real database

**Status:** **fixed for this instance, open as a pattern** · **Effort:** ~2 h (audit the raw-SQL call
sites) · **Added:** B4 (2026-08-18, found in runtime verification)

B4's booking transaction took its per-barber advisory lock with
`tx.$queryRaw\`SELECT pg_advisory_xact_lock(...)\``. `pg_advisory_xact_lock` returns **`void`**, and
the Prisma pg driver adapter cannot deserialize a void column: it raises `UnsupportedNativeDataType`,
which Prisma surfaces as a generic `P2010` and which aborts the whole transaction. **Every booking
write failed**, in the runtime, from the first one.

The repository test mocked `$queryRaw`, asserted it was called first, and passed — so the suite
certified the precise call that could not work. Twenty-four repository tests, all green, over a
mechanism that had never executed successfully once.

Fixed by using `$executeRaw`, which runs a statement for its effect and reads no columns back, and by
making the test's transaction stub expose **only** `$executeRaw`, so a regression fails as "not a
function" rather than passing.

**What stays open is the pattern.** Any raw-SQL call in this project is mocked in its unit test and
therefore unverified in shape: the mock proves the call was made, never that PostgreSQL and the driver
adapter would accept it. Today the raw call sites are few — this lock, and the `mpAccessToken IS NOT
NULL` presence check in `findPaymentReadinessForPublic`, which the gate does not cover either. B5's
webhook and D5's aggregate statistics will add more, and `GROUP BY` aggregates are exactly where the
driver's type mapping is easiest to get wrong.

The general defence is the one B3 established and B4 leaned on: **a gate script that runs the real
call against the live database**. This entry exists to say that the gate is not optional garnish on
raw SQL — it is the only thing that tests it.

- **Trigger:** the next raw-SQL call added anywhere (**B5**, **D5**), or any `P2010` /
  `UnsupportedNativeDataType` seen in logs. When it fires, add the call to the relevant gate script in
  the same change rather than after it.

### T59 — A repeat submission over a CONFIRMED booking is reported as a live hold

**Status:** accepted — **unreachable today, reachable the moment B5 lands** · **Effort:** ~1 h ·
**Added:** B4 (2026-08-18, adversarial review)

`findLiveHoldsForClientOnDay` answers the same question `blocksAvailability` does, which means it
includes **`CONFIRMED`** bookings — correctly, because a confirmed appointment does hold its slot.

The consequence sits one layer up. If a client re-submits a slot they have already **paid for**, the
service returns `alreadyHeld` and the confirmation page renders "Te guardamos el turno", a countdown,
and "el pago de la seña se habilita muy pronto" — over an appointment that is already confirmed and
paid. The countdown is absent (a confirmed booking has no `holdExpiresAt`), so the page is not
actively wrong about time, but the two sentences are wrong about state.

**Nothing can be `CONFIRMED` today**: no story writes that status, so the path is unreachable and no
client can meet it. **B5 is what makes it reachable**, and B5 is the next story.

The fix is a state on the confirmation page, not a change to the lookup — the lookup is right. The
page needs to distinguish "held, awaiting payment" from "confirmed", which B5 has to add anyway for
the client returning from a successful checkout. Doing it as part of B5 costs nothing extra; doing it
after costs a bug report from someone who paid.

**B5 already has the task that closes this, which is why the entry is short.** Its task **9.2** covers
"the page's eight states: hold live unpaid · payment in flight · awaiting confirmation · **confirmed**
· rejected with time left · hold lapsed · paid but slot lost · payments impossible". The fourth is
exactly what is missing today. So this needs no new work in B5 — it needs whoever writes 9.2 to know
that the `alreadyHeld` path reaches that state too, not only a client returning from checkout.

- **Trigger:** **B5 task 9.2**, before it merges. Verify the confirmed state is reached by a _repeat
  submission_ as well as by a successful return from Mercado Pago; the two paths arrive at the same
  page from opposite directions, and only the second is obvious.

### T60 — The Mercado Pago webhook is authenticated by re-fetch, not by signature

**Status:** accepted — **deliberate, and the alternative is worse than the gap** · **Effort:** ~half a
day (column, cipher purpose, PC2 field, handler branch) · **Added:** B5 (2026-08-19)

`/api/webhooks/mercadopago` performs **no signature validation**. Mercado Pago's `x-signature` is an
HMAC keyed by a **per-integration webhook secret** issued in their dashboard, and this product is
multi-tenant against Mercado Pago: every owner brings their own account. Choosing _which_ owner's
secret to validate with requires resolving the notification first, and no such secret is stored.

**What authenticates a notification instead.** The `notification_url` carries `?ref={payment.id}` —
not a secret, authorizing nothing — which resolves the owner and therefore their access token. The
handler then re-fetches the payment from `GET /v1/payments/{id}` with **that owner's own token**, and
verifies `external_reference`, `transaction_amount` and `currency_id` against the stored row before
any transition.

**This is the stronger of the two checks, which is why the gap is narrow.** A valid signature proves
only that Mercado Pago sent the bytes. The re-fetch proves the payment exists, is approved, is for the
right amount, and is bound to our booking — every property the transition actually depends on. An
attacker cannot forge a payment that the owner's own account will confirm.

**What is actually missing** is cheap rejection of forged traffic. Without a signature, a fabricated
notification costs one indexed `ref` lookup before it is dropped. That lookup is deliberately ordered
first, so no outbound Mercado Pago call is ever spent on an unresolvable notification — but the
endpoint remains unauthenticated and unmetered, in the same family as T47 and T55.

Doing it properly is not a handler change: it needs an encrypted `PaymentConfig.mpWebhookSecret`
column, a fourth `CredentialPurpose`, a field on PC2's editor with its own verified and unreadable
states, and a manual dashboard step walked through with every owner. That is a PC2 amendment wearing
a B5 costume, and `base-standards.md` §1 says one thing at a time.

**A `validateSignature()` that returns `true` when no secret is configured must never be introduced.**
It reads as protection in every later review while protecting nothing, and it is strictly worse than
the honest absence recorded here.

- **Trigger:** the first owner who asks for it, **or** forged notification traffic appearing in the
  logs. B5 logs the ref-unresolved and payment-not-found-at-Mercado-Pago outcomes as distinct causes
  precisely so that this trigger is observable rather than hypothetical.

### T61 — A low deposit silently removes payment methods, and nothing says so

**Status:** accepted · **Effort:** ~1–2 h (a band table and a line in the deposit editor) ·
**Added:** B5 (2026-08-19)

Mercado Pago's payment methods do not share a minimum. Measured against a real Argentine account
while closing **T45**:

| band                                       | `min_allowed_amount` |
| ------------------------------------------ | -------------------- |
| prepaid cards                              | 1 ARS                |
| debit, and Visa / Mastercard / Amex credit | 3 ARS                |
| Diners, Naranja, Argencard, Cabal credit   | 15 ARS               |
| Rapipago, Pago Fácil (cash tickets)        | 50 ARS               |

`MIN_DEPOSIT_AMOUNT` is 15, so every **card** works at any deposit this product will produce. But a
deposit between **15 and 50 ARS is payable while offering no cash option at all** — Rapipago and
Pago Fácil simply do not appear at Mercado Pago's checkout, and neither the owner nor the client is
told why.

**Why this is small today and worth writing down anyway.** A barbershop deposit is realistically a
few thousand pesos, so the band is unreachable by any sensible configuration. It becomes reachable
the moment an owner sets a percentage policy against a cheap service — 1% of a 1,500-peso service is
15 pesos, exactly in the band — and the owner has no way to see that they have quietly excluded
every client who pays in cash. In Argentina that is not a marginal group.

There is a second, larger version of the same effect: the cash tickets cap at **1,000,000 ARS**
while cards go to 15,000,000. A deposit above a million loses cash methods from the other end. Out of
reach for this product, recorded so the table is complete rather than half-remembered.

The fix is not a validation. Refusing a deposit in the band would be wrong — it is a legitimate
amount and the owner may not care about cash. What is missing is **disclosure**: the deposit editor
already previews the computed deposit per service (PC3), and that preview is where a line saying
which payment methods the client will actually be offered belongs.

- **Trigger:** the first owner who asks why clients cannot pay their deposit in cash, **or** B6,
  which introduces bank transfer as the deliberate answer to "no card" and is the natural place to
  notice that Mercado Pago's own cash methods were being dropped silently all along.

### T62 — The confirmation moment ends with "please refresh", and that is the normal path

**Status:** ✅ **CLOSED by N1 (2026-08-25)** · **Effort:** ~1 h · **Added:** B5 (2026-08-21, observed in runtime verification)

> **What shipped, and it is both halves rather than one.** This entry was deferred to N1 by decision
> (Franco, 2026-08-22) so that *how this product tells somebody their appointment is real* got
> decided once instead of twice. It did:
>
> - **The page updates itself.** `resolveConfirmationRefresh` emits a server-rendered
>   `<meta http-equiv="refresh">` on the awaiting state only, at most twice, five seconds apart,
>   carrying the attempt in `?intento=`. No JavaScript, exactly as this entry required. The parse is
>   **strict** — a run of digits or nothing — because `parseInt('2.5')` is `2` and a lenient parse
>   accepts values this page never emitted; anything absent, malformed, negative or past the bound
>   renders the terminal form, which is precisely the pre-N1 page. **The worst a hand-edited URL can
>   do is get the old behaviour.**
> - **The spinner became honest and was added with it**, as this entry predicted. B5's prohibition was
>   always conditional on the page not updating, so it survives in its true form: no indicator on the
>   terminal state, where nothing further will happen. The B5 test asserting the old rule was
>   **inverted rather than deleted**, with the reversal written into it.
> - **The email is the other half**, and it is what makes the transfer path work at all — that client
>   is never on the page when their booking confirms.
>
> **One thing this entry did not anticipate:** the page now also has to say whether the email
> actually went. Three variants — sent, too soon to say, could not be sent — because claiming a
> message that failed would remove the client's reason to save the link at the exact moment the link
> became their only record. `EMAIL_NOTICE_GRACE_SECONDS` (30) is the sixth guessed constant in this
> product and is disclosed as one.
>
> The rejections stand as written: no client-side polling, and no holding the response on Mercado
> Pago's schedule.

When a client returns from Mercado Pago, the confirmation page reads live state and renders one of
two things: the booking is `CONFIRMED`, or the notification has not arrived yet and the page says
**"Estamos confirmando tu pago — actualizá esta página en unos segundos."**

B5 designed that second state as the careful fallback. **Runtime verification showed it is not a
fallback — it is what nearly every client will see.** The browser redirect from Mercado Pago is a
direct navigation; the notification is a server-to-server call Mercado Pago makes on its own
schedule. The redirect wins essentially every time. Measured end to end through a tunnel: the page
rendered the awaiting state, and the booking was `CONFIRMED` moments later.

So the single most important moment in this product — the one where a client learns whether their
appointment is real — currently ends with an instruction to refresh. Nothing is wrong; it just reads
as though nothing happened.

**The page deliberately does not poll**, and that decision stands as written: a spinner implying an
update that never comes is worse than a plain sentence. What is missing is the update itself.

**The fix that fits this codebase's constraints is a bounded `<meta http-equiv="refresh">` on the
awaiting state only.** It works with no JavaScript — which the whole public flow requires — and it
can be bounded without script by carrying an attempt counter in the URL: `?estado=pago-pendiente`
refreshes once to `&intento=2`, then `&intento=3`, then stops and shows the manual instruction. Three
attempts over roughly ten seconds covers the ordinary notification delay without hammering the page
when a notification is never coming. Once the refresh is real, the spinner the current rule forbids
becomes honest and can be added with it.

Rejected: client-side polling (needs JavaScript, which this flow does not assume) and holding the
response until the notification lands (Mercado Pago's timing is not ours to wait on, and it would
pin a Worker request on a third party).

- **Trigger:** **N1**, decided by Franco on 2026-08-22 rather than left as "whichever comes first".
  N1 sends the confirmation email and is the other half of the same problem — the client learning
  that their turn is real. Solving the page refresh and the email together means deciding once how
  this product tells somebody their appointment exists, instead of twice in two stories with two
  different answers. B5 therefore closes with this open, deliberately.

---

### T63 — A storage policy depends on Prisma-owned tables, and Prisma never reports it as drift

**Status:** accepted — mitigated by a gate probe, not removed · **Effort:** ~1 h to add a schema-drift check to CI, unbounded to remove the coupling · **Added:** B6 (2026-08-22)

B6 gives an anonymous caller an insert grant on a storage bucket, which nothing in this product had
done before. What confines it is not application code: it is `public.storage_can_accept_receipt()`,
a `SECURITY DEFINER` predicate the bucket's insert policy calls, which resolves the object key
against `Booking → Barber → Location → Owner` and admits the write only where it names a real
booking, in a state still accepting a receipt, under that booking's real owner.

That re-derives P1's guarantee — a write outside the owner's prefix refused by the database rather
than by a promise in code — for a caller with no `auth.uid()` to compare against. It also creates a
dependency that **nothing in the toolchain watches**:

```
"Booking"  . id, barberId, status, holdExpiresAt
"Barber"   . id, locationId
"Location" . id, ownerId
"Owner"    . id, authUserId
```

Prisma owns those tables. The predicate lives in a function Prisma does not track, so `migrate
status` and `migrate diff` are both silent about it. **Rename any of those eight columns and the
predicate stops resolving** — and the failure is the quiet direction: it starts refusing every
upload, so the bucket looks secure while B6 is dead.

**Mitigated rather than accepted blind.** `scripts/b6-gate.ts` probes both directions: three inserts
that must be refused **and one that must be admitted**. The positive probe is the one that matters
here — without it, a predicate broken by a rename would pass every negative check.

The residual risk is that the gate is run by hand. Nothing runs it on a schema change.

- **Trigger:** the first rename of any column in that list, or CI gaining a step that can reach the
  database. A cheap partial fix is a test that asserts those column names still exist, which would
  fail in the suite rather than in the gate.

---

### T64 — An unreviewed receipt blocks its slot until the appointment passes

**Status:** accepted — bounded by design, not eliminated · **Effort:** ~2 h (a reminder to the owner, or a shorter review deadline with a decided consequence) · **Added:** B6 (2026-08-22)

`PENDING_APPROVAL` blocks availability and is deliberately **not** governed by `holdExpiresAt` —
that column is the deadline for _uploading_ a receipt, not for _answering_ one. Releasing a slot
underneath a transfer the owner is about to approve would sell it twice.

B6 gives the status one terminal path: a booking whose `startTime` has passed becomes sweepable,
because its time is unsellable by then and releasing it sells nothing twice. **That closes the
permanent case and not the painful one.** A receipt uploaded for an appointment three weeks out
blocks that slot for three weeks if nobody answers it.

Shipping D2 in the same change makes this rarer rather than impossible: an owner on holiday blocks
the calendar exactly as an absent review surface would. The queue is the only surface that shows a
waiting receipt — D1's counter and N1's email are both later stories.

Two clients can also do this deliberately: a valid booking plus a blank JPEG holds a slot until the
appointment. Bounded by `MAX_LIVE_HOLDS_PER_CLIENT` and by the per-booking upload cap, so it is
harassment rather than a denial of service, but it is not prevented.

- **Trigger:** **D1** (a pending-receipt counter on the dashboard home makes an unanswered receipt
  visible without opening the queue) or **N1** (an email tells the owner one is waiting). Whichever
  lands first should carry this.

**B7 executed the half B6 could only specify (2026-08-23).** The `startTime` exit is now a job that
runs: `ExpiredHoldSweepService` moves a `PENDING_APPROVAL` booking whose appointment has passed to
`EXPIRED`, every five minutes, and `b7-gate.ts` proves both directions of the rule against real rows.
Before this, the exit existed only as a clause in `blocksAvailability` — the slot stopped being
blocked, but the row stayed `PENDING_APPROVAL` forever and appeared in the review queue as though an
answer still mattered.

**The painful half is untouched, and it is the one that hurts.** A receipt uploaded for an
appointment three weeks out still blocks that slot for three weeks if nobody answers it. Nothing in
B7 could change that: releasing the slot underneath a transfer the owner is about to approve would
sell it twice, which is the reason the status is not governed by time in the first place. The sweep
deliberately does not apply its grace window here either — a human's answer is the only thing that
could confirm such a booking, and no delay makes that more likely.

- **Trigger (narrowed):** still **D1** or **N1** — but now specifically for _visibility_, not for a
  terminal state. B7 supplied the terminal state; what remains missing is any surface that tells the
  owner a receipt is waiting before the appointment arrives.

**D1 closed the visibility half, and found that the queue had been over-reporting (2026-08-24).**
The counter this entry asked for exists. Building it surfaced something the two halves above had
hidden between them: **B7's terminal state and D2's queue never agreed.** `expire()` writes
`Booking.status` and nothing else — deliberately, so a late notification can still complete a
payment's own history — and `findPendingForOwner` filtered on `TransferReceipt.status = 'PENDING'`
alone. So a receipt whose booking the sweep had expired stayed `PENDING` forever and kept its place
in the queue, under an **Aprobar** control whose only reachable answer was `noLongerPending`, because
the approval is guarded on `PENDING_APPROVAL`.

That was invisible while the queue was the only surface: an owner would meet it as one stale row and
move on. A counter makes it structural — the figure climbs and never returns to zero, which destroys
the one property that makes a counter worth putting on a page.

The fix is a read-side narrowing, `payment.booking.status = 'PENDING_APPROVAL'`, expressed once and
shared by the listing and the count. **The alternative — having the sweep also reject the receipt —
was rejected**: `IExpiredHoldRepository.expire` states it writes one column to one value, and
`REJECTED` is a word that means a human looked at something.

**The painful half is still untouched**, and it is worth restating that no counter could touch it. A
receipt uploaded for an appointment three weeks out still blocks that slot for three weeks. What D1
changes is that the owner now sees the number without opening the queue; what it does not change is
that answering is still the only thing that resolves it.

- **Trigger (unchanged for what remains):** **N1**, or the first owner who reports a slot they could
  not sell because a receipt sat unanswered. The visibility trigger is spent.

**D3 gives the blocked slot its first surface (2026-08-27).** The counter said *how many* receipts
were unanswered; the calendar is the first place the owner can see **which slot one of them is
holding** — the appointment renders in the day's timeline as *"Comprobante por revisar"*, at the time
it occupies.

It also forced the product to state a rule it had never needed: **an unanswered receipt occupies the
calendar independently of the clock.** `blocksAvailability` stops blocking a `PENDING_APPROVAL`
booking once its appointment has started — correctly, since nothing can be sold into a time already
in use — so reusing that predicate for the calendar would have filed yesterday's unanswered
appointment, which the shop may well have served, under "no effect". `calendarPresence` is a second
predicate for exactly this case, and `Booking.ts` records why the two must not be merged.

Nothing here changes what the entry is about: the slot is still blocked, and answering is still the
only thing that resolves it.

---

### T65 — Transfer receipts accumulate with no retention or deletion rule

**Status:** accepted · **Effort:** ~3 h (a scheduled sweep, plus a decision about how long to keep an approved receipt) · **Added:** B6 (2026-08-22)

A receipt is a bank document. It carries an account number, a full legal name, an amount, and —
when it is a phone screenshot — whatever capture metadata the phone attached, including location.
P1's images are downscaled and re-encoded in the browser, which strips that; **B6 does no such
thing**, because a PDF cannot be downscaled and a rule applying to half the accepted types is a rule
nobody can rely on.

Nothing deletes them. Not the review, not the booking's cancellation, not time.

**Two sources, and the second is a consequence of B6's own design.** Every reviewed receipt stays.
And every _replacement_ leaves its predecessor behind as a bounded orphan — at most two per booking,
given the cap — because the anonymous uploader holds no delete grant and granting one would let
anybody delete anybody's receipt. The displaced key is logged so a retention rule can find it.

This is the same family as **T56** (guest personal data has no deletion path) and should probably be
solved with it: one rule about how long this product keeps things about people, applied to both.

**C2 added a second route into this pile, and one the retention rule will have to name (2026-08-26).**
An owner cancelling a booking that is awaiting review leaves its receipt **`PENDING` forever** — the
row is deliberately not written, because `PENDING` is the honest record of a document nobody
reviewed, and the owner's queue hides it anyway by filtering on the booking's status. The file stays
in the bucket regardless.

So the bucket now accumulates from three directions rather than two: reviewed receipts, superseded
uploads, and now receipts whose booking ended before anybody looked. **Only the third has no
terminal status at all**, which means a retention rule keyed on `reviewedAt` would skip exactly the
receipts nobody is ever going to review.

- **Trigger:** T56, a storage bill, or the first client who asks for their data to be removed.

---

### T66 — Nothing verifies that a transfer actually happened, or that its amount was right

**Status:** accepted — inherent to the payment method, disclosed rather than hidden · **Effort:** unbounded (a bank integration) · **Added:** B6 (2026-08-22)

A receipt image is trivially fabricated and this product has no bank integration. **The owner must
reconcile against their own bank, and nothing in the system can do it for them.**

This is not a gap to be closed with more code at this scale; it is a property of accepting bank
transfers without an API. What B6 does instead is refuse to imply otherwise:

- The review page instructs the owner to check their bank, in the intro rather than in fine print:
  _"El comprobante es una foto: no confirma que el dinero haya entrado."_
- It renders the booking's **snapshotted deposit** beside the file, because that is the only thing
  that makes the comparison possible at all — without it, approving is a guess.
- A test fails if the rendered page contains "transferencia verificada", "pago confirmado" or
  "validamos", and a second test forbids identifiers like `verifyPayment` or `confirmTransfer` in
  `ReceiptReviewService`. The vocabulary is enforced so a later reader cannot infer from a name that
  the system checks something it does not.

**The residual risk is an owner approving without looking.** A client can upload a receipt for $1
against a $3.000 deposit and it will be approved if nobody compares. The amount is on screen; the
discipline is not something software here can supply.

- **Trigger:** a bank API worth integrating (Argentina's interoperable transfer rails may expose
  one), or the first owner who reports approving a wrong amount. If the second comes first, the
  cheap mitigation is a confirmation that repeats the expected figure.

---

### T67 — The sweep's only instrument is a log line, and nothing tells the owner a hold expired

**Status:** accepted — the visibility half of B7, deliberately not built · **Effort:** ~2 h (a counter on the dashboard home) · **Added:** B7 (2026-08-23)

B7 writes `EXPIRED` and reports what it did. **Everything else about it is invisible.**

Two distinct gaps, and they fail differently:

**1. The owner never learns a slot came back.** An abandoned checkout expires, the calendar quietly
regains an hour, and no surface in the product mentions it. This is mild today — the slot was already
sellable the moment the hold lapsed, so nothing is lost by not knowing — but it means an owner
watching a busy day cannot tell "nobody booked this" from "somebody held it and walked away", which
is the difference between a quiet day and a broken checkout.

**2. A dead job looks exactly like a healthy one.** This is the sharper of the two. If the cron is
never registered, or the entrypoint stops exporting `scheduled`, or `DATABASE_URL` is unreadable from
the scheduled context, then availability still works, every page still renders, and no client or
owner experiences a symptom — the product simply stops writing terminal statuses. What B7 does about
it is emit one structured summary per run **including runs that swept nothing**, so the absence of
lines is the signal. That is a real instrument, and it is one nobody is watching: there is no alert,
no dashboard and no check that a run happened at all.

The mitigation available today costs nothing and is not code: a Cloudflare log filter on
`operation = "booking.sweepExpiredHolds"` shows one line every five minutes, and a gap is the
failure. Written here because the next person to wonder whether the sweep is alive should not have to
work that out.

- **Trigger:** **D1** — a dashboard home with counters is where an expiry becomes visible to the
  owner, and where a "last swept at" would cost almost nothing to add beside them. For the second
  gap, any of: the first time somebody asks whether the job is running, a Cloudflare alert being set
  up for anything at all, or the first `EXPIRED` row that turns out to be days late.

**D1 closed gap 1 and left gap 2 exactly where it was (2026-08-24).** The dashboard home gives the
owner two surfaces that mention an expiry: the recent-bookings list renders `EXPIRED` rows with their
own badge, distinct from `CANCELLED`, and a "reservas sin confirmar hoy" figure sits beneath today's
confirmed count. Between them an owner watching a quiet day can now tell "nobody booked this" from
"somebody held it and walked away", which is what gap 1 asked for.

**Gap 2 is untouched, and the "last swept at" line this entry suggested was considered and not
built.** The reason is worth recording, because the suggestion reads cheap: nothing in the schema
records when a sweep ran. `expire()` writes `Booking.status` and the sweep keeps no run log, so the
line would need either a new table or a query against Cloudflare's log stream — neither of which is
"almost nothing beside a counter", and both of which are a different story from a page of figures.

**What must not be inferred from gap 1 closing:** no counter on the dashboard home changes when the
sweep stops running. An unswept lapsed hold and a swept one are indistinguishable to availability, to
the booking write and to every figure on that page — which was B7's own design property, restated
here because a page that now shows expiries looks like it would notice their absence, and it would
not. The log filter on `operation = "booking.sweepExpiredHolds"` remains the only instrument.

- **Trigger (narrowed to gap 2):** the first time somebody asks whether the job is running, a
  Cloudflare alert being set up for anything at all, or the first `EXPIRED` row that turns out to be
  days late.

---

### T68 — The development machine cannot receive a database response larger than ~1.4 KB

**Status:** open — **an environment fault, not a product defect** · **Effort:** unknown (a network
diagnosis, not code) · **Added:** D1 (2026-08-24)

`scripts/d1-gate.ts` could not complete from the development machine. Every probe that returned a
small result passed; the one returning ten rows of seven columns timed out at `query_timeout`, and
with the timeout removed it hung **indefinitely**.

**It is not the query, and the bisection is worth keeping because the query looks guilty.** The
failure was chased through four wrong suspects before the real one:

| suspect                                        | ruled out by                                             |
| ---------------------------------------------- | -------------------------------------------------------- |
| Prisma relation loading                        | raw SQL with explicit joins fails identically            |
| the four joins                                 | the same four joins with fewer columns return in ~310 ms |
| a column type (enum, `Decimal`, `Timestamptz`) | each returns fine alone; `status::text` fails too        |
| pool exhaustion (`max: 5`, `maxUses: 1`)       | reproduces with `max: 20` and with `maxUses` removed     |

The actual boundary has nothing to do with the schema:

```
SELECT repeat('x', 1200) →  303 ms
SELECT repeat('x', 1400) →  never returns
```

One row, one column, no table. **The threshold is the size of the response in bytes**, right at the
payload of a single ~1500-byte Ethernet frame. That is the signature of a **path-MTU black hole**:
the first full-size packet is dropped and the ICMP "fragmentation needed" that would tell the sender
to back off never arrives, so the connection waits for data that will never come. Common causes are a
VPN, a tunnel, or a router on the path that drops ICMP.

**Why this is not a product defect.** Cloudflare Workers reach Supavisor over an entirely different
network path, and nothing about the application's queries depends on response size. The dashboard's
own reads are small — five scalars and ten rows — and were correct in every probe that could return.

**What it costs, and it is not nothing:**

- **The D1 gate cannot fully pass from this machine.** Fourteen probes pass, including every counting
  rule, both money rules and both directions of cross-owner isolation. The recent-bookings read and
  anything downstream of it cannot be verified locally.
- **Every future gate inherits this.** D3's calendar, D4's client table and D5's statistics all return
  more rows than this ceiling admits. A gate is this project's answer to T58 — "a mock can certify a
  call that cannot work" — and that answer is unavailable for any read that returns real volume.
- **It cost most of a day and produced one reverted commit.** `findRecentForOwner` was rewritten to
  raw SQL on the misdiagnosis and reverted once the cause was found. The comment on that method now
  records the reversal, so the next reader does not re-accuse the query.

**How to confirm it in one command**, without any of this repository involved:

```
npx tsx -e "…SELECT repeat('x', 1400)…"     # hangs on the affected path
```

Or outside Node entirely: `ping -f -l 1400 aws-1-sa-east-1.pooler.supabase.com` on Windows, which
should report that the packet needs fragmenting.

**N1 found that it also blocks `prisma migrate` entirely (2026-08-25), which this entry had not
predicted.** `npx prisma migrate status` and `migrate deploy` both fail with **`P1001: Can't reach
database server`** from this machine — while `pg` connects to the same host and port in the same
second and runs queries fine. The engine's own reads are past the ceiling, and Prisma reports that
as unreachability, which sends you looking at the network instead of at the payload.

Measured at the time, on the direct connection:

| payload            | result           |
| ------------------ | ---------------- |
| `repeat('x', 1000)`| OK               |
| `repeat('x', 1400)`| read timeout     |
| `repeat('x', 2000)`| read timeout     |

**The workaround used for N1's migration**, and it is worth keeping because the next migration will
hit this too: apply the DDL through the Supabase MCP — which travels over Supabase's HTTPS API and
is therefore unaffected by the local MTU — and then insert the `_prisma_migrations` ledger row by
hand, with the migration's real `sha256` checksum, so Prisma sees no drift afterwards. It is exactly
what `migrate deploy` does, in two steps that route around the broken hop.

**This raises the cost of the entry considerably.** It was previously "gates that return volume
cannot run here". It is now also "schema changes cannot be applied here by the normal tool", which
is on the critical path of every story that touches the database.

- **Likely fixes** (all outside this repository): disable a VPN or split-tunnel the database host;
  lower the interface MTU (`netsh interface ipv4 set subinterface "<name>" mtu=1400 store=persistent`);
  or run the gates from a different network. Verifying with a phone hotspot is the cheapest first test.
- **Trigger:** the next gate that must return more than a handful of rows — **D3, D4 or D5**, whichever
  comes first. Until then, `readSummary`-shaped probes still work and the gates keep most of their
  value.

**D3 arrived, and the prediction was wrong in the useful direction (2026-08-27).** The fault itself
is unchanged and was re-confirmed before the gate was written — `repeat('x', 1000)` returns in 59 ms
and `repeat('x', 1400)` never returns, on the same connection in the same second. But
`scripts/d3-gate.ts` ran **every one of its 23 probes to completion**, including the composed day
read, the two-owner isolation pair and the schedule narrowed under a booking. Nothing was skipped.

The reason is worth keeping, because it is a design property rather than luck: **this entry assumed
"a calendar returns more rows", and what decides the response size is the projection, not the row
count.** D3's appointment projection is eight narrow columns with no price, no deposit, no
cancellation token, no client id, no email, no telephone and no absence reason — each omitted for its
own reason, none of them this one — and a barber-day is a handful of appointments. The whole response
stays under the ceiling.

So the entry's cost is smaller than it has been reading: it is *"a gate returning a large **payload**
cannot run here"*, not *"a gate over real volume cannot run here"*. D1's ten-row, seven-column
recent-bookings read is still the shape that fails. D4's client table and D5's statistics are still
squarely at risk — a client row carries email and telephone by definition, which is the opposite of
what saved this one.

The migration half of this entry is untouched and remains the expensive part: `prisma migrate` still
cannot run from this machine. D3 needed no migration, so it did not exercise it.
**The fault was not present when D4 ran, and it had been present hours earlier the same day
(2026-08-27).** This entry is now **intermittent**, which is a different and more dangerous shape
than "broken here", so the measurements are recorded rather than the conclusion:

| time (ART)  | `repeat('x', 1000)` | `repeat('x', 1400)` | `repeat('x', 2000000)` |
| ----------- | ------------------- | ------------------- | ---------------------- |
| ~11:30, D3  | 59 ms               | **never returns**   | not attempted          |
| ~17:40, D4  | 42 ms               | **36 ms**           | **347 ms**             |

Two megabytes in 347 ms on the same connection string, from the same machine, on the same day. Nobody
applied any of the fixes this entry lists — no MTU change, no VPN toggle, no split tunnel — so the
path changed underneath the project rather than being repaired.

**What that costs, and it is not nothing:** a gate that passes here is no longer evidence that the
fault is gone, and a gate that hangs here is no longer evidence of a product defect. Every future
gate must keep `probeOrSkip` and must run the `repeat('x', 1400)` check **first**, so its result
carries the state of the path it ran on. `scripts/d4-gate.ts` does both, and its header records that
the check was run before the file was written.

**D4 ran every probe.** Nineteen, nothing skipped, including the twenty-tied-client paging probe that
returns three full pages of contact details — squarely the payload this entry says cannot arrive.
That is a fact about the network on 27 August, not about the product.

- **Trigger (revised):** unchanged in substance, but the entry can no longer be closed by a green
  gate. It closes when somebody diagnoses the path — the hotspot test is still the cheapest first
  step — or stays open as a known intermittent that every gate is built to survive.

---

### T69 — The address a confirmation is sent to has never been verified, and it now carries a credential

**Status:** accepted — **the mitigation shipped in C1; the debt itself did not close** · **Effort:** unbounded to fix properly · **Added:** N1 (2026-08-25) · **Re-costed:** C1 (2026-08-27)

> **C1 did what this entry demanded and no more (2026-08-27).** The cancellation is a `POST` behind
> a server-rendered confirmation reached by a safe `GET`, so a mail scanner, a link-preview bot, a
> corporate security gateway or the framework's own link prefetching produces a rendered page and
> no cancelled appointment. Proven at runtime on both engines: every URL on the page was fetched and
> nothing changed status.
>
> **What did not change is the whole of this entry.** The address was never verified and still is
> not. A human who received the message by mistake can read the appointment, and can now destroy it
> — two deliberate steps are a bot filter, not an authorization check. **C1 must not be recorded as
> closing this.**

B4 takes an email address in a form and creates a booking with it. **Nothing confirms the address
belongs to the person typing it**, and nothing ever has — until N1 that was harmless, because the
address was only ever a column.

N1 makes that address the destination for the client's **cancellation token**, which is their only
credential for the booking. A single typo therefore does one of two things:

- nobody receives the confirmation, and the client has only the page they were redirected to; or
- **a stranger receives a working link to somebody else's appointment.**

The second is the one that matters. It is not a hypothetical shape of attack — it is what happens
when somebody mistypes their own address, which people do constantly.

**Why it is not fixed here.** The honest fix is verifying the address before it becomes a
destination, and every version of that gates the deposit on a round trip through a mailbox: the
client is at a checkout, holding a slot on a 15-minute timer, and would have to leave, find a
message, come back and pay. That trades a rare wrong recipient for a common abandoned booking, and
it is a product decision nobody has made.

**What it does force, and this is the part that must not be lost:**

> **C1's cancellation MUST be a `POST` behind an explicit confirmation, never a `GET`.**

A cancel-by-URL would be fired by a mail scanner, a link-preview bot, a corporate security gateway
that fetches every link in an inbound message, or a person who received the mail by mistake — none
of them intending to cancel anything, all of them producing an appointment that vanishes. The
booking page N1 links to is safe today because it only renders; the moment C1 puts an action behind
that token, the action needs a deliberate second step.

Cheaper partial mitigations, if the full fix stays deferred: a confirm-your-address step on the
booking form for addresses at obviously mistyped domains, or an owner-visible flag on bookings whose
confirmation bounced (which needs a provider webhook this product does not have).

- **Trigger:** **C1**, for the `POST` constraint — that one is not optional and is not deferred, it
  is a requirement on the next story. The verification question itself triggers on the first real
  shop, or the first client who reports never receiving a confirmation.

---

### T70 — A confirmation that fails to send has no recovery path inside the product

**Status:** accepted · **Effort:** ~2 h for the owner-visible half · **Added:** N1 (2026-08-25)

N1 records `Booking.confirmationEmailSentAt` precisely so that "confirmed, and the client was never
told" is a query rather than a log line:

```sql
SELECT id FROM "Booking" WHERE status = 'CONFIRMED' AND "confirmationEmailSentAt" IS NULL;
```

**Nothing runs that query.** The column has no reader, no index, and no surface. Three gaps follow
from it:

- **The owner is never told.** On the transfer path the approval succeeds, the receipt leaves the
  queue, and a failed send produces one `error` line in a log the owner does not read. The action's
  success message deliberately does **not** claim the client was notified (that would remove the
  owner's reason to phone them) — but not lying is not the same as informing.
- **There is no resend.** No control anywhere re-sends a confirmation, and after approval the receipt
  row is gone from `/comprobantes`, so there is not even an obvious place to put one.
- **The client's only signal is the page.** They see the could-not-send variant *if* they still have
  the link open. A client who closed the tab after paying gets nothing at all.

**The cheapest useful version is a counter and a list on the dashboard home**, which is a surface
that already exists (D1). A sweeper-based retry is the more complete answer and is more work: B7's
cron Worker would need the email adapter, which is the second Worker growing a second reason to
exist.

- **Trigger:** the first failed send in production, or **D1's next revision** — whichever comes
  first. Also worth doing alongside **T67**, which is the same shape of gap for expired holds: a
  thing that happened, that only a log knows about.

---

### T71 — Quota exhaustion stops every confirmation and looks exactly like success

**Status:** accepted · **Effort:** ~30 min for an alert, ~0 to notice it exists · **Added:** N1 (2026-08-25)

The email provider caps sending volume. Crossing that cap is the **most likely production failure of
this story**, and it is shaped so that nothing in the product looks wrong: bookings still confirm,
payments still clear, every page still renders, and every client after the cap simply hears nothing.

`IEmailSender` splits `throttled` from `rejected` for exactly this reason — the two look identical at
the call site and lead to completely different action, so the log line is at least findable. That is
the whole mitigation. **Nothing alerts on it**, and nobody is watching a log on a Saturday.

It compounds with T70: the shop stops notifying its clients, no owner-visible surface says so, and
the only record is a log line distinguishable from an ordinary failure by one field.

- **Trigger:** the first `throttled` outcome in production, the first shop busy enough to approach
  the cap, or taking the provider's paid tier — whichever comes first. An alert on that one outcome
  is cheap; the surface from T70 would carry it for free.

---

### T72 — A client who paid and lost their slot is the only one this product never contacts

**Status:** accepted — **narrowed by C2, and the title is now the whole of it** · **Effort:** ~2 h once the email path exists — and it now does · **Added:** N1 (2026-08-25, deliberately not fixed)

> **C2 closed the half that was about deliberate decisions (2026-08-26).** When it was written this
> entry covered a broader asymmetry: *this product emails when nothing is wrong and stays silent when
> something is.* An owner cancelling a confirmed appointment now sends the client a message naming
> the shop as the canceller and, where a deposit was approved, saying plainly that it is not returned
> by this system — non-fatal on the same terms as the confirmation, so a provider outage cannot undo
> a scheduling decision.
>
> **What remains is the harder half, and it is the one about accidents rather than decisions**: the
> two outcomes where money moved and the appointment did not exist — `slotLost` and
> `bookingUnavailable` — still send nothing. Those are the cases with no human deciding anything, so
> nobody is prompted to make contact by hand either. The owner learns from a log line or not at all.
>
> The cost of building it has dropped again: C2 added a second message and a second builder to the
> path N1 opened, so a third is now a well-worn shape rather than a design question.

There are two outcomes where money moved and the appointment did not exist:

- **`slotLost`** — the payment was approved after the hold lapsed and somebody else had taken the
  time.
- **`bookingUnavailable`** — the payment was approved against a booking that had been cancelled or
  expired.

Both are logged at `error` because, as `PaymentConfirmationService` puts it, "a human owes this client
a refund and nothing else in the product is going to say so". **That sentence is still true after
N1, and N1 is the story that makes it look deliberate rather than pending.**

The confirmation email now goes out on the one outcome that is good news. The two outcomes that are
bad news — the ones where somebody has actually lost money — send nothing. The client sees the
`paidSlotLost` state **only if they still have the page open**, which after a redirect back from a
gateway is a coin flip, and after a bank transfer is not even that.

So the asymmetry N1 leaves behind is: **this product will email you when nothing is wrong, and stay
silent when something is.**

**Why it was not fixed here.** It is a different message with different copy, a different trigger
branch and a different failure mode, and N1's scope was the confirmation. Adding it as an
afterthought to a story whose whole subject is the confirming outcome would have got it the least
attention of anything in the change. It is now cheap, though — the port, the adapter, the builder
shape and the composition roots all exist, and this needs a second `build*Email` function and one
more call site.

**What it needs beyond the email:** the owner has to know too. A refund is theirs to arrange, they
cannot arrange one they never hear about, and today the only record is a log line. That half is the
same gap as **T70** and should be built with it.

- **Trigger:** the first real `slotLost` or `bookingUnavailable` in production — which is also the
  first time somebody is out real money — or **T70**, whichever comes first. Do not wait for the
  first one; it is a bad way to find out.

---

### T73 — The receipt-rejected state is unreachable, so a refused comprobante has never said so

**Status:** accepted — C2 replaced the false message with a true one, not the specific one · **Effort:** ~1 h plus re-verification of the payment states · **Added:** C2 (2026-08-26, found in runtime verification)

`resolvePaymentPageState` has a `receiptRejected` state whose whole purpose is to tell a client
**"La barbería no aprobó el comprobante"** — the reason and something they can act on. **It has never
been reachable.**

The confirmation page's projection reads only the booking's *live* payment:

```ts
payments: { where: { status: { not: 'REJECTED' } }, take: 1, ... }
receiptStatus: payment?.transferReceipt?.status ?? null
```

B6's rejection sets the `Payment` to `REJECTED` in the same transaction as the receipt. So after a
rejection there is **no live payment**, `receiptStatus` arrives `null`, and the branch that would
name the comprobante cannot fire.

**What the client saw instead, from B6 until C2: "La reserva venció."** The booking fell through
every branch to the lapsed-hold state — the same lie C2 was written to fix for cancellations,
arriving from a path nobody had looked at. Measured at runtime on 2026-08-26 against a real rejected
receipt, not inferred.

**Two tests were certifying the dead branch.** Both constructed `CANCELLED` + receipt `REJECTED` by
hand — the shape the *database* holds, and not the one the *projection* emits. They passed for three
stories while the state they described was unreachable. Both are now inverted and documented rather
than deleted, so the branch stays live for whoever fixes this.

**C2 improved it without fixing it.** A rejected comprobante now renders the generic cancelled state
— *"La barbería canceló tu turno"* — which is true, and better than an expiry the client is blamed
for. It is still less useful than naming the document.

**Why C2 did not widen the projection.** That filter has documented semantics in B5's and B6's
specs: it is what makes `paymentStatus`, `hasCheckout` and "the live payment" mean what the other
states rely on. Changing it alters branches C2 does not verify, and the honest fix comes with its own
runtime check rather than riding along on a story about cancellation.

**The shape of the fix**: let the projection carry a rejected payment's receipt without changing what
`paymentStatus` reports — a separate narrow read of the booking's most recent receipt, rather than
widening the payment filter. Then `receiptRejected` becomes reachable and this entry closes.

- **Trigger:** **C1**, which touches this same state table and will add a third cancelled state, or
  the first owner who asks why a client did not understand that their transfer was refused.

---

### T74 — Nothing returns a deposit, and nothing records that one is owed

**Status:** accepted — **worse after C1: the client can now open this door themselves** · **Effort:** ~2 h to record the obligation, unbounded to actually move money · **Added:** C2 (2026-08-26) · **Re-costed:** C1 (2026-08-27)

> **C1 adds a third door, and it is the first one the shop does not control (2026-08-27).** C2 made
> "this product owes somebody money" reachable from a button on the dashboard — a deliberate act by
> the person who would have to pay it back. C1 makes it reachable by the person who would receive
> it, from a link in their inbox, with the owner finding out only by looking at the dashboard (T77).
>
> C1 says it on the one surface that matters most and C2 did not have: the **confirmation step**,
> before the irreversible click, while the decision is still the client's to reverse. That is three
> sentences and still no record. **The cheap fix has not moved**: mark the payment refund-owed at
> cancellation, and list the outstanding set. C1 has made it cheaper to justify and more expensive
> to keep deferring — it is also what would let the `PENDING_APPROVAL` exclusion be lifted (see the
> design note in C1) and what would give T79's captured payments a row.

This product takes deposits and has no way to give one back. That was tolerable while every path to
"money moved and the appointment did not happen" was either an accident or a refusal:

- **`slotLost` / `bookingUnavailable`** — an approved payment against a booking that lapsed or was
  resold. Rare, and nobody chose it.
- **A rejected receipt** — the owner refusing a transfer they judged wrong. The confirmation says
  the money is not returned here, and the owner was already looking at the case.

**C2 makes it routine and deliberate.** An owner can now cancel a `CONFIRMED` booking whose Mercado
Pago deposit is `APPROVED` — a real charge, on a real card, for an appointment the shop is choosing
to end. That is the cleanest possible statement of "this product owes somebody money", and it
happens from a button on the dashboard home.

**What C2 does about it, which is not nothing and is not enough:** the confirmation names it before
the write (*"si el cliente ya pagó la seña, la devolución la coordinás vos"*), the client's page says
it, and the cancellation email says it where a deposit was approved. Three surfaces tell the truth.

**What is missing is any record.** No column marks a deposit as owed, no query lists them, no counter
shows one. An owner who cancels five paid bookings in a busy week has five refunds to remember and
nothing to remember them with — and the client has only whichever of the three messages they happened
to see.

**The cheap fix is not a refund integration.** It is a flag and a list: mark the payment as
refund-owed at cancellation, and surface the outstanding set on the dashboard. That turns an
obligation nobody is tracking into a short list somebody can work through, without this product ever
touching money it cannot move.

- **Trigger:** the first owner cancellation of a paid booking in production, or **D5** (statistics),
  which will otherwise report deposit income that includes money the shop owes back.

---

### T75 — Nested `not-found` boundaries do not resolve, so every public 404 shares one message

**Status:** accepted — worked around by making the shared copy true of every case · **Effort:** unbounded until the cause is understood · **Added:** C2 (2026-08-26, found while fixing a client-facing 404)

`app/b/not-found.tsx` answers for **every** failure under the public namespace: a mistyped slug, a
profile that does not exist, and a booking link whose token resolves nothing. A boundary closer to
the route it serves would let each say something specific. **Placing one has no effect.**

Measured, on Next 16.2.10 with an empty `next.config.ts`, against both `next dev` and a real
`opennextjs-cloudflare` build:

| boundary placed at | result |
| --- | --- |
| `app/b/[slug]/reserva/[token]/not-found.tsx` | ignored — `app/b/not-found.tsx` still rendered |
| `app/b/[slug]/reserva/not-found.tsx` | ignored |
| `app/b/[slug]/not-found.tsx` | ignored, **even for its own segment's page** |

The file compiles — the built output contains
`chunks/ssr/app_b_[slug]_reserva_[token]_not-found_tsx_*.js` — so it is registered and then not
wired. The RSC payload shows `"notFound":"$undefined"` on every inner router segment, with the
boundary attached only at `b`.

**Two things contradict this and are worth recording rather than smoothing over.** Next's own
documentation states that `not-found.js` "renders between `loading.js` and `page.js`" **in the same
segment**, which is exactly the placement that was ignored. And this repository's own `app/b/not-found.tsx`
carries a comment from B1 saying a `[slug]`-level boundary *did* catch that page's `notFound()` —
behaviour this measurement could not reproduce. Either it regressed between Next versions, or B1's
note recorded an inference rather than an observation.

**The unexplored suspect** is the layout tree: `app/b/layout.tsx` is the nearest layout above all
three attempted placements, and none of those segments has a layout of its own. If boundaries are
wired per layout rather than per segment, that would explain every row in the table — and would mean
the fix is a `layout.tsx` in the booking segment, which is a file added for a framework reason and
should not be guessed at.

**What was done instead**, because the defect was the message and not its location: the shared copy
was rewritten to be true of every case it answers for. It said *"No encontramos esta barbería"* to
clients whose shop was perfectly real and whose booking link was merely unknown — and then told them
to ask that shop for a new link. The subject is now the link, which is what all these failures share.

- **Trigger:** the next time a route wants 404 copy of its own — plausibly **C1**, or a Next upgrade.
  Reproducing the table above takes one dev cycle per row.

---

### T76 — Confirmation emails reach exactly one person, and production cannot send them at all

**Status:** accepted — the product is honest about it on every surface · **Effort:** ~30 min once a domain exists · **Added:** N1 (2026-08-26, at the close of its verification)

N1's own spec required delivery proven against a real inbox before the story closed. **That was
partly achieved and the remainder is worth naming precisely rather than rounding off.**

**What was proven (2026-08-26).** A real message, composed from a real database read, sent by the
real Resend adapter through the real approval trigger, arrived in a real mailbox — and its link
opened the booking, which rendered as confirmed. That is the whole chain, end to end, once.

**Three gaps remain, in descending order of consequence:**

1. **No sending domain is verified, so the only usable sender is the provider's shared
   `onboarding@resend.dev` — which delivers to the account owner and to nobody else.** Every real
   client would get silence, with no error anywhere. This is why `RESEND_API_KEY` is deliberately
   **not** set on the production Worker: with it set, production would start "sending" mail that
   reaches one person. Confirmations are therefore disabled in production, and the booking page says
   so truthfully rather than claiming a message nobody received.
2. **The Resend call has never been made from `workerd`.** The verification ran under Node, against
   the real API. B5's whole lesson is that a runtime can differ — its `Intl` and its `fetch` were
   both measured rather than assumed — and this call has not had that treatment.
3. **Delivery through the Mercado Pago trigger is unverified and cannot now be verified.** Both
   sandbox payments B5 left behind are gone from the gateway, so no notification replay reaches the
   confirming branch. The trigger itself is covered branch by branch in tests, and it calls the same
   `notifyConfirmed` the transfer path exercised — every line after that call is shared.

**None of these is a defect in the code.** They are the difference between "the chain works" and
"clients receive mail", and the product currently tells the truth about being in the first state.

**Closing it is one step and it is DNS:** verify a domain in Resend, set `EMAIL_FROM` in
`wrangler.jsonc` to a sender on it, set the key as a Worker secret, and repeat the check — which
also closes gap 2, since the send then happens inside the Worker.

- **Trigger:** the first real client, which is also the first moment gap 1 costs anything. Do not
  ship this product to a shop with confirmations in this state.

---

### T77 — An owner learns of a client cancellation only by looking

**Status:** accepted — deliberate, and the surface that replaces the message was built with it · **Effort:** ~2 h to reuse the email port for a second recipient class · **Added:** C1 (2026-08-27)

C1 lets a client cancel their own booking. **Nothing tells the shop.** No email, no push, no
counter that moves in front of anybody's eyes — the appointment simply stops being on the calendar.

**This was decided rather than overlooked**, and the reasoning is worth keeping because it is the
kind that stops being true. No owner has ever been sent a message by this product. Introducing that
recipient class means a projection, a builder, a second sender configuration question, and a share
of T71's quota — for a fact the dashboard already carries. And T76 makes the timing worse: the
sending domain is unverified, so an owner notification would today reach exactly one mailbox and
silently drop for every real shop.

**What C1 built instead, and it is not nothing.** `RecentBooking` gained `cancelledBy`, so the
recent-bookings list now names who ended each cancelled booking, and "Cancelaciones de hoy" stops
being a number an owner cannot decompose. That was moved into C1's scope *because* of this decision:
choosing not to send a message is only defensible if the surface replacing it carries the fact.

**What is still missing is the push.** An owner who does not open the dashboard between a
cancellation and the appointment learns about it by standing in an empty shop at 15:00. A busy
Saturday makes that likelier, not less.

- **Trigger:** the first real shop. The moment a client cancellation happens to somebody who is not
  watching the dashboard, this stops being theoretical.

---

### T78 — No minimum-notice policy exists, so a client may cancel one minute before their turn

**Status:** accepted — deliberately not invented · **Effort:** ~1 h for the rule, unbounded for the surface an owner sets it on · **Added:** C1 (2026-08-27)

`isCancellableByClient` admits a cancellation up to `startTime` and no further. There is no notice
window: a client can release a 15:00 appointment at 14:59.

**A number was not chosen here on purpose.** Whether that is acceptable is a **shop policy**, and
this product has no surface on which an owner has ever expressed one. Picking two hours, or
twenty-four, would turn one person's guess into a rule every shop inherits, on the story that first
makes the question visible — and the shops most likely to want a window are exactly the ones nobody
has spoken to yet.

The direction chosen is the permissive one, which is also the recoverable one: a shop that wants a
window can be given one later, while a shop given a window it did not ask for has clients who
cannot cancel and start phoning instead.

**A related asymmetry is deliberate and should not be "fixed" by symmetry.** The owner's predicate
takes no instant at all — a no-show is precisely the past appointment they want off the books —
while the client's refuses a started appointment, because a past slot cannot be released and
cancelling one would only record an appointment that happened as cancelled.

- **Trigger:** the first owner who asks for one, or the first complaint about a last-minute
  cancellation. Both are conversations with a real shop, which is the input this decision lacks.

---

### T79 — Cancelling does not close the client's open checkout, and money can still be captured

**Status:** accepted — warned about, not prevented · **Effort:** unbounded here; the cheap half is T74's record · **Added:** C1 (2026-08-27)

A cancellation does not invalidate `mpInitPoint`. A client who cancels and then completes a Mercado
Pago checkout they left open in another tab **captures real money for an appointment that no longer
exists**. B5 anticipated the shape and logs it — *"Payment approved for a booking that no longer
exists"*, at `error` — and **that log line is the entire record**. Nothing notifies anyone (T72) and
nothing marks the money as owed (T74).

There is a second door with no gateway involved at all: a `PENDING_PAYMENT` booking that committed
to bank transfer has already been shown the CBU. A client can transfer, cancel without uploading a
receipt, and leave **no row anywhere** asserting the money arrived. That one is worse than the
`PENDING_APPROVAL` case C1 deliberately excludes, because there at least a receipt exists.

**Closing the checkout was rejected, and the reason is structural.** It needs an authenticated call
to Mercado Pago with the owner's access token, which would make the public cancellation path a
**third** composition root permitted to decrypt that credential — against B5's fixed count of two —
on a path whose failure must not undo a cancellation that has already committed.

**What C1 does instead:** the confirmation step tells the client not to complete a payment they have
already started, and to contact the shop if they have already transferred. Three sentences on the
one surface shown while the decision is still reversible. That is a mitigation, not a fix.

**A related interaction is now specified rather than accidental.** `confirmIfSlotFree` guards its
approval on `mpPaymentId` being null, **not** on the payment's status, so a payment C1 sets to
`REJECTED` can still be moved to `APPROVED` by a notification arriving afterwards. C1 keeps that
behaviour deliberately — the money did move, and forcing the row to stay `REJECTED` would make the
client's own page silent about cash that left their account, since the refund sentence is
conditioned on an approved payment. It is now covered by tests in both orderings.

- **Trigger:** T74's cheap half — marking a payment refund-owed at cancellation and listing the
  outstanding set — which would give all of these a record without this product ever moving money.
  Or the first client who reports paying for a turn they had cancelled.

---

### T80 — A refused checkout leaves a client record behind, and the directory shows it

**Status:** open — **surfaced, not caused, by D4** · **Effort:** ~1 h for the write-path fix; the
question of what to do with the rows already stored is separate · **Added:** D4 (2026-08-27)

`BookingCreationService` resolves the client **before** it writes the booking, and the two are not in
a shared transaction:

```
const client = await this.clients.resolve({ … });   // creates the row
const liveHolds = await this.bookings.countLiveHoldsForClient(…);
if (liveHolds >= MAX_LIVE_HOLDS_PER_CLIENT) return { outcome: 'holdLimitReached' };
const result = await this.bookings.createProvisional({ … });
```

So a submission refused by the hold cap — or one whose slot is taken in the interval, or which fails
for any infrastructure reason after that point — **leaves a `Client` with no booking of any kind**. A
stranger who never completed anything is now stored with their name, email address and telephone
number, indefinitely (T56).

**The flow already knows this is undesirable and guards the other path.** The repeat-submission branch
uses `findByEmail`, which deliberately does *not* create, with the comment: *"on a genuinely lost race
the submitter may be someone this shop has never seen, and a failed booking must not leave a `Client`
row behind."* The refusal paths **after** `resolve` do exactly what that comment forbids.

**D4 is why this is worth writing down rather than living in the code.** Until the clients directory
there was no surface where such a row appeared, so its existence cost nothing visible. Now it is a
row in the owner's customer table, and the table has to carry copy specifically to stop it being read
as business — *"Sin turnos · Dejó sus datos pero nunca llegó a reservar"*. That copy is correct and it
is a workaround: the product is explaining a row it should probably not have created.

**No naturally-occurring instance has been observed.** D4's runtime pass rendered a seeded one to
prove the state is handled; the two real clients in the database both have bookings. The mechanism is
read from the code, not from data.

The plausible fixes, in rising cost:

- **Move the hold-cap check above `resolve`** — it needs a client id today, so it would need to key on
  the email address instead. Closes the most likely refusal path, not the rest.
- **Create the client inside the booking transaction**, so a failed booking rolls the row back. The
  honest fix, and it touches B4's concurrency-critical write, which is exactly the review this project
  keeps declining to ride along on.
- **Sweep client rows that have no bookings and no recent activity** — cheap, but it is a deletion
  policy, and that is T56's unanswered question.

- **Trigger:** the next change that touches B4's booking write — the same trigger T54's decision now
  waits on, and the two should be done together since both are edits to that transaction. Or the
  first owner who asks why somebody with no appointments is in their client list.

---

### T81 — The clients directory reads every booking of the shop to draw one page

**Status:** open — **measured, not suspected** · **Effort:** ~15 min for the index; the rest is a
design change · **Added:** D4 (2026-08-27)

The directory's statement aggregates confirmed and inactive counts per client, orders by the
confirmed count, and takes the total from `count(*) OVER ()`. All three are computed **before**
`LIMIT` can apply, so the page size bounds what is *returned* and not what is *done*.

`EXPLAIN (ANALYZE, BUFFERS)` against the live database, on the real owner:

```
Limit  (actual time=0.738..0.741 rows=2)
  ->  Sort  (Sort Key: (count(b.id) FILTER (…)) DESC, c.id)
        ->  WindowAgg
              ->  HashAggregate  (Group Key: c.id)
                    ->  Hash Right Join  (Hash Cond: (b."clientId" = c.id))
                          ->  Seq Scan on "Booking" b        ← every booking, all owners
                          ->  Hash  ->  Seq Scan on "Client" c
```

**`Booking` has no index on `clientId`.** PostgreSQL does not create one for a foreign key, and the
schema declares none — the only booking indexes are `@@index([barberId, startTime])` and the
`cancellationToken` unique. So the join has nothing to seek on, and the planner scans the table.

At today's volume this is correct and fast: 20 bookings, 0.74 ms, 9 shared buffers. The planner is
right to prefer a sequential scan at this size, and adding an index now would produce one nothing
uses — **D1 set the rule that indexes are added by measurement rather than assumption, and this
measurement says "not yet"**.

What the measurement does establish is the shape: the cost of drawing page one is proportional to the
shop's entire booking history, and it does not fall as the owner pages deeper. D4's own design got
this wrong in its risk section, calling it "offset degradation at very deep pages" — the degradation
is on **every** page, and offset depth is the smaller half.

The fixes, in rising cost:

- **An index on `Booking.clientId`**, which turns the scan into a lookup per client on the page. The
  cheap and obvious first move, once there is enough data for the planner to choose it.
- **Drop `count(*) OVER ()`** and accept not knowing the total, or compute it separately with its own
  cheap `COUNT` — the window is what forces the aggregate over every group before the limit.
- **Stop ordering by an aggregate.** Ordering by "most bookings" is what makes the whole set have to
  be computed. A stored `confirmedBookingCount` on `Client`, maintained by the booking write, makes
  the ordering indexable — and is a write-path change of the same family as T54 and T80.

- **Trigger:** measure again when `Booking` passes a few thousand rows, or on the first owner report
  that the clients page is slow. Re-run the `EXPLAIN` above rather than assuming which fix applies.
