## Context

Three tables already hold everything this story renders. `WorkingHours` (M5a) holds a barber's week as
wall-clock minutes per weekday; `TimeOff` (M5b) holds absences as instants; `Booking` (B4) holds
appointments as instants. The public booking flow already reads all three in one composed trip —
`IBarberAvailabilityRepository.findDayInputs` — and turns them into purchasable start times for a
stranger who has chosen a service.

Nobody has ever rendered them for the person who owns them. The owner's only view of appointments is
D1's recent list: ten rows, newest first, across every barber, ordered by creation. It answers *what
happened*, not *what does Tuesday look like*.

The constraints this design works inside are all pre-existing and all load-bearing:

- **The runtime is UTC and the business is at UTC−3.** `businessTime.ts` is the only module allowed to
  turn a wall clock into an instant, and `businessTime.test.ts` scans this directory for the banned
  runtime calendar getters — so the ban is enforced by a test rather than by memory.
- **There is no row-level security.** Tenancy is the `barber → location → ownerId` join, in every
  repository, on every method.
- **The connection pool is shared with the public booking flow** (T47), and B2 measured ~0.35–0.40 s
  per Supavisor round trip on this runtime. Round trips are the unit of cost here, not queries.
- **The Worker sits at 3131.48 KiB gzip** of the paid plan's 10 MiB (T51). A route that ships client
  JavaScript is a route that spends from that budget.
- **`scripts/*-gate.ts` is this project's answer to T58** — "a mock can certify a call that cannot
  work against the real database" — and T68 caps what that answer can prove from the development
  machine.

## Goals / Non-Goals

**Goals:**

- Render one barber's day: windows, absences, appointments, free time — from one round trip.
- Make a stranded appointment (T29) *look* wrong for the first time in the product.
- Keep the page free of client JavaScript, writes, and new dependencies.
- Keep the owner's history rule and the public sale rule separable, permanently and visibly.

**Non-Goals:**

- Cancelling, creating, or moving an appointment from this surface.
- Week and month views; live refresh; client contact details; per-appointment money.
- Fixing T29 (the stranding itself), T64 (the unanswered receipt), or T67 (the silent sweep). This
  story makes two of them visible and closes none.
- A second card grid at `/calendario`.

## Decisions

### D1 — The route hangs off the barber, and there is no `/calendario` index

`app/(dashboard)/barberos/[id]/calendario/page.tsx`, joining `editar`, `servicios`, `horarios` and
`ausencias` under the same `[id]`. The entry point is a fourth link on the card that already exists.

`frontend-standards.md`'s project-structure sketch lists a top-level `calendario/page.tsx`, written
before `/barberos` existed in its current form. Building it now would mean two card grids over the
same barbers, kept in step by hand, one of which duplicates the assignment counts and schedule
indicators the other already renders. **The sketch is corrected in this change** rather than left to
disagree with the code — `base-standards.md` §8 makes the docs' mutual consistency a rule, and a
structure diagram nobody updates is how the first disagreement gets in.

*Alternative considered:* `/calendario` as an index listing the cards, with `/calendario/[barberId]`
beneath it. Rejected: it moves the barber's calendar away from everything else about that barber, for
the sake of matching a sketch.

### D2 — Read-only, and therefore no action, no revalidation, no lock

D3's verb is *visualize*. C2 already ships owner cancellation from the dashboard home, and adding a
second caller of `cancelByOwner` here would mean a Server Action, a second composition root that can
write, a `revalidatePath` decision on a page whose barber id arrives from the URL, and a second place
that must get the guarded-transition contract right.

The whole story is one `SELECT`. That is what makes the rest of this design cheap.

*Alternative considered:* a cancel control on each appointment, reusing `(home)/actions.ts`. Rejected
for this story; it is the obvious follow-up once the calendar exists and the owner has used it.

### D3 — `calendarPresence`, a second predicate, and the most important decision here

`blocksAvailability(booking, now)` is the product's single definition of whether a time is on sale,
shared by the availability read, B4's transaction, B5's late confirmation and D2's approval. Reusing
it to decide what the calendar draws is the obvious move and it is **wrong**:

```
PENDING_APPROVAL → booking.startTime.getTime() >= now.getTime()
```

For any day in the past that returns `false`. An appointment whose transfer receipt nobody answered —
which the shop may well have served — would be filed as "no effect" on yesterday's calendar. The
booking's own comment explains why the blocking rule is right to do that (nothing can be sold into a
time being used right now), which is exactly why the calendar must ask a different question.

So `Booking.ts` gains:

```ts
export type CalendarPresence = 'confirmed' | 'awaitingApproval' | 'holding' | 'lapsed' | 'cancelled';
export function calendarPresence(booking: BlockingCandidate, now: Date): CalendarPresence
```

An exhaustive `switch`, not a set test, for the reason `isCancellableByOwner` gives about its own: a
sixth status must force a decision rather than default to invisible. `now` is taken for exactly one
case — the live/lapsed hold boundary, half-open like every other boundary here.

**This design deliberately creates the thing this project usually refuses to create: a second rule
over the same data.** The justification has to be written where both rules live, or a future reader
will helpfully collapse them. One is about *sale*, takes the clock seriously, and is shared with a
transaction under an advisory lock; the other is about *history*, and is shared with nothing. They are
allowed to differ, and the day they stop differing is the day a past appointment disappears.

*Alternative considered:* pass a `now` of the day's end for past days, so `blocksAvailability` answers
"was it blocking then". Rejected: it makes the calendar's correctness depend on a subtle argument
choice at every call site, and it still gives the wrong answer for a hold that lapsed mid-day.

### D4 — Two lanes: the timeline occupies, the secondary region records

`confirmed | awaitingApproval | holding` → the timeline. `lapsed | cancelled` → a `<details>` region
below it, with a count, closed by default.

A cancelled booking and its replacement at the same time is the normal state of any shop that has ever
had a cancellation. Drawn in one lane they overlap, and the timeline then asserts the barber is in two
places at once. `<details>` rather than a client-side toggle keeps the page at zero JavaScript.

### D5 — Free time is `subtractAll`, and it is time rather than slots

`availability.ts` already exports `subtractAll(window, blockers)`. Free time is
`subtractAll(workingIntervalsFor(date, windows), [...absences, ...occupying])`, flattened per window.

**`generateSlots` is not called**, and this is a rule rather than an omission: slot generation needs a
service duration and a lead time. This page has neither — no service is chosen — so any grid it drew
would be a bookability claim it cannot support. The distinction is written into the spec because
"add a slot grid, we already have the function" is a plausible and wrong follow-up.

### D6 — A new port, `IBarberCalendarRepository`, one method, one round trip

Not a widened `IBarberAvailabilityRepository`: that contract's projection is four columns and its own
comment says so, because it serves an anonymous availability read. A client's name has no business in
it. Not a method on `IBookingRepository` either — that port promises aggregate reads and writes, and
this is a page's composed projection.

The precedent is `IDashboardSummaryRepository`, whose header argues the separation is about **shape**,
not scoping. Every method here still takes `ownerId`, so an unscoped calendar query stays
inexpressible.

```ts
findDay(input: { barberId: string; ownerId: string; weekday: number; range: Interval })
  : Promise<BarberCalendarDay | null>
```

`null` carries both "no such barber" and "not yours". The page calls `notFound()` on it, so the
oracle is closed by the *shape of the return type* rather than by a branch someone can split later —
the rule `barberos/[id]/horarios/page.tsx` already applies.

One trip is a contract, not an optimization: the barber's name, the windows, the absences and the
appointments all arrive from one `barber.findFirst` with three nested selections, under the owner
predicate. Four trips at ~0.4 s each is a page that feels broken, on a pool the booking flow shares.

### D7 — Overlap at both ends, on both range reads

`startTime >= start AND startTime < end` is the filter one writes without thinking, and it silently
drops a 23:30 appointment from the following day and erases a three-day absence from its middle day.
Both reads use `start < range.end AND end > range.start`. The existing
`@@index([barberId, startTime])` and `@@index([barberId, startsAt])` still lead the scan; the second
predicate is a filter, not a seek, and at a barber-day's volume that is not worth an index.

### D8 — The `dia` parameter follows `recentBookingsParams.ts` exactly

Spanish name, first-occurrence resolution for repeated parameters, a generous length bound before
parsing, `parseLocalDate` for the parse, and **degradation to today** for anything that fails —
never a 404 and never a throw.

The window is `[today − 365, today + MAX_BOOKING_HORIZON_DAYS]`. The past is open because a calendar
whose history is unreachable cannot answer the question an owner actually has about a no-show; 365 is
a bound rather than a measurement, declared as a named constant beside the horizon it borrows from, so
the next answer is a one-line change.

**The one difference from D1's filter:** that resolver matches a submitted id against a list the
owner's own scope produced. A date has no such list, so the bound and the parser *are* the validation
— which is safe here because the resolved day only ever becomes two instants, and never a string in a
query.

### D9 — Business time, asserted at the composition root

`businessToday`, `dayBoundsOf`, `weekdayOfLocalDate` — all existing. `hasTimezoneSupport()` is
asserted at the composition root, before a repository is constructed, which is the only place early
enough that no wrong day can be computed. The service holds the same invariant for any future caller
that did not come through that root, the pattern `PublicAvailabilityService` established.

### D10 — The stranded badge is a pure containment test, and it reports only

`isStranded(appointment, windows, absences)` in `barberCalendarDay.ts`: the appointment's interval is
not fully contained in the union of the day's working intervals, **or** it overlaps an absence. Both
operands are already in hand; the check costs no query and no round trip.

T29's trigger names this story: *"the first place where a stranded one looks wrong rather than merely
being present."* This closes the *surfacing* half. It does **not** refuse a narrowing schedule edit,
so T29 stays open and is re-costed with its trigger marked answered-in-part — the same honesty D1
applied when it arrived and did *not* satisfy the trigger it had been assigned.

An appointment on a weekday with **no** windows at all is stranded by the same test (the union is
empty, so nothing contains it) and must still render — with nothing to sit inside, it goes at its own
time in an otherwise unframed day.

### D11 — Native `<input type="date">`, not `react-day-picker`

`frontend-standards.md:59` names `react-day-picker` for date selection, and that reference is about
the public booking flow's client-side needs. Here it would be the **first and only** client component
on the route: the page stops being zero-JS, the dashboard's `useActionState`/no-JS problem (T44)
acquires another instance, and the Worker pays bundle for a control that a native date input plus a
GET form already provides — the `RecentBookingsFilter` pattern, shipped and working.

Recorded as a deliberate deviation from the standards document, with the reason, rather than done
quietly.

### D12 — `prefetch={false}` on every day link, for a weaker reason than `StepLink`'s

Next prefetches `<Link>`s in the viewport, and `StepLink` turns that off in the booking flow on a
**measured** basis: each prefetch there fired a full catalogue read, so a step cost `1 + L` queries.

**This route is not that case, and the first version of this decision said it was.** The calendar has
a `loading.tsx`, and the App Router's default prefetch for a dynamic route stops at the nearest
loading boundary — so the database read almost certainly does not fire, and neither behaviour has
been measured here.

The prop stays, on the honest reason: it avoids an RSC payload request per link in the viewport for
days the owner may never open, on a pool the public flow shares (T47), and it keeps one convention
for navigating between server-rendered reads. Set directly rather than through a wrapper, because
three links do not justify a component.

**Recorded as a correction rather than edited away**, because "a database round trip per hover" is
exactly the kind of measurement-shaped claim that stops the next reader checking — the class of defect
this project has caught in N1, C2 and C1.

### D13 — Failure degrades inside the page, and never renders as an empty day

The page is one read, so a failure has nothing to fall back to — which makes "render zero" the
tempting default and the wrong one. D1's rule: **zero and failure never render alike.** A failed read
produces a failure card inside the page; the error boundary is not reached, because reaching it
replaces the page and loses the day navigation the owner would use to retry.

### D14 — Two empty states, not one

"This barber does not work Sundays" and "this barber works Tuesdays and has nothing booked" are
opposite facts. One shared empty state makes a configured schedule look like a missing one, and sends
the owner to the schedule editor to fix something that is not broken. The first carries the route to
`/barberos/[id]/horarios`; the second does not.

### D15 — The projection is narrow by design, and a test says so

Seven fields per appointment: id, start, end, status, hold deadline, client display name, service
name, plus the cancellation actor. No email, no telephone (D4's), no price, no deposit (D5's). No
absence `reason` — M5b confined that field structurally because it can hold medical information, and
this is a consumer it was confined against.

The composition root builds a Prisma client, a clock and a logger, and nothing else: no cipher, no
storage client, no Supabase session client. A test asserts the root's contents, so the claim and the
code cannot drift — the correction C2 had to make when a root asserted a test that did not exist.

## Risks / Trade-offs

- **[The two predicates get merged by a well-meaning refactor]** → The reason lives in
  `calendarPresence`'s doc comment *and* in a spec requirement, and a unit test asserts the past
  `PENDING_APPROVAL` case explicitly, so the merge goes red rather than silent.
- **[T68 prevents the gate from proving the volume case from the development machine]** → A busy day
  exceeds the ~1.4 KB response ceiling and hangs indefinitely rather than failing. Confirm the path
  with the documented `repeat('x', 1400)` one-liner first; run the gate from an unaffected path; and
  report any probe that cannot run as **not run**. This is the third story to inherit T68 and the
  first whose main read is squarely over the ceiling.
- **[The calendar shows a slot as free that the booking flow will refuse]** → It can: free *time* is
  not a bookable *slot*, because no service duration and no lead time are applied. Mitigated by never
  rendering a slot grid and by copy that says "libre" rather than "disponible para reservar".
- **[An owner can drive one round trip per `?fecha=` request, on the shared pool]** → Session-bound and
  single-tenant, so the realistic ceiling is one owner clicking. `prefetch={false}` removes the
  accidental multiplier, which was the real risk. Worth a debt note that the dashboard has no
  authenticated rate limit anywhere, not a mechanism in this story.
- **[The stranded badge fires on data that is merely old]** → An appointment booked legitimately under
  a schedule that has since changed *is* the condition; the badge states a fact about now, not a
  fault. Copy must therefore describe the appointment's relation to the current schedule, not accuse
  anyone of an error.
- **[A day with many appointments becomes unreadable on a phone]** → An ordered list rather than a
  positioned grid, so density degrades into scrolling rather than into overlap.
- **[The page is a snapshot and the owner may read it as live]** → No relative timestamps, no "en
  vivo", nothing that implies freshness. D8 owns polling.

## Migration Plan

**No database migration.** No column, no enum value, no index. `@@index([barberId, startTime])`,
`@@index([barberId, dayOfWeek])` and `@@index([barberId, startsAt])` already back the three reads;
the plan is to be **confirmed by the gate**, not assumed.

Deployment is an ordinary Worker deploy. Rollback is a redeploy of the previous version: the change
adds one route and one link and writes nothing, so there is no state to unwind and no half-applied
condition to detect.

Order of work is the tasks list: pure rules and their tests first, then the port and its adapter, then
the page, then the entry link, then the gate, then the runtime pass, then the docs.

## Open Questions

- **Is 365 days the right amount of past?** It is a guess, named as one, and cheap to change. The
  first owner who wants last year's Christmas week will settle it.
- **Should the timeline mark "now" on today's view?** Omitted: a static line is wrong the moment the
  page ages, and a live one costs the zero-JS property. Revisit with D8, which is where liveness
  belongs.
- **Does the calendar eventually get the cancel control (D2)?** Likely, and it should be its own story
  so the guarded transition gets its own verification rather than riding in on a read.
