## Context

M1–M4 shipped without ever storing a time. Every timestamp so far is `createdAt`/`updatedAt` — written by the database, read by nobody, and correct in any zone because nothing compares them to a human's clock. This change ends that: `WorkingHours` records a fact a person states in their own local time ("we open at nine"), and B3 will compare it against instants.

Three facts about the runtime shape the design:

- **`workerd` runs in UTC.** Argentina is UTC−3 with no DST since 2009. Between 21:00 and 23:59 local, the UTC date has already rolled over, so any weekday or calendar-day derived from the runtime clock is wrong for three hours of every day — and returns a plausible answer rather than throwing.
- **Migrations generate `TIMESTAMP(3)`, zone-less.** Fine for `createdAt`; not fine for anything compared against a wall clock.
- **`Intl` locale data is verified, tzdata is not.** M3 proved `Intl.NumberFormat('es-AR')` works. Timezone conversion needs a separate dataset, and most runtimes missing it fall back to UTC silently.

The owner has decided the product surface: **one continuous window per day**, no shift crossing midnight, and time off handled separately (M5b).

## Goals / Non-Goals

**Goals:**
- Record each barber's recurring weekly schedule accurately enough that B3 can generate slots from it without re-deciding anything.
- Establish the project's time convention once, in one module, so B3 and B4 inherit it rather than reinventing it.
- Make the write idempotent under retry, given that a schedule row has no natural business key.
- Keep the schema capable of the split shift the product surface currently omits.

**Non-Goals:**
- Time off, holidays, per-location schedules, one-off exceptions (all M5b or later).
- Slot generation (B3).
- Split shifts in the UI — deliberately deferred, see D3.
- Reconciling existing bookings with a schedule change; no bookings exist yet.

## Decisions

### D1 — Recurring schedules store wall-clock minutes; points in time store UTC instants
`WorkingHours.startMinute` / `endMinute` are `Int` minutes from midnight **in business local time**. They are not instants and must never be converted at rest.

A recurring schedule is a statement about a clock face, not about a moment. Storing an offset or an instant would mean that if Argentina ever reinstates DST, "nine o'clock" silently becomes eight or ten. Storing the wall clock keeps the owner's statement true and pushes the conversion to the one place that needs it — comparing against a booking.

*Alternative considered — `String` "HH:mm"* (which `data-model.md` §8 offered as an equal option): rejected. B3's arithmetic is addition and comparison; a string demands parsing at every step and invites lexicographic comparison, which happens to work until it does not. The formatting back to "09:00" belongs in presentation, exactly as `formatCurrency` does for M3's money.

Points in time — `TimeOff` in M5b, `Booking.startTime` in B4 — are UTC instants in `timestamptz`. Recorded here because B4 would otherwise inherit the project's zone-less default.

### D2 — One timezone module, and a ban on the runtime clock's calendar methods
A single domain module owns the business timezone and every local↔UTC conversion. Scheduling code may not call `getDay()`, `getHours()`, `getDate()`, or `toISOString().slice(0,10)`.

This is not style. Each of those returns the UTC answer, which is wrong for the last three hours of every Argentine day, and each returns a valid-looking number while being wrong. A lint-level or review-level prohibition is the only defence, because no test that runs during Argentine business hours will catch it.

The timezone is a **constant**, not a column on `Location`. Every branch is in Argentina; a per-location zone is machinery for a case that does not exist. The trigger to revisit is a location outside AR.

### D3 — One window per day in the product, many in the schema
The editor offers exactly one window per weekday. The schema carries `@@unique([barberId, dayOfWeek, startMinute])` rather than `@@unique([barberId, dayOfWeek])`.

The owner's decision governs the surface, and it makes this change substantially smaller: no overlap invariant, no window ordering, no per-window error targeting. But the split shift (9–13, 16–20) is the common Argentine pattern, and `data-model.md` §8 explicitly permitted it for that reason. Encoding "one per day" into the constraint would make the reversal a migration over live data; leaving the constraint at the wider shape makes it a UI change plus re-enabling a validation.

The cost of keeping it open is one extra column in an index. The cost of closing it is a migration. That asymmetry decides it.

**Consequence to record rather than hide:** with one window, a barber working a split shift must enter 9–20, and B3 will offer slots during the midday break. That is a real booking defect, it belongs to B3, and it is recorded as debt now rather than discovered then.

### D4 — The whole week is replaced inside one transaction, not diffed
The write deletes every window for the barber and inserts the submitted set, in one batched `$transaction`.

M4 solved a superficially identical problem with a rendered-baseline diff, and reusing it here would be wrong twice over. First, it is unnecessary: M4 needed a baseline because its form rendered a *subset* of the assignable services, whereas this form always renders all seven days, so its baseline is the entire week and a full replace is exactly equivalent. Second, it is unsafe: M4's idempotence came from `@@unique(barberId, serviceId)` plus `skipDuplicates`, and a weekly schedule has no comparable natural key — a retry after a committed-but-timed-out write would insert a second copy of the whole week.

Replace-in-transaction is idempotent by construction: the end state is the submitted set regardless of how many times it runs.

*Alternative considered — per-row diff with a unique key:* rejected as more machinery for the same result.

### D5 — Timezone support is gated before the schema is written
A runtime gate must prove, on `workerd` against the deployed shape, that `Intl.DateTimeFormat` with `America/Argentina/Buenos_Aires` performs a correct round trip. It runs **first**, because a negative result changes the implementation of D1 and D2.

**Designed fallback:** a fixed `-03:00` offset constant. Argentina has observed no DST since 2009, so this is not an approximation today — it is exactly correct, with a documented trigger if DST returns. That is why a negative gate result does not reopen the design.

### D6 — Zero windows is a legitimate state, and is indistinguishable from "never configured"
A barber with no rows works no days. This is also the state of every barber created before this change. The two are the same row-set and the product does not attempt to tell them apart: the list says "sin horario", which is true and actionable in both cases.

Distinguishing them would need a "configured at" marker whose only consumer would be a slightly different sentence.

### D7 — `type="time"`, and empty means "does not work that day"
Native `<input type="time">`, no `step`. The server validates the 5-minute granularity, per the house rule that the browser is a convenience and not the authority.

M3 banned `type="number"` because a rejected parse submits an empty string, making "missing" indistinguishable from "malformed". That failure does not arise here: an empty time field **is** a meaningful state — the barber does not work that day. The only genuine error is a half-filled pair, which is detected explicitly.

`type="time"` renders in the browser's locale, so an en-US browser shows AM/PM while the interface is es-AR. The submitted value is always 24-hour `HH:mm`, so correctness is unaffected and no code can override the display.

## Risks / Trade-offs

- **`workerd` lacks tzdata** → Gated first (D5) with a fallback that is exactly correct for the current market. Residual risk is a wrong assumption about the fallback's lifetime, tracked against DST returning.

- **A UTC calendar method slips into scheduling code later** → The ban is a convention, and conventions decay. Mitigated by concentrating conversion in one module and by a test that asserts the weekday resolver disagrees with the runtime clock at 21:00–23:59 local — a test that fails loudly if someone reintroduces `getDay()`.

- **The split-shift gap produces bookings during a closed midday** → Real, and belongs to B3. Recorded as debt with the schema left capable so the fix is a UI change.

- **A schedule edited after bookings exist strands appointments outside working hours** → Same shape as T14. No bookings exist; trigger is B4.

- **Seven day-groups in one form reproduce M4's `<fieldset>` overflow** → `min-width: min-content` from the UA stylesheet is a known, already-diagnosed defect; the classes go in from the start rather than being rediscovered at 360px.

## Migration Plan

1. Run the timezone gate (D5) before touching the schema.
2. Schema-only migration `add_working_hours` — purely additive, no backfill, no existing table altered.
3. Regenerate both Prisma clients.
4. Ship the write path, then the editor, then the list indicator.

**Rollback:** the migration is additive and the feature is reachable only from a new route. Reverting the application code leaves an unused table that nothing reads until B3.

## Open Questions

None. The four product questions this change depended on — closing time, windows per day, the M5 split, and holiday urgency — were answered before it was written, and their consequences are recorded above rather than left implicit.
