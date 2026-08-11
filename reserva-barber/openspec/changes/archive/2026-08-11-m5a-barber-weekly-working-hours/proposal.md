## Why

Every barber in the system is currently available at all times and at no times: nothing records when they work. B3 cannot generate a single slot without it, and M4's assignment editor already lets the owner make a service bookable by a barber whose schedule does not exist.

This is also the story where **time semantics enter the product**, and the project has no decision on record about them. Migrations generate `TIMESTAMP(3)` without a time zone, the Worker runs in UTC, and the business and its clients are in Argentina (UTC−3). "We open at nine" is a wall-clock fact, not an instant. Getting that wrong here propagates into B3's slot generation and B4's booking rows, where it becomes expensive to unwind.

M5 was split: this change covers the **recurring weekly schedule** only. Time off (M5b) is a separate entity with a different write shape and is independent of this one; B3 depends on both.

## What Changes

- Add the `WorkingHours` model and migration: one window per barber per weekday, stored as **minutes from midnight in business local time** — never an instant.
- Add a weekly schedule editor at `/barberos/[id]/horarios`: seven days, one window each, native `<input type="time">`, operable before hydration.
- Establish the project's **time convention** in one place: a business timezone constant, a single conversion helper, and an explicit ban on `getDay()` / `getHours()` / `toISOString().slice(0,10)` in scheduling code — each of which silently returns a UTC answer that is wrong for three hours of every local day.
- Gate that convention against the deployment runtime **before writing the schema**: `Intl` timezone support needs tzdata, a different dataset from the locale data M3 verified, and its absence degrades silently to UTC rather than throwing.
- The barbers list gains a "no schedule" indicator, so a barber who cannot be booked is visible without opening them.
- Record for B4 that `Booking.startTime` must be `timestamptz`, since the project's current convention would produce a zone-less column.
- **BREAKING to the written spec, not to any data:** `data-model.md` §8 currently permits multiple non-overlapping windows per day. This change narrows the product surface to one window per day per the owner's decision, while keeping the schema capable of more so the reversal costs no migration.

## Capabilities

### New Capabilities
- `barber-working-hours`: the owner defines each barber's recurring weekly schedule — the editor, the one-window-per-day rule, wall-clock storage, the replace-whole-week write, and the Spanish (es-AR) states of the form.

### Modified Capabilities
- `data-persistence`: the `WorkingHours` model as single source of truth, the whole-week replace performed in one transaction, and the project's stored-time convention (wall-clock minutes for recurring schedules, UTC instants for points in time).
- `barber-management`: the barbers list gains a schedule indicator and a route into the editor.

## Impact

**Schema** — new `WorkingHours` model and migration `add_working_hours`; back-relation on `Barber`; both Prisma clients regenerated. Purely additive.

**Server layers** — new `IWorkingHoursRepository`, `PrismaWorkingHoursRepository`, `BarberScheduleService`, `workingHoursSchema`, and domain modules for the business timezone and the weekday mapping.

**Presentation** — new route group `app/(dashboard)/barberos/[id]/horarios/`; modifications to `app/(dashboard)/barberos/page.tsx` and `src/lib/copy.ts`; a new `src/lib/formatTime.ts`.

**Runtime risk** — first use of timezone-aware conversion on `workerd`. Gated by the first implementation task, with a designed fallback (a fixed −03:00 offset, which is exactly correct while Argentina observes no DST) so a negative result does not reopen the design.

**Downstream** — unblocks half of B3. `Booking` is untouched; no payment or availability story is affected.

**Not affected** — time off (M5b), business holidays, per-location schedules, split shifts.
