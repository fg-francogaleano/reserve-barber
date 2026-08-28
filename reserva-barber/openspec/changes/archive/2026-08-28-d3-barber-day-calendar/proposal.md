## Why

**The product has a card per barber and nothing behind it.** `project-context.md` describes the
dashboard's calendar in one sentence — *"una tarjeta por barbero y, al hacer clic, el calendario
individual de ese barbero con sus turnos"* — and the cards have existed since M2. They route to the
editor, to the service assignment, to the schedule and to the absences. They do not route to a
calendar, because there isn't one.

What the owner has instead is D1's recent-bookings list: the newest ten rows, ordered by creation,
across every barber. That answers *"what happened since I last looked"*. It cannot answer *"what does
Tuesday look like for Nico"*, which is the question a shop actually asks before promising a client a
time on the phone. `RECENT_BOOKINGS_LIMIT`'s own comment names the successor: *"A shop taking more
than ten bookings between glances has outgrown this list rather than this constant, and wants D3's
calendar."*

**Three facts are already stored and have never been shown together.** Working hours (M5a), absences
(M5b) and bookings (B4) are read as one composed trip by the public booking flow, which turns them
into slots for a stranger choosing a time. Nobody has ever rendered them for the person who owns
them. The owner can see the schedule they configured and the appointments that were taken, on two
different pages, and cannot see one against the other.

**That gap has a measured cost, and `tech-debt.md` names this story as the place it becomes
visible.** T29 — a schedule edit strands the bookings already inside the window it narrowed — was
re-costed at D1 with the note that the dashboard *could* have shown a stranded appointment and does
not: it renders in the recent list looking entirely ordinary, because nothing on that page compares a
booking against the schedule it was made under. The entry's trigger, verbatim, is **D3, "whose
per-barber calendar renders appointments _against_ a schedule and is therefore the first place where
a stranded one looks wrong rather than merely being present."** Rendering the two together is not a
side effect of this story; it is the reason the debt entry pointed here.

## What Changes

### The capability

- **A read-only day calendar** at `/barberos/[id]/calendario?fecha=YYYY-MM-DD`, showing one barber on
  one day: the working windows that frame it, the absences that cut into it, the appointments inside
  it, and the free time left over.
- **The existing barber card gains its fourth link.** `/barberos` is already the card-per-barber
  surface the brief describes; the click it never had now goes somewhere.
- **A new owner-scoped read-only port, `IBarberCalendarRepository.findDay`**, returning the barber's
  identity, windows, absences and appointments in **one round trip**, and `null` for an id that
  resolves to nothing *within this owner's scope*. Unknown and foreign are the same answer, because a
  differential one is an enumeration oracle.
- **Free *time*, never bookable *slots*.** `generateSlots` needs a service duration and no service is
  chosen on this surface. The calendar composes gaps with `subtractAll` and states nothing about
  bookability.
- **No migration.** `@@index([barberId, startTime])`, `@@index([barberId, dayOfWeek])` and
  `@@index([barberId, startsAt])` already back all three reads.

### The rule this story could not borrow, and why that matters

`blocksAvailability` answers *"is this time still on sale right now"*. A calendar asks *"what was
real on this day"*, and the two diverge on any past date: a `PENDING_APPROVAL` booking whose
appointment has already started returns `false` from the blocking rule — correctly, since nothing can
be sold into a time that is being used — so yesterday's unanswered-receipt appointment would be drawn
as though it had never existed.

So the calendar gets **`calendarPresence`**, a second pure predicate in `Booking.ts` over the same
status union, a `switch` rather than a set test, documented against the first. This is the opposite of
the project's usual instinct — `blocksAvailability` has one home precisely so the read side and the
write side cannot disagree — and the distinction is written down so the next reader does not
"simplify" the two back together: **one predicate is about sale, asks the clock, and is shared with a
transaction; the other is about history, and is shared with nothing.**

### What the edge-case pass forced into scope

Each of these is a defect the obvious implementation ships:

- **A stranded appointment renders as ordinary.** The containment test costs nothing — both operands
  arrive in the same read — and T29's trigger names this story. D3 **reports** it; it does not refuse
  a schedule edit, so the debt is re-costed rather than closed.
- **A day with no working hours reads identically to a day with hours and nothing booked.** Two
  opposite facts — *closed* and *open and free* — collapsing into one empty state is the single most
  likely UX defect here.
- **An appointment crossing midnight disappears** from one of its two days under a `startTime IN
  [day)` filter. The read is an overlap test at both ends, as is the absence read, or a multi-day
  absence vanishes from its middle days.
- **A lapsed hold the sweeper has not yet collected** must not be drawn as occupying a slot that is
  back on sale, and a cancelled booking must not be painted over the confirmed one that replaced it.
  Terminal and lapsed rows go to a secondary region so the timeline never shows two appointments in
  one place.
- **`?fecha=` is stranger-shaped input on an authenticated page.** Bounded in length, parsed, clamped to
  a window, and degraded to today — never a 404, never an exception. The rule
  `recentBookingsParams.ts` established for the only other read filter in this dashboard.
- **Next's default link prefetch fetches an RSC payload per day link in the viewport**, for days the
  owner may never open, against the pool the public booking flow shares (T47). `prefetch={false}`,
  following `StepLink` — though **not** for `StepLink`'s measured reason: this route has a
  `loading.tsx`, so the default prefetch stops at that boundary and the database read almost certainly
  does not fire. Design D12 records the correction.
- **A failed read must not render an empty day.** Zero and failure never look alike (D1's rule), and
  the failure belongs in a card inside the page rather than in the route's error boundary.

### What is deliberately not here

- **No writes.** C2 already gives the owner cancellation from the dashboard home. A story whose verb
  is *visualize* does not become the second writer of `cancelByOwner`.
- **No `/calendario` index page**, despite the sketch in `frontend-standards.md`'s project structure.
  `/barberos` **is** the card grid; a second one is two surfaces to keep in step. The sketch is
  corrected as part of this change rather than left to disagree with the code.
- **No week or month view.** The brief says *día por día*, and a month grid is thirty compositions per
  render.
- **No live refresh** (D8 owns polling), **no client contact details** (D4), **no money** (D5).
- **No `react-day-picker`**, though `frontend-standards.md` names it for client-side date selection.
  Here it would be the first client component on the route and the whole reason the page stops being
  zero-JS, for a control a native `<input type="date">` in a GET form already provides.

## Capabilities

### New Capabilities

- `barber-calendar`: the per-barber day view. What a day is composed of, which appointments occupy it
  and which are merely recorded, how free time is derived, how the day parameter is resolved and
  bounded, how a stranded appointment is detected and named, every empty and failure state, the
  one-round-trip read contract and its owner scoping, and the gate that proves it against the live
  database.

A new capability rather than a section of `booking-availability`, which owns the rule that turns the
same three inputs into *purchasable* times for a stranger. Both read the same rows; they answer
different questions, to different people, with different consequences for being wrong. Folding the
owner's history view into the spec that governs what may be sold would put one document in charge of
two rules that must be allowed to differ — which is exactly the difference `calendarPresence` exists
to hold.

### Modified Capabilities

- `barber-management`: the barbers list gains a fourth route, alongside the three requirements that
  already govern what its cards show and where they lead.

## Impact

**New:**
- `app/(dashboard)/barberos/[id]/calendario/` — `page.tsx`, `loading.tsx`, `DayNavigation.tsx`, the
  composition root, and the page test.
- `src/server/domain/repositories/IBarberCalendarRepository.ts` — the port.
- `src/server/infrastructure/prisma/PrismaBarberCalendarRepository.ts` — the adapter.
- `src/server/application/services/BarberCalendarService.ts` — the composition.
- `src/server/application/dashboard/barberCalendarParams.ts` — the `dia` resolver.
- `src/server/domain/models/barberCalendarDay.ts` — the pure day rules: lanes, free-time subtraction,
  stranded detection.
- `scripts/d3-gate.ts`.

**Modified:**
- `src/server/domain/models/Booking.ts` — `calendarPresence`, and the comment that says why it is not
  `blocksAvailability`.
- `app/(dashboard)/barberos/page.tsx` — one link per card, no new query.
- `src/lib/copy.ts` — the `barberCalendar` namespace.
- `docs/frontend-standards.md` — the project-structure sketch, which names a `calendario/page.tsx`
  this change deliberately does not build.
- `docs/tech-debt.md` — T29 re-costed (its trigger is answered in part), T64 gains its first surface,
  T68 re-confirmed against this gate.
- `docs/roadmap.md` — the D3 entry.

**Dependencies:** none added. No package, no provider, no environment variable, **no external call of
any kind** — no gateway, no mail, no storage, no credential decryption. The composition root is the
thinnest since D1's, and a test asserts it, so the count of surfaces permitted to decrypt a Mercado
Pago credential is provably unchanged.

**Verification:** `scripts/d3-gate.ts` against the live database — cross-owner isolation on a
two-owner fixture, a split shift, a three-day absence, a midnight-crossing booking, a stranded
appointment produced by actually narrowing a schedule, and the round trip **measured** rather than
assumed. Then a runtime pass on Node and `workerd`, including one inside the 21:00–00:00 ART window
with `TZ=UTC` forced, where the runtime's calendar reads tomorrow and the business's does not.

> ⚠ **T68 caps this gate.** A path-MTU black hole on the development machine's route to Supavisor
> makes any database response over ~1.4 KB hang indefinitely rather than fail, and the debt entry
> names D3's calendar as one of the reads that exceeds it. The gate must be run from an unaffected
> path, confirmed first with the one-line `repeat('x', 1400)` check, and **any probe that cannot run
> is reported as not run — never as passed.**
